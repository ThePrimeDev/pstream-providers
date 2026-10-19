import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const DMDAMEDIA_BASE = 'https://dmdamedia.hu';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

interface DmdaCandidate {
  title: string;
  url: string;
  year?: number;
  type?: 'movie' | 'show';
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
    console.log('[DMDAMedia] TMDB Hungarian title lookup error:', err);
  }
  return null;
}

function getEmbedId(targetUrl: string): string | null {
  const url = targetUrl.toLowerCase();
  if (url.includes('videa')) return 'videa';
  if (url.includes('indavideo')) return 'indavideo';
  if (url.includes('vidara') || url.includes('gjsabgs')) return 'vidara';
  if (url.includes('filemoon') || url.includes('bysefujedu') || url.includes('moonmov')) return 'filemoon';
  if (url.includes('streamwish') || url.includes('wishembed') || url.includes('strwish')) return 'streamwish-english';
  if (url.includes('vidhide') || url.includes('vidhidepro') || url.includes('dinisglows')) return 'vidhide-english';
  if (url.includes('dood') || url.includes('ds2play') || url.includes('do0od') || url.includes('d0o0d')) return 'dood';
  if (url.includes('mixdrop') || url.includes('mixdrp')) return 'mixdrop';
  if (url.includes('streamtape')) return 'streamtape';
  if (url.includes('supervideo')) return 'supervideo';
  if (url.includes('dropload')) return 'dropload';
  if (url.includes('filelions')) return 'filelions';
  if (url.includes('turbovid')) return 'turbovid';
  if (url.includes('vidmoly')) return 'vidmoly';
  if (url.includes('voe') || url.includes('voe-unblock')) return 'voe';
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
  mediaType: 'movie' | 'show',
): Promise<DmdaCandidate[]> {
  const searchUrl = `${DMDAMEDIA_BASE}/search?q=${encodeURIComponent(query)}`;
  console.log(`[DMDAMedia] Running search: ${searchUrl}`);

  try {
    const html = await ctx.proxiedFetcher<string>(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: `${DMDAMEDIA_BASE}/`,
      },
    });

    const $ = load(html);
    const candidates: DmdaCandidate[] = [];

    $('.movie-grid a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const title = $(el).find('.card-title').text().trim();
      const yearText = $(el).find('.card-year').text().trim();
      const badgeText = $(el).find('.card-badge').text().trim();

      const year = yearText ? parseInt(yearText, 10) : undefined;
      const isShow = badgeText.toLowerCase().includes('sorozat') || (!href.endsWith('_film') && !badgeText.toLowerCase().includes('film'));
      const itemType: 'movie' | 'show' = isShow ? 'show' : 'movie';

      if (itemType !== mediaType) return;

      const fullUrl = href.startsWith('http') ? href : `${DMDAMEDIA_BASE}${href}`;

      candidates.push({
        title,
        url: fullUrl,
        year: !Number.isNaN(year) ? year : undefined,
        type: itemType,
      });
    });

    return candidates;
  } catch (err) {
    console.log(`[DMDAMedia] Search error for "${query}":`, err);
    return [];
  }
}

