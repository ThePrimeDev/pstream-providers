import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const MOZIGO_BASE = 'https://mozigo24.hu';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

interface MoziGoCandidate {
  id: number;
  name: string;
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
): Promise<string | null> {
  try {
    // 1. If tmdbId exists and is valid, fetch directly
    if (tmdbId && tmdbId !== '0') {
      const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=hu-HU`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        const hu = data.title;
        if (hu && typeof hu === 'string' && hu.trim()) {
          return hu.trim();
        }
      }
    }

    // 2. Search TMDB with query and language=hu-HU (using year if provided)
    const yearParam = year ? `&year=${year}` : '';
    const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
      title,
    )}&language=hu-HU${yearParam}`;
    const searchResp = await fetch(searchUrl);
    if (searchResp.ok) {
      const data = await searchResp.json();
      if (Array.isArray(data.results) && data.results.length > 0) {
        const first = data.results[0];
        const hu = first.title;
        if (hu && typeof hu === 'string' && hu.trim()) {
          return hu.trim();
        }
      }
    }

    // 3. Fallback: Retry search without year constraint
    if (year) {
      const fallbackUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
        title,
      )}&language=hu-HU`;
      const fallbackResp = await fetch(fallbackUrl);
      if (fallbackResp.ok) {
        const fallbackData = await fallbackResp.json();
        if (Array.isArray(fallbackData.results) && fallbackData.results.length > 0) {
          const first = fallbackData.results[0];
          const hu = first.title;
          if (hu && typeof hu === 'string' && hu.trim()) {
            return hu.trim();
          }
        }
      }
    }
  } catch (err) {
    console.log('[MoziGo] TMDB Hungarian title lookup error:', err);
  }
  return null;
}

function getEmbedId(targetUrl: string): string | null {
  const url = targetUrl.toLowerCase();
  if (url.includes('videa')) return 'videa';
  if (url.includes('filemoon') || url.includes('bysefujedu') || url.includes('moonmov')) return 'filemoon';
  if (url.includes('ok.ru') || url.includes('odnoklassniki')) return 'okru';
  if (url.includes('voe') || url.includes('megankiddifference') || url.includes('delivery-node') || url.includes('voe-unblock')) return 'voe';
  if (url.includes('indavideo')) return 'indavideo';
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

async function searchCandidates(
  ctx: MovieScrapeContext,
  query: string,
): Promise<MoziGoCandidate[]> {
  const searchUrl = `${MOZIGO_BASE}/api/v3/get-search-data?search=${encodeURIComponent(
    query,
  )}&page=1&is_ajax=1&per_page=24`;
  console.log(`[MoziGo] Running search: ${searchUrl}`);

  try {
    const resp = await ctx.proxiedFetcher<any>(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${MOZIGO_BASE}/`,
      },
    });

    const raw = typeof resp === 'string' ? resp : typeof resp?.body === 'string' ? resp.body : resp?.body || resp;
    const parsedData = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsedData || !parsedData.html) {
      return [];
    }

    const $ = load(parsedData.html);
    const candidates: MoziGoCandidate[] = [];

    $('[data-movie-data]').each((_, el) => {
      const rawData = $(el).attr('data-movie-data');
      if (!rawData) return;

      try {
        const d = JSON.parse(rawData);
        if (!d.slug || !d.name) return;

        // Unescape HTML entities in slug and name
        const cleanSlug = d.slug
          .replace(/&amp;/g, '&')
          .replace(/&#038;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

        const year = d.release_date ? parseInt(d.release_date.slice(0, 4), 10) : undefined;

        candidates.push({
          id: d.id,
          name: d.name,
          slug: cleanSlug,
          year: isNaN(year!) ? undefined : year,
        });
      } catch {
        // Skip unparseable data-movie-data
      }
    });

    return candidates;
  } catch (err) {
    console.log(`[MoziGo] Search error for query "${query}":`, err);
    return [];
  }
}

