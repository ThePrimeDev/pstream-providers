import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const MOZIKATALOGUS_BASE = 'https://mozikatalogus.hu';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: `${MOZIKATALOGUS_BASE}/`,
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

    if (year) {
      const fallbackUrl = `https://api.themoviedb.org/3/search/${typePath}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
        title,
      )}&language=hu-HU`;
      const fallbackResp = await fetch(fallbackUrl);
      if (fallbackResp.ok) {
        const data = await fallbackResp.json();
        if (Array.isArray(data.results) && data.results.length > 0) {
          const first = data.results[0];
          const hu = mediaType === 'show' ? first.name : first.title;
          if (hu && typeof hu === 'string' && hu.trim()) {
            return hu.trim();
          }
        }
      }
    }
  } catch (err) {
    console.log('[MoziKatalogus] TMDB Hungarian title lookup error:', err);
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

interface FilmCard {
  id: number;
  hungarian_title: string;
  original_title?: string;
  slug: string;
  release_date?: number;
  type: number; // 1 = Film, 2 = Sorozat
  url?: string;
}

function extractCardsFromHtml(html: string): FilmCard[] {
  const $ = load(html);
  const cards: FilmCard[] = [];

  $('film-card-component, film-card-big-component').each((_, el) => {
    const raw = $(el).attr(':film');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        cards.push(parsed as FilmCard);
      }
    } catch {
      // ignore
    }
  });

  return cards;
}

export const mozikatalogusScraper = makeSourcerer({
  id: 'mozikatalogus',
  name: 'MoziKatalógus',
  rank: 141,
  flags: [flags.CORS_ALLOWED],
  disabled: false,
  async scrapeMovie(ctx: MovieScrapeContext): Promise<SourcererOutput> {
    const huTitle = await getHungarianTitle(ctx.media.title, ctx.media.releaseYear, ctx.media.tmdbId, 'movie');
    const queries = new Set<string>();
    if (huTitle) queries.add(huTitle);
    queries.add(ctx.media.title);

    const targetYear = ctx.media.releaseYear;
    const normEn = normalizeTitle(ctx.media.title);
    const normHu = huTitle ? normalizeTitle(huTitle) : null;

    let matchedCard: FilmCard | null = null;

    for (const query of queries) {
      const searchUrl = `${MOZIKATALOGUS_BASE}/filmkereso?film_title2=${encodeURIComponent(query)}&film_type=0&language=all`;
      const html = await ctx.proxiedFetcher<string>(searchUrl, { headers: HEADERS });
      const cards = extractCardsFromHtml(html);

      for (const card of cards) {
        if (card.type !== 1) continue; // 1 = movie

        const cardHunNorm = normalizeTitle(card.hungarian_title || '');
        const cardOrigNorm = card.original_title ? normalizeTitle(card.original_title) : '';

        const titleMatch =
          cardHunNorm === normEn ||
          cardOrigNorm === normEn ||
          (normHu && cardHunNorm === normHu) ||
          (normHu && cardOrigNorm === normHu) ||
          cardHunNorm.includes(normEn) ||
          normEn.includes(cardHunNorm);

        if (!titleMatch) continue;

        if (targetYear && card.release_date) {
          if (Math.abs(card.release_date - targetYear) <= 1) {
            matchedCard = card;
            break;
          }
        } else {
          matchedCard = card;
          break;
        }
      }

      if (matchedCard) break;
    }

    if (!matchedCard || !matchedCard.url) {
      throw new NotFoundError('No movie found on MoziKatalógus');
    }

    let streamUrl = matchedCard.url.trim();
    if (streamUrl.startsWith('//')) streamUrl = `https:${streamUrl}`;

    const embedId = getEmbedId(streamUrl);
    if (!embedId) {
      throw new NotFoundError(`Unsupported player on MoziKatalógus: ${streamUrl}`);
    }

    return {
      embeds: [
        {
          embedId,
          url: streamUrl,
        },
      ],
    };
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

    let matchedCard: FilmCard | null = null;

    for (const query of queries) {
      const searchUrl = `${MOZIKATALOGUS_BASE}/filmkereso?film_title2=${encodeURIComponent(query)}&film_type=0&language=all`;
      const html = await ctx.proxiedFetcher<string>(searchUrl, { headers: HEADERS });
      const cards = extractCardsFromHtml(html);

      for (const card of cards) {
        if (card.type !== 2) continue; // 2 = series

        const cardHunNorm = normalizeTitle(card.hungarian_title || '');
        const cardOrigNorm = card.original_title ? normalizeTitle(card.original_title) : '';

        const titleMatch =
          cardHunNorm === normEn ||
          cardOrigNorm === normEn ||
          (normHu && cardHunNorm === normHu) ||
          (normHu && cardOrigNorm === normHu) ||
          cardHunNorm.includes(normEn) ||
          normEn.includes(cardHunNorm);

        if (titleMatch) {
          matchedCard = card;
          break;
        }
      }

      if (matchedCard) break;
    }

    if (!matchedCard || !matchedCard.slug) {
      throw new NotFoundError('Series not found on MoziKatalógus');
    }

    const episodeUrl = `${MOZIKATALOGUS_BASE}/film/${matchedCard.slug}/${targetSeason}-evad/${targetEpisode}-resz`;
    const epHtml = await ctx.proxiedFetcher<string>(episodeUrl, { headers: HEADERS });
    const $ = load(epHtml);

    let playerUrl: string | null = null;

    const iframeComp = $('iframe-component');
    if (iframeComp.length > 0) {
      const rawUrl = iframeComp.attr(':url');
      if (rawUrl) {
        playerUrl = rawUrl.replace(/^['"]|['"]$/g, '').replace(/\\/g, '');
      }
    }

    if (!playerUrl) {
      const iframeSrc = $('iframe[src]').attr('src');
      if (iframeSrc && !iframeSrc.includes('youtube.com')) {
        playerUrl = iframeSrc;
      }
    }

    if (!playerUrl) {
      throw new NotFoundError(`Episode S${targetSeason}E${targetEpisode} not found on MoziKatalógus`);
    }

    if (playerUrl.startsWith('//')) playerUrl = `https:${playerUrl}`;

    const embedId = getEmbedId(playerUrl);
    if (!embedId) {
      throw new NotFoundError(`Unsupported player on MoziKatalógus: ${playerUrl}`);
    }

    return {
      embeds: [
        {
          embedId,
          url: playerUrl,
        },
      ],
    };
  },
});
