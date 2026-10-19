import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const FILMEZEK_BASE = 'https://filmezek.com';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: `${FILMEZEK_BASE}/`,
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
  } catch (err) {
    console.log('[Filmezek] TMDB Hungarian title lookup error:', err);
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

interface FilmezekSearchItem {
  MovieTitle: string;
  MovieSlug: string;
  MovieTipus: string;
  type: string; // "online-filmek" or "online-sorozatok"
}

export const filmezekScraper = makeSourcerer({
  id: 'filmezek',
  name: 'Filmezek',
  rank: 143,
  flags: [flags.CORS_ALLOWED],
  disabled: false,
  async scrapeMovie(ctx: MovieScrapeContext): Promise<SourcererOutput> {
    const huTitle = await getHungarianTitle(ctx.media.title, ctx.media.releaseYear, ctx.media.tmdbId, 'movie');
    const queries = new Set<string>();
    if (huTitle) queries.add(huTitle);
    queries.add(ctx.media.title);

    const normEn = normalizeTitle(ctx.media.title);
    const normHu = huTitle ? normalizeTitle(huTitle) : null;

    let matchedItem: FilmezekSearchItem | null = null;

    for (const query of queries) {
      const searchUrl = `${FILMEZEK_BASE}/searchinput.php?searchType=1&term=${encodeURIComponent(query)}`;
      const raw = await ctx.proxiedFetcher<any>(searchUrl, { headers: HEADERS });
      let items: FilmezekSearchItem[] = [];
      try {
        items = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        continue;
      }
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        if (item.type !== 'online-filmek') continue;

        const titleNorm = normalizeTitle(item.MovieTitle || '');
        const titleMatch =
          titleNorm === normEn ||
          (normHu && titleNorm === normHu) ||
          titleNorm.includes(normEn) ||
          normEn.includes(titleNorm);

        if (titleMatch) {
          matchedItem = item;
          break;
        }
      }

      if (matchedItem) break;
    }

    if (!matchedItem) {
      throw new NotFoundError('Movie not found on Filmezek');
    }

    const movieUrl = `${FILMEZEK_BASE}/online-filmek/${matchedItem.MovieSlug}/`;
    const html = await ctx.proxiedFetcher<string>(movieUrl, { headers: HEADERS });
    const $ = load(html);

    const rawUrls: string[] = [];

    const mainIframe = $('iframe#embedPlayer').attr('src');
    if (mainIframe) rawUrls.push(mainIframe);

    $('button.embed-switch[data-url]').each((_, el) => {
      const altUrl = $(el).attr('data-url');
      if (altUrl) rawUrls.push(altUrl);
    });

    $('a.playicon[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) rawUrls.push(href);
    });

    const embeds: SourcererEmbed[] = [];
    const seenUrls = new Set<string>();

    for (let link of rawUrls) {
      link = link.trim();
      if (link.startsWith('//')) link = `https:${link}`;
      if (!link.startsWith('http')) continue;
      if (link.includes('youtube.com') || link.includes('google')) continue;

      const embedId = getEmbedId(link);
      if (embedId && !seenUrls.has(link)) {
        seenUrls.add(link);
        embeds.push({
          embedId,
          url: link,
        });
      }
    }

    if (embeds.length === 0) {
      throw new NotFoundError('No compatible video embeds found on Filmezek');
    }

    return { embeds };
  },

  async scrapeShow(ctx: ShowScrapeContext): Promise<SourcererOutput> {
    const huTitle = await getHungarianTitle(ctx.media.title, ctx.media.releaseYear, ctx.media.tmdbId, 'show');
    const queries = new Set<string>();
    if (huTitle) queries.add(huTitle);
    queries.add(ctx.media.title);

    const normEn = normalizeTitle(ctx.media.title);
    const normHu = huTitle ? normalizeTitle(huTitle) : null;
    const targetSeason = ctx.media.season.number;
    const targetEpisode = ctx.media.episode.number;

    let matchedItem: FilmezekSearchItem | null = null;

    for (const query of queries) {
      const searchUrl = `${FILMEZEK_BASE}/searchinput.php?searchType=1&term=${encodeURIComponent(query)}`;
      const raw = await ctx.proxiedFetcher<any>(searchUrl, { headers: HEADERS });
      let items: FilmezekSearchItem[] = [];
      try {
        items = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        continue;
      }
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        if (item.type !== 'online-sorozatok') continue;

        const titleNorm = normalizeTitle(item.MovieTitle || '');
        const titleMatch =
          titleNorm === normEn ||
          (normHu && titleNorm === normHu) ||
          titleNorm.includes(normEn) ||
          normEn.includes(titleNorm);

        if (titleMatch) {
          // Check if this item is the target season
          const seasonMatch = item.MovieTitle.match(/(\d+)\.\s*[ée]vad/i) || item.MovieSlug.match(/-(\d+)-evad/i);
          if (seasonMatch) {
            const seasonNum = parseInt(seasonMatch[1], 10);
            if (seasonNum === targetSeason) {
              matchedItem = item;
              break;
            }
          } else if (targetSeason === 1) {
            matchedItem = item;
            break;
          }
        }
      }

      if (matchedItem) break;
    }

    if (!matchedItem) {
      throw new NotFoundError('Series not found on Filmezek');
    }

    const seriesUrl = `${FILMEZEK_BASE}/online-sorozatok/${matchedItem.MovieSlug}/`;
    const html = await ctx.proxiedFetcher<string>(seriesUrl, { headers: HEADERS });
    const $ = load(html);

    // Find link for target episode
    let targetEpUrl: string | null = null;
    $('a[href*="/resz/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const m = href.match(/\/resz\/(\d+)\/?/);
      if (m && parseInt(m[1], 10) === targetEpisode) {
        targetEpUrl = href;
      }
    });

    if (!targetEpUrl) {
      throw new NotFoundError(`Episode S${targetSeason}E${targetEpisode} link not found on Filmezek`);
    }

    const epHtml = await ctx.proxiedFetcher<string>(targetEpUrl, { headers: HEADERS });
    const $ep = load(epHtml);

    const rawUrls: string[] = [];

    const epIframe = $ep('iframe#embedPlayer').attr('src') || $ep('iframe[src]').attr('src');
    if (epIframe) rawUrls.push(epIframe);

    $ep('button.embed-switch[data-url]').each((_, el) => {
      const altUrl = $ep(el).attr('data-url');
      if (altUrl) rawUrls.push(altUrl);
    });

    $ep('a.playicon[href]').each((_, el) => {
      const href = $ep(el).attr('href');
      if (href) rawUrls.push(href);
    });

    const embeds: SourcererEmbed[] = [];
    const seenUrls = new Set<string>();

    for (let link of rawUrls) {
      link = link.trim();
      if (link.startsWith('//')) link = `https:${link}`;
      if (!link.startsWith('http')) continue;
      if (link.includes('youtube.com') || link.includes('google')) continue;

      const embedId = getEmbedId(link);
      if (embedId && !seenUrls.has(link)) {
        seenUrls.add(link);
        embeds.push({
          embedId,
          url: link,
        });
      }
    }

    if (embeds.length === 0) {
      throw new NotFoundError('No compatible video embeds found for episode on Filmezek');
    }

    return { embeds };
  },
});
