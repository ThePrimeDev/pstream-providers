import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const MOZISAROK_API_BASE = 'https://api.mozisarok.hu';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

// Dedicated credentials for Mozisarok API
const AUTH_CREDENTIALS = {
  username: 'xdxd',
  password: 'Prime12791376.',
};

let cachedAuthToken: string | null = null;
let cachedTokenExpiry = 0; // unix seconds

interface MozisarokLink {
  id: number;
  tmdb_id: number;
  media_type: number;
  season?: number;
  episode?: number;
  url: string;
  sandbox?: boolean;
  quality?: {
    id: number;
    short_name: string;
    formatted: string;
  };
  language?: {
    id: number;
    short_name: string;
    formatted: string;
  };
  subtitle?: {
    id: number;
    short_name: string;
    formatted: string;
  };
  uploader?: {
    id: number;
    username: string;
  };
  view_count?: number;
}

async function getAuthToken(ctx: MovieScrapeContext | ShowScrapeContext): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAuthToken && now < cachedTokenExpiry - 300) {
    return cachedAuthToken;
  }

  console.log('[Mozisarok] Authenticating to get API token...');
  const loginUrl = `${MOZISAROK_API_BASE}/auth/login`;
  const resp = await ctx.proxiedFetcher<any>(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://mozisarok.hu',
      Referer: 'https://mozisarok.hu/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    },
    body: JSON.stringify(AUTH_CREDENTIALS),
  });

  const raw = typeof resp === 'string' ? resp : typeof resp?.body === 'string' ? resp.body : resp?.body || resp;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (!parsed?.token) {
    throw new NotFoundError('Mozisarok: Failed to authenticate');
  }

  cachedAuthToken = parsed.token;
  try {
    const payload = JSON.parse(Buffer.from(parsed.token.split('.')[1], 'base64').toString());
    cachedTokenExpiry = typeof payload.exp === 'number' ? payload.exp : now + 86400;
  } catch {
    cachedTokenExpiry = now + 86400;
  }

  console.log('[Mozisarok] Authenticated successfully, token cached');
  return cachedAuthToken!;
}

async function resolveTmdbId(
  ctx: MovieScrapeContext | ShowScrapeContext,
  mediaType: 'movie' | 'show',
): Promise<string | null> {
  if (ctx.media.tmdbId && ctx.media.tmdbId !== '0') {
    return String(ctx.media.tmdbId);
  }

  const typePath = mediaType === 'show' ? 'tv' : 'movie';
  const year = ctx.media.releaseYear;
  const yearParam = year ? (mediaType === 'show' ? `&first_air_date_year=${year}` : `&year=${year}`) : '';
  const searchUrl = `https://api.themoviedb.org/3/search/${typePath}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
    ctx.media.title,
  )}${yearParam}`;

  try {
    const resp = await fetch(searchUrl);
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data.results) && data.results.length > 0) {
        return String(data.results[0].id);
      }
    }
  } catch (err) {
    console.log('[Mozisarok] TMDb ID resolution error:', err);
  }
  return null;
}

function getEmbedId(targetUrl: string): string | null {
  const url = targetUrl.toLowerCase();
  if (url.includes('vk.com') || url.includes('vkvideo.ru')) return 'vk';
  if (url.includes('videa')) return 'videa';
  if (url.includes('indavideo')) return 'indavideo';
  if (url.includes('voe') || url.includes('delivery-node') || url.includes('voe-unblock')) return 'voe';
  if (url.includes('filemoon') || url.includes('bysefujedu') || url.includes('moonmov')) return 'filemoon';
  if (url.includes('ok.ru') || url.includes('odnoklassniki')) return 'okru';
  if (url.includes('vidara') || url.includes('gjsabgs')) return 'vidara';
  if (url.includes('rpmshare') || url.includes('rpmstream')) return 'rpmshare';
  if (url.includes('dood') || url.includes('ds2play') || url.includes('do0od') || url.includes('d0o0d')) return 'dood';
  if (url.includes('vidmoly')) return 'vidmoly';
  if (url.includes('streamwish') || url.includes('wishembed') || url.includes('strwish')) return 'streamwish-english';
  if (url.includes('vidhide') || url.includes('vidhidepro') || url.includes('dinisglows')) return 'vidhide-english';
  if (url.includes('mixdrop') || url.includes('mixdrp')) return 'mixdrop';
  if (url.includes('supervideo')) return 'supervideo';
  if (url.includes('turbovid')) return 'turbovid';
  if (url.includes('dropload')) return 'dropload';
  if (url.includes('filelions')) return 'filelions';
  if (url.includes('streamtape')) return 'streamtape';
  if (url.includes('streamvid')) return 'streamvid';
  if (
    url.includes('rubyvid') ||
    url.includes('streamruby') ||
    url.includes('rubystream') ||
    url.includes('sruby') ||
    url.includes('stmruby')
  )
    return 'rubyvid';
  return null;
}

