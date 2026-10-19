import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const FILMI_BASE = 'https://filmi.hu';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

interface FilmiCandidate {
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
    console.log('[Filmi] TMDB Hungarian title lookup error:', err);
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

function isAdUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes('a-ads.com') ||
    lower.includes('inmobi') ||
    lower.includes('doubleclick') ||
    lower.includes('googlesyndication') ||
    lower.includes('adservice') ||
    lower.includes('banner')
  );
}

async function searchCandidates(
  ctx: MovieScrapeContext | ShowScrapeContext,
  query: string,
  targetMediaType: 'movie' | 'show',
): Promise<FilmiCandidate[]> {
  const searchUrl = `${FILMI_BASE}/?search=${encodeURIComponent(query)}`;
  console.log(`[Filmi] Running search: ${searchUrl}`);

  try {
    const html = await ctx.proxiedFetcher<string>(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: `${FILMI_BASE}/`,
      },
    });

    const $ = load(html);
    const candidates: FilmiCandidate[] = [];

    $('.card, [id^=item]').each((_, el) => {
      const linkEl = $(el).find('a[href^="/video/"]').first();
      const href = linkEl.attr('href');
      if (!href) return;

      const cardTitle = $(el).find('.card-title a').text().trim();
      const rawTitle = cardTitle || linkEl.attr('title') || $(el).find('a.filename').attr('title') || '';
      const cleanTitle = rawTitle
        .replace(/\s+teljes\s+(film|sorozat)\s+magyarul.*/i, '')
        .replace(/\s+online.*/i, '')
        .trim();

      const yearMatch = $(el).text().match(/\b(19\d\d|20\d\d)\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

      const isShow =
        $(el).find('.badge-series').length > 0 ||
        $(el).text().includes('SOROZAT') ||
        $(el).find('[title*="sorozat"]').length > 0;
      const mediaType: 'movie' | 'show' = isShow ? 'show' : 'movie';

      if (mediaType !== targetMediaType) return;

      const fullUrl = href.startsWith('http') ? href : `${FILMI_BASE}${href}`;
      if (!candidates.some((c) => c.url === fullUrl)) {
        candidates.push({
          title: cleanTitle || cardTitle || 'Unknown',
          url: fullUrl,
          year,
          mediaType,
        });
      }
    });

    return candidates;
  } catch (err) {
    console.log(`[Filmi] Search error for "${query}":`, err);
    return [];
  }
}

