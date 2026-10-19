import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const HDMOZI_BASE = 'https://hdmozi.hu';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

interface HDMoziCandidate {
  title: string;
  url: string;
  year?: number;
  mediaType: 'movie' | 'show';
}

function normalizeTitle(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves the Hungarian title from TMDB API if available
 */
async function getHungarianTitle(
  title: string,
  year?: number,
  tmdbId?: string,
  mediaType: 'movie' | 'show' = 'movie',
): Promise<string | null> {
  const typePath = mediaType === 'show' ? 'tv' : 'movie';
  try {
    // 1. If tmdbId exists and is valid, fetch directly
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

    // 2. Search TMDB with query and language=hu-HU (using year if provided)
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

    // 3. Fallback: Retry search without year constraint
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
    console.log('[HDMozi] TMDB Hungarian title lookup error:', err);
  }
  return null;
}

function getEmbedId(targetUrl: string): string | null {
  const url = targetUrl.toLowerCase();
  if (url.includes('rpmshare') || url.includes('rpmstream')) return 'rpmshare';
  if (url.includes('videa')) return 'videa';
  if (url.includes('indavideo')) return 'indavideo';
  if (url.includes('vidara') || url.includes('gjsabgs')) return 'vidara';
  if (url.includes('voe') || url.includes('megankiddifference') || url.includes('delivery-node') || url.includes('voe-unblock')) return 'voe';
  if (url.includes('dood') || url.includes('ds2play') || url.includes('do0od') || url.includes('d0o0d')) return 'dood';
  if (url.includes('filemoon') || url.includes('bysefujedu') || url.includes('moonmov')) return 'filemoon';
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

async function searchCandidates(
  ctx: MovieScrapeContext | ShowScrapeContext,
  query: string,
  targetMediaType: 'movie' | 'show',
): Promise<HDMoziCandidate[]> {
  const searchUrl = `${HDMOZI_BASE}/?s=${encodeURIComponent(query)}`;
  console.log(`[HDMozi] Running search: ${searchUrl}`);

  try {
    const html = await ctx.proxiedFetcher<string>(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: `${HDMOZI_BASE}/`,
      },
    });

    const $ = load(html);
    const candidates: HDMoziCandidate[] = [];

    $('.result-item, article').each((_, el) => {
      const linkEl = $(el).find('.title a').first().length ? $(el).find('.title a').first() : $(el).find('a').first();
      const href = linkEl.attr('href');
      if (!href) return;

      const rawTitle = linkEl.text().trim() || linkEl.attr('title') || $(el).find('img').attr('alt') || '';
      const cleanTitle = rawTitle
        .replace(/\s*\(\d{4}\)\s*/g, ' ')
        .replace(/\s*\(\d+-\d+\s*évad\)\s*/gi, ' ')
        .replace(/\s*\(4k.*?\)/gi, ' ')
        .replace(/\s*\(fhd.*?\)/gi, ' ')
        .replace(/\s*\(uhd.*?\)/gi, ' ')
        .trim();

      const yearText = $(el).find('.year').text().trim();
      const yearMatch = yearText.match(/\b(19\d\d|20\d\d)\b/) || rawTitle.match(/\b(19\d\d|20\d\d)\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

      const isShow = href.includes('/tvshows/');
      const isMovie = href.includes('/movies/');
      const mediaType: 'movie' | 'show' | null = isShow ? 'show' : isMovie ? 'movie' : null;

      if (!mediaType || mediaType !== targetMediaType) return;

      const fullUrl = href.startsWith('http') ? href : `${HDMOZI_BASE}${href}`;
      if (!candidates.some((c) => c.url === fullUrl)) {
        candidates.push({
          title: cleanTitle || rawTitle,
          url: fullUrl,
          year,
          mediaType,
        });
      }
    });

    return candidates;
  } catch (err) {
    console.log(`[HDMozi] Search error for "${query}":`, err);
    return [];
  }
}

async function scrapeHDMozi(
  ctx: MovieScrapeContext | ShowScrapeContext,
  mediaType: 'movie' | 'show',
): Promise<SourcererOutput> {
  const originalTitle = ctx.media.title;
  const targetYear = ctx.media.releaseYear;
  const tmdbId = ctx.media.tmdbId;

  console.log(`[HDMozi] Starting scrape for "${originalTitle}" (${targetYear}) [${mediaType}]`);

  // 1. Resolve Hungarian title from TMDB
  const hungarianTitle = await getHungarianTitle(originalTitle, targetYear, tmdbId, mediaType);
  if (hungarianTitle) {
    console.log(`[HDMozi] Resolved Hungarian title from TMDB: "${hungarianTitle}"`);
  }

  // 2. Generate search queries
  const queries: string[] = [];
  if (hungarianTitle) {
    queries.push(hungarianTitle);
    if (hungarianTitle.includes('&')) {
      queries.push(hungarianTitle.replace(/&/g, 'és'));
      queries.push(hungarianTitle.replace(/&/g, ' '));
    }
    const unaccentedHu = hungarianTitle
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (unaccentedHu !== hungarianTitle) {
      queries.push(unaccentedHu);
    }
  }
  queries.push(originalTitle);
  if (originalTitle.includes('&')) {
    queries.push(originalTitle.replace(/&/g, 'és'));
    queries.push(originalTitle.replace(/&/g, ' '));
  }
  const unaccentedOrig = originalTitle
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (unaccentedOrig !== originalTitle) {
    queries.push(unaccentedOrig);
  }

  const uniqueQueries = Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean)));
  console.log(`[HDMozi] Search query list:`, uniqueQueries);

  // 3. Search HDMozi
  let candidates: HDMoziCandidate[] = [];
  for (const q of uniqueQueries) {
    const results = await searchCandidates(ctx, q, mediaType);
    if (results.length > 0) {
      candidates = results;
      break;
    }
  }

  if (candidates.length === 0) {
    throw new NotFoundError(`No results found on HDMozi for "${originalTitle}"`);
  }

  // 4. Select Candidate
  const titlesToMatch = [
    originalTitle,
    hungarianTitle,
    originalTitle.replace(/&/g, 'és'),
    hungarianTitle ? hungarianTitle.replace(/&/g, 'és') : null,
  ]
    .filter((t): t is string => Boolean(t))
    .map(normalizeTitle);

  let selectedCandidate: HDMoziCandidate | null = null;

  // A. Match both year (+/- 1) and exact normalized title
  if (targetYear) {
    selectedCandidate =
      candidates.find((c) => {
        const norm = normalizeTitle(c.title);
        const yearOk = c.year && Math.abs(c.year - targetYear) <= 1;
        return yearOk && titlesToMatch.some((t) => t === norm);
      }) || null;
  }

  // B. Match exact normalized title
  if (!selectedCandidate) {
    selectedCandidate =
      candidates.find((c) => {
        const norm = normalizeTitle(c.title);
        return titlesToMatch.some((t) => t === norm);
      }) || null;
  }

  // C. Match year (+/- 1) and substring
  if (!selectedCandidate && targetYear) {
    selectedCandidate =
      candidates.find((c) => {
        const norm = normalizeTitle(c.title);
        const yearOk = c.year && Math.abs(c.year - targetYear) <= 1;
        return yearOk && titlesToMatch.some((t) => norm.includes(t) || t.includes(norm));
      }) || null;
  }

  // D. Match substring title
  if (!selectedCandidate) {
    selectedCandidate =
      candidates.find((c) => {
        const norm = normalizeTitle(c.title);
        return titlesToMatch.some((t) => norm.includes(t) || t.includes(norm));
      }) || null;
  }

  // Fallback to first candidate
  if (!selectedCandidate && candidates.length > 0) {
    selectedCandidate = candidates[0];
  }

  if (!selectedCandidate) {
    throw new NotFoundError(`No matching candidate found on HDMozi for "${originalTitle}"`);
  }

  console.log(
    `[HDMozi] Selected candidate: "${selectedCandidate.title}" (${selectedCandidate.year}) -> ${selectedCandidate.url}`,
  );

  const embedUrls = new Set<string>();

  // 5. Scrape Player URLs via DooPlay AJAX
  if (mediaType === 'show') {
    const showCtx = ctx as ShowScrapeContext;
    const seasonNum = showCtx.media.season.number;
    const episodeNum = showCtx.media.episode.number;

    // Fetch show hub page to locate the episode link
    const showHtml = await ctx.proxiedFetcher<string>(selectedCandidate.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: `${HDMOZI_BASE}/`,
      },
    });

    const $show = load(showHtml);
    let foundEpUrl: string | null = null;

    for (const el of $show('ul.episodios li').toArray()) {
      const numText = $show(el).find('.numerando').text().trim(); // e.g. "1 - 1" or "2 - 4"
      const href = $show(el).find('.episodiotitle a').attr('href') || $show(el).find('a').attr('href');
      if (!href) continue;

      const numMatch = numText.match(/(\d+)\s*-\s*(\d+)/);
      if (numMatch) {
        const s = parseInt(numMatch[1], 10);
        const e = parseInt(numMatch[2], 10);
        if (s === seasonNum && e === episodeNum) {
          foundEpUrl = href;
          break;
        }
      } else if (href.includes(`-${seasonNum}x${episodeNum}/`) || href.includes(`/${seasonNum}x${episodeNum}/`)) {
        foundEpUrl = href;
        break;
      }
    }

    let targetEpUrl = '';
    // Fallback: direct URL construction if not matched in list
    if (!foundEpUrl) {
      const showSlug = selectedCandidate.url.replace(/\/+$/, '').split('/').pop();
      targetEpUrl = `${HDMOZI_BASE}/episodes/${showSlug}-${seasonNum}x${episodeNum}/`;
      console.log(`[HDMozi] Using direct episode URL fallback: ${targetEpUrl}`);
    } else {
      targetEpUrl = foundEpUrl.startsWith('http') ? foundEpUrl : `${HDMOZI_BASE}${foundEpUrl}`;
      console.log(`[HDMozi] Found episode URL: ${targetEpUrl}`);
    }

    // Fetch episode page
    const epHtml = await ctx.proxiedFetcher<string>(targetEpUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: selectedCandidate.url,
      },
    });

    const $ep = load(epHtml);
    const servers: Array<{ post: string; nume: string; type: string }> = [];

    $ep('li[data-post]').each((_, el) => {
      const post = $ep(el).attr('data-post');
      const nume = $ep(el).attr('data-nume');
      const type = $ep(el).attr('data-type') || 'tv';
      if (post && nume && nume !== 'trailer') {
        servers.push({ post, nume, type });
      }
    });

    for (const s of servers) {
      try {
        const body = new URLSearchParams({
          action: 'doo_player_ajax',
          post: s.post,
          nume: s.nume,
          type: s.type,
        });

        const ajaxResp = await ctx.proxiedFetcher<{ embed_url?: string }>(`${HDMOZI_BASE}/wp-admin/admin-ajax.php`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: targetEpUrl,
          },
          body: body.toString(),
        });

        if (ajaxResp?.embed_url) {
          const raw = ajaxResp.embed_url;
          const full = raw.startsWith('//') ? `https:${raw}` : raw;
          embedUrls.add(full);
        }
      } catch (err) {
        console.log(`[HDMozi] Error fetching server ${s.nume}:`, err);
      }
    }
  } else {
    // Movie: fetch movie page and extract servers
    const movieHtml = await ctx.proxiedFetcher<string>(selectedCandidate.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: `${HDMOZI_BASE}/`,
      },
    });

    const $ = load(movieHtml);
    const servers: Array<{ post: string; nume: string; type: string }> = [];

    $('li[data-post]').each((_, el) => {
      const post = $(el).attr('data-post');
      const nume = $(el).attr('data-nume');
      const type = $(el).attr('data-type') || 'movie';
      if (post && nume && nume !== 'trailer') {
        servers.push({ post, nume, type });
      }
    });

    for (const s of servers) {
      try {
        const body = new URLSearchParams({
          action: 'doo_player_ajax',
          post: s.post,
          nume: s.nume,
          type: s.type,
        });

        const ajaxResp = await ctx.proxiedFetcher<{ embed_url?: string }>(`${HDMOZI_BASE}/wp-admin/admin-ajax.php`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: selectedCandidate.url,
          },
          body: body.toString(),
        });

        if (ajaxResp?.embed_url) {
          const raw = ajaxResp.embed_url;
          const full = raw.startsWith('//') ? `https:${raw}` : raw;
          embedUrls.add(full);
        }
      } catch (err) {
        console.log(`[HDMozi] Error fetching server ${s.nume}:`, err);
      }
    }
  }

  console.log(`[HDMozi] Found ${embedUrls.size} raw embed URLs:`, Array.from(embedUrls));

  // 6. Map raw embed URLs to supported scrapers
  const embeds: SourcererEmbed[] = [];
  for (const rawUrl of embedUrls) {
    const embedId = getEmbedId(rawUrl);
    if (embedId) {
      embeds.push({
        embedId,
        url: rawUrl,
      });
    } else {
      console.log(`[HDMozi] Unknown or unsupported embed host: ${rawUrl}`);
    }
  }

  if (embeds.length === 0) {
    throw new NotFoundError(`No playable streams found on HDMozi for "${originalTitle}"`);
  }

  console.log(
    `[HDMozi] Returning ${embeds.length} embeds:`,
    embeds.map((e) => `${e.embedId} -> ${e.url}`),
  );

  return { embeds };
}

export const hdmoziScraper = makeSourcerer({
  id: 'hdmozi',
  name: 'HDMozi',
  rank: 130,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie(ctx) {
    return scrapeHDMozi(ctx, 'movie');
  },
  scrapeShow(ctx) {
    return scrapeHDMozi(ctx, 'show');
  },
});
