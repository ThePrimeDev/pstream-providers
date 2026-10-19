import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { NotFoundError } from '@/utils/errors';
import { createM3U8ProxyUrl } from '@/utils/proxy';

function voeDecode(ct: string, luts: string): any {
  const lutRaw = luts.slice(2, -2).split("','");
  let txt = '';
  for (let i = 0; i < ct.length; i++) {
    const x = ct.charCodeAt(i);
    if (x > 64 && x < 91) {
      txt += String.fromCharCode(((x - 52) % 26) + 65);
    } else if (x > 96 && x < 123) {
      txt += String.fromCharCode(((x - 84) % 26) + 97);
    } else {
      txt += ct[i];
    }
  }
  for (const l of lutRaw) {
    txt = txt.split(l).join('');
  }
  const decoded1 = typeof atob === 'function' ? atob(txt) : Buffer.from(txt, 'base64').toString('utf-8');
  let shifted = '';
  for (let i = 0; i < decoded1.length; i++) {
    shifted += String.fromCharCode(decoded1.charCodeAt(i) - 3);
  }
  const reversed = shifted.split('').reverse().join('');
  const jsonStr = typeof atob === 'function' ? atob(reversed) : Buffer.from(reversed, 'base64').toString('utf-8');
  return JSON.parse(jsonStr);
}

export const voeScraper = makeEmbed({
  id: 'voe',
  name: 'voe.sx',
  rank: 179,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    let embedRes = await ctx.proxiedFetcher.full<string>(ctx.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    });
    let embed = embedRes.body;
    let finalUrl = embedRes.finalUrl || ctx.url;

    // Follow JS window.location.href redirect if present
    const redirectMatch = embed.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
    if (redirectMatch && redirectMatch[1]) {
      const nextUrl = redirectMatch[1].startsWith('http') ? redirectMatch[1] : new URL(redirectMatch[1], finalUrl).href;
      embedRes = await ctx.proxiedFetcher.full<string>(nextUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          Referer: finalUrl,
        },
      });
      embed = embedRes.body;
      finalUrl = embedRes.finalUrl || nextUrl;
    }

    let streamUrl: string | null = null;

    // Pattern 1: Encoded JSON payload with external JS LUT
    const encodedJsonMatch = embed.match(/json">\["([^"]+)"]<\/script>\s*<script\s*src="([^"]+)/i);
    if (encodedJsonMatch && encodedJsonMatch[1] && encodedJsonMatch[2]) {
      try {
        const jsUrl = encodedJsonMatch[2].startsWith('http')
          ? encodedJsonMatch[2]
          : new URL(encodedJsonMatch[2], finalUrl).href;
        const jsBody = await ctx.proxiedFetcher<string>(jsUrl);
        const lutMatch = jsBody.match(/(\[(?:'\W{2}'[,\]]){1,9})/);
        if (lutMatch && lutMatch[1]) {
          const data = voeDecode(encodedJsonMatch[1], lutMatch[1]);
          if (data?.file) streamUrl = data.file;
          else if (data?.source) streamUrl = data.source;
          else if (data?.direct_access_url) streamUrl = data.direct_access_url;
        }
      } catch {
        // ignore decode failure and continue
      }
    }

    // Pattern 2: 'hls': '...' or "hls": "..."
    if (!streamUrl) {
      const hlsMatch =
        embed.match(/['"]hls['"]\s*:\s*['"]([^'"]+)['"]/i) ||
        embed.match(/['"]file['"]\s*:\s*['"](https?:\/\/[^'"]+?\.m3u8[^'"]*?)['"]/i);
      if (hlsMatch && hlsMatch[1]) {
        streamUrl = hlsMatch[1];
      }
    }

    // Pattern 3: atob encoded sources
    if (!streamUrl) {
      const atobMatch = embed.match(/atob\(['"]([A-Za-z0-9+/=]{20,})['"]\)/);
      if (atobMatch && atobMatch[1]) {
        try {
          const decoded =
            typeof atob === 'function' ? atob(atobMatch[1]) : Buffer.from(atobMatch[1], 'base64').toString('utf-8');
          if (decoded.includes('.m3u8') || decoded.startsWith('http')) {
            streamUrl = decoded;
          }
        } catch {
          // ignore
        }
      }
    }

    // Pattern 4: direct mp4 or m3u8 in script
    if (!streamUrl) {
      const directMatch = embed.match(/(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*)/i);
      if (directMatch && directMatch[1]) {
        streamUrl = directMatch[1];
      }
    }

    if (!streamUrl) {
      throw new NotFoundError('Stream url not found in VOE embed');
    }

    const origin = new URL(finalUrl).origin;

    const streamHeaders = {
      Referer: `${origin}/`,
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