function scoreLink(link: MozisarokLink): number {
  let score = 0;

  // Heavily penalize known broken or privacy-restricted uploaders
  const uploader = (link.uploader?.username ?? '').toLowerCase();
  if (uploader === 'xflesx' || uploader === 'orfk') {
    score -= 1000;
  }

  // Boost verified active and reliable uploaders
  if (['szabolcs', 'marxhme', 'nyam2007'].includes(uploader)) {
    score += 50;
  }

  // Quality score: UHD (5) = 500, FHD (4) = 400, HD (3) = 300, SD (2) = 200, CAM (1) = 100
  const qId = link.quality?.id ?? 0;
  score += qId * 100;

  // Prefer Hungarian audio (+50)
  if (link.language?.short_name?.toLowerCase() === 'hu') {
    score += 50;
  }

  // Hungarian subtitles (+20) if audio is not Hungarian
  if (link.subtitle?.short_name?.toLowerCase() === 'hu' && link.language?.short_name?.toLowerCase() !== 'hu') {
    score += 20;
  }

  // Popularity bonus based on view count (up to 50 points)
  if (link.view_count && typeof link.view_count === 'number') {
    score += Math.min(50, Math.floor(link.view_count / 50));
  }

  // Prefer VK and Videa
  const url = (link.url ?? '').toLowerCase();
  if (url.includes('vk.com') || url.includes('vkvideo.ru')) {
    score += 30;
  } else if (url.includes('videa')) {
    score += 20;
  }

  return score;
}

