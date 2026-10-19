import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const FILMEZZMOZI_BASE = 'https://filmezzmozi.do.am';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: `${FILMEZZMOZI_BASE}/`,
};

function normalizeTitle(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getHungarianTitle(
  title: string,
  year?: number,
  tmdbId?: string,
  mediaType: 'movie' | 'show' = 'movie',
): Promise<string | null> {
  const typePath = mediaType === 'show' ? 'tv' : 'movie';
  try {
    if (tmdbId && tmdbId !== '0') {
      const url = `https://api.themoviedb.org/3/${typePath}/${tmdbId}?api_key=${TMDB_API_KEY}&language=hu-HU`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        const hu = mediaType === 'show' ? data.name : data.title;
        if (hu && typeof hu === 'string' && hu.trim()) {
          return hu.trim();
        }
      }
    }

    const yearParam = year ? (mediaType === 'show' ? `&first_air_date_year=${year}` : `&year=${year}`) : '';
    const searchUrl = `https://api.themoviedb.org/3/search/${typePath}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
      title,
    )}&language=hu-HU${yearParam}`;
    const searchResp = await fetch(searchUrl);
    if (searchResp.ok) {
      const data = await searchResp.json();
      if (Array.isArray(data.results) && data.results.length > 0) {
        const first = data.results[0];
        const hu = mediaType === 'show' ? first.name : first.title;
        if (hu && typeof hu === 'string' && hu.trim()) {
          return hu.trim();
        }
      }
    }

    if (year) {
      const fallbackUrl = `https://api.themoviedb.org/3/search/${typePath}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
        title,
      )}&language=hu-HU`;
      const fallbackResp = await fetch(fallbackUrl);
      if (fallbackResp.ok) {
        const fallbackData = await fallbackResp.json();
        if (Array.isArray(fallbackData.results) && fallbackData.results.length > 0) {
          const first = fallbackData.results[0];
          const hu = mediaType === 'show' ? first.name : first.title;
          if (hu && typeof hu === 'string' && hu.trim()) {
            return hu.trim();
          }
        }
      }
    }
  } catch (err) {
    console.log('[FilmezzMozi] TMDB Hungarian title lookup error:', err);
  }
  return null;
}

function getEmbedId(targetUrl: string): string | null {
  const url = targetUrl.toLowerCase();
  if (url.includes('videa')) return 'videa';
  if (url.includes('indavideo')) return 'indavideo';
  if (url.includes('ok.ru') || url.includes('odnoklassniki')) return 'okru';
  if (url.includes('vk.com') || url.includes('vkvideo.ru') || url.includes('vk.ru')) return 'vk';
  if (url.includes('fsst.online') || url.includes('incvideo1.online')) return 'fsst';
  if (url.includes('supervideo')) return 'supervideo';
  if (url.includes('mixdrop') || url.includes('mixdrp')) return 'mixdrop';
  if (url.includes('voe') || url.includes('megankiddifference') || url.includes('delivery-node')) return 'voe';
  if (
    url.includes('rubyvid') ||
    url.includes('streamruby') ||
    url.includes('rubystream') ||
    url.includes('sruby') ||
    url.includes('stmruby') ||
    url.includes('rubystm')
  )
    return 'rubyvid';
  if (url.includes('filemoon') || url.includes('moonplayer') || url.includes('bysezoxexe')) return 'filemoon';
  if (url.includes('vidhide') || url.includes('vidhidepro') || url.includes('dinisglows')) return 'vidhide-english';
  if (url.includes('dood') || url.includes('ds2play') || url.includes('do0od') || url.includes('d0o0d')) return 'dood';
  if (url.includes('streamtape')) return 'streamtape';
  if (url.includes('streamwish') || url.includes('wishembed') || url.includes('strwish')) return 'streamwish-english';
  if (url.includes('vidara') || url.includes('gjsabgs')) return 'vidara';
  if (url.includes('vidmoly')) return 'vidmoly';
  if (url.includes('rpmshare') || url.includes('rpmstream')) return 'rpmshare';
  return null;
}

async function resolveUTo(ctx: MovieScrapeContext | ShowScrapeContext, uToUrl: string): Promise<string | null> {
  try {
    const res = await ctx.proxiedFetcher.full<any>(uToUrl, {
      method: 'GET',
      headers: HEADERS,
    });
    const dest = res.headers.get('location') || res.finalUrl;
    if (dest && !dest.includes('u.to')) return dest;
  } catch {
    // ignore
  }
  return null;
}

