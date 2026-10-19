import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const FILMVIILAG2_BASE = 'https://onlinefilmvilag2.eu';
const KATALOG_SEARCH_URL = 'https://katalog.estranky.cz/';
const KATALOG_UID = '1504382';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: `${FILMVIILAG2_BASE}/`,
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
    console.log('[OnlineFilmvilag2] TMDB Hungarian title lookup error:', err);
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
  if (url.includes('vidhide') || url.includes('vidhidepro') || url.includes('dinisglows') || url.includes('vtbe.to'))
    return 'vidhide-english';
  if (url.includes('dood') || url.includes('ds2play') || url.includes('do0od') || url.includes('d0o0d')) return 'dood';
  if (url.includes('streamtape')) return 'streamtape';
  if (url.includes('streamwish') || url.includes('wishembed') || url.includes('strwish')) return 'streamwish-english';
  if (url.includes('vidara') || url.includes('gjsabgs')) return 'vidara';
  if (url.includes('vidmoly')) return 'vidmoly';
  if (url.includes('rpmshare') || url.includes('rpmstream')) return 'rpmshare';
  return null;
}

interface SearchCandidate {
  title: string;
  url: string;
}

async function searchKatalog(ctx: MovieScrapeContext | ShowScrapeContext, query: string): Promise<SearchCandidate[]> {
  try {
    const formData = new URLSearchParams();
    formData.append('uid', KATALOG_UID);
    formData.append('key', query);

    const html = await ctx.proxiedFetcher<string>(KATALOG_SEARCH_URL, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const $ = load(html);
    const candidates: SearchCandidate[] = [];

    $('a[href*="cikkek"]').each((_, el) => {
      let href = $(el).attr('href')?.trim();
      const text = $(el).text().trim();
      if (!href || !text || href.includes('filmkeres-es-hibas-link')) return;

      if (href.startsWith('http://')) href = href.replace('http://', 'https://');
      if (href.startsWith('/')) href = `${FILMVIILAG2_BASE}${href}`;

      if (!candidates.some((c) => c.url === href)) {
        candidates.push({ title: text, url: href });
      }
    });

    return candidates;
  } catch {
    return [];
  }
}

export const onlinefilmvilag2Scraper = makeSourcerer({
  id: 'onlinefilmvilag2',
  name: 'OnlineFilmvilág2',
  rank: 145,
  flags: [flags.CORS_ALLOWED],
  disabled: false,
  async scrapeMovie(ctx: MovieScrapeContext): Promise<SourcererOutput> {
    const huTitle = await getHungarianTitle(ctx.media.title, ctx.media.releaseYear, ctx.media.tmdbId, 'movie');
    const queries = new Set<string>();
    if (huTitle) queries.add(huTitle);
    queries.add(ctx.media.title);

    const normEn = normalizeTitle(ctx.media.title);
    const normHu = huTitle ? normalizeTitle(huTitle) : null;
    const targetYear = ctx.media.releaseYear;

    let matchedCandidate: SearchCandidate | null = null;

    for (const query of queries) {
      const candidates = await searchKatalog(ctx, query);

      for (const cand of candidates) {
        const titleNorm = normalizeTitle(cand.title);
        const titleMatch =
          titleNorm === normEn ||
          (normHu && titleNorm === normHu) ||
          titleNorm.includes(normEn) ||
          normEn.includes(titleNorm);

        if (!titleMatch) continue;

        if (targetYear) {
          const yearMatch = cand.title.match(/(19\d\d|20\d\d)/);
          if (yearMatch) {
            const candYear = parseInt(yearMatch[1], 10);
            if (Math.abs(candYear - targetYear) <= 1) {
              matchedCandidate = cand;
              break;
            }
          } else {
            matchedCandidate = cand;
            break;
          }
        } else {
          matchedCandidate = cand;
          break;
        }
      }

      if (matchedCandidate) break;
    }

    if (!matchedCandidate) {
      throw new NotFoundError('Movie not found on OnlineFilmvilág2');
    }

    const html = await ctx.proxiedFetcher<string>(matchedCandidate.url, { headers: HEADERS });
    const $ = load(html);

    const rawUrls: string[] = [];

    $('.editor-area iframe[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) rawUrls.push(src);
    });

    $('.editor-area a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) rawUrls.push(href);
    });

    const embeds: SourcererEmbed[] = [];
    const seenUrls = new Set<string>();

    for (let link of rawUrls) {
      link = link.trim();
      if (link.startsWith('//')) link = `https:${link}`;
      if (!link.startsWith('http')) continue;
      if (link.includes('youtube.com') || link.includes('google') || link.includes('facebook.com')) continue;

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
      throw new NotFoundError('No compatible video embeds found on OnlineFilmvilág2');
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

    let matchedCandidate: SearchCandidate | null = null;

    for (const query of queries) {
      const candidates = await searchKatalog(ctx, query);

      for (const cand of candidates) {
        const titleNorm = normalizeTitle(cand.title);
        const titleMatch =
          titleNorm === normEn ||
          (normHu && titleNorm === normHu) ||
          titleNorm.includes(normEn) ||
          normEn.includes(titleNorm);

        if (titleMatch) {
          const seasonMatch = cand.title.match(/(\d+)\.\s*[ée]vad/i);
          if (seasonMatch) {
            if (parseInt(seasonMatch[1], 10) === targetSeason) {
              matchedCandidate = cand;
              break;
            }
          } else {
            matchedCandidate = cand;
            break;
          }
        }
      }

      if (matchedCandidate) break;
    }

    if (!matchedCandidate) {
      throw new NotFoundError('Show not found on OnlineFilmvilág2');
    }

    const html = await ctx.proxiedFetcher<string>(matchedCandidate.url, { headers: HEADERS });
    const $ = load(html);

    const rawUrls: string[] = [];

    $('.editor-area p').each((_, pEl) => {
      const text = $(pEl).text();
      const epMatch = text.match(/(\d+)\.\s*r[eé]sz/i);
      if (epMatch && parseInt(epMatch[1], 10) === targetEpisode) {
        $(pEl)
          .find('iframe[src]')
          .each((_, el) => {
            const src = $(el).attr('src');
            if (src) rawUrls.push(src);
          });
        $(pEl)
          .find('a[href]')
          .each((_, el) => {
            const href = $(el).attr('href');
            if (href) rawUrls.push(href);
          });
      }
    });

    if (rawUrls.length === 0) {
      $('.editor-area iframe[src]').each((_, el) => {
        const src = $(el).attr('src');
        if (src) rawUrls.push(src);
      });
      $('.editor-area a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) rawUrls.push(href);
      });
    }

    const embeds: SourcererEmbed[] = [];
    const seenUrls = new Set<string>();

    for (let link of rawUrls) {
      link = link.trim();
      if (link.startsWith('//')) link = `https:${link}`;
      if (!link.startsWith('http')) continue;
      if (link.includes('youtube.com') || link.includes('google') || link.includes('facebook.com')) continue;

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
      throw new NotFoundError('No compatible video embeds found for episode on OnlineFilmvilág2');
    }

    return { embeds };
  },
});
