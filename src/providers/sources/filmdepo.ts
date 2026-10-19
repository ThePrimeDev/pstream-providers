import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const FILMDEPO_BASE = 'https://filmdepo.hu';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: `${FILMDEPO_BASE}/`,
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

async function getHungarianTitle(title: string, year?: number, tmdbId?: string): Promise<string | null> {
  try {
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
    console.log('[FilmDepo] TMDB Hungarian title lookup error:', err);
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

export const filmdepoScraper = makeSourcerer({
  id: 'filmdepo',
  name: 'FilmDepo',
  rank: 134,
  flags: [flags.CORS_ALLOWED],
  disabled: false,
  async scrapeMovie(ctx: MovieScrapeContext): Promise<SourcererOutput> {
    const huTitle = await getHungarianTitle(ctx.media.title, ctx.media.releaseYear, ctx.media.tmdbId);
    const searchQueries = new Set<string>();
    if (huTitle) searchQueries.add(huTitle);
    searchQueries.add(ctx.media.title);

    interface Candidate {
      huTitle: string;
      origTitle: string;
      url: string;
    }

    const candidates: Candidate[] = [];

    for (const query of searchQueries) {
      try {
        const searchUrl = `${FILMDEPO_BASE}/search.php?q=${encodeURIComponent(query)}`;
        const html = await ctx.proxiedFetcher<string>(searchUrl, { headers: HEADERS });
        const $ = load(html);

        $('.col a[href*="details.php?id="]').each((_, el) => {
          const href = $(el).attr('href');
          const itemHu = $(el).find('.fw-semibold').text().trim();
          const itemOrig = $(el).find('.text-white-50').text().trim();
          if (!href) return;

          const fullUrl = href.startsWith('http') ? href : `${FILMDEPO_BASE}/${href.replace(/^\//, '')}`;
          if (!candidates.some((c) => c.url === fullUrl)) {
            candidates.push({
              huTitle: itemHu,
              origTitle: itemOrig,
              url: fullUrl,
            });
          }
        });
      } catch (err) {
        console.log(`[FilmDepo] Search error for query "${query}":`, err);
      }
    }

    if (candidates.length === 0) {
      throw new NotFoundError('No search results found on FilmDepo');
    }

    const normOriginal = normalizeTitle(ctx.media.title);
    const normHu = huTitle ? normalizeTitle(huTitle) : null;

    let bestCandidate: Candidate | null = null;
    let highestScore = -1;

    for (const cand of candidates) {
      let score = 0;
      const normCandHu = normalizeTitle(cand.huTitle);
      const normCandOrig = normalizeTitle(cand.origTitle);

      if (normCandOrig && normCandOrig === normOriginal) {
        score += 50;
      } else if (normCandHu && normHu && normCandHu === normHu) {
        score += 50;
      } else if (normCandHu && normCandHu === normOriginal) {
        score += 45;
      } else if (normCandOrig && normCandOrig.includes(normOriginal)) {
        score += 30;
      } else if (normCandHu && normHu && normCandHu.includes(normHu)) {
        score += 30;
      } else if (normCandHu && normCandHu.includes(normOriginal)) {
        score += 20;
      }

      if (score > highestScore) {
        highestScore = score;
        bestCandidate = cand;
      }
    }

    if (!bestCandidate || highestScore < 10) {
      throw new NotFoundError('No matching movie found on FilmDepo');
    }

    const detailHtml = await ctx.proxiedFetcher<string>(bestCandidate.url, { headers: HEADERS });

    // Check year in detail page if available
    const pageYearMatch = detailHtml.match(/<title>[^<]*\((\d{4})\)/i);
    if (pageYearMatch && ctx.media.releaseYear) {
      const pageYear = parseInt(pageYearMatch[1], 10);
      if (Math.abs(pageYear - ctx.media.releaseYear) > 2) {
        throw new NotFoundError('Release year mismatch on FilmDepo');
      }
    }

    let videoUrl: string | null = null;

    // Pattern 1: FD_URLS object main property
    const fdUrlsMatch = detailHtml.match(/main\s*:\s*["']([^"']+)["']/);
    if (fdUrlsMatch) {
      videoUrl = fdUrlsMatch[1].replace(/\\\//g, '/').trim();
    }

    // Pattern 2: iframe with embed/player/video
    if (!videoUrl) {
      const $ = load(detailHtml);
      const iframeSrc = $('iframe[src*="videa"], iframe[src*="ok.ru"], iframe[src*="vk"], iframe[src*="player"]')
        .first()
        .attr('src');
      if (iframeSrc) {
        videoUrl = iframeSrc.trim();
      }
    }

    if (!videoUrl) {
      throw new NotFoundError('No video player found on FilmDepo detail page');
    }

    if (videoUrl.startsWith('//')) {
      videoUrl = `https:${videoUrl}`;
    }

    const embedId = getEmbedId(videoUrl);
    if (!embedId) {
      throw new NotFoundError(`Unsupported embed host on FilmDepo: ${videoUrl}`);
    }

    return {
      embeds: [
        {
          embedId,
          url: videoUrl,
        },
      ],
    };
  },
});
