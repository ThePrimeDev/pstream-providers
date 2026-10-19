import { load } from 'cheerio';

import { flags } from '@/entrypoint/utils/targets';
import { SourcererEmbed, SourcererOutput, makeSourcerer } from '@/providers/base';
import { MovieScrapeContext, ShowScrapeContext } from '@/utils/context';
import { NotFoundError } from '@/utils/errors';

/* eslint-disable no-console */

const FILMSAROK_BASE = 'https://www.filmsarok.hu';
const TMDB_API_KEY = '7604525319adb2db8e7e841cb98e9217';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: `${FILMSAROK_BASE}/`,
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
    console.log('[FilmSarok] TMDB Hungarian title lookup error:', err);
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

async function extractVideoLinkFromIntermediate(
  ctx: MovieScrapeContext | ShowScrapeContext,
  url: string,
): Promise<string | null> {
  try {
    const html = await ctx.proxiedFetcher<string>(url, { headers: HEADERS });
    const match = html.match(/class=["']btn["'][^>]*href=["']([^"']+)["'][^>]*id=["']link["']/i);
    if (match) return match[1].trim();

    const $ = load(html);
    const linkHref = $('a#link').attr('href');
    if (linkHref) return linkHref.trim();

    const iframeSrc = $('iframe[src]').attr('src');
    if (iframeSrc) return iframeSrc.trim();
  } catch {
    // ignore
  }
  return null;
}

export const filmsarokScraper = makeSourcerer({
  id: 'filmsarok',
  name: 'FilmSarok',
  rank: 139,
  flags: [flags.CORS_ALLOWED],
  disabled: false,
  async scrapeMovie(ctx: MovieScrapeContext): Promise<SourcererOutput> {
    const huTitle = await getHungarianTitle(ctx.media.title, ctx.media.releaseYear, ctx.media.tmdbId, 'movie');
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
        const searchUrl = `${FILMSAROK_BASE}/?s=${encodeURIComponent(query)}`;
        const html = await ctx.proxiedFetcher<string>(searchUrl, { headers: HEADERS });
        const $ = load(html);

        $('.result-item').each((_, el) => {
          const typeText = $(el).find('.movies, .tvshows').text().trim().toLowerCase();
          if (typeText && !typeText.includes('movie')) return;

          const titleLink = $(el).find('.title a');
          const title = titleLink.text().trim();
          const href = titleLink.attr('href') || $(el).find('.thumbnail a').attr('href');
          const yearStr = $(el).find('.year').text().trim();
          if (!href || !title) return;

          let year: number | undefined;
          if (yearStr && /^\d{4}$/.test(yearStr)) {
            year = parseInt(yearStr, 10);
          }

          const fullUrl = href.startsWith('http') ? href : `${FILMSAROK_BASE}${href}`;
          if (!candidates.some((c) => c.url === fullUrl)) {
            candidates.push({ title, url: fullUrl, year });
          }
        });
      } catch (err) {
        console.log(`[FilmSarok] Search error for query "${query}":`, err);
      }
    }

    if (candidates.length === 0) {
      throw new NotFoundError('No search results found on FilmSarok');
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
      throw new NotFoundError('No matching movie found on FilmSarok');
    }

    const movieHtml = await ctx.proxiedFetcher<string>(bestCandidate.url, { headers: HEADERS });
    const $ = load(movieHtml);

    const directOrIntermediateUrls: string[] = [];

    $('#videos table tbody tr a').each((_, el) => {
      const href = $(el).attr('href')?.trim();
      if (href && href.startsWith('http')) {
        directOrIntermediateUrls.push(href);
      }
    });

    $('iframe[src]').each((_, el) => {
      let src = $(el).attr('src')?.trim();
      if (!src) return;
      if (src.startsWith('//')) src = `https:${src}`;
      if (src.startsWith('http') && !src.includes('youtube.com') && !src.includes('google')) {
        directOrIntermediateUrls.push(src);
      }
    });

    const playerOptions: Array<{ post: string; nume: string; type: string }> = [];
    $('.dooplay_player_option, #playeroptionsul li').each((_, el) => {
      const post = $(el).attr('data-post');
      const nume = $(el).attr('data-nume');
      const type = $(el).attr('data-type') || 'movie';
      if (post && nume && nume !== 'trailer') {
        playerOptions.push({ post, nume, type });
      }
    });

    for (const opt of playerOptions) {
      try {
        const formData = new URLSearchParams({
          action: 'doo_player_ajax',
          post: opt.post,
          nume: opt.nume,
          type: opt.type,
        });
        const ajaxRes = await ctx.proxiedFetcher<any>(`${FILMSAROK_BASE}/wp-admin/admin-ajax.php`, {
          method: 'POST',
          headers: {
            ...HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Referer: bestCandidate.url,
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: formData.toString(),
        });
        const resBody = (ajaxRes as any)?.body || ajaxRes;
        const embedUrl = resBody?.embed_url;
        if (embedUrl && typeof embedUrl === 'string' && embedUrl.startsWith('http')) {
          if (!embedUrl.includes('youtube.com') && !embedUrl.includes('youtu.be')) {
            directOrIntermediateUrls.push(embedUrl);
          }
        }
      } catch {
        // ignore
      }
    }

    const embeds: SourcererEmbed[] = [];
    const seenUrls = new Set<string>();

    for (const link of directOrIntermediateUrls) {
      let targetUrl: string | null = link;
      let embedId = getEmbedId(targetUrl);

      if (!embedId && targetUrl.includes('filmsarok.hu')) {
        targetUrl = await extractVideoLinkFromIntermediate(ctx, targetUrl);
        if (targetUrl) {
          embedId = getEmbedId(targetUrl);
        }
      }

      if (targetUrl && embedId && !seenUrls.has(targetUrl)) {
        seenUrls.add(targetUrl);
        embeds.push({
          embedId,
          url: targetUrl,
        });
      }
    }

    if (embeds.length === 0) {
      throw new NotFoundError('No compatible video embeds found on FilmSarok');
    }

    return { embeds };
  },

  async scrapeShow(ctx: ShowScrapeContext): Promise<SourcererOutput> {
    const huTitle = await getHungarianTitle(ctx.media.title, ctx.media.releaseYear, ctx.media.tmdbId, 'show');
    const searchQueries = new Set<string>();
    if (huTitle) searchQueries.add(huTitle);
    searchQueries.add(ctx.media.title);

    interface Candidate {
      title: string;
      url: string;
    }

    const candidates: Candidate[] = [];

    for (const query of searchQueries) {
      try {
        const searchUrl = `${FILMSAROK_BASE}/?s=${encodeURIComponent(query)}`;
        const html = await ctx.proxiedFetcher<string>(searchUrl, { headers: HEADERS });
        const $ = load(html);

        $('.result-item').each((_, el) => {
          const typeText = $(el).find('.movies, .tvshows').text().trim().toLowerCase();
          if (typeText && !typeText.includes('tv') && !typeText.includes('sorozat')) return;

          const titleLink = $(el).find('.title a');
          const title = titleLink.text().trim();
          const href = titleLink.attr('href') || $(el).find('.thumbnail a').attr('href');
          if (!href || !title) return;

          const fullUrl = href.startsWith('http') ? href : `${FILMSAROK_BASE}${href}`;
          if (!candidates.some((c) => c.url === fullUrl)) {
            candidates.push({ title, url: fullUrl });
          }
        });
      } catch (err) {
        console.log(`[FilmSarok] Show search error for query "${query}":`, err);
      }
    }

    if (candidates.length === 0) {
      throw new NotFoundError('No show search results found on FilmSarok');
    }

    const normOriginal = normalizeTitle(ctx.media.title);
    const normHu = huTitle ? normalizeTitle(huTitle) : null;

    let bestCandidate: Candidate | null = null;
    let highestScore = -1;

    for (const cand of candidates) {
      let score = 0;
      const normCand = normalizeTitle(cand.title);

      if (normCand === normOriginal || (normHu && normCand === normHu)) {
        score += 50;
      } else if (normCand.includes(normOriginal) || (normHu && normCand.includes(normHu))) {
        score += 30;
      }

      if (score > highestScore) {
        highestScore = score;
        bestCandidate = cand;
      }
    }

    if (!bestCandidate || highestScore < 10) {
      throw new NotFoundError('No matching show found on FilmSarok');
    }

    const showHtml = await ctx.proxiedFetcher<string>(bestCandidate.url, { headers: HEADERS });
    const $ = load(showHtml);

    let episodeUrl: string | null = null;
    const targetSeason = ctx.media.season.number;
    const targetEpisode = ctx.media.episode.number;

    $('#episodes .se-c').each((_, seEl) => {
      const seTitle = $(seEl).find('.title').text().trim();
      const seNumMatch = seTitle.match(/(\d+)/);
      if (!seNumMatch || parseInt(seNumMatch[1], 10) !== targetSeason) return;

      $(seEl)
        .find('li')
        .each((__, epEl) => {
          const epNumText = $(epEl).find('.numerando').text().trim();
          const epNumMatch = epNumText.match(/-\s*(\d+)/);
          if (epNumMatch && parseInt(epNumMatch[1], 10) === targetEpisode) {
            const epLink = $(epEl).find('a').attr('href');
            if (epLink) {
              episodeUrl = epLink.startsWith('http') ? epLink : `${FILMSAROK_BASE}${epLink}`;
            }
          }
        });
    });

    if (!episodeUrl) {
      throw new NotFoundError(`Episode S${targetSeason}E${targetEpisode} not found on FilmSarok`);
    }

    const epHtml = await ctx.proxiedFetcher<string>(episodeUrl, { headers: HEADERS });
    const $ep = load(epHtml);

    const directOrIntermediateUrls: string[] = [];
    $ep('#videos table tbody tr a').each((_, el) => {
      const href = $ep(el).attr('href')?.trim();
      if (href && href.startsWith('http')) {
        directOrIntermediateUrls.push(href);
      }
    });

    $ep('iframe[src]').each((_, el) => {
      let src = $ep(el).attr('src')?.trim();
      if (!src) return;
      if (src.startsWith('//')) src = `https:${src}`;
      if (src.startsWith('http') && !src.includes('youtube.com') && !src.includes('google')) {
        directOrIntermediateUrls.push(src);
      }
    });

    const epPlayerOptions: Array<{ post: string; nume: string; type: string }> = [];
    $ep('.dooplay_player_option, #playeroptionsul li').each((_, el) => {
      const post = $ep(el).attr('data-post');
      const nume = $ep(el).attr('data-nume');
      const type = $ep(el).attr('data-type') || 'tv';
      if (post && nume && nume !== 'trailer') {
        epPlayerOptions.push({ post, nume, type });
      }
    });

    for (const opt of epPlayerOptions) {
      try {
        const formData = new URLSearchParams({
          action: 'doo_player_ajax',
          post: opt.post,
          nume: opt.nume,
          type: opt.type,
        });
        const ajaxRes = await ctx.proxiedFetcher<any>(`${FILMSAROK_BASE}/wp-admin/admin-ajax.php`, {
          method: 'POST',
          headers: {
            ...HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Referer: episodeUrl,
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: formData.toString(),
        });
        const resBody = (ajaxRes as any)?.body || ajaxRes;
        const embedUrl = resBody?.embed_url;
        if (embedUrl && typeof embedUrl === 'string' && embedUrl.startsWith('http')) {
          if (!embedUrl.includes('youtube.com') && !embedUrl.includes('youtu.be')) {
            directOrIntermediateUrls.push(embedUrl);
          }
        }
      } catch {
        // ignore
      }
    }

    const embeds: SourcererEmbed[] = [];
    const seenUrls = new Set<string>();

    for (const link of directOrIntermediateUrls) {
      let targetUrl: string | null = link;
      let embedId = getEmbedId(targetUrl);

      if (!embedId && targetUrl.includes('filmsarok.hu')) {
        targetUrl = await extractVideoLinkFromIntermediate(ctx, targetUrl);
        if (targetUrl) {
          embedId = getEmbedId(targetUrl);
        }
      }

      if (targetUrl && embedId && !seenUrls.has(targetUrl)) {
        seenUrls.add(targetUrl);
        embeds.push({
          embedId,
          url: targetUrl,
        });
      }
    }

    if (embeds.length === 0) {
      throw new NotFoundError('No compatible video embeds found for episode on FilmSarok');
    }

    return { embeds };
  },
});
