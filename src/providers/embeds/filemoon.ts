import { load } from 'cheerio';
import { unpack } from 'unpacker';

import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { NotFoundError } from '@/utils/errors';
import { createM3U8ProxyUrl } from '@/utils/proxy';

const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function base64UrlDecode(str: string): Uint8Array {
  const t = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = t.length % 4 === 0 ? 0 : 4 - (t.length % 4);
  const binary = typeof atob === 'function' ? atob(t + '='.repeat(pad)) : Buffer.from(t + '='.repeat(pad), 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getByseKeyPairs(): Record<string, [number, number]> {
  const e: Record<string, [number, number]> = {};
  for (let n = 1; n <= 20; n += 1) {
    const o = n ^ 0;
    const a = (31 - n) ^ 0;
    e[String(n)] = [o, a];
  }
  return e;
}

function selectKeyParts(version: string, keyParts: string[]): string[] {
  const pairs = getByseKeyPairs();
  const pair = pairs[version.trim()];
  if (!pair) return keyParts;
  const [a, b] = pair;
  if (a < 1 || b < 1 || a > keyParts.length || b > keyParts.length) return keyParts;
  return [keyParts[a - 1], keyParts[b - 1]];
}

function assembleKey(selectedParts: string[]): Uint8Array {
  const bufs = selectedParts.map(base64UrlDecode);
  const totalLen = bufs.reduce((acc, b) => acc + b.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of bufs) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

async function decryptBysePlayback(playback: {
  version: string;
  key_parts: string[];
  iv: string;
  payload: string;
}): Promise<any> {
  const selected = selectKeyParts(playback.version, playback.key_parts);
  const keyBytes = assembleKey(selected);
  const iv = base64UrlDecode(playback.iv);
  const rawPayload = base64UrlDecode(playback.payload);

  const cryptoSubtle = globalThis.crypto?.subtle;
  if (!cryptoSubtle) {
    throw new Error('WebCrypto subtle is not available');
  }

  const key = await cryptoSubtle.importKey('raw', keyBytes as unknown as BufferSource, 'AES-GCM', false, ['decrypt']);
  const decrypted = await cryptoSubtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
    },
    key,
    rawPayload as unknown as BufferSource,
  );

  const text = new TextDecoder().decode(decrypted);
  return JSON.parse(text);
}

export const filemoonScraper = makeEmbed({
  id: 'filemoon',
  name: 'Filemoon',
  rank: 174,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    const origin = new URL(ctx.url).origin;
    const headers = {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      Referer: `${origin}/`,
      'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
      'User-Agent': userAgent,
    };

    // Fetch initial response
    const rawResponse = await ctx.proxiedFetcher<string>(ctx.url, { headers });
    const response =
      typeof rawResponse === 'string'
        ? rawResponse
        : (rawResponse as any)?.body
          ? String((rawResponse as any).body)
          : String(rawResponse);

    // Method 1: Modern Byse / Filemoon React SPA
    const codeMatch = ctx.url.match(/\/(?:e|d)\/([a-zA-Z0-9_-]+)/);
    if (codeMatch && (response.includes('id="root"') || response.includes('Byse Frontend') || response.includes('/assets/index-'))) {
      try {
        const code = codeMatch[1];
        const indexMatch = response.match(/src=["'](?:\/)?(assets\/index-[^"']+\.js)["']/);
        if (indexMatch) {
          const indexJsUrl = new URL(indexMatch[1], origin).toString();
          const rawIndex = await ctx.proxiedFetcher<any>(indexJsUrl, { headers });
          const indexJs = typeof rawIndex === 'string' ? rawIndex : (rawIndex as any)?.body ? String((rawIndex as any).body) : String(rawIndex);
          const powMatch = indexJs.match(/["'](?:\/)?(assets\/pow-[^"']+\.js)["']/);
          if (powMatch) {
            const powJsUrl = new URL(powMatch[1], origin).toString();
            const rawPow = await ctx.proxiedFetcher<any>(powJsUrl, { headers });
            let powJs = typeof rawPow === 'string' ? rawPow : (rawPow as any)?.body ? String((rawPow as any).body) : String(rawPow);
            powJs = powJs.replace(/import\{[^}]+\}from\"[^\"]+\";/, `const Xt = () => "${origin}"; const gt = () => null;`);
            const powMod = await import(`data:text/javascript,${encodeURIComponent(powJs)}`);

            const rawCap = await ctx.proxiedFetcher<any>(`${origin}/api/videos/${code}/embed/captcha`, {
              method: 'POST',
              headers: {
                ...headers,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({}),
            });
            const capRes = (rawCap as any)?.body || rawCap;

            const solution = await powMod.s(capRes.pow_nonce, capRes.pow_difficulty);
            const rawVerify = await ctx.proxiedFetcher<any>(`${origin}/api/videos/${code}/embed/captcha/verify`, {
              method: 'POST',
              headers: {
                ...headers,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                pow_token: capRes.pow_token,
                solution,
              }),
            });
            const verifyRes = (rawVerify as any)?.body || rawVerify;

            if (verifyRes.token) {
              const fp = await powMod.e();
              const fingerprint = {
                token: fp.token,
                viewer_id: fp.viewerId,
                device_id: fp.deviceId,
                confidence: fp.confidence,
              };

              const rawPlay = await ctx.proxiedFetcher<any>(`${origin}/api/videos/${code}/embed/playback`, {
                method: 'POST',
                headers: {
                  ...headers,
                  'Content-Type': 'application/json',
                  'X-Captcha-Token': verifyRes.token,
                },
                body: JSON.stringify({ fingerprint }),
              });
              const playRes = (rawPlay as any)?.body || rawPlay;

              if (playRes?.playback) {
                const decrypted = await decryptBysePlayback(playRes.playback);
                const hlsSource = decrypted?.sources?.[0]?.url;
                if (hlsSource) {
                  return {
                    stream: [
                      {
                        id: 'primary',
                        type: 'hls',
                        playlist: createM3U8ProxyUrl(hlsSource, ctx.features),
                        flags: [flags.CORS_ALLOWED],
                        captions: [],
                      },
                    ],
                  };
                }
              }
            }
          }
        }
      } catch {
        // Fall back to legacy packed JS extraction below
      }
    }

    // Method 2: Legacy Filemoon packed JS extraction
    const soup = load(response);
    const iframe = soup('iframe').first();
    const iframeUrl = iframe.length ? iframe.attr('src') : null;

    let targetHtml = response;
    if (iframeUrl) {
      targetHtml = await ctx.proxiedFetcher<string>(iframeUrl, { headers });
    }

    const targetSoup = load(targetHtml);
    const jsCode = targetSoup('script')
      .filter((_, el) => {
        const text = targetSoup(el).html() || '';
        return text.includes('eval(function(p,a,c,k,e,d)');
      })
      .first()
      .html();

    if (!jsCode) throw new NotFoundError('No playable stream or packed JS code found on Filemoon');

    const unpacked = unpack(jsCode);
    if (!unpacked) throw new NotFoundError('Failed to unpack JS code');

    const videoMatch = unpacked.match(/file:"([^"]+)"/);
    if (!videoMatch) throw new NotFoundError('No video URL found');
    const videoUrl = videoMatch[1];
    const isHls = videoUrl.includes('.m3u8');

    if (isHls) {
      return {
        stream: [
          {
            id: 'primary',
            type: 'hls',
            playlist: createM3U8ProxyUrl(videoUrl, ctx.features, { Referer: `${origin}/` }),
            flags: [flags.CORS_ALLOWED],
            captions: [],
            headers: {
              Referer: `${origin}/`,
              'User-Agent': userAgent,
            },
          },
        ],
      };
    }

    return {
      stream: [
        {
          id: 'primary',
          type: 'file',
          qualities: {
            unknown: {
              type: 'mp4',
              url: videoUrl,
            },
          },
          headers: {
            Referer: `${origin}/`,
            'User-Agent': userAgent,
          },
          flags: [flags.CORS_ALLOWED],
          captions: [],
        },
      ],
    };
  },
});
