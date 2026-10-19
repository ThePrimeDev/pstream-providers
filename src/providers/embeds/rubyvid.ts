import { unpack } from 'unpacker';

import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { NotFoundError } from '@/utils/errors';
import { createM3U8ProxyUrl } from '@/utils/proxy';

export const rubyvidScraper = makeEmbed({
  id: 'rubyvid',
  name: 'RubyVid',
  rank: 175,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    const origin = new URL(ctx.url).origin;
    const mediaIdMatch = ctx.url.match(/(?:embed-|e\/|d\/)?([a-zA-Z0-9]+)(?:\.html)?$/);
    const mediaId = mediaIdMatch ? mediaIdMatch[1] : '';

    const embedUrl = mediaId ? `${origin}/embed-${mediaId}.html` : ctx.url;

    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.5',
      Referer: `${origin}/`,
    };

    const html = await ctx.proxiedFetcher<string>(embedUrl, { headers });

    let streamUrl: string | null = null;

    // Pattern 1: Packed JavaScript
    if (html.includes('eval(function(p,a,c,k,e,d)')) {
      const evalMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]+?\.split\('\|'\)\)\)/);
      if (evalMatch) {
        try {
          const unpacked = unpack(evalMatch[0]);
          const unpackedMatch =
            unpacked.match(/sources\s*:\s*\[(?:\{src:|\{file:)?\s*['"]([^'"]+)['"]/i) ||
            unpacked.match(/file\s*:\s*['"](https?:\/\/[^'"]+?\.m3u8[^'"]*?)['"]/i) ||
            unpacked.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
          if (unpackedMatch && unpackedMatch[1]) {
            streamUrl = unpackedMatch[1];
          }
        } catch {
          // ignore
        }
      }
    }

    // Pattern 2: Direct sources array in HTML
    if (!streamUrl) {
      const sourcesMatch =
        html.match(/sources\s*:\s*\[(?:\{src:|\{file:)?\s*['"]([^'"]+)['"]/i) ||
        html.match(/file\s*:\s*['"](https?:\/\/[^'"]+?\.m3u8[^'"]*?)['"]/i);
      if (sourcesMatch && sourcesMatch[1]) {
        streamUrl = sourcesMatch[1];
      }
    }

    // Pattern 3: General m3u8 in HTML
    if (!streamUrl) {
      const m3u8Match = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (m3u8Match && m3u8Match[1]) {
        streamUrl = m3u8Match[1];
      }
    }

    if (!streamUrl) {
      throw new NotFoundError('No playable stream found on RubyVid');
    }

    const streamHeaders = {
      Referer: `${origin}/`,
      Origin: origin,
    };

    return {
      stream: [
        {
          id: 'primary',
          type: 'hls',
          playlist: createM3U8ProxyUrl(streamUrl, ctx.features, streamHeaders),
          flags: [flags.CORS_ALLOWED],
          captions: [],
          headers: streamHeaders,
          preferredHeaders: streamHeaders,
        },
      ],
    };
  },
});
