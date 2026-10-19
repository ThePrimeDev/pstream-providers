import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { Qualities, StreamFile } from '@/providers/streams';
import { NotFoundError } from '@/utils/errors';

export const okruScraper = makeEmbed({
  id: 'okru',
  name: 'OK.ru',
  rank: 186,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    let embedUrl = ctx.url;
    if (embedUrl.startsWith('//')) {
      embedUrl = `https:${embedUrl}`;
    }

    // Extract video ID if it's a full URL or partial path
    const idMatch = embedUrl.match(/(?:videoembed|video)\/([0-9]+)/);
    const videoId = idMatch ? idMatch[1] : null;

    const targetUrl = videoId
      ? `https://ok.ru/videoembed/${videoId}`
      : embedUrl;

    const rawHtml = await ctx.proxiedFetcher<any>(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: 'https://ok.ru/',
      },
    });

    const html =
      typeof rawHtml === 'string'
        ? rawHtml
        : typeof rawHtml?.body === 'string'
          ? rawHtml.body
          : String(rawHtml ?? '');

    const dataOptionsMatch = html.match(/data-options=["']([^"']+)["']/);
    if (!dataOptionsMatch) {
      throw new NotFoundError('OK.ru: Stream options not found');
    }

    let parsed: any;
    try {
      const unescaped = dataOptionsMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      parsed = JSON.parse(unescaped);
    } catch (e) {
      throw new NotFoundError('OK.ru: Failed to parse stream data');
    }

    const flashvars = parsed?.flashvars;
    if (!flashvars) {
      throw new NotFoundError('OK.ru: Video metadata missing');
    }

    let metadata = flashvars.metadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (e) {
        throw new NotFoundError('OK.ru: Failed to parse video metadata');
      }
    }

    if (!metadata) {
      throw new NotFoundError('OK.ru: Video metadata unavailable');
    }

    // Check error condition
    if (metadata.error) {
      throw new NotFoundError(`OK.ru: ${metadata.error}`);
    }

    const defaultHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Referer: 'https://ok.ru/',
    };

    // 1. Prefer HLS manifest if present
    if (metadata.hlsManifestUrl) {
      return {
        stream: [
          {
            id: 'primary',
            type: 'hls',
            playlist: metadata.hlsManifestUrl,
            preferredHeaders: defaultHeaders,
            flags: [flags.CORS_ALLOWED],
            captions: [],
          },
        ],
      };
    }

    // 2. Direct MP4 videos fallback
    if (Array.isArray(metadata.videos) && metadata.videos.length > 0) {
      const qualities: Partial<Record<Qualities, StreamFile>> = {};
      const qualityMap: Record<string, Qualities> = {
        lowest: '360',
        low: '360',
        sd: '480',
        hd: '720',
        full: '1080',
        quad: '1080',
        ultra: '4k',
      };

      for (const v of metadata.videos) {
        const mapped = qualityMap[v.name];
        if (mapped && v.url && !v.disallowed) {
          qualities[mapped] = {
            type: 'mp4',
            url: v.url,
          };
        }
      }

      if (Object.keys(qualities).length > 0) {
        return {
          stream: [
            {
              id: 'primary',
              type: 'file',
              qualities,
              preferredHeaders: defaultHeaders,
              flags: [flags.CORS_ALLOWED],
              captions: [],
            },
          ],
        };
      }
    }

    throw new NotFoundError('OK.ru: No playable stream found');
  },
});
