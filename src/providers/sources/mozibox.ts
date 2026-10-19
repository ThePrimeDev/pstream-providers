import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const MOZIBOX_BASE = 'https://mozibox.hu';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: `${MOZIBOX_BASE}/`,
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
    console.log('[MoziBox] TMDB Hungarian title lookup error:', err);
  }
  return null;
}

function getEmbedId(targetUrl: string): string | null {
  const url = targetUrl.toLowerCase();
  if (url.includes('fsst.online') || url.includes('incvideo1.online')) return 'fsst';
  if (url.includes('videa')) return 'videa';
  if (url.includes('indavideo')) return 'indavideo';
  if (url.includes('ok.ru') || url.includes('odnoklassniki')) return 'okru';
  if (url.includes('vk.com') || url.includes('vkvideo.ru') || url.includes('vk.ru')) return 'vk';
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

export const moziboxScraper = makeSourcerer({
  id: 'mozibox',
  name: 'MoziBox',
  rank: 137,
  flags: [flags.CORS_ALLOWED],
  disabled: false,
  async scrapeMovie(ctx: MovieScrapeContext): Promise<SourcererOutput> {
    const huTitle = await getHungarianTitle(ctx.media.title, ctx.media.releaseYear, ctx.media.tmdbId);
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
        const searchUrl = `${MOZIBOX_BASE}/index.php?q=${encodeURIComponent(query)}`;
        const html = await ctx.proxiedFetcher<string>(searchUrl, { headers: HEADERS });
        const $ = load(html);

        $('article.movie-card').each((_, el) => {
          const title = $(el).find('h2.movie-title').text().trim();
          const yearStr = $(el).find('.movie-year').text().trim();
          const href = $(el).find('a.btn-primary').attr('href');
          if (!href || !title) return;

          let year: number | undefined;
          if (yearStr && /^\d{4}$/.test(yearStr)) {
            year = parseInt(yearStr, 10);
          }

          const fullUrl = href.startsWith('http') ? href : `${MOZIBOX_BASE}/${href.replace(/^\//, '')}`;
          if (!candidates.some((c) => c.url === fullUrl)) {
            candidates.push({
              title,
              url: fullUrl,
              year,
            });
          }
        });
      } catch (err) {
        console.log(`[MoziBox] Search error for query "${query}":`, err);
      }
    }

    if (candidates.length === 0) {
      throw new NotFoundError('No search results found on MoziBox');
    }

    const normOriginal = normalizeTitle(ctx.media.title);
    const normHu = huTitle ? normalizeTitle(huTitle) : null;

    let bestCandidate: Candidate | null = null;
    let highestScore = -1;

    for (const cand of candidates) {
      let score = 0;
      const normCand = normalizeTitle(cand.title);

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
      throw new NotFoundError('No matching movie found on MoziBox');
    }

    const movieHtml = await ctx.proxiedFetcher<string>(bestCandidate.url, { headers: HEADERS });
    const $ = load(movieHtml);

    const rawUrls = new Set<string>();

    $('.player-frame iframe, iframe[src]').each((_, el) => {
      let src = $(el).attr('src')?.trim();
      if (!src) return;
      if (src.startsWith('//')) src = `https:${src}`;
      if (src.startsWith('http')) {
        rawUrls.add(src);
      }
    });

    const embeds: SourcererEmbed[] = [];
    const seenUrls = new Set<string>();

    for (const url of rawUrls) {
      const embedId = getEmbedId(url);
      if (embedId && !seenUrls.has(url)) {
        seenUrls.add(url);
        embeds.push({
          embedId,
          url,
        });
      }
    }

    if (embeds.length === 0) {
      throw new NotFoundError('No compatible video embeds found on MoziBox');
    }

    return { embeds };
  },
});
