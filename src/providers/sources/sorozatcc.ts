import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const SOROZATCC_BASE = 'https://sorozat.cc';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: `${SOROZATCC_BASE}/`,
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
    console.log('[SorozatCC] TMDB Hungarian title lookup error:', err);
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
  if (
    url.includes('vidhide') ||
    url.includes('vidhidepro') ||
    url.includes('dinisglows') ||
    url.includes('vtbe.to') ||
    url.includes('vid-hide')
  )
    return 'vidhide-english';
  if (url.includes('dood') || url.includes('ds2play') || url.includes('do0od') || url.includes('d0o0d')) return 'dood';
  if (url.includes('streamtape')) return 'streamtape';
  if (url.includes('streamwish') || url.includes('wishembed') || url.includes('strwish')) return 'streamwish-english';
  if (url.includes('vidara') || url.includes('gjsabgs')) return 'vidara';
  if (url.includes('vidmoly')) return 'vidmoly';
  if (url.includes('rpmshare') || url.includes('rpmstream')) return 'rpmshare';
  return null;
}

function extractSnapshot(html: string, componentName: string): string | null {
  const $ = load(html);
  let found: string | null = null;

  $('div[wire\\:snapshot]').each((_, el) => {
    const raw = $(el).attr('wire:snapshot');
    if (!raw) return;
    try {
      const snap = JSON.parse(raw);
      if (snap?.memo?.name === componentName) {
        found = raw;
      }
    } catch {
      // ignore
    }
  });

  return found;
}

