/* eslint-disable no-console */
import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

interface NetmoziSearchResult {
  name: string;
  year: number;
  movie_id: number;
  url: string;
}

const NETMOZI_BASE = 'https://netmozi.com';
const MEGNEZED_BASE = 'https://mindjart.megnezed.com';

function getEmbedId(targetUrl: string): string | null {
  const url = targetUrl.toLowerCase();
  if (url.includes('videa')) return 'videa';
  if (url.includes('indavideo')) return 'indavideo';
  if (url.includes('vidhide') || url.includes('vidhidepro') || url.includes('dinisglows')) return 'vidhide-english';
  if (url.includes('mixdrop') || url.includes('mixdrp')) return 'mixdrop';
  if (url.includes('streamwish') || url.includes('wishembed') || url.includes('strwish')) return 'streamwish-english';
  if (url.includes('dood') || url.includes('ds2play') || url.includes('do0od') || url.includes('d0o0d')) return 'dood';
  if (url.includes('streamtape')) return 'streamtape';
  if (url.includes('filemoon')) return 'filemoon';
  if (url.includes('supervideo')) return 'supervideo';
  if (url.includes('dropload')) return 'dropload';
  if (url.includes('filelions')) return 'filelions';
  if (url.includes('turbovid')) return 'turbovid';
  if (url.includes('vidmoly')) return 'vidmoly';
  if (url.includes('voe') || url.includes('voe-unblock')) return 'voe';
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

function getEmbedIdFromHost(hostName: string): string | null {
  const h = hostName.toLowerCase();
  if (h.includes('videa')) return 'videa';
  if (h.includes('indavideo')) return 'indavideo';
  if (h.includes('vidhide') || h.includes('vidhidepro') || h.includes('dinisglows')) return 'vidhide-english';
  if (h.includes('mixdrop') || h.includes('mixdrp')) return 'mixdrop';
  if (h.includes('streamwish') || h.includes('wishembed') || h.includes('strwish')) return 'streamwish-english';
  if (h.includes('dood') || h.includes('ds2play') || h.includes('do0od') || h.includes('d0o0d')) return 'dood';
  if (h.includes('streamtape')) return 'streamtape';
  if (h.includes('filemoon')) return 'filemoon';
  if (h.includes('supervideo')) return 'supervideo';
  if (h.includes('dropload')) return 'dropload';
  if (h.includes('filelions')) return 'filelions';
  if (h.includes('turbovid')) return 'turbovid';
  if (h.includes('vidmoly')) return 'vidmoly';
  if (h.includes('voe')) return 'voe';
  if (
    h.includes('rubyvid') ||
    h.includes('streamruby') ||
    h.includes('rubystream') ||
    h.includes('sruby') ||
    h.includes('stmruby')
  )
    return 'rubyvid';
  return null;
}

function extractDestinationUrl(html: string, finalUrl?: string, locationHeader?: string | null): string | null {
  // 1. Direct location header redirect
  if (
    locationHeader &&
    !locationHeader.includes('megnezed.com') &&
    (locationHeader.startsWith('http://') || locationHeader.startsWith('https://'))
  ) {
    return locationHeader;
  }

  // 2. Final URL if redirected away from megnezed
  if (
    finalUrl &&
    !finalUrl.includes('megnezed.com') &&
    (finalUrl.startsWith('http://') || finalUrl.startsWith('https://'))
  ) {
    return finalUrl;
  }

  if (!html) return null;

  // 3. Counter script with base64 encoded link (megnezed countdown mechanism)
  // e.g. function counter() { ... var link = "aHR0cHM6Ly92aWRlYS5odS9wbGF5ZXI/dj1..."; }
  const base64Matches = [
    ...html.matchAll(/function\s+counter[\s\S]*?var\s+link[^=]*=\s*["']([^"']+)["']/gi),
    ...html.matchAll(/var\s+link[^=]*=\s*["']([A-Za-z0-9+/=]{16,})["']/gi),
  ];
  for (const m of base64Matches) {
    const raw = m[1];
    try {
      let decoded = '';
      if (typeof atob === 'function') {
        decoded = atob(raw);
      } else if (typeof Buffer !== 'undefined') {
        decoded = Buffer.from(raw, 'base64').toString('utf-8');
      }
      if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://'))) {
        return decoded;
      }
    } catch {
      // ignore decoding errors
    }
  }

  // 4. Iframe with embed player
  const iframeMatch = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
  if (iframeMatch && iframeMatch[1] && !iframeMatch[1].includes('megnezed.com')) {
    const src = iframeMatch[1];
    return src.startsWith('//') ? `https:${src}` : src;
  }

  // 5. JavaScript redirection
  const locMatch = html.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
  if (locMatch && locMatch[1] && !locMatch[1].includes('megnezed.com')) {
    return locMatch[1];
  }

  // 6. Direct video host link in the page
  const hostRegex =
    /https?:\/\/[^\s"'><]+(?:videa|indavideo|vidhide|vidhidepro|dinisglows|mixdrop|mixdrp|streamwish|wishembed|dood|filemoon|supervideo|dropload|turbovid|vidmoly|voe|rubyvid|streamruby|rubystream|sruby)[^\s"'><]*/i;
  const directMatch = html.match(hostRegex);
  if (directMatch && directMatch[0]) {
    return directMatch[0];
  }

  return null;
}

const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

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
    console.log('[NetMozi] TMDB Hungarian title lookup error:', err);
  }
  return null;
}

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  ctx.progress(10);
  console.log(`[NetMozi] Searching for: "${ctx.media.title}" (${ctx.media.releaseYear})`);

  const huTitle = await getHungarianTitle(
    ctx.media.title,
    ctx.media.releaseYear,
    ctx.media.tmdbId,
    ctx.media.type === 'show' ? 'show' : 'movie',
  );

  const queries = new Set<string>();
  if (huTitle) {
    queries.add(huTitle);
    if (huTitle.includes(':')) {
      queries.add(huTitle.replace(/:/g, '').replace(/\s+/g, ' ').trim());
      queries.add(huTitle.split(':')[0].trim());
    }
  }
  queries.add(ctx.media.title);
  if (ctx.media.title.includes(':')) {
    queries.add(ctx.media.title.replace(/:/g, '').replace(/\s+/g, ' ').trim());
  }

  let searchRes: NetmoziSearchResult[] = [];
  for (const q of queries) {
    try {
      const res = await ctx.proxiedFetcher<NetmoziSearchResult[]>(`${NETMOZI_BASE}/index/fastSearch`, {
        method: 'POST',
        body: `name=${encodeURIComponent(q)}`,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Referer: `${NETMOZI_BASE}/`,
          Accept: '*/*',
        },
      });
      if (Array.isArray(res) && res.length > 0) {
        searchRes = res;
        break;
      }
    } catch {
      // try next query
    }
  }

  if (!Array.isArray(searchRes) || searchRes.length === 0) {
    throw new NotFoundError('No results found on NetMozi');
  }

  ctx.progress(25);

  const isShow = ctx.media.type === 'show';
  const typeFiltered = searchRes.filter((it) =>
    isShow ? it.url.includes('/sorozatok/') : it.url.includes('/filmek/'),
  );

  const candidatePool = typeFiltered.length > 0 ? typeFiltered : searchRes;

  let matched = candidatePool.find((it) => it.year === ctx.media.releaseYear);
  if (!matched && ctx.media.releaseYear) {
    matched = candidatePool.find((it) => Math.abs(it.year - ctx.media.releaseYear) <= 1);
  }
  if (!matched) {
    matched = candidatePool[0];
  }

  if (!matched) {
    throw new NotFoundError('No matching title found on NetMozi');
  }

  console.log(`[NetMozi] Selected candidate: "${matched.name}" (${matched.year}) -> ${matched.url}`);

  ctx.progress(40);

  let contentUrl = `${NETMOZI_BASE}${matched.url}`;
  if (ctx.media.type === 'show') {
    const cleanUrl = matched.url.replace(/\/+$/, '');
    contentUrl = `${NETMOZI_BASE}${cleanUrl}/s${ctx.media.season.number}/e${ctx.media.episode.number}`;
  }

  console.log(`[NetMozi] Fetching content page: ${contentUrl}`);
  const contentResp = await ctx.proxiedFetcher.full<string>(contentUrl, {
    readHeaders: ['set-cookie', 'Set-Cookie'],
    headers: {
      Referer: `${NETMOZI_BASE}/`,
    },
  });
  const contentHtml = contentResp.body;
  const setCookie = contentResp.headers.get('set-cookie') || contentResp.headers.get('Set-Cookie') || '';
  const cMatch = setCookie.match(/\b(c=[a-f0-9]{40})/i);
  let sessionCookie = cMatch ? cMatch[1] : '';

  if (!sessionCookie && typeof document !== 'undefined' && document.cookie) {
    const docMatch = document.cookie.match(/\b(c=[a-f0-9]{40})/i);
    if (docMatch) sessionCookie = docMatch[1];
  }
  if (!sessionCookie) {
    const csrfMatch = contentHtml.match(/data-csrf=["'][^"']*c=([a-f0-9]{40})/i);
    if (csrfMatch) sessionCookie = `c=${csrfMatch[1]}`;
  }
  if (!sessionCookie) {
    const htmlCMatch = contentHtml.match(/\bc=([a-f0-9]{40})/i);
    if (htmlCMatch) sessionCookie = `c=${htmlCMatch[1]}`;
  }
  console.log(`[NetMozi] Content page status ${contentResp.statusCode}, session cookie: ${sessionCookie || '(none)'}`);

  const $content = load(contentHtml);
  let megnezedUrl: string | undefined =
    $content('a.details_links_btn').attr('href') ||
    $content('a[href*="megnezed.com"]').attr('href') ||
    $content('a[data-link-external]').attr('href') ||
    $content('a[class*="details_links_btn"]').attr('href');

  // Handle dynamic link loader (NetMozi client-side AJAX)
  if (!megnezedUrl) {
    const loader = $content('[data-link-loader]');
    if (loader.length > 0) {
      const movieId = loader.attr('data-movie-id') || (matched.movie_id ? String(matched.movie_id) : '');
      const token = loader.attr('data-token');
      const csrf = loader.attr('data-csrf') || '';

      if (movieId && token) {
        const loadUrl = `${NETMOZI_BASE}/details/loadLinks/${movieId}${csrf}`;
        console.log(`[NetMozi] Dynamic link loader found for id=${movieId}. Calling ${loadUrl}...`);

        const ajaxHeaders: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Referer: contentUrl,
        };
        if (sessionCookie) {
          ajaxHeaders.Cookie = `${sessionCookie}; js_detected=1`;
        }

        try {
          const loadResp = await ctx.proxiedFetcher.full<any>(loadUrl, {
            method: 'POST',
            body: `token=${encodeURIComponent(token)}`,
            headers: ajaxHeaders,
          });

          console.log(`[NetMozi] loadLinks HTTP ${loadResp.statusCode} response:`, loadResp.body);

          let loadData = loadResp.body;
          if (typeof loadData === 'string') {
            try {
              loadData = JSON.parse(loadData);
            } catch {
              // Not JSON string
            }
          }

          if (loadData && loadData.html) {
            const $ajax = load(loadData.html);
            megnezedUrl =
              $ajax('a.details_links_btn').attr('href') ||
              $ajax('a[href*="megnezed.com"]').attr('href') ||
              $ajax('a[data-link-external]').attr('href') ||
              $ajax('a[class*="details_links_btn"]').attr('href');
            console.log(`[NetMozi] Extracted Megnezed URL: ${megnezedUrl}`);
          } else if (loadData && loadData.error) {
            console.warn(`[NetMozi] loadLinks returned error: ${loadData.error}`);
          }
        } catch (err) {
          console.warn('[NetMozi] Dynamic loadLinks call failed:', err);
        }
      }
    }
  }

  // Fallback regex search
  if (!megnezedUrl) {
    const linkBtnMatch = contentHtml.match(/href="([^"]*megnezed\.com[^"]*)"/i);
    if (linkBtnMatch) {
      megnezedUrl = linkBtnMatch[1];
    }
  }

  if (!megnezedUrl) {
    throw new NotFoundError('No stream links found on NetMozi');
  }

  if (megnezedUrl.startsWith('/')) {
    megnezedUrl = `${MEGNEZED_BASE}${megnezedUrl}`;
  }

  console.log(`[NetMozi] Found Megnezed URL: ${megnezedUrl}`);
  ctx.progress(60);

  const megnezedHeaders: Record<string, string> = {
    Referer: contentUrl,
  };
  if (sessionCookie) {
    megnezedHeaders.Cookie = `${sessionCookie}; js_detected=1`;
  } else {
    megnezedHeaders.Cookie = 'js_detected=1';
  }

  const megnezedResp = await ctx.proxiedFetcher.full<string>(megnezedUrl, {
    headers: megnezedHeaders,
  });

  const megnezedHtml = megnezedResp.body || '';

  // Check for rate-limit / CAPTCHA on Megnezed
  if (
    megnezedResp.statusCode === 429 ||
    megnezedHtml.includes('link-captcha') ||
    megnezedHtml.includes('Tartalom ellenőrzése')
  ) {
    console.warn(
      `[NetMozi] Megnezed rate-limit CAPTCHA triggered (HTTP ${megnezedResp.statusCode}). Human verification required at ${megnezedUrl}`,
    );
    throw new NotFoundError(
      `Megnezed rate-limit CAPTCHA triggered ("Tartalom ellenőrzése"). Please open this URL in your browser to complete verification: ${megnezedUrl}`,
    );
  }

  const $ = load(megnezedHtml);
  const rawRows: { openHref: string; host: string; isStream: boolean }[] = [];
  const megnezedBase = new URL(megnezedUrl).origin;

  $('table tr').each((_, el) => {
    const row = $(el);
    const openHref =
      row.find('td.col-open a').attr('href') ||
      row.find('a.btn-link-open-mobile').attr('href') ||
      row.find('a.action-btn').attr('href') ||
      row.find('a[href*="/links/open/"]').attr('href');
    const host =
      row.find('td.col-host').text().trim().toLowerCase() ||
      row.find('td').eq(5).text().trim().toLowerCase();
    const type =
      row.find('td.col-type').text().trim().toLowerCase() ||
      row.find('td').eq(0).text().trim().toLowerCase();
    const rowHtml = row.html() || '';

    // Ignore links marked dead/invalid
    const isDead = rowHtml.includes('red_mark.png') || rowHtml.includes('érvénytelen');

    if (openHref && !isDead) {
      const isStream = type.includes('megtekint') || !type.includes('letölt');
      rawRows.push({ openHref, host, isStream });
    }
  });

  console.log(`[NetMozi] Found ${rawRows.length} viable links in Megnezed table`);

  if (rawRows.length === 0) {
    console.warn(
      `[NetMozi] No links found in Megnezed table! (HTTP ${megnezedResp.statusCode}, title: "${$('title').text().trim()}", htmlLen: ${megnezedHtml.length}, tables: ${$('table').length})`,
    );
    console.warn(`[NetMozi] Megnezed HTML preview: ${megnezedHtml.slice(0, 300).replace(/\s+/g, ' ')}`);
    throw new NotFoundError('No links in megnezed table');
  }

  // 1. Group and report all discovered hosts and their counts
  const hostCounts: Record<string, number> = {};
  for (const r of rawRows) {
    hostCounts[r.host] = (hostCounts[r.host] || 0) + 1;
  }
  const hostSummary = Object.entries(hostCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([h, c]) => `${h} (${c})`)
    .join(', ');
  console.log(`[NetMozi] Discovered hosts in Megnezed table: ${hostSummary}`);

  // Host priority weights (higher number = higher priority)
  const hostPriority: Record<string, number> = {
    vidmoly: 10,
    videa: 9,
    voe: 8,
    rubyvid: 7,
    mixdrop: 6,
    streamtape: 5,
    dood: 4,
    filemoon: 3,
  };

  // 2. Separate into supported vs unsupported
  const supportedStreamRows = rawRows
    .filter((r) => r.isStream && getEmbedIdFromHost(r.host) !== null)
    .sort((a, b) => {
      const pA = hostPriority[getEmbedIdFromHost(a.host) || ''] || 0;
      const pB = hostPriority[getEmbedIdFromHost(b.host) || ''] || 0;
      return pB - pA;
    });
  const otherSupportedRows = rawRows.filter((r) => !r.isStream && getEmbedIdFromHost(r.host) !== null);
  const otherStreamRows = rawRows.filter((r) => r.isStream && getEmbedIdFromHost(r.host) === null);
  const otherRows = rawRows.filter((r) => !r.isStream && getEmbedIdFromHost(r.host) === null);

  const supportedCounts: Record<string, number> = {};
  for (const r of [...supportedStreamRows, ...otherSupportedRows]) {
    supportedCounts[r.host] = (supportedCounts[r.host] || 0) + 1;
  }
  const supportedSummary = Object.entries(supportedCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([h, c]) => `${h} (${c})`)
    .join(', ');
  console.log(`[NetMozi] Supported hosts: ${supportedSummary || 'none'}`);

  const unsupportedCounts: Record<string, number> = {};
  for (const r of [...otherStreamRows, ...otherRows]) {
    unsupportedCounts[r.host] = (unsupportedCounts[r.host] || 0) + 1;
  }
  const unsupportedSummary = Object.entries(unsupportedCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([h, c]) => `${h} (${c})`)
    .join(', ');
  if (unsupportedSummary) {
    console.log(`[NetMozi] Unsupported hosts: ${unsupportedSummary}`);
  }

  ctx.progress(75);

  const candidates = [...supportedStreamRows, ...otherSupportedRows, ...otherStreamRows, ...otherRows];

  console.log(
    `[NetMozi] Candidate resolution order: ${candidates.length} total (supported streams: ${supportedStreamRows.length})`,
  );

  const embeds: SourcererEmbed[] = [];
  const seenUrls = new Set<string>();

  // Process candidates prioritizing top supported streams, up to 3 attempts or 2 resolved embeds
  const maxAttempts = Math.min(candidates.length, 3);
  for (let i = 0; i < maxAttempts; i++) {
    const row = candidates[i];
    if (embeds.length >= 2) {
      console.log('[NetMozi] Reached target embed count (2), stopping link resolution.');
      break;
    }

    if (i > 0) {
      // Delay between requests to avoid triggering Megnezed rate-limit
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    const openUrl = row.openHref.startsWith('http')
      ? row.openHref
      : `${megnezedBase}${row.openHref.startsWith('/') ? '' : '/'}${row.openHref}`;

    console.log(`[NetMozi] [${i + 1}/${maxAttempts}] Resolving link for host "${row.host}" (${openUrl})`);

    try {
      const headers: Record<string, string> = {
        Referer: megnezedUrl,
      };
      if (sessionCookie) {
        headers.Cookie = `${sessionCookie}; js_detected=1`;
      } else {
        headers.Cookie = 'js_detected=1';
      }

      const openResp = await ctx.proxiedFetcher.full<string>(openUrl, {
        method: 'GET',
        readHeaders: ['location', 'Location'],
        headers,
      });

      if (openResp.body?.includes('link-captcha') || openResp.body?.includes('Tartalom ellenőrzése')) {
        console.warn(`[NetMozi] Megnezed captcha / rate-limit encountered for host "${row.host}"`);
        continue;
      }

      const redirected = extractDestinationUrl(
        openResp.body,
        openResp.finalUrl,
        openResp.headers.get('location') || openResp.headers.get('Location'),
      );

      if (!redirected) {
        console.log(
          `[NetMozi] Could not extract destination URL for "${row.host}" (HTTP ${openResp.statusCode}, finalUrl: ${openResp.finalUrl})`,
        );
        continue;
      }

      const embedId = getEmbedId(redirected) || getEmbedIdFromHost(row.host);
      if (!embedId) {
        console.log(`[NetMozi] Host "${row.host}" resolved to ${redirected}, but no active embed scraper matched`);
        continue;
      }

      if (!seenUrls.has(redirected)) {
        seenUrls.add(redirected);
        embeds.push({
          embedId,
          url: redirected,
        });
        console.log(`[NetMozi] Successfully resolved embed [${embedId}]: ${redirected}`);
      }
    } catch (err) {
      console.warn(`[NetMozi] Failed resolving link for host ${row.host}:`, err);
    }
  }

  if (embeds.length === 0) {
    throw new NotFoundError('No playable embeds found on NetMozi');
  }

  ctx.progress(90);
  console.log(
    `[NetMozi] Scraper completed with ${embeds.length} playable embeds:`,
    embeds.map((e) => e.embedId),
  );

  return {
    embeds,
  };
}

export const netmoziScraper = makeSourcerer({
  id: 'netmozi',
  name: 'NetMozi',
  rank: 121,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
