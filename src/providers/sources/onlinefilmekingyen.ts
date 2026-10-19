import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const ONLINEFILMEKINGYEN_BASE = 'https://www.onlinefilmekingyen1.com';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

interface OnlineFilmekIngyenCandidate {
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
    console.log('[OnlineFilmekIngyen] TMDB Hungarian title lookup error:', err);
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
  mediaType: 'movie' | 'show',
): Promise<OnlineFilmekIngyenCandidate[]> {
  const searchUrl = `${ONLINEFILMEKINGYEN_BASE}/?s=${encodeURIComponent(query)}`;
  console.log(`[OnlineFilmekIngyen] Running search: ${searchUrl}`);

  try {
    const html = await ctx.proxiedFetcher<string>(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: `${ONLINEFILMEKINGYEN_BASE}/`,
      },
    });

    const $ = load(html);
    const candidates: OnlineFilmekIngyenCandidate[] = [];

    $('.result-item, article').each((_, el) => {
      const linkEl = $(el).find('.title a').first().length ? $(el).find('.title a').first() : $(el).find('a').first();
      const href = linkEl.attr('href');
      if (!href) return;

      const title = $(el).find('.title a').text().trim() || linkEl.text().trim() || $(el).find('img').attr('alt') || '';
      const yearText = $(el).find('.year').text().trim() || $(el).find('span').text().trim();

      const yearMatch = yearText.match(/\b(19\d\d|20\d\d)\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

      const isShow = href.includes('/tvshows/');
      const isMovie = href.includes('/movies/');

      const itemType: 'movie' | 'show' | null = isShow ? 'show' : isMovie ? 'movie' : null;
      if (!itemType || itemType !== mediaType) return;

      const fullUrl = href.startsWith('http') ? href : `${ONLINEFILMEKINGYEN_BASE}${href}`;

      // Deduplicate by URL
      if (!candidates.some((c) => c.url === fullUrl)) {
        candidates.push({
          title,
          url: fullUrl,
          year: year && !Number.isNaN(year) ? year : undefined,
          type: itemType,
        });
      }
    });

    return candidates;
  } catch (err) {
    console.log(`[OnlineFilmekIngyen] Search error for "${query}":`, err);
    return [];
  }
}