function cleanCandidateTitle(raw: string): string {
  return raw
    .replace(/\s*\(\d{4}\)\s*/g, '')
    .replace(/\s*-\s*premier\s*/gi, '')
    .replace(/\s*teljes\s+film\s*/gi, '')
    .trim();
}

export const filmezzmoziScraper = makeSourcerer({
  id: 'filmezzmozi',
  name: 'Filmezz Mozi',
  rank: 133,
  flags: [flags.CORS_ALLOWED],
  disabled: false,
  async scrapeMovie(ctx: MovieScrapeContext): Promise<SourcererOutput> {
    const huTitle = await getHungarianTitle(ctx.media.title, ctx.media.releaseYear, ctx.media.tmdbId, 'movie');
    const searchQueries = new Set<string>();
    if (huTitle) searchQueries.add(huTitle);
    searchQueries.add(ctx.media.title);

    interface Candidate {
      title: string;
      url: string;
      year?: number;
    }

    const candidates: Candidate[] = [];

    for (const query of searchQueries) {
      try {
        const searchUrl = `${FILMEZZMOZI_BASE}/search/?q=${encodeURIComponent(query)}`;
        const html = await ctx.proxiedFetcher<string>(searchUrl, { headers: HEADERS });
        const $ = load(html);

        $('.block-title a[href^="/load/"]').each((_, el) => {
          const href = $(el).attr('href');
          const title = $(el).text().trim();
          if (!href || !title) return;

          let year: number | undefined;
          const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
          if (yearMatch) year = parseInt(yearMatch[1], 10);

          const fullUrl = href.startsWith('http') ? href : `${FILMEZZMOZI_BASE}${href}`;
          if (!candidates.some((c) => c.url === fullUrl)) {
            candidates.push({ title, url: fullUrl, year });
          }
        });
      } catch (err) {
        console.log(`[FilmezzMozi] Search error for query "${query}":`, err);
      }
    }

    if (candidates.length === 0) {
      throw new NotFoundError('No search results found on Filmezz Mozi');
    }

    const normOriginal = normalizeTitle(ctx.media.title);
    const normHu = huTitle ? normalizeTitle(huTitle) : null;

    let bestCandidate: Candidate | null = null;
    let highestScore = -1;

    for (const cand of candidates) {
      let score = 0;
      const candClean = cleanCandidateTitle(cand.title);
      const normCand = normalizeTitle(candClean);

      if (cand.year && ctx.media.releaseYear) {
        if (cand.year === ctx.media.releaseYear) score += 30;
        else if (Math.abs(cand.year - ctx.media.releaseYear) === 1) score += 10;
        else score -= 20;
      }

      if (normCand === normOriginal || (normHu && normCand === normHu)) {
        score += 50;
      } else if (normCand.includes(normOriginal) || (normHu && normCand.includes(normHu))) {
        score += 30;
      } else if (normOriginal.includes(normCand) || (normHu && normHu.includes(normCand))) {
        score += 20;
      }

      if (score > highestScore) {
        highestScore = score;
        bestCandidate = cand;
      }
    }

    if (!bestCandidate || highestScore < 10) {
      throw new NotFoundError('No matching title found on Filmezz Mozi');
    }

    const movieHtml = await ctx.proxiedFetcher<string>(bestCandidate.url, { headers: HEADERS });
    const $ = load(movieHtml);

    const rawUrls = new Set<string>();

    $('iframe[src]').each((_, el) => {
      let src = $(el).attr('src')?.trim();
      if (!src) return;
      if (src.startsWith('//')) src = `https:${src}`;
      if (
        src.includes('youtube.com') ||
        src.includes('mchat') ||
        src.includes('yadro') ||
        src.includes('ucoz') ||
        src.includes('google')
      )
        return;
      rawUrls.add(src);
    });

    $('table a[href], .style3 a[href], a[href*="u.to/"]').each((_, el) => {
      const href = $(el).attr('href')?.trim();
      if (!href) return;
      if (href.startsWith('http')) {
        rawUrls.add(href);
      }
    });

    const embeds: SourcererEmbed[] = [];
    const seenEmbedUrls = new Set<string>();

    for (const rawUrl of rawUrls) {
      let resolvedUrl: string | null = rawUrl;
      if (rawUrl.includes('u.to/')) {
        resolvedUrl = await resolveUTo(ctx, rawUrl);
      }
      if (!resolvedUrl) continue;

      const embedId = getEmbedId(resolvedUrl);
      if (embedId && !seenEmbedUrls.has(resolvedUrl)) {
        seenEmbedUrls.add(resolvedUrl);
        embeds.push({
          embedId,
          url: resolvedUrl,
        });
      }
    }

    if (embeds.length === 0) {
      throw new NotFoundError('No compatible video embeds found on Filmezz Mozi');
    }

    return { embeds };
  },

  async scrapeShow(ctx: ShowScrapeContext): Promise<SourcererOutput> {
    const huTitle = await getHungarianTitle(ctx.media.title, ctx.media.releaseYear, ctx.media.tmdbId, 'show');
    const searchQueries = new Set<string>();
    if (huTitle) searchQueries.add(huTitle);
    searchQueries.add(ctx.media.title);

    interface Candidate {
      title: string;
      url: string;
      season?: number;
    }

    const candidates: Candidate[] = [];

    for (const query of searchQueries) {
      try {
        const searchUrl = `${FILMEZZMOZI_BASE}/search/?q=${encodeURIComponent(query)}`;
        const html = await ctx.proxiedFetcher<string>(searchUrl, { headers: HEADERS });
        const $ = load(html);

        $('.block-title a[href^="/load/"]').each((_, el) => {
          const href = $(el).attr('href');
          const title = $(el).text().trim();
          if (!href || !title) return;

          let season: number | undefined;
          const sMatch = title.match(/(\d+)\s*\.?\s*évad/i);
          if (sMatch) season = parseInt(sMatch[1], 10);

          const fullUrl = href.startsWith('http') ? href : `${FILMEZZMOZI_BASE}${href}`;
          if (!candidates.some((c) => c.url === fullUrl)) {
            candidates.push({ title, url: fullUrl, season });
          }
        });
      } catch (err) {
        console.log(`[FilmezzMozi] Show search error for query "${query}":`, err);
      }
    }

    if (candidates.length === 0) {
      throw new NotFoundError('No search results found on Filmezz Mozi');
    }

    const normOriginal = normalizeTitle(ctx.media.title);
    const normHu = huTitle ? normalizeTitle(huTitle) : null;

    let bestCandidate: Candidate | null = null;
    let highestScore = -1;

    for (const cand of candidates) {
      let score = 0;
      const candClean = cleanCandidateTitle(cand.title);
      const normCand = normalizeTitle(candClean);

      if (cand.season !== undefined) {
        if (cand.season === ctx.media.season.number) score += 40;
        else score -= 30;
      }

      if (normCand === normOriginal || (normHu && normCand === normHu)) {
        score += 50;
      } else if (normCand.includes(normOriginal) || (normHu && normCand.includes(normHu))) {
        score += 30;
      }

      if (score > highestScore) {
        highestScore = score;
        bestCandidate = cand;
      }
    }

    if (!bestCandidate || highestScore < 10) {
      throw new NotFoundError('No matching show season found on Filmezz Mozi');
    }

    const pageHtml = await ctx.proxiedFetcher<string>(bestCandidate.url, { headers: HEADERS });
    const $ = load(pageHtml);

    // If there are multiple iframes on the page (one per episode sequentially)
    const validIframes: string[] = [];
    $('iframe[src]').each((_, el) => {
      let src = $(el).attr('src')?.trim();
      if (!src) return;
      if (src.startsWith('//')) src = `https:${src}`;
      if (
        src.includes('youtube.com') ||
        src.includes('mchat') ||
        src.includes('yadro') ||
        src.includes('ucoz') ||
        src.includes('google')
      )
        return;
      validIframes.push(src);
    });

    const embeds: SourcererEmbed[] = [];
    const epIndex = ctx.media.episode.number - 1;

    if (validIframes.length > epIndex && epIndex >= 0) {
      const targetSrc = validIframes[epIndex];
      const embedId = getEmbedId(targetSrc);
      if (embedId) {
        embeds.push({
          embedId,
          url: targetSrc,
        });
      }
    }

    // Also look for specific episode link in the page
    if (embeds.length === 0) {
      const epNum = ctx.media.episode.number;
      const epRegex = new RegExp(`(?:${epNum}\\s*\\.?\\s*rész|ep(?:isode)?\\s*${epNum}\\b)`, 'i');

      $('a[href]').each((_, el) => {
        const text = $(el).text();
        const href = $(el).attr('href');
        if (href && epRegex.test(text)) {
          const embedId = getEmbedId(href);
          if (embedId) {
            embeds.push({
              embedId,
              url: href,
            });
          }
        }
      });
    }

    if (embeds.length === 0) {
      throw new NotFoundError('Episode stream not found on Filmezz Mozi');
    }

    return { embeds };
  },
});