async function scrapeFilmi(
  ctx: MovieScrapeContext | ShowScrapeContext,
  mediaType: 'movie' | 'show',
): Promise<SourcererOutput> {
  const originalTitle = ctx.media.title;
  const targetYear = ctx.media.releaseYear;
  const tmdbId = ctx.media.tmdbId;

  console.log(`[Filmi] Starting scrape for "${originalTitle}" (${targetYear}) [${mediaType}]`);

  // 1. Resolve Hungarian title from TMDB
  const hungarianTitle = await getHungarianTitle(originalTitle, targetYear, tmdbId, mediaType);
  if (hungarianTitle) {
    console.log(`[Filmi] Resolved Hungarian title from TMDB: "${hungarianTitle}"`);
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
  console.log(`[Filmi] Search query list:`, uniqueQueries);

  // 3. Search Filmi
  let candidates: FilmiCandidate[] = [];
  for (const q of uniqueQueries) {
    const results = await searchCandidates(ctx, q, mediaType);
    if (results.length > 0) {
      candidates = results;
      break;
    }
  }

  if (candidates.length === 0) {
    throw new NotFoundError(`No results found on Filmi for "${originalTitle}"`);
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

  let selectedCandidate: FilmiCandidate | null = null;

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
    throw new NotFoundError(`No matching candidate found on Filmi for "${originalTitle}"`);
  }

  console.log(
    `[Filmi] Selected candidate: "${selectedCandidate.title}" (${selectedCandidate.year}) -> ${selectedCandidate.url}`,
  );

  const embedUrls = new Set<string>();

  // 5. Scrape Player URL
  if (mediaType === 'show') {
    const showCtx = ctx as ShowScrapeContext;
    const seasonNum = showCtx.media.season.number;
    const episodeNum = showCtx.media.episode.number;

    let curUrl = selectedCandidate.url;
    let pageHtml = await ctx.proxiedFetcher<string>(curUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: `${FILMI_BASE}/`,
      },
    });
    let $ = load(pageHtml);

    // Season navigation
    let seasonHref: string | null = null;
    for (const a of $('a').toArray()) {
      const title = $(a).attr('title') || '';
      const text = $(a).text().trim();
      if (
        title.match(new RegExp(`\\b${seasonNum}\\.évad\\b`, 'i')) ||
        title.includes(`${seasonNum}.évad sorozat`) ||
        text === `${seasonNum}.évad`
      ) {
        seasonHref = $(a).attr('href') || null;
        if (seasonHref) break;
      }
    }

    if (seasonHref) {
      const hrefStr: string = seasonHref;
      const targetSeasonUrl = hrefStr.startsWith('http') ? hrefStr : `${FILMI_BASE}${hrefStr}`;
      if (targetSeasonUrl !== curUrl) {
        console.log(`[Filmi] Switching to season ${seasonNum}: ${targetSeasonUrl}`);
        curUrl = targetSeasonUrl;
        pageHtml = await ctx.proxiedFetcher<string>(curUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Referer: `${FILMI_BASE}/`,
          },
        });
        $ = load(pageHtml);
      }
    }

    // Episode navigation
    let episodeHref: string | null = null;
    for (const a of $('a').toArray()) {
      const title = $(a).attr('title') || '';
      if (
        title.match(new RegExp(`(?:${seasonNum}\\.évad\\s+)?\\b${episodeNum}\\.rész\\b`, 'i')) ||
        title.match(new RegExp(`\\b${episodeNum}\\.rész\\b`, 'i'))
      ) {
        episodeHref = $(a).attr('href') || null;
        if (episodeHref) break;
      }
    }

    if (episodeHref) {
      const hrefStr: string = episodeHref;
      const targetEpisodeUrl = hrefStr.startsWith('http') ? hrefStr : `${FILMI_BASE}${hrefStr}`;
      if (targetEpisodeUrl !== curUrl) {
        console.log(`[Filmi] Switching to episode ${episodeNum}: ${targetEpisodeUrl}`);
        curUrl = targetEpisodeUrl;
        pageHtml = await ctx.proxiedFetcher<string>(curUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Referer: `${FILMI_BASE}/`,
          },
        });
        $ = load(pageHtml);
      }
    }

    $('iframe').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && !isAdUrl(src)) {
        const fullSrc = src.startsWith('//') ? `https:${src}` : src;
        embedUrls.add(fullSrc);
      }
    });
  } else {
    // Movie: fetch movie page and extract iframes
    const movieHtml = await ctx.proxiedFetcher<string>(selectedCandidate.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: `${FILMI_BASE}/`,
      },
    });

    const $ = load(movieHtml);
    $('iframe').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && !isAdUrl(src)) {
        const fullSrc = src.startsWith('//') ? `https:${src}` : src;
        embedUrls.add(fullSrc);
      }
    });
  }

  console.log(`[Filmi] Found ${embedUrls.size} raw embed URLs:`, Array.from(embedUrls));

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
      console.log(`[Filmi] Unknown or unsupported embed host: ${rawUrl}`);
    }
  }

  if (embeds.length === 0) {
    throw new NotFoundError(`No playable streams found on Filmi for "${originalTitle}"`);
  }

  console.log(
    `[Filmi] Returning ${embeds.length} embeds:`,
    embeds.map((e) => `${e.embedId} -> ${e.url}`),
  );

  return { embeds };
}

export const filmiScraper = makeSourcerer({
  id: 'filmi',
  name: 'Filmi',
  rank: 129,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie(ctx) {
    return scrapeFilmi(ctx, 'movie');
  },
  scrapeShow(ctx) {
    return scrapeFilmi(ctx, 'show');
  },
});
