import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { Qualities, StreamFile } from '@/providers/streams';
import { NotFoundError } from '@/utils/errors';

export const fsstScraper = makeEmbed({
  id: 'fsst',
  name: 'FSST',
  rank: 188,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    let embedUrl = ctx.url;
    if (embedUrl.startsWith('//')) {
      embedUrl = `https:${embedUrl}`;
    }

    const html = await ctx.proxiedFetcher<string>(embedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: 'https://mozibox.hu/',
      },
    });

    const fileMatch = html.match(/file\s*:\s*["']([^"']+)["']/i);
    if (!fileMatch) {
      throw new NotFoundError('FSST: Stream file not found');
    }

    const fileStr = fileMatch[1].trim();

    if (fileStr.includes('.m3u8')) {
      return {
        stream: [
          {
            id: 'primary',
            type: 'hls',
            playlist: fileStr,
            flags: [flags.CORS_ALLOWED],
            captions: [],
          },
        ],
      };
    }

    const qualityMap: Record<string, Qualities> = {
      '360p': '360',
      '360': '360',
      '480p': '480',
      '480': '480',
      '720p': '720',
      '720': '720',
      '1080p': '1080',
      '1080': '1080',
      '4k': '4k',
    };

    const qualities: Partial<Record<Qualities, StreamFile>> = {};
    const fileRegex = /(?:\[(\w+)\])?(https?:\/\/[^,\[\]"']+)/g;
    let match: RegExpExecArray | null;
    while ((match = fileRegex.exec(fileStr)) !== null) {
      const qTag = match[1] ? match[1].toLowerCase() : 'unknown';
      const q = qualityMap[qTag] || 'unknown';
      qualities[q] = {
        type: 'mp4',
        url: match[2].trim(),
      };
    }

    if (Object.keys(qualities).length === 0) {
      if (fileStr.startsWith('http')) {
        qualities.unknown = {
          type: 'mp4',
          url: fileStr,
        };
      } else {
        throw new NotFoundError('FSST: No playable video streams found');
      }
    }

    return {
      stream: [
        {
          id: 'primary',
          type: 'file',
          flags: [flags.CORS_ALLOWED],
          captions: [],
          qualities,
        },
      ],
    };
  },
});