async function scrapeDMDAMedia(
  ctx: MovieScrapeContext | ShowScrapeContext,
  mediaType: 'movie' | 'show',
): Promise<SourcererOutput> {
  const originalTitle = ctx.media.title;
  const targetYear = ctx.media.releaseYear;
  const tmdbId = ctx.media.tmdbId;

  console.log(`[DMDAMedia] Starting scrape for "${originalTitle}" (${targetYear}) [${mediaType}]`);

  // 1. Resolve Hungarian title from TMDB
  const hungarianTitle = await getHungarianTitle(originalTitle, targetYear, tmdbId, mediaType);
  if (hungarianTitle) {
    console.log(`[DMDAMedia] Resolved Hungarian title from TMDB: "${hungarianTitle}"`);
  }

  // 2. Generate search query variations
  const queries: string[] = [];
  if (hungarianTitle) {
    queries.push(hungarianTitle);
    if (hungarianTitle.includes('&')) {
      queries.push(hungarianTitle.replace(/&/g, 'és'));
      queries.push(hungarianTitle.replace(/&/g, ' '));
    }
  }
  queries.push(originalTitle);
  if (originalTitle.includes('&')) {
    queries.push(originalTitle.replace(/&/g, 'és'));
    queries.push(originalTitle.replace(/&/g, ' '));
  }

  // Deduplicate queries
  const uniqueQueries = Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean)));
  console.log(`[DMDAMedia] Search query list:`, uniqueQueries);

  // 3. Search DMDAMedia
  let candidates: DmdaCandidate[] = [];
  for (const q of uniqueQueries) {
    const results = await searchCandidates(ctx, q, mediaType);
    if (results.length > 0) {
      candidates = results;
      break;
    }
  }

  if (candidates.length === 0) {
    throw new NotFoundError(`No results found on DMDAMedia for "${originalTitle}"`);
  }

  // 4. Select best candidate
  const titlesToMatch = [
    originalTitle,
    hungarianTitle,
    originalTitle.replace(/&/g, 'és'),
    hungarianTitle ? hungarianTitle.replace(/&/g, 'és') : null,
  ]
    .filter((t): t is string => Boolean(t))
    .map(normalizeTitle);

  let selectedCandidate: DmdaCandidate | null = null;

  // Exact year match + title match
  if (targetYear) {
    selectedCandidate =
      candidates.find((c) => {
        const norm = normalizeTitle(c.title);
        const matchesTitle = titlesToMatch.some((t) => norm.includes(t) || t.includes(norm));
        return matchesTitle && c.year === targetYear;
      }) || null;

    // Tolerance of 1 year
    if (!selectedCandidate) {
      selectedCandidate =
        candidates.find((c) => {
          const norm = normalizeTitle(c.title);
          const matchesTitle = titlesToMatch.some((t) => norm.includes(t) || t.includes(norm));
          return matchesTitle && c.year && Math.abs(c.year - targetYear) <= 1;
        }) || null;
    }
  }

  // Fallback to title match alone
  if (!selectedCandidate) {
    selectedCandidate =
      candidates.find((c) => {
        const norm = normalizeTitle(c.title);
        return titlesToMatch.some((t) => norm.includes(t) || t.includes(norm));
      }) || null;
  }

  // Fallback to first candidate if none matched strictly
  if (!selectedCandidate && candidates.length > 0) {
    selectedCandidate = candidates[0];
  }

  if (!selectedCandidate) {
    throw new NotFoundError(`No matching candidate found on DMDAMedia for "${originalTitle}"`);
  }

  console.log(
    `[DMDAMedia] Selected candidate: "${selectedCandidate.title}" (${selectedCandidate.year || '?'}) -> ${selectedCandidate.url}`,
  );

  // 5. Construct target player page URL
  let playerPageUrl = selectedCandidate.url;
  if (mediaType === 'show') {
    const showCtx = ctx as ShowScrapeContext;
    const seasonNum = showCtx.media.season.number;
    const episodeNum = showCtx.media.episode.number;
    // Strip trailing slash if present
    const baseUrl = playerPageUrl.replace(/\/+$/, '');
    playerPageUrl = `${baseUrl}/${seasonNum}.evad/${episodeNum}.resz`;
  }

  console.log(`[DMDAMedia] Fetching player page: ${playerPageUrl}`);

  const pageHtml = await ctx.proxiedFetcher<string>(playerPageUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Referer: `${DMDAMEDIA_BASE}/`,
    },
  });

  const $ = load(pageHtml);
  const embedUrls = new Set<string>();

  // 6. Extract default active iframe
  $('iframe').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !src.includes('invadedcompetence')) {
      embedUrls.add(src.startsWith('//') ? `https:${src}` : src);
    }
  });

  // 7. Check for additional provider tabs (e.g. ?a=videa#lejatszo, ?a=inda#lejatszo, ?a=filemoon#lejatszo)
  const tabHrefs: string[] = [];
  $('a.provider-btn').each((_, el) => {
    const href = $(el).attr('href');
    const isAktiv = $(el).hasClass('aktiv') || $(el).hasClass('active');
    if (href && href.startsWith('?a=') && !isAktiv && !href.includes('invadedcompetence')) {
      tabHrefs.push(href);
    }
  });

  if (tabHrefs.length > 0) {
    console.log(`[DMDAMedia] Fetching ${tabHrefs.length} additional provider tabs:`, tabHrefs);
    const tabPromises = tabHrefs.map(async (tabHref) => {
      try {
        const fullTabUrl = `${playerPageUrl}${tabHref}`;
        const tabHtml = await ctx.proxiedFetcher<string>(fullTabUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Referer: playerPageUrl,
          },
        });
        const tab$ = load(tabHtml);
        tab$('iframe').each((_, el) => {
          const src = tab$(el).attr('src');
          if (src && !src.includes('invadedcompetence')) {
            embedUrls.add(src.startsWith('//') ? `https:${src}` : src);
          }
        });
      } catch (tabErr) {
        console.log(`[DMDAMedia] Error fetching tab ${tabHref}:`, tabErr);
      }
    });

    await Promise.allSettled(tabPromises);
  }

  console.log(`[DMDAMedia] Found ${embedUrls.size} raw embed URLs:`, Array.from(embedUrls));

  // 8. Map embed URLs to registered embed scrapers
  const embeds: SourcererEmbed[] = [];
  for (const rawUrl of embedUrls) {
    const embedId = getEmbedId(rawUrl);
    if (embedId) {
      embeds.push({
        embedId,
        url: rawUrl,
      });
    } else {
      console.log(`[DMDAMedia] Unknown or unhandled embed URL: ${rawUrl}`);
    }
  }

  if (embeds.length === 0) {
    throw new NotFoundError(`No playable streams found on DMDAMedia for "${originalTitle}"`);
  }

  console.log(
    `[DMDAMedia] Returning ${embeds.length} embeds:`,
    embeds.map((e) => `${e.embedId} -> ${e.url}`),
  );

  return { embeds };
}

export const dmdamediaScraper = makeSourcerer({
  id: 'dmdamedia',
  name: 'DMDAMedia',
  rank: 126,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie(ctx) {
    return scrapeDMDAMedia(ctx, 'movie');
  },
  scrapeShow(ctx) {
    return scrapeDMDAMedia(ctx, 'show');
  },
});
