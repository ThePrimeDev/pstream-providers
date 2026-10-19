import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { Caption } from '@/providers/captions';
import { Qualities, StreamFile } from '@/providers/streams';
import { NotFoundError } from '@/utils/errors';
import { getValidQualityFromString } from '@/utils/quality';

export const indavideoScraper = makeEmbed({
  id: 'indavideo',
  name: 'Indavideo',
  rank: 177,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    let targetUrl = ctx.url.startsWith('//') ? `https:${ctx.url}` : ctx.url;

    let hash: string | null = null;

    // Check if hash is directly in embed URL (e.g. embed.indavideo.hu/player/video/06fc090308 or indavideo.hu/player/video/8c75687b82)
    const directEmbedMatch = targetUrl.match(/(?:embed\.)?indavideo\.hu\/player\/video\/([a-zA-Z0-9]+)/i);
    if (directEmbedMatch && directEmbedMatch[1].length >= 8) {
      hash = directEmbedMatch[1];
    }

    // Otherwise, fetch page to extract video ID / emb_hash
    if (!hash) {
      const pageResp = await ctx.proxiedFetcher<string>(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          Referer: 'https://indavideo.hu/',
        },
      });

      const hashMatch =
        pageResp.match(/vID=([a-zA-Z0-9]+)/i) ||
        pageResp.match(/id=["']emb_hash["'][^>]*value=["']([^"']+)["']/i) ||
        pageResp.match(/value=["']([^"']+)["'][^>]*id=["']emb_hash["']/i) ||
        pageResp.match(/emb_hash["']?\s*[:=]\s*["']([a-f0-9]+)["']/i) ||
        pageResp.match(/(?:embed\.)?indavideo\.hu\/player\/video\/([a-zA-Z0-9]+)/i);

      if (hashMatch) {
        hash = hashMatch[1];
      }
    }

    // Fallback: Check pathname segment
    if (!hash) {
      const parts = new URL(targetUrl).pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && /^[a-f0-9]{8,16}$/i.test(last)) {
        hash = last;
      }
    }

    if (!hash) {
      throw new NotFoundError('Indavideo: Video hash not found');
    }

    const rnd = Math.floor(Math.random() * 2147483647);
    const apiUrl = `http://amfphp.indavideo.hu/SYm0json.php/player.playerHandler.getVideoData/${encodeURIComponent(
      hash,
    )}/12/?callback=json&_=${rnd}`;

    const apiResp = await ctx.proxiedFetcher<string>(apiUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: targetUrl,
      },
    });

    let jsonStr = apiResp;
    if (typeof jsonStr === 'string' && jsonStr.startsWith('json(')) {
      jsonStr = jsonStr.slice(5, jsonStr.lastIndexOf(')'));
    }

    let payload: any;
    try {
      payload = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    } catch {
      throw new NotFoundError('Indavideo: Failed to parse video metadata');
    }

    const data = payload?.data;
    if (!data || data.ban_status > 0) {
      throw new NotFoundError('Indavideo: Video is unavailable or deleted');
    }

    const filesh: Record<string, string> = data.filesh || {};
    const defaultToken = Object.values(filesh)[0] || '';

    const rawVideoFiles = Array.isArray(data.video_files) ? data.video_files : Object.values(data.video_files || {});
    if (data.video_file && !rawVideoFiles.includes(data.video_file)) {
      rawVideoFiles.push(data.video_file);
    }

    const qualities: Partial<Record<Qualities, StreamFile>> = {};

    for (const rawUrl of rawVideoFiles) {
      if (typeof rawUrl !== 'string' || !rawUrl) continue;
      const heightMatch = rawUrl.match(/\.(\d{3,4})\.mp4(?:\?|$)/i);
      const height = heightMatch ? heightMatch[1] : '';
      const token = (height && filesh[height]) || defaultToken;

      const streamUrl = token ? `${rawUrl}&token=${token}` : rawUrl;
      const validQuality = getValidQualityFromString(height || '360');

      if (!qualities[validQuality]) {
        qualities[validQuality] = {
          type: 'mp4',
          url: streamUrl,
        };
      }
    }

    if (Object.keys(qualities).length === 0) {
      throw new NotFoundError('Indavideo: No playable video streams found');
    }

    const captions: Caption[] = [];
    if (Array.isArray(data.subtitles)) {
      for (const sub of data.subtitles) {
        if (sub && sub.url) {
          captions.push({
            id: sub.url,
            language: sub.lang || 'hu',
            hasCorsRestrictions: false,
            type: 'srt',
            url: sub.url,
          });
        }
      }
    }

    return {
      stream: [
        {
          id: 'primary',
          type: 'file',
          flags: [flags.CORS_ALLOWED],
          captions,
          qualities,
          headers: {
            Referer: 'https://indavideo.hu/',
          },
          preferredHeaders: {
            Referer: 'https://indavideo.hu/',
          },
        },
      ],
    };
  },
});