async function scrapeOnlineFilmekIngyen(
  ctx: MovieScrapeContext | ShowScrapeContext,
  mediaType: 'movie' | 'show',
): Promise<SourcererOutput> {
  const originalTitle = ctx.media.title;
  const targetYear = ctx.media.releaseYear;
  const tmdbId = ctx.media.tmdbId;

  console.log(`[OnlineFilmekIngyen] Starting scrape for "${originalTitle}" (${targetYear}) [${mediaType}]`);

  // 1. Resolve Hungarian title from TMDB
  const hungarianTitle = await getHungarianTitle(originalTitle, targetYear, tmdbId, mediaType);
  if (hungarianTitle) {
    console.log(`[OnlineFilmekIngyen] Resolved Hungarian title from TMDB: "${hungarianTitle}"`);
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

  const uniqueQueries = Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean)));
  console.log(`[OnlineFilmekIngyen] Search query list:`, uniqueQueries);

  // 3. Search OnlineFilmekIngyen
  let candidates: OnlineFilmekIngyenCandidate[] = [];
  for (const q of uniqueQueries) {
    const results = await searchCandidates(ctx, q, mediaType);
    if (results.length > 0) {
      candidates = results;
      break;
    }
  }

  if (candidates.length === 0) {
    throw new NotFoundError(`No results found on OnlineFilmekIngyen for "${originalTitle}"`);
  }

  // 4. Select candidate
  const titlesToMatch = [
    originalTitle,
    hungarianTitle,
    originalTitle.replace(/&/g, 'és'),
    hungarianTitle ? hungarianTitle.replace(/&/g, 'és') : null,
  ]
    .filter((t): t is string => Boolean(t))
    .map(normalizeTitle);

  let selectedCandidate: OnlineFilmekIngyenCandidate | null = null;

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

  // Fallback to first candidate
  if (!selectedCandidate && candidates.length > 0) {
    selectedCandidate = candidates[0];
  }

  if (!selectedCandidate) {
    throw new NotFoundError(`No matching candidate found on OnlineFilmekIngyen for "${originalTitle}"`);
  }

  console.log(
    `[OnlineFilmekIngyen] Selected candidate: "${selectedCandidate.title}" (${selectedCandidate.year || '?'}) -> ${selectedCandidate.url}`,
  );

  // 5. Fetch candidate page
  const pageHtml = await ctx.proxiedFetcher<string>(selectedCandidate.url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Referer: `${ONLINEFILMEKINGYEN_BASE}/`,
    },
  });

  if (pageHtml.includes('DMCA tartalom eltávolítva') || pageHtml.includes('A tartalom eltávolításra került jogsértő tartalma miatt')) {
    throw new NotFoundError(`Content on OnlineFilmekIngyen removed due to DMCA for "${originalTitle}"`);
  }

  const embedUrls = new Set<string>();

  // 6. Handle Series vs Movie
  if (mediaType === 'show') {
    const showCtx = ctx as ShowScrapeContext;
    const seasonNum = String(showCtx.media.season.number);
    const episodeNum = String(showCtx.media.episode.number);

    console.log(`[OnlineFilmekIngyen] Parsing series for S${seasonNum}E${episodeNum}`);

    const match =
      pageHtml.match(/__sorozatAdatok\s*=\s*(\{.*?\});/s) ||
      pageHtml.match(/const\s+seasons\s*=\s*(\{.*?\});/s);

    if (match && match[1]) {
      try {
        const seasonsData = JSON.parse(match[1]);
        const seasonInfo = seasonsData[seasonNum];
        if (seasonInfo) {
          const episodes = seasonInfo.episodes || seasonInfo;
          const rawUrl = episodes[episodeNum];
          if (rawUrl && typeof rawUrl === 'string') {
            let directUrl = rawUrl;
            if (!directUrl.startsWith('http')) {
              try {
                const decoded =
                  typeof atob === 'function'
                    ? atob(directUrl)
                    : Buffer.from(directUrl, 'base64').toString('utf-8');
                if (decoded.startsWith('http')) {
                  directUrl = decoded;
                }
              } catch {
                // Ignore base64 decoding error
              }
            }
            if (directUrl.startsWith('http')) {
              embedUrls.add(directUrl);
            }
          }
        }
      } catch (err) {
        console.log('[OnlineFilmekIngyen] Error parsing __sorozatAdatok:', err);
      }
    }
  } else {
    // Media is Movie: extract DooPlay player options
    const $ = load(pageHtml);
    interface PlayerOption {
      type: string;
      post: string;
      nume: string;
    }

    const options: PlayerOption[] = [];
    $('li.dooplay_player_option, li[id^="player-option-"]').each((_, el) => {
      const type = $(el).attr('data-type');
      const post = $(el).attr('data-post');
      const nume = $(el).attr('data-nume');
      if (type && post && nume && nume !== 'trailer') {
        options.push({ type, post, nume });
      }
    });

    console.log(`[OnlineFilmekIngyen] Found ${options.length} player options on movie page`);

    // Fetch player options (up to 8 candidates)
    const optionsToTry = options.slice(0, 8);
    const optionPromises = optionsToTry.map(async (opt) => {
      try {
        const apiUrl = `${ONLINEFILMEKINGYEN_BASE}/wp-json/dooplayer/v2/${opt.post}/${opt.type}/${opt.nume}`;
        let resJson: any = null;
        try {
          const res = await ctx.proxiedFetcher<string>(apiUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
              Referer: selectedCandidate.url,
            },
          });
          resJson = typeof res === 'string' ? JSON.parse(res) : res;
        } catch {
          // Fallback to admin-ajax.php
          const ajaxRes = await ctx.proxiedFetcher<string>(`${ONLINEFILMEKINGYEN_BASE}/wp-admin/admin-ajax.php`, {
            method: 'POST',
            body: new URLSearchParams({
              action: 'doo_player_ajax',
              post: opt.post,
              nume: opt.nume,
              type: opt.type,
            }),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
              Referer: selectedCandidate.url,
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            },
          });
          resJson = typeof ajaxRes === 'string' ? JSON.parse(ajaxRes) : ajaxRes;
        }

        if (resJson && resJson.embed_url) {
          let embedTarget: string = resJson.embed_url;
          if (embedTarget.includes('<iframe')) {
            const iframeMatch = embedTarget.match(/src=["']([^"']+)["']/i);
            if (iframeMatch && iframeMatch[1]) {
              embedTarget = iframeMatch[1];
            }
          }
          if (embedTarget.startsWith('//')) {
            embedTarget = `https:${embedTarget}`;
          } else if (embedTarget.startsWith('/')) {
            embedTarget = `${ONLINEFILMEKINGYEN_BASE}${embedTarget}`;
          }

          if (embedTarget.includes('video-proxy.php')) {
            try {
              const proxyHtml = await ctx.proxiedFetcher<string>(embedTarget, {
                headers: {
                  Referer: selectedCandidate.url,
                },
              });
              const destMatch = proxyHtml.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
              if (destMatch && destMatch[1]) {
                embedTarget = destMatch[1].trim();
              }
            } catch {
              // ignore
            }
          }

          if (embedTarget.startsWith('http')) {
            embedUrls.add(embedTarget);
          }
        }
      } catch (optErr) {
        console.log(`[OnlineFilmekIngyen] Error resolving option ${opt.nume}:`, optErr);
      }
    });

    await Promise.allSettled(optionPromises);
  }

  console.log(`[OnlineFilmekIngyen] Found ${embedUrls.size} raw embed URLs:`, Array.from(embedUrls));

  // 7. Map raw embed URLs to supported scrapers
  const embeds: SourcererEmbed[] = [];
  for (const rawUrl of embedUrls) {
    const embedId = getEmbedId(rawUrl);
    if (embedId) {
      embeds.push({
        embedId,
        url: rawUrl,
      });
    } else {
      console.log(`[OnlineFilmekIngyen] Unknown or unsupported embed host: ${rawUrl}`);
    }
  }

  if (embeds.length === 0) {
    throw new NotFoundError(`No playable streams found on OnlineFilmekIngyen for "${originalTitle}"`);
  }

  console.log(
    `[OnlineFilmekIngyen] Returning ${embeds.length} embeds:`,
    embeds.map((e) => `${e.embedId} -> ${e.url}`),
  );

  return { embeds };
}

export const onlinefilmekingyenScraper = makeSourcerer({
  id: 'onlinefilmekingyen',
  name: 'OnlineFilmekIngyen',
  rank: 127,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie(ctx) {
    return scrapeOnlineFilmekIngyen(ctx, 'movie');
  },
  scrapeShow(ctx) {
    return scrapeOnlineFilmekIngyen(ctx, 'show');
  },
});
