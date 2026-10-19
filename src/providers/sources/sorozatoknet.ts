import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const SOROZATOK_BASE = 'https://sorozatok.net';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: `${SOROZATOK_BASE}/`,
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
  mediaType: 'movie' | 'show' = 'show',
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
    console.log('[SorozatokNet] TMDB Hungarian title lookup error:', err);
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

function decodeHunter(h: string, u: number, n: string, t: number, e: number, r: number): string {
  try {
    const separator = n[e];
    const parts = h.split(separator);
    const decodedBytes: number[] = [];
    for (const part of parts) {
      if (!part) continue;
      let val = 0;
      for (const char of part) {
        if (n.indexOf(char) !== -1) {
          val = val * e + n.indexOf(char);
        }
      }
      decodedBytes.push(val - t);
    }
    return Buffer.from(decodedBytes).toString('utf-8');
  } catch {
    return '';
  }
}

interface SorozatSearchItem {
  cat_id: string;
  cat_name: string;
  cat_eng: string;
  year: string;
  url: string;
}

export const sorozatoknetScraper = makeSourcerer({
  id: 'sorozatoknet',
  name: 'Sorozatok.Net',
  rank: 142,
  flags: [flags.CORS_ALLOWED],
  disabled: false,
  async scrapeMovie(): Promise<SourcererOutput> {
    throw new NotFoundError('Sorozatok.Net only provides series');
  },

  async scrapeShow(ctx: ShowScrapeContext): Promise<SourcererOutput> {
    const huTitle = await getHungarianTitle(ctx.media.title, ctx.media.releaseYear, ctx.media.tmdbId, 'show');

    const normEn = normalizeTitle(ctx.media.title);
    const normHu = huTitle ? normalizeTitle(huTitle) : null;
    const targetSeason = ctx.media.season.number;
    const targetEpisode = ctx.media.episode.number;

    const listRaw = await ctx.proxiedFetcher<any>('https://sorozatok.net/api/search.json', {
      headers: HEADERS,
    });
    const listJson: SorozatSearchItem[] = typeof listRaw === 'string' ? JSON.parse(listRaw) : listRaw;

    if (!Array.isArray(listJson)) {
      throw new NotFoundError('Failed to fetch Sorozatok.Net series list');
    }

    let matchedItem: SorozatSearchItem | null = null;

    for (const item of listJson) {
      const hunNorm = normalizeTitle(item.cat_name || '');
      const engNorm = normalizeTitle(item.cat_eng || '');

      const titleMatch =
        hunNorm === normEn ||
        engNorm === normEn ||
        (normHu && hunNorm === normHu) ||
        (normHu && engNorm === normHu) ||
        hunNorm.includes(normEn) ||
        normEn.includes(hunNorm);

      if (titleMatch) {
        matchedItem = item;
        break;
      }
    }

    if (!matchedItem) {
      throw new NotFoundError('Series not found on Sorozatok.Net');
    }

    const seriesUrl = `${SOROZATOK_BASE}/${matchedItem.url}-online`;
    const seriesHtml = await ctx.proxiedFetcher<string>(seriesUrl, { headers: HEADERS });

    const $ = load(seriesHtml);
    let targetKey: string | null = null;
    let targetDataId: string | null = null;

    $('a.clip-link').each((_, el) => {
      const href = $(el).attr('href') || '';
      const title = $(el).attr('title') || $(el).text() || '';
      const dataId = $(el).attr('data-id');

      const keyMatch = href.match(/watch\.php\?v=([a-zA-Z0-9]+)/);
      if (!keyMatch) return;

      const sMatch = title.match(/(\d+)\.\s*[ÉE]vad/i);
      const eMatch = title.match(/(\d+)\.\s*(?:Epiz[oó]d|r[eé]sz)/i);

      if (sMatch && eMatch) {
        const s = parseInt(sMatch[1], 10);
        const e = parseInt(eMatch[1], 10);
        if (s === targetSeason && e === targetEpisode) {
          targetKey = keyMatch[1];
          if (dataId) targetDataId = dataId;
        }
      }
    });

    if (!targetKey) {
      throw new NotFoundError(`Episode S${targetSeason}E${targetEpisode} not found on Sorozatok.Net`);
    }

    const watchUrl = `${SOROZATOK_BASE}/watch.php?v=${targetKey}`;
    const watchResp = await ctx.proxiedFetcher.full<string>(watchUrl, { headers: HEADERS });
    const watchHtml = watchResp.body;

    if (!targetDataId) {
      const mId =
        watchHtml.match(new RegExp(`data-id=["'](\\d+)["'][^>]*href=["']\\/watch\\.php\\?v=${targetKey}["']`, 'i')) ||
        watchHtml.match(/data-id=["'](\d+)["']/i);
      if (mId) targetDataId = mId[1];
    }

    if (!targetDataId) {
      throw new NotFoundError('Failed to extract embed data-id on Sorozatok.Net');
    }

    const goUrl = `${SOROZATOK_BASE}/go.php?id=${targetDataId}&key=${targetKey}`;
    const goResp = await ctx.proxiedFetcher.full<string>(goUrl, {
      headers: { ...HEADERS, Referer: watchUrl },
    });

    const streambotUrl = goResp.finalUrl || goUrl;
    const streambotHtml = goResp.body;

    const hunterRegex = /eval\(function\(h,u,n,t,e,r\)[\s\S]+?\}\(([\s\S]+?)\)\)/g;
    let hMatch: RegExpExecArray | null = null;
    let videoplaybackUrl: string | null = null;

    while ((hMatch = hunterRegex.exec(streambotHtml)) !== null) {
      try {
        // eslint-disable-next-line no-eval
        const args = (0, eval)(`[${hMatch[1]}]`);
        const decoded = decodeHunter(args[0], args[1], args[2], args[3], args[4], args[5]);
        const vMatch = decoded.match(/(https?:\/\/[^\s"'<>]+\/videoplayback\.php\?hash=[a-zA-Z0-9]+)/);
        if (vMatch) {
          videoplaybackUrl = vMatch[1];
          break;
        }
      } catch {
        // ignore
      }
    }

    if (!videoplaybackUrl) {
      throw new NotFoundError('Failed to unpack stream playback link on Sorozatok.Net');
    }

    const playResp = await ctx.proxiedFetcher.full<string>(videoplaybackUrl, {
      headers: { ...HEADERS, Referer: streambotUrl },
    });

    const finalPlayerUrl = playResp.finalUrl || videoplaybackUrl;
    const embedId = getEmbedId(finalPlayerUrl);

    if (!embedId) {
      throw new NotFoundError(`Unsupported video player resolved from Sorozatok.Net: ${finalPlayerUrl}`);
    }

    return {
      embeds: [
        {
          embedId,
          url: finalPlayerUrl,
        },
      ],
    };
  },
});
