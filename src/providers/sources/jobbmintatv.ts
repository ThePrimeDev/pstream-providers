import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const JOBBMINTATV_BASE = 'https://jobbmintatv.pro';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

const ISO_REPLACEMENTS: Record<string, string> = {
  á: '%E1',
  é: '%E9',
  í: '%ED',
  ó: '%F3',
  ö: '%F6',
  ő: '%F5',
  ú: '%FA',
  ü: '%FC',
  ű: '%FB',
  Á: '%C1',
  É: '%C9',
  Í: '%CD',
  Ó: '%D3',
  Ö: '%D6',
  Ő: '%D5',
  Ú: '%DA',
  Ü: '%DC',
  Ű: '%DB',
};

function encodeIso88592(text: string): string {
  return text
    .split('')
    .map((c) => {
      if (c === ' ') return '%20';
      if (ISO_REPLACEMENTS[c]) return ISO_REPLACEMENTS[c];
      return encodeURIComponent(c);
    })
    .join('');
}

interface JobbMintTvCandidate {
  title: string;
  url: string;
  slug: string;
  year?: number;
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
    console.log('[JobbMintATV] TMDB Hungarian title lookup error:', err);
  }
  return null;
}

function getEmbedId(targetUrl: string): string | null {
  const url = targetUrl.toLowerCase();
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
): Promise<JobbMintTvCandidate[]> {
  const encoded = encodeIso88592(query);
  const searchUrl = `${JOBBMINTATV_BASE}/ajax.php?keres=${encoded}`;
  console.log(`[JobbMintATV] Running search: ${searchUrl}`);

  try {
    const html = await ctx.proxiedFetcher<string>(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${JOBBMINTATV_BASE}/`,
      },
    });

    const $ = load(html);
    const candidates: JobbMintTvCandidate[] = [];

    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || !href.includes('/online/')) return;

      const rawTitle = $(el).find('div').text().trim() || $(el).text().trim();
      const fullUrl = href.startsWith('//') ? `https:${href}` : href.startsWith('http') ? href : `${JOBBMINTATV_BASE}${href}`;
      const slug = fullUrl.replace(/.*\/online\//, '').replace(/\/+$/, '');

      if (!candidates.some((c) => c.url === fullUrl)) {
        candidates.push({
          title: rawTitle || slug.replace(/_/g, ' '),
          url: fullUrl,
          slug,
        });
      }
    });

    return candidates;
  } catch (err) {
    console.log(`[JobbMintATV] Search error for "${query}":`, err);
    return [];
  }
}

async function scrapeJobbMintATV(
  ctx: MovieScrapeContext | ShowScrapeContext,
  mediaType: 'movie' | 'show',
): Promise<SourcererOutput> {
  const originalTitle = ctx.media.title;
  const targetYear = ctx.media.releaseYear;
  const tmdbId = ctx.media.tmdbId;

  console.log(`[JobbMintATV] Starting scrape for "${originalTitle}" (${targetYear}) [${mediaType}]`);

  // 1. Resolve Hungarian title from TMDB
  const hungarianTitle = await getHungarianTitle(originalTitle, targetYear, tmdbId, mediaType);
  if (hungarianTitle) {
    console.log(`[JobbMintATV] Resolved Hungarian title from TMDB: "${hungarianTitle}"`);
  }

  // 2. Generate search queries
  const queries: string[] = [];
  if (hungarianTitle) {
    queries.push(hungarianTitle);
    if (hungarianTitle.includes('&')) {
      queries.push(hungarianTitle.replace(/&/g, 'és'));
      queries.push(hungarianTitle.replace(/&/g, ' '));
    }
    // Also try unaccented
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
  console.log(`[JobbMintATV] Search query list:`, uniqueQueries);

  // 3. Search JobbMintATV
  let candidates: JobbMintTvCandidate[] = [];
  for (const q of uniqueQueries) {
    const results = await searchCandidates(ctx, q);
    if (results.length > 0) {
      candidates = results;
      break;
    }
  }

  if (candidates.length === 0) {
    throw new NotFoundError(`No results found on JobbMintATV for "${originalTitle}"`);
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

  let selectedCandidate: JobbMintTvCandidate | null = null;

  // Title / slug exact match
  selectedCandidate =
    candidates.find((c) => {
      const normTitle = normalizeTitle(c.title);
      const normSlug = normalizeTitle(c.slug);
      return titlesToMatch.some((t) => t === normTitle || t === normSlug);
    }) || null;

  // Title / slug word match
  if (!selectedCandidate) {
    selectedCandidate =
      candidates.find((c) => {
        const normTitle = normalizeTitle(c.title);
        const normSlug = normalizeTitle(c.slug);
        return titlesToMatch.some((t) => {
          if (t.length <= 3) return false;
          const titleWords = normTitle.split(' ');
          const targetWords = t.split(' ');
          if (targetWords.length === 1 && titleWords.length > 2) return false;
          return (
            normTitle === t ||
            normSlug === t ||
            (normTitle.startsWith(t) && titleWords.length <= targetWords.length + 1) ||
            (normSlug.startsWith(t) && normSlug.length <= t.length + 5)
          );
        });
      }) || null;
  }

  if (!selectedCandidate) {
    throw new NotFoundError(`No matching candidate found on JobbMintATV for "${originalTitle}"`);
  }

  console.log(
    `[JobbMintATV] Selected candidate: "${selectedCandidate.title}" (${selectedCandidate.slug}) -> ${selectedCandidate.url}`,
  );

  const embedUrls = new Set<string>();

  // 5. Scrape Player URL
  if (mediaType === 'show') {
    const showCtx = ctx as ShowScrapeContext;
    const seasonNum = showCtx.media.season.number;
    const episodeNum = showCtx.media.episode.number;

    const baseShowUrl = selectedCandidate.url.replace(/\/+$/, '');
    const directEpisodeUrl = `${baseShowUrl}/${seasonNum}_evad/${episodeNum}_resz/`;

    console.log(`[JobbMintATV] Trying direct episode URL: ${directEpisodeUrl}`);

    try {
      const epHtml = await ctx.proxiedFetcher<string>(directEpisodeUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          Referer: `${JOBBMINTATV_BASE}/`,
        },
      });

      const ep$ = load(epHtml);
      ep$('iframe').each((_, el) => {
        const src = ep$(el).attr('src');
        if (src) {
          const fullSrc = src.startsWith('//') ? `https:${src}` : src;
          embedUrls.add(fullSrc);
        }
      });
    } catch (epErr) {
      console.log(`[JobbMintATV] Direct episode fetch failed, falling back to season page:`, epErr);
    }

    // Fallback: check season page if direct URL had no iframes
    if (embedUrls.size === 0) {
      try {
        const seasonUrl = `${baseShowUrl}/${seasonNum}_evad/`;
        const seasonHtml = await ctx.proxiedFetcher<string>(seasonUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Referer: `${JOBBMINTATV_BASE}/`,
          },
        });

        const season$ = load(seasonHtml);
        let foundEpLink: string | null = null;
        season$('a').each((_, el) => {
          const href = season$(el).attr('href');
          if (href && (href.includes(`/${episodeNum}_resz/`) || href.endsWith(`/${episodeNum}_resz`))) {
            foundEpLink = href.startsWith('//') ? `https:${href}` : href.startsWith('http') ? href : `${JOBBMINTATV_BASE}${href}`;
          }
        });

        if (foundEpLink) {
          console.log(`[JobbMintATV] Found episode link from season page: ${foundEpLink}`);
          const targetHtml = await ctx.proxiedFetcher<string>(foundEpLink, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
              Referer: seasonUrl,
            },
          });
          const target$ = load(targetHtml);
          target$('iframe').each((_, el) => {
            const src = target$(el).attr('src');
            if (src) {
              const fullSrc = src.startsWith('//') ? `https:${src}` : src;
              embedUrls.add(fullSrc);
            }
          });
        }
      } catch (seasonErr) {
        console.log(`[JobbMintATV] Season page fallback error:`, seasonErr);
      }
    }
  } else {
    // Movie: fetch movie page and extract iframes
    const movieHtml = await ctx.proxiedFetcher<string>(selectedCandidate.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: `${JOBBMINTATV_BASE}/`,
      },
    });

    const $ = load(movieHtml);
    $('iframe').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        const fullSrc = src.startsWith('//') ? `https:${src}` : src;
        embedUrls.add(fullSrc);
      }
    });
  }

  console.log(`[JobbMintATV] Found ${embedUrls.size} raw embed URLs:`, Array.from(embedUrls));

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
      console.log(`[JobbMintATV] Unknown or unsupported embed host: ${rawUrl}`);
    }
  }

  if (embeds.length === 0) {
    throw new NotFoundError(`No playable streams found on JobbMintATV for "${originalTitle}"`);
  }

  console.log(
    `[JobbMintATV] Returning ${embeds.length} embeds:`,
    embeds.map((e) => `${e.embedId} -> ${e.url}`),
  );

  return { embeds };
}

export const jobbmintatvScraper = makeSourcerer({
  id: 'jobbmintatv',
  name: 'JobbMintATV',
  rank: 128,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie(ctx) {
    return scrapeJobbMintATV(ctx, 'movie');
  },
  scrapeShow(ctx) {
    return scrapeJobbMintATV(ctx, 'show');
  },
});
