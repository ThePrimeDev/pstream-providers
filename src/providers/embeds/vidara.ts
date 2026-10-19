import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { Caption } from '@/providers/captions';
import { NotFoundError } from '@/utils/errors';
import { labelToLanguageCode } from '@/providers/captions';

interface VidaraStreamResponse {
  default_sub_lang?: string;
  filecode?: string;
  streaming_url?: string;
  subtitles?: Array<{
    file_path?: string;
    language?: string;
    type?: number;
  }> | null;
  thumbnail?: string;
  title?: string;
}

export const vidaraScraper = makeEmbed({
  id: 'vidara',
  name: 'Vidara',
  rank: 185,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    const targetUrl = ctx.url.startsWith('//') ? `https:${ctx.url}` : ctx.url;
    const urlObj = new URL(targetUrl);
    const origin = urlObj.origin;

    // Extract filecode from path (e.g. /e/lWOTvhWoea0h or /lWOTvhWoea0h)
    const match = urlObj.pathname.match(/(?:\/e\/|\/v\/|\/d\/)?([a-zA-Z0-9]+)$/);
    const filecode = match ? match[1] : null;

    if (!filecode) {
      throw new NotFoundError('Vidara: Could not extract filecode');
    }

    const apiUrl = `${origin}/api/stream`;
    const response = await ctx.proxiedFetcher<VidaraStreamResponse>(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: targetUrl,
      },
      body: {
        filecode,
        device: 'desktop',
        codecs: ['avc', 'h264', 'mp4a'],
      },
    });

    const streamingUrl = response?.streaming_url;
    if (!streamingUrl) {
      throw new NotFoundError('Vidara: No streaming URL found');
    }

    const captions: Caption[] = [];
    if (Array.isArray(response.subtitles)) {
      for (const sub of response.subtitles) {
        if (sub && sub.file_path) {
          const langCode = sub.language ? labelToLanguageCode(sub.language) || 'hu' : 'hu';
          captions.push({
            id: sub.file_path,
            language: langCode,
            hasCorsRestrictions: false,
            type: sub.file_path.endsWith('.vtt') ? 'vtt' : 'srt',
            url: sub.file_path,
          });
        }
      }
    }

    return {
      stream: [
        {
          id: 'primary',
          type: 'hls',
          playlist: streamingUrl,
          flags: [flags.CORS_ALLOWED],
          captions,
          headers: {
            Referer: `${origin}/`,
          },
          preferredHeaders: {
            Referer: `${origin}/`,
          },
        },
      ],
    };
  },
});