function extractCsrf(html: string): string | null {
  const m = html.match(/name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function extractSorozatCookies(headers: Headers): string {
  const sc = headers.get('set-cookie') || headers.get('Set-Cookie') || '';
  const xsrf = sc.match(/XSRF-TOKEN=([^;]+)/)?.[0];
  const session = sc.match(/sorozatcc_session=([^;]+)/)?.[0];
  return [xsrf, session].filter(Boolean).join('; ');
}

interface LivewireResponse {
  components: Array<{
    snapshot: string;
    effects?: {
      html?: string;
    };
  }>;
}

export const sorozatccScraper = makeSourcerer({
  id: 'sorozatcc',
  name: 'Sorozat.cc',
  rank: 144,
  flags: [flags.CORS_ALLOWED],
  disabled: false,
  async scrapeMovie(ctx: MovieScrapeContext): Promise<SourcererOutput> {
    const huTitle = await getHungarianTitle(ctx.media.title, ctx.media.releaseYear, ctx.media.tmdbId, 'movie');
    const queries = new Set<string>();
    if (huTitle) queries.add(huTitle);
    queries.add(ctx.media.title);

    const normEn = normalizeTitle(ctx.media.title);
    const normHu = huTitle ? normalizeTitle(huTitle) : null;

    // Step 1: Load homepage to get CSRF token and search snapshot
    const homeResp = await ctx.proxiedFetcher.full<string>(SOROZATCC_BASE, {
      readHeaders: ['set-cookie', 'Set-Cookie'],
      headers: HEADERS,
    });
    const csrfToken = extractCsrf(homeResp.body);
    const searchSnapshot = extractSnapshot(homeResp.body, 'search');

    if (!csrfToken || !searchSnapshot) {
      throw new NotFoundError('Failed to initialize Sorozat.cc search session');
    }

    let cookieHeader = extractSorozatCookies(homeResp.headers);

    let matchedMoviePath: string | null = null;

    for (const query of queries) {
      const payload = {
        _token: csrfToken,
        components: [
          {
            snapshot: searchSnapshot,
            updates: { searchkeyword: query },
            calls: [],
          },
        ],
      };

      const updateResp = await ctx.proxiedFetcher<LivewireResponse>(`${SOROZATCC_BASE}/livewire/update`, {
        method: 'POST',
        headers: {
          ...HEADERS,
          'Content-Type': 'application/json',
          'X-CSRF-TOKEN': csrfToken,
          Cookie: cookieHeader,
        },
        body: JSON.stringify(payload),
      });

      const resultHtml = updateResp.components?.[0]?.effects?.html || '';
      const $res = load(resultHtml);

      $res('a.search-result-item[href*="/film/"]').each((_, el) => {
        const href = $res(el).attr('href');
        const title = $res(el).find('h6').text().trim();
        if (!href || !title) return;

        const titleNorm = normalizeTitle(title);
        const titleMatch =
          titleNorm === normEn ||
          (normHu && titleNorm === normHu) ||
          titleNorm.includes(normEn) ||
          normEn.includes(titleNorm);

        if (titleMatch) {
          matchedMoviePath = href.startsWith('http') ? href : `${SOROZATCC_BASE}${href}`;
        }
      });

      if (matchedMoviePath) break;
    }

    if (!matchedMoviePath) {
      throw new NotFoundError('Movie not found on Sorozat.cc');
    }

    // Step 2: Fetch movie page to get movie-embed snapshot and embed IDs
    const movieResp = await ctx.proxiedFetcher.full<string>(matchedMoviePath, {
      readHeaders: ['set-cookie', 'Set-Cookie'],
      headers: { ...HEADERS, Cookie: cookieHeader },
    });
    const movieCookies = extractSorozatCookies(movieResp.headers);
    if (movieCookies) cookieHeader = movieCookies;
    const movieCsrf = extractCsrf(movieResp.body) || csrfToken;
    const embedSnapshot = extractSnapshot(movieResp.body, 'movies.movie-embed');
    const linksSnapshot = extractSnapshot(movieResp.body, 'movies.movie-links');

    if (!embedSnapshot && !linksSnapshot) {
      throw new NotFoundError('No embed or links snapshot found on Sorozat.cc movie page');
    }

    const embeds: SourcererEmbed[] = [];
    const seenUrls = new Set<string>();

    // 1. Try movie-embed component if present
    if (embedSnapshot) {
      const embedIds: number[] = [];
      const selectMatches = movieResp.body.matchAll(/selectEmbed\((\d+)\)/g);
      for (const m of selectMatches) {
        const id = parseInt(m[1], 10);
        if (!embedIds.includes(id)) embedIds.push(id);
      }

      for (const embedId of embedIds.slice(0, 4)) {
        try {
          const payload = {
            _token: movieCsrf,
            components: [
              {
                snapshot: embedSnapshot,
                updates: {},
                calls: [
                  {
                    path: '',
                    method: 'selectEmbed',
                    params: [embedId],
                  },
                ],
              },
            ],
          };

          const embedResp = await ctx.proxiedFetcher<LivewireResponse>(`${SOROZATCC_BASE}/livewire/update`, {
            method: 'POST',
            headers: {
              ...HEADERS,
              'Content-Type': 'application/json',
              'X-CSRF-TOKEN': movieCsrf,
              Cookie: cookieHeader,
            },
            body: JSON.stringify(payload),
          });

          const newHtml = embedResp.components?.[0]?.effects?.html || '';
          const $embed = load(newHtml);
          const iframeSrc = $embed('iframe#myVideo').attr('src') || $embed('iframe[src]').attr('src');

          if (iframeSrc) {
            let cleanUrl = iframeSrc.trim();
            if (cleanUrl.startsWith('//')) cleanUrl = `https:${cleanUrl}`;
            const targetEmbedId = getEmbedId(cleanUrl);
            if (targetEmbedId && !seenUrls.has(cleanUrl)) {
              seenUrls.add(cleanUrl);
              embeds.push({
                embedId: targetEmbedId,
                url: cleanUrl,
              });
            }
          }
        } catch {
          // continue to next embed
        }
      }
    }

    // 2. Try movie-links component if present
    if (linksSnapshot) {
      try {
        const payload = {
          _token: movieCsrf,
          components: [
            {
              snapshot: linksSnapshot,
              updates: {},
              calls: [
                {
                  path: '',
                  method: 'getLinks',
                  params: [],
                },
              ],
            },
          ],
        };

        const linkResp = await ctx.proxiedFetcher<LivewireResponse>(`${SOROZATCC_BASE}/livewire/update`, {
          method: 'POST',
          headers: {
            ...HEADERS,
            'Content-Type': 'application/json',
            'X-CSRF-TOKEN': movieCsrf,
            Cookie: cookieHeader,
          },
          body: JSON.stringify(payload),
        });

        const linkHtml = linkResp.components?.[0]?.effects?.html || '';
        const $link = load(linkHtml);
        $link('tbody tr').each((_, tr) => {
          const href = $link(tr).find('a').attr('href');
          if (href) {
            let cleanUrl = href.trim();
            if (cleanUrl.startsWith('//')) cleanUrl = `https:${cleanUrl}`;
            const targetEmbedId = getEmbedId(cleanUrl);
            if (targetEmbedId && !seenUrls.has(cleanUrl)) {
              seenUrls.add(cleanUrl);
              embeds.push({
                embedId: targetEmbedId,
                url: cleanUrl,
              });
            }
          }
        });
      } catch {
        // continue
      }
    }

    if (embeds.length === 0) {
      throw new NotFoundError('No compatible video embeds resolved on Sorozat.cc');
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

    // Step 1: Initialize session
    const homeResp = await ctx.proxiedFetcher.full<string>(SOROZATCC_BASE, {
      readHeaders: ['set-cookie', 'Set-Cookie'],
      headers: HEADERS,
    });
    const csrfToken = extractCsrf(homeResp.body);
    const searchSnapshot = extractSnapshot(homeResp.body, 'search');

    if (!csrfToken || !searchSnapshot) {
      throw new NotFoundError('Failed to initialize Sorozat.cc search session');
    }

    let cookieHeader = extractSorozatCookies(homeResp.headers);

    let matchedShowUrl: string | null = null;

    for (const query of queries) {
      const payload = {
        _token: csrfToken,
        components: [
          {
            snapshot: searchSnapshot,
            updates: { searchkeyword: query },
            calls: [],
          },
        ],
      };

      const updateResp = await ctx.proxiedFetcher<LivewireResponse>(`${SOROZATCC_BASE}/livewire/update`, {
        method: 'POST',
        headers: {
          ...HEADERS,
          'Content-Type': 'application/json',
          'X-CSRF-TOKEN': csrfToken,
          Cookie: cookieHeader,
        },
        body: JSON.stringify(payload),
      });

      const resultHtml = updateResp.components?.[0]?.effects?.html || '';
      const $res = load(resultHtml);

      $res('a.search-result-item[href*="/sorozat/"]').each((_, el) => {
        const href = $res(el).attr('href');
        const title = $res(el).find('h6').text().trim();
        if (!href || !title) return;

        const titleNorm = normalizeTitle(title);
        const titleMatch =
          titleNorm === normEn ||
          (normHu && titleNorm === normHu) ||
          titleNorm.includes(normEn) ||
          normEn.includes(titleNorm);

        if (titleMatch) {
          matchedShowUrl = href.startsWith('http') ? href : `${SOROZATCC_BASE}${href}`;
        }
      });

      if (matchedShowUrl) break;
    }

    if (!matchedShowUrl) {
      throw new NotFoundError('Show not found on Sorozat.cc');
    }

    // Step 2: Fetch season page
    const seasonUrl = `${matchedShowUrl}/evad/${targetSeason}`;
    const seasonResp = await ctx.proxiedFetcher.full<string>(seasonUrl, {
      readHeaders: ['set-cookie', 'Set-Cookie'],
      headers: { ...HEADERS, Cookie: cookieHeader },
    });
    const seasonCookies = extractSorozatCookies(seasonResp.headers);
    if (seasonCookies) cookieHeader = seasonCookies;

    const seasonCsrf = extractCsrf(seasonResp.body) || csrfToken;
    const epSnapshot = extractSnapshot(seasonResp.body, 'series.episode-links');

    if (!epSnapshot) {
      throw new NotFoundError(`Season ${targetSeason} snapshot not found on Sorozat.cc`);
    }

    // Find getLinks calls: getLinks(episode_num, episode_id, series_id)
    const getLinksRegex = /getLinks\((\d+),\s*(\d+),\s*(\d+)\)/g;
    let targetParams: [number, number, number] | null = null;
    let m: RegExpExecArray | null = null;

    while ((m = getLinksRegex.exec(seasonResp.body)) !== null) {
      const epNum = parseInt(m[1], 10);
      const epId = parseInt(m[2], 10);
      const sId = parseInt(m[3], 10);
      if (epNum === targetEpisode) {
        targetParams = [epNum, epId, sId];
        break;
      }
    }

    if (!targetParams) {
      throw new NotFoundError(`Episode S${targetSeason}E${targetEpisode} not found on Sorozat.cc`);
    }

    // Step 3: Call getLinks on livewire
    const payload = {
      _token: seasonCsrf,
      components: [
        {
          snapshot: epSnapshot,
          updates: {},
          calls: [
            {
              path: '',
              method: 'getLinks',
              params: targetParams,
            },
          ],
        },
      ],
    };

    const linkResp = await ctx.proxiedFetcher<LivewireResponse>(`${SOROZATCC_BASE}/livewire/update`, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': seasonCsrf,
        Cookie: cookieHeader,
      },
      body: JSON.stringify(payload),
    });

    const rawSnap = linkResp.components?.[0]?.snapshot;
    if (!rawSnap) {
      throw new NotFoundError('Empty response for episode links on Sorozat.cc');
    }

    let parsedSnap: any;
    try {
      parsedSnap = JSON.parse(rawSnap);
    } catch {
      throw new NotFoundError('Failed to parse episode links snapshot on Sorozat.cc');
    }

    const linksData = parsedSnap?.data?.links;
    const embeds: SourcererEmbed[] = [];
    const seenUrls = new Set<string>();

    const linkString = JSON.stringify(linksData || {});
    const urlMatches = linkString.matchAll(/"link":\s*"([^"]+)"/g);

    for (const match of urlMatches) {
      let rawLink = match[1].replace(/\\/g, '');
      if (rawLink.startsWith('//')) rawLink = `https:${rawLink}`;
      const embedId = getEmbedId(rawLink);
      if (embedId && !seenUrls.has(rawLink)) {
        seenUrls.add(rawLink);
        embeds.push({
          embedId,
          url: rawLink,
        });
      }
    }

    if (embeds.length === 0) {
      throw new NotFoundError('No compatible video embeds found for episode on Sorozat.cc');
    }

    return { embeds };
  },
});