async function fetchLinks(
  ctx: MovieScrapeContext | ShowScrapeContext,
  mediaType: 'movie' | 'tv',
  tmdbId: string,
): Promise<MozisarokLink[]> {
  const token = await getAuthToken(ctx);
  const linksUrl = `${MOZISAROK_API_BASE}/media/links?type=${mediaType}&tmdb_id=${encodeURIComponent(tmdbId)}`;
  console.log(`[Mozisarok] Fetching links: ${linksUrl}`);

  let resp = await ctx.proxiedFetcher<any>(linksUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://mozisarok.hu',
      Referer: 'https://mozisarok.hu/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    },
  });

  let raw = typeof resp === 'string' ? resp : typeof resp?.body === 'string' ? resp.body : resp?.body || resp;
  let parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // If token expired / unauthorized, re-authenticate and retry once
  if (parsed?.error) {
    console.log(`[Mozisarok] API returned error: "${parsed.error}", re-authenticating...`);
    cachedAuthToken = null;
    const freshToken = await getAuthToken(ctx);
    resp = await ctx.proxiedFetcher<any>(linksUrl, {
      headers: {
        Authorization: `Bearer ${freshToken}`,
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://mozisarok.hu',
        Referer: 'https://mozisarok.hu/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    });
    raw = typeof resp === 'string' ? resp : typeof resp?.body === 'string' ? resp.body : resp?.body || resp;
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  if (Array.isArray(parsed?.links)) {
    return parsed.links;
  }
  return [];
}

export const mozisarokScraper = makeSourcerer({
  id: 'mozisarok',
  name: 'Mozisarok',
  rank: 132,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  async scrapeMovie(ctx: MovieScrapeContext): Promise<SourcererOutput> {
    console.log(`[Mozisarok] Scraping movie: "${ctx.media.title}" (${ctx.media.releaseYear})`);

    const tmdbId = await resolveTmdbId(ctx, 'movie');
    if (!tmdbId) {
      throw new NotFoundError('Mozisarok: TMDb ID not found');
    }

    const allLinks = await fetchLinks(ctx, 'movie', tmdbId);
    console.log(`[Mozisarok] Found ${allLinks.length} total movie links for TMDb ${tmdbId}`);

    const validLinks = allLinks.filter(
      (l) => !l.sandbox && (l.media_type === 1 || l.episode === 0 || (!l.season && !l.episode)),
    );

    if (validLinks.length === 0) {
      throw new NotFoundError('No valid links found on Mozisarok for this movie');
    }

    // Filter out known broken/restricted uploaders if working alternatives exist
    const hasActiveUploaders = validLinks.some(
      (l) => !['xflesx', 'orfk'].includes((l.uploader?.username ?? '').toLowerCase()),
    );
    const candidateLinks = hasActiveUploaders
      ? validLinks.filter((l) => !['xflesx', 'orfk'].includes((l.uploader?.username ?? '').toLowerCase()))
      : validLinks;

    // Sort by quality and language
    candidateLinks.sort((a, b) => scoreLink(b) - scoreLink(a));

    const embeds: SourcererEmbed[] = [];
    const seenUrls = new Set<string>();

    for (const link of candidateLinks) {
      if (!link.url || seenUrls.has(link.url)) continue;
      seenUrls.add(link.url);

      const embedId = getEmbedId(link.url);
      if (embedId) {
        embeds.push({
          embedId,
          url: link.url,
        });
      } else {
        console.log(`[Mozisarok] Unknown embed URL format: ${link.url}`);
      }
    }

    if (embeds.length === 0) {
      throw new NotFoundError('No supported embeds found on Mozisarok');
    }

    console.log(`[Mozisarok] Returning ${embeds.length} movie embeds sorted by quality`);
    return { embeds };
  },
  async scrapeShow(ctx: ShowScrapeContext): Promise<SourcererOutput> {
    console.log(
      `[Mozisarok] Scraping show: "${ctx.media.title}" S${ctx.media.season.number}E${ctx.media.episode.number}`,
    );

    const tmdbId = await resolveTmdbId(ctx, 'show');
    if (!tmdbId) {
      throw new NotFoundError('Mozisarok: TMDb ID not found');
    }

    const allLinks = await fetchLinks(ctx, 'tv', tmdbId);
    console.log(`[Mozisarok] Found ${allLinks.length} total TV links for TMDb ${tmdbId}`);

    const seasonNum = Number(ctx.media.season.number);
    const episodeNum = Number(ctx.media.episode.number);
    const validLinks = allLinks.filter(
      (l) => !l.sandbox && Number(l.season) === seasonNum && Number(l.episode) === episodeNum,
    );

    console.log(`[Mozisarok] Matched ${validLinks.length} links for S${seasonNum}E${episodeNum}`);

    if (validLinks.length === 0) {
      throw new NotFoundError(
        `No valid links found on Mozisarok for S${seasonNum}E${episodeNum}`,
      );
    }

    // Filter out known broken/restricted uploaders if working alternatives exist
    const hasActiveUploaders = validLinks.some(
      (l) => !['xflesx', 'orfk'].includes((l.uploader?.username ?? '').toLowerCase()),
    );
    const candidateLinks = hasActiveUploaders
      ? validLinks.filter((l) => !['xflesx', 'orfk'].includes((l.uploader?.username ?? '').toLowerCase()))
      : validLinks;

    // Sort by quality and language
    candidateLinks.sort((a, b) => scoreLink(b) - scoreLink(a));

    const embeds: SourcererEmbed[] = [];
    const seenUrls = new Set<string>();

    for (const link of candidateLinks) {
      if (!link.url || seenUrls.has(link.url)) continue;
      seenUrls.add(link.url);

      const embedId = getEmbedId(link.url);
      if (embedId) {
        embeds.push({
          embedId,
          url: link.url,
        });
      } else {
        console.log(`[Mozisarok] Unknown embed URL format: ${link.url}`);
      }
    }

    if (embeds.length === 0) {
      throw new NotFoundError('No supported embeds found on Mozisarok');
    }

    console.log(`[Mozisarok] Returning ${embeds.length} episode embeds sorted by quality`);
    return { embeds };
  },
});