export const mozigoScraper = makeSourcerer({
  id: 'mozigo',
  name: 'MoziGo',
  rank: 131,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  async scrapeMovie(ctx: MovieScrapeContext): Promise<SourcererOutput> {
    console.log(`[MoziGo] Starting movie scrape: "${ctx.media.title}" (${ctx.media.releaseYear})`);

    // 1. Resolve Hungarian title
    const huTitle = await getHungarianTitle(
      ctx.media.title,
      ctx.media.releaseYear,
      ctx.media.tmdbId,
    );
    if (huTitle) {
      console.log(`[MoziGo] Resolved Hungarian title: "${huTitle}"`);
    }

    // 2. Build search queries
    const queries = new Set<string>();
    if (huTitle) {
      queries.add(huTitle);
      const cleanHu = huTitle.replace(/[:\-–—]/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleanHu !== huTitle) {
        queries.add(cleanHu);
      }
    }
    queries.add(ctx.media.title);
    const cleanOrig = ctx.media.title.replace(/[:\-–—]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanOrig !== ctx.media.title) {
      queries.add(cleanOrig);
    }

    // 3. Search and gather candidates
    const candidateMap = new Map<number | string, MoziGoCandidate>();
    for (const q of queries) {
      const results = await searchCandidates(ctx, q);
      for (const cand of results) {
        const key = cand.id || cand.slug;
        if (!candidateMap.has(key)) {
          candidateMap.set(key, cand);
        }
      }
      if (candidateMap.size > 0 && huTitle && q === huTitle) {
        // If we found candidates with the primary Hungarian title, proceed
        break;
      }
    }

    const allCandidates = Array.from(candidateMap.values());
    console.log(`[MoziGo] Found ${allCandidates.length} unique candidates`);
    if (allCandidates.length === 0) {
      throw new NotFoundError('No candidates found on MoziGo');
    }

    // 4. Score and sort candidates
    const targetTitleNorm = normalizeTitle(ctx.media.title);
    const targetHuTitleNorm = huTitle ? normalizeTitle(huTitle) : null;
    const targetYear = ctx.media.releaseYear;

    function scoreCandidate(c: MoziGoCandidate): number {
      const cNorm = normalizeTitle(c.name);
      let score = 0;

      if (targetHuTitleNorm && cNorm === targetHuTitleNorm) {
        score += 100;
      } else if (cNorm === targetTitleNorm) {
        score += 90;
      } else if (targetHuTitleNorm && (cNorm.includes(targetHuTitleNorm) || targetHuTitleNorm.includes(cNorm))) {
        score += 50;
      } else if (cNorm.includes(targetTitleNorm) || targetTitleNorm.includes(cNorm)) {
        score += 40;
      }

      if (targetYear && c.year) {
        const diff = Math.abs(c.year - targetYear);
        if (diff === 0) {
          score += 30;
        } else if (diff === 1) {
          score += 15;
        } else {
          score -= 30;
        }
      }

      return score;
    }

    const scoredCandidates = allCandidates
      .map((cand) => ({ cand, score: scoreCandidate(cand) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    console.log(
      `[MoziGo] Scored candidates:`,
      scoredCandidates.map((sc) => `${sc.cand.name} (${sc.cand.year}) [score=${sc.score}, slug=${sc.cand.slug}]`),
    );

    if (scoredCandidates.length === 0) {
      throw new NotFoundError('No matching candidates found on MoziGo');
    }

    // 5. Scrape candidate watch pages
    const embeds: SourcererEmbed[] = [];

    for (const { cand } of scoredCandidates) {
      const watchUrl = `${MOZIGO_BASE}/watch/${encodeURI(cand.slug)}.html`;
      console.log(`[MoziGo] Checking watch page: ${watchUrl}`);

      try {
        const rawWatch = await ctx.proxiedFetcher<any>(watchUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Referer: `${MOZIGO_BASE}/`,
          },
        });

        const watchHtml =
          typeof rawWatch === 'string'
            ? rawWatch
            : typeof rawWatch?.body === 'string'
              ? rawWatch.body
              : String(rawWatch ?? '');

        const tokenMatch = watchHtml.match(/data-video-url=["']([^"']+)["']/);
        const token = tokenMatch ? tokenMatch[1].trim() : '';
        if (!token) {
          console.log(`[MoziGo] No active video stream token found on ${cand.slug} (upcoming/cinema)`);
          continue;
        }

        const streamApiUrl = `${MOZIGO_BASE}/video/stream/${token}`;
        console.log(`[MoziGo] Fetching stream info from: ${streamApiUrl}`);

        const streamResp = await ctx.proxiedFetcher<any>(streamApiUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Referer: watchUrl,
            'X-Requested-With': 'XMLHttpRequest',
          },
        });

        const rawStream =
          typeof streamResp === 'string'
            ? streamResp
            : typeof streamResp?.body === 'string'
              ? streamResp.body
              : streamResp;
        const streamData = typeof rawStream === 'string' ? JSON.parse(rawStream) : rawStream;
        if (!streamData || !streamData.url) {
          console.log(`[MoziGo] Empty stream URL returned from API for ${cand.slug}`);
          continue;
        }

        let streamUrl: string = streamData.url;
        if (streamUrl.startsWith('//')) {
          streamUrl = `https:${streamUrl}`;
        }

        console.log(`[MoziGo] Extracted stream URL: ${streamUrl}`);

        // Direct HLS stream
        if (streamUrl.includes('.m3u8')) {
          return {
            embeds: [],
            stream: [
              {
                id: 'primary',
                type: 'hls',
                playlist: streamUrl,
                flags: [flags.CORS_ALLOWED],
                captions: [],
              },
            ],
          };
        }

        const embedId = getEmbedId(streamUrl);
        if (embedId) {
          embeds.push({
            embedId,
            url: streamUrl,
          });
          // Found a working embed for top matching candidate
          break;
        } else {
          console.log(`[MoziGo] Unrecognized embed URL format: ${streamUrl}`);
        }
      } catch (err) {
        console.log(`[MoziGo] Failed to extract from candidate ${cand.slug}:`, err);
      }
    }

    if (embeds.length === 0) {
      throw new NotFoundError('No playable embeds found on MoziGo');
    }

    console.log(`[MoziGo] Returning ${embeds.length} embeds:`, embeds);
    return {
      embeds,
    };
  },
  async scrapeShow(_ctx: ShowScrapeContext): Promise<SourcererOutput> {
    throw new NotFoundError('MoziGo only supports movies');
  },
});
