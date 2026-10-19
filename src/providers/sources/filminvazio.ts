import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const FILMINVAZIO_BASE = 'https://filminvazio.pro';
const VIDEALETOLTES_BASE = 'https://videaletoltes.com';
const FALLBACK_NONCE = 'f620484b8f';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

interface DooPlaySearchItem {
  title?: string;
  url?: string;
  img?: string;
  extra?: {
    date?: string;
  };
}

interface FilminvazioCandidate {
  title: string;
  url: string;
  year?: number;
  type?: 'movie' | 'show';
  slug?: string;
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

    // 3. If no result found with year, retry search without year constraint
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
    console.log('[Filminvazio] TMDB Hungarian title lookup error:', err);
  }
  return null;
}

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
  if (
    locationHeader &&
    !locationHeader.includes('filminvazio') &&
    !locationHeader.includes('videaletoltes') &&
    (locationHeader.startsWith('http://') || locationHeader.startsWith('https://'))
  ) {
    return locationHeader;
  }

  if (
    finalUrl &&
    !finalUrl.includes('filminvazio') &&
    !finalUrl.includes('videaletoltes') &&
    (finalUrl.startsWith('http://') || finalUrl.startsWith('https://'))
  ) {
    return finalUrl;
  }

  if (!html) return null;

  // 1. Direct button link on landing page (e.g. videaletoltes /links/...)
  const linkBtnMatch =
    html.match(/<a\b[^>]*id=["']link["'][^>]*href=["']([^"']+)["']/i) ||
    html.match(/<a\b[^>]*class=["'][^"']*btn[^"']*["'][^>]*href=["'](https?:\/\/[^"']+)["']/i);
  if (
    linkBtnMatch &&
    linkBtnMatch[1] &&
    !linkBtnMatch[1].includes('videaletoltes') &&
    !linkBtnMatch[1].includes('filminvazio')
  ) {
    return linkBtnMatch[1];
  }

  // 2. Iframe with embed player
  const iframeMatch = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
  if (
    iframeMatch &&
    iframeMatch[1] &&
    !iframeMatch[1].includes('filminvazio') &&
    !iframeMatch[1].includes('videaletoltes')
  ) {
    const src = iframeMatch[1];
    return src.startsWith('//') ? `https:${src}` : src;
  }

  // 3. Base64 decoded player URLs
  const base64Matches = [
    ...html.matchAll(/function\s+counter[\s\S]*?var\s+link[^=]*=\s*["']([^"']+)["']/gi),
    ...html.matchAll(/var\s+link[^=]*=\s*["']([A-Za-z0-9+/=]{16,})["']/gi),
  ];
  for (const m of base64Matches) {
    try {
      let decoded = '';
      if (typeof atob === 'function') {
        decoded = atob(m[1]);
      } else if (typeof Buffer !== 'undefined') {
        decoded = Buffer.from(m[1], 'base64').toString('utf-8');
      }
      if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://'))) {
        return decoded;
      }
    } catch {
      // Ignore
    }
  }

  // 4. Direct video host link
  const hostRegex =
    /https?:\/\/[^\s"'><]+(?:videa|vidhide|vidhidepro|dinisglows|mixdrop|mixdrp|streamwish|wishembed|dood|filemoon|supervideo|dropload|turbovid|vidmoly|voe|rubyvid|streamruby|rubystream|sruby)[^\s"'><]*/i;
  const directMatch = html.match(hostRegex);
  if (directMatch && directMatch[0]) {
    return directMatch[0];
  }

  // 5. Any external provider anchor tag on landing page
  const externalLinkMatches = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi);
  for (const m of externalLinkMatches) {
    const href = m[1];
    if (
      (href.startsWith('http://') || href.startsWith('https://')) &&
      !href.includes('videaletoltes.com') &&
      !href.includes('filminvazio.pro') &&
      !href.includes('whatsapp') &&
      !href.includes('facebook') &&
      !href.includes('twitter')
    ) {
      return href;
    }
  }

  return null;
}

function extractSlug(url: string): string {
  try {
    const parts = new URL(url).pathname.replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] || '';
  } catch {
    const clean = url.replace(/[?#].*$/, '').replace(/\/+$/, '');
    const parts = clean.split('/');
    return parts[parts.length - 1] || '';
  }
}

async function searchCandidatesForQuery(
  ctx: ShowScrapeContext | MovieScrapeContext,
  query: string,
): Promise<FilminvazioCandidate[]> {
  const candidates: FilminvazioCandidate[] = [];
  const isShow = ctx.media.type === 'show';

  // 1. Try DooPlay live search API (videaletoltes.com first as it has no Cloudflare Turnstile, then filminvazio.pro)
  const apiBases = [VIDEALETOLTES_BASE, FILMINVAZIO_BASE];
  for (const base of apiBases) {
    try {
      const apiUrl = `${base}/wp-json/dooplay/search/?keyword=${encodeURIComponent(query)}&nonce=${FALLBACK_NONCE}`;
      console.log(`[Filminvazio] Calling live search API on ${base}: ${apiUrl}`);

      const searchResp = await ctx.proxiedFetcher<any>(apiUrl, {
        headers: {
          Referer: `${base}/`,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      let payload = searchResp;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          // Ignore
        }
      }

      if (payload && typeof payload === 'object' && !payload.error) {
        const list: DooPlaySearchItem[] = Array.isArray(payload) ? payload : Object.values(payload);
        for (const item of list) {
          if (item && item.title && item.url) {
            const yearMatch = item.extra?.date?.match(/\b(19\d\d|20\d\d)\b/);
            const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
            const fullUrl = item.url.startsWith('/') ? `${base}${item.url}` : item.url;
            const type = fullUrl.includes('/sorozat') || fullUrl.includes('/tvshow') ? 'show' : 'movie';
            const slug = extractSlug(fullUrl);

            if (!candidates.some((c) => c.url === fullUrl || (c.slug && c.slug === slug))) {
              candidates.push({
                title: item.title,
                url: fullUrl,
                year,
                type,
                slug,
              });
            }
          }
        }
      }

      if (candidates.length > 0) {
        break; // Found results via API
      }
    } catch (err) {
      console.log(`[Filminvazio] Live search on ${base} encountered error:`, err);
    }
  }

  // 2. Fallback to standard WordPress HTML search (?s=...)
  if (candidates.length === 0) {
    for (const base of [VIDEALETOLTES_BASE, FILMINVAZIO_BASE]) {
      if (candidates.length > 0) break;
      try {
        const searchUrl = `${base}/?s=${encodeURIComponent(query)}`;
        console.log(`[Filminvazio] Running HTML search on ${base}: ${searchUrl}`);
        const searchHtml = await ctx.proxiedFetcher<string>(searchUrl, {
          headers: {
            Referer: `${base}/`,
          },
        });

        const $ = load(searchHtml);
        $('article, .result-item, .search-page article, .items article').each((_, el) => {
          const item = $(el);
          const link = item
            .find('a[href*="/videa-film/"], a[href*="/film/"], a[href*="/sorozat/"], a[href*="/tvshows/"], .title a, h3 a')
            .first();
          const url = link.attr('href');
          const title =
            link.text().trim() ||
            item.find('.title, h3, h2').text().trim() ||
            item.find('img').attr('alt') ||
            '';

          const yearText = item.find('.year, .metadata span, span.date').text().trim();
          const yearMatch = yearText.match(/\b(19\d\d|20\d\d)\b/) || item.text().match(/\b(19\d\d|20\d\d)\b/);
          const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;

          if (url && title) {
            const fullUrl = url.startsWith('/') ? `${base}${url}` : url;
            const isTv = fullUrl.includes('/sorozat') || fullUrl.includes('/tvshow');
            const type = isTv ? 'show' : 'movie';
            const slug = extractSlug(fullUrl);

            if (!candidates.some((c) => c.url === fullUrl || (c.slug && c.slug === slug))) {
              candidates.push({
                title,
                url: fullUrl,
                year,
                type,
                slug,
              });
            }
          }
        });
      } catch (err) {
        console.warn(`[Filminvazio] HTML search on ${base} failed:`, err);
      }
    }
  }

  const filtered = candidates.filter((c) => (isShow ? c.type === 'show' : c.type === 'movie'));
  return filtered.length > 0 ? filtered : candidates;
}

async function comboScraper(ctx: ShowScrapeContext | MovieScrapeContext): Promise<SourcererOutput> {
  ctx.progress(10);
  console.log(`[Filminvazio] Starting scraper for: "${ctx.media.title}" (${ctx.media.releaseYear})`);

  // 1. Resolve Hungarian title from TMDB
  const hungarianTitle = await getHungarianTitle(
    ctx.media.title,
    ctx.media.releaseYear,
    ctx.media.tmdbId,
    ctx.media.type,
  );
  if (hungarianTitle) {
    console.log(`[Filminvazio] Translated "${ctx.media.title}" -> Hungarian title: "${hungarianTitle}"`);
  }

  // 2. Build prioritized search terms
  const searchTerms: string[] = [];
  if (hungarianTitle) {
    searchTerms.push(hungarianTitle);
    if (hungarianTitle.includes('&')) {
      searchTerms.push(hungarianTitle.replace(/&/g, ' '));
      const firstPart = hungarianTitle.split('&')[0].trim();
      if (firstPart.length > 3) searchTerms.push(firstPart);
    }
  }
  if (!searchTerms.includes(ctx.media.title)) {
    searchTerms.push(ctx.media.title);
  }
  if (ctx.media.title.includes('&')) {
    searchTerms.push(ctx.media.title.replace(/&/g, ' '));
  }

  let candidates: FilminvazioCandidate[] = [];
  for (const term of searchTerms) {
    console.log(`[Filminvazio] Searching with term: "${term}"`);
    const results = await searchCandidatesForQuery(ctx, term);
    for (const r of results) {
      if (!candidates.some((c) => c.url === r.url || (c.slug && c.slug === r.slug))) {
        candidates.push(r);
      }
    }
    if (candidates.length > 0) {
      break; // Found viable results
    }
  }

  // 3. Fallback: Synthesize candidate slugs directly if search returned 0 results
  if (candidates.length === 0) {
    console.log('[Filminvazio] Search returned 0 results; generating direct candidate slugs...');
    const primaryName = hungarianTitle || ctx.media.title;
    const cleanSlug = normalizeTitle(primaryName).replace(/\s+/g, '-');
    if (cleanSlug) {
      candidates.push({
        title: primaryName,
        url: `${FILMINVAZIO_BASE}/videa-film/${cleanSlug}/`,
        year: ctx.media.releaseYear,
        type: ctx.media.type === 'show' ? 'show' : 'movie',
        slug: cleanSlug,
      });
      if (ctx.media.releaseYear) {
        candidates.push({
          title: primaryName,
          url: `${FILMINVAZIO_BASE}/videa-film/${cleanSlug}-${ctx.media.releaseYear}/`,
          year: ctx.media.releaseYear,
          type: ctx.media.type === 'show' ? 'show' : 'movie',
          slug: `${cleanSlug}-${ctx.media.releaseYear}`,
        });
      }
    }
  }

  if (candidates.length === 0) {
    throw new NotFoundError('No results found on Filminvazio');
  }

  ctx.progress(30);

  // Match the best candidate based on release year and title similarity
  const targetNorms = [
    hungarianTitle ? normalizeTitle(hungarianTitle) : '',
    normalizeTitle(ctx.media.title),
  ].filter(Boolean);

  let matched = candidates.find((c) => {
    if (ctx.media.releaseYear && c.year && c.year === ctx.media.releaseYear) {
      const norm = normalizeTitle(c.title);
      return targetNorms.some((t) => norm.includes(t) || t.includes(norm));
    }
    return false;
  });

  if (!matched && ctx.media.releaseYear) {
    matched = candidates.find(
      (c) => c.year && Math.abs(c.year - ctx.media.releaseYear) <= 1 && normalizeTitle(c.title).length > 0,
    );
  }

  if (!matched) {
    matched = candidates.find((c) => {
      const norm = normalizeTitle(c.title);
      return targetNorms.some((t) => norm.includes(t) || t.includes(norm));
    });
  }

  if (!matched) {
    matched = candidates[0];
  }

  console.log(`[Filminvazio] Selected candidate: "${matched.title}" (${matched.year || 'N/A'}) -> ${matched.url}`);
  ctx.progress(45);

  let targetUrl = matched.url;
  const slug = matched.slug || extractSlug(matched.url);

  // For TV Shows, locate the specific episode URL
  if (ctx.media.type === 'show') {
    const seasonNum = ctx.media.season.number;
    const epNum = ctx.media.episode.number;
    console.log(`[Filminvazio] Locating show episode S${seasonNum}E${epNum}...`);

    try {
      const showHtml = await ctx.proxiedFetcher<string>(targetUrl, {
        headers: {
          Referer: `${FILMINVAZIO_BASE}/`,
        },
      });

      const $show = load(showHtml);
      let episodeUrl: string | undefined;

      $show('a[href]').each((_, el) => {
        const href = $show(el).attr('href') || '';
        const text = $show(el).text().trim();
        const parentText = $show(el).closest('li, div').text();

        const epPattern = new RegExp(`(?:-|/)(?:${seasonNum}x${epNum}|s0?${seasonNum}e0?${epNum})(?:/|$|-)`, 'i');
        if (epPattern.test(href)) {
          episodeUrl = href;
          return false;
        }

        if (
          (text.includes(`${seasonNum} - ${epNum}`) || parentText.includes(`${seasonNum} - ${epNum}`)) &&
          (href.includes('/epizod') || href.includes('/episode'))
        ) {
          episodeUrl = href;
          return false;
        }
      });

      if (episodeUrl) {
        targetUrl = episodeUrl.startsWith('/') ? `${FILMINVAZIO_BASE}${episodeUrl}` : episodeUrl;
        console.log(`[Filminvazio] Found episode URL: ${targetUrl}`);
      } else {
        const cleanBase = targetUrl.replace(/\/+$/, '');
        targetUrl = `${cleanBase}-${seasonNum}x${epNum}/`;
        console.log(`[Filminvazio] Episode link not explicitly found; trying standard slug: ${targetUrl}`);
      }
    } catch (err) {
      console.warn('[Filminvazio] Failed loading show page for episode links:', err);
    }
  }

  ctx.progress(60);
  console.log(`[Filminvazio] Fetching player page: ${targetUrl}`);

  interface PlayerOption {
    nume: string;
    post: string;
    type: string;
    host: string;
    directUrl?: string;
  }

  const playerOptions: PlayerOption[] = [];

  // Path 1: Check candidate page for DooPlay player options, iframes, and tables
  try {
    const targetOrigin = new URL(targetUrl).origin;
    const pageResp = await ctx.proxiedFetcher.full<string>(targetUrl, {
      headers: {
        Referer: `${targetOrigin}/`,
      },
    });

    const pageHtml = pageResp.body || '';
    const $page = load(pageHtml);

    const rawPostVal =
      $page('[data-post]').first().attr('data-post') ||
      $page('input[name="post_id"]').val() ||
      $page('input#post_id').val();
    let postId: string | undefined =
      typeof rawPostVal === 'string' ? rawPostVal : Array.isArray(rawPostVal) ? rawPostVal[0] : undefined;

    if (!postId) {
      const postMatch = pageHtml.match(/\bdata-post=['"](\d+)['"]/i) || pageHtml.match(/post-(\d+)/i);
      if (postMatch) {
        postId = postMatch[1];
      }
    }

    // 1. DooPlay dynamic player options (<li data-nume="...">)
    $page('li[data-nume], li.dooplay_player_option').each((_, el) => {
      const li = $page(el);
      const nume = li.attr('data-nume');
      const post = li.attr('data-post') || postId;
      const type = li.attr('data-type') || (ctx.media.type === 'show' ? 'tv' : 'movie');
      const hostText = li.find('.server, .title').text().trim() || li.text().trim();

      if (nume && post) {
        playerOptions.push({
          nume,
          post,
          type,
          host: hostText,
        });
      }
    });

    // 2. Directly embedded iframes
    $page('iframe[src]').each((_, el) => {
      const src = $page(el).attr('src') || '';
      const cleanSrc = src.startsWith('//') ? `https:${src}` : src;
      if (cleanSrc.startsWith('http') && !cleanSrc.includes('filminvazio.pro') && !cleanSrc.includes('youtube.com')) {
        const embedId = getEmbedId(cleanSrc);
        if (embedId) {
          playerOptions.push({
            nume: '0',
            post: postId || '0',
            type: ctx.media.type === 'show' ? 'tv' : 'movie',
            host: embedId,
            directUrl: cleanSrc,
          });
        }
      }
    });

    // 3. Page table rows or submitted links
    $page('table tr, .links-table tr').each((_, el) => {
      const row = $page(el);
      const href =
        row.find('a[href*="/links/"], a[href*="open"]').attr('href') ||
        row.find('a.btn, a.action-btn').attr('href') ||
        '';
      const host = row.find('td').first().text().trim() || row.text().trim();

      if (href && !href.startsWith('#')) {
        const fullHref = href.startsWith('/') ? `${targetOrigin}${href}` : href;
        if (!playerOptions.some((p) => p.directUrl === fullHref)) {
          playerOptions.push({
            nume: 'table',
            post: postId || '0',
            type: ctx.media.type === 'show' ? 'tv' : 'movie',
            host,
            directUrl: fullHref,
          });
        }
      }
    });
  } catch (err) {
    console.log('[Filminvazio] Could not load candidate player page directly:', err);
  }

  // Path 2: Check backend link provider mirror table (videaletoltes.com/videa-film/{slug}/)
  if (slug) {
    try {
      const mirrorUrl = `${VIDEALETOLTES_BASE}/videa-film/${slug}/`;
      console.log(`[Filminvazio] Checking mirror link table: ${mirrorUrl}`);
      const mirrorHtml = await ctx.proxiedFetcher<string>(mirrorUrl, {
        headers: {
          Referer: `${VIDEALETOLTES_BASE}/`,
        },
      });

      const $mirror = load(mirrorHtml);
      $mirror('table tr').each((_, el) => {
        const row = $mirror(el);
        const link = row.find('a[href*="/links/"]').first();
        const rowUrl = link.attr('href');
        const host = row.find('td').first().text().trim();

        if (rowUrl && host) {
          const fullRowUrl = rowUrl.startsWith('/') ? `${VIDEALETOLTES_BASE}${rowUrl}` : rowUrl;
          if (!playerOptions.some((p) => p.directUrl === fullRowUrl)) {
            playerOptions.push({
              nume: 'mirror',
              post: '0',
              type: ctx.media.type === 'show' ? 'tv' : 'movie',
              host,
              directUrl: fullRowUrl,
            });
          }
        }
      });
    } catch (err) {
      console.log('[Filminvazio] Mirror link table check failed:', err);
    }
  }

  console.log(`[Filminvazio] Discovered ${playerOptions.length} player source options.`);

  if (playerOptions.length === 0) {
    throw new NotFoundError('No playable sources found on Filminvazio page');
  }

  ctx.progress(75);

  // Group and sort options prioritizing supported and fast hosts (Videa, Rubyvid, VOE)
  const hostPriority: Record<string, number> = {
    videa: 1,
    rubyvid: 2,
    voe: 3,
    vidmoly: 4,
    streamtape: 5,
    dood: 6,
    filemoon: 7,
    supervideo: 8,
    turbovid: 9,
    mixdrop: 10,
  };

  const getPriority = (opt: PlayerOption) => {
    const embedId = getEmbedIdFromHost(opt.host) || (opt.directUrl ? getEmbedId(opt.directUrl) : null);
    return embedId && hostPriority[embedId] ? hostPriority[embedId] : 99;
  };

  const supportedOptions = playerOptions.filter(
    (opt) => getEmbedIdFromHost(opt.host) !== null || (opt.directUrl && getEmbedId(opt.directUrl) !== null),
  );
  supportedOptions.sort((a, b) => getPriority(a) - getPriority(b));

  const otherOptions = playerOptions.filter(
    (opt) => getEmbedIdFromHost(opt.host) === null && (!opt.directUrl || getEmbedId(opt.directUrl) === null),
  );

  const candidateOptions = [...supportedOptions, ...otherOptions];
  console.log(
    `[Filminvazio] Resolving options (${supportedOptions.length} supported: ${supportedOptions.map((o) => o.host).join(', ')})`,
  );

  const embeds: SourcererEmbed[] = [];
  const seenUrls = new Set<string>();

  // Resolve up to 8 candidate options to discover all available resolutions
  const maxAttempts = Math.min(candidateOptions.length, 8);
  for (let i = 0; i < maxAttempts; i++) {
    const opt = candidateOptions[i];

    try {
      let resolvedUrl: string | null = null;

      if (opt.directUrl) {
        // Direct link or redirect link from videaletoltes / links table
        console.log(`[Filminvazio] Probing direct/redirect source: ${opt.directUrl}`);
        const directResp = await ctx.proxiedFetcher.full<string>(opt.directUrl, {
          headers: {
            Referer: targetUrl,
          },
        });
        resolvedUrl = extractDestinationUrl(
          directResp.body,
          directResp.finalUrl,
          directResp.headers.get('location') || directResp.headers.get('Location'),
        );
      } else {
        // DooPlay AJAX request
        console.log(`[Filminvazio] Calling doo_player_ajax for host "${opt.host}" (nume=${opt.nume}, post=${opt.post})`);
        const ajaxResp = await ctx.proxiedFetcher<any>(`${FILMINVAZIO_BASE}/wp-admin/admin-ajax.php`, {
          method: 'POST',
          body: `action=doo_player_ajax&post=${encodeURIComponent(opt.post)}&nume=${encodeURIComponent(opt.nume)}&type=${encodeURIComponent(opt.type)}`,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: targetUrl,
          },
        });

        let data = ajaxResp;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch {
            const iframeSrc = data.match(/<iframe[^>]*src=["']([^"']+)["']/i);
            if (iframeSrc) {
              resolvedUrl = iframeSrc[1].startsWith('//') ? `https:${iframeSrc[1]}` : iframeSrc[1];
            }
          }
        }

        if (data && typeof data === 'object') {
          const rawEmbed = data.embed_url || data.url || data.iframe;
          if (typeof rawEmbed === 'string') {
            if (rawEmbed.includes('<iframe')) {
              const iframeSrc = rawEmbed.match(/src=["']([^"']+)["']/i);
              if (iframeSrc) {
                resolvedUrl = iframeSrc[1].startsWith('//') ? `https:${iframeSrc[1]}` : iframeSrc[1];
              }
            } else {
              resolvedUrl = rawEmbed.startsWith('//') ? `https:${rawEmbed}` : rawEmbed;
            }
          }
        }
      }

      if (!resolvedUrl) {
        console.log(`[Filminvazio] Could not extract embed URL for host "${opt.host}"`);
        continue;
      }

      // If the embed URL points to an intermediate redirect (e.g. /links/open or videaletoltes), follow it
      if (
        resolvedUrl.includes('videaletoltes.com/links/') ||
        resolvedUrl.includes('filminvazio.pro/links/') ||
        resolvedUrl.includes('moziverzum.club')
      ) {
        const followResp = await ctx.proxiedFetcher.full<string>(resolvedUrl, {
          headers: {
            Referer: targetUrl,
          },
        });
        const finalDest = extractDestinationUrl(
          followResp.body,
          followResp.finalUrl,
          followResp.headers.get('location') || followResp.headers.get('Location'),
        );
        if (finalDest) {
          resolvedUrl = finalDest;
        }
      }

      const embedId = getEmbedId(resolvedUrl) || getEmbedIdFromHost(opt.host);
      if (!embedId) {
        console.log(`[Filminvazio] URL "${resolvedUrl}" has no matching embed scraper`);
        continue;
      }

      if (!seenUrls.has(resolvedUrl)) {
        seenUrls.add(resolvedUrl);
        embeds.push({
          embedId,
          url: resolvedUrl,
        });
        console.log(`[Filminvazio] Successfully resolved embed [${embedId}]: ${resolvedUrl}`);
      }
    } catch (err) {
      console.warn(`[Filminvazio] Error resolving player option for "${opt.host}":`, err);
    }
  }

  if (embeds.length === 0) {
    throw new NotFoundError('No playable embeds found on Filminvazio');
  }

  ctx.progress(90);
  console.log(
    `[Filminvazio] Scraper completed with ${embeds.length} playable embeds:`,
    embeds.map((e) => e.embedId),
  );

  return {
    embeds,
  };
}

export const filminvazioScraper = makeSourcerer({
  id: 'filminvazio',
  name: 'Filminvázió',
  rank: 122,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  scrapeMovie: comboScraper,
  scrapeShow: comboScraper,
});
