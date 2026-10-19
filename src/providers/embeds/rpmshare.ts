import CryptoJS from 'crypto-js';

import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { Caption } from '@/providers/captions';
import { NotFoundError } from '@/utils/errors';
import { createM3U8ProxyUrl } from '@/utils/proxy';

const KEY = CryptoJS.enc.Utf8.parse('kiemtienmua911ca');
const IV = CryptoJS.enc.Utf8.parse('1234567890oiuytr');

export const rpmshareScraper = makeEmbed({
  id: 'rpmshare',
  name: 'RPMShare',
  rank: 190,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    let videoId = '';
    if (ctx.url.includes('#')) {
      videoId = ctx.url.split('#')[1].trim();
    } else {
      const parts = ctx.url.split('?')[0].split('/').filter(Boolean);
      videoId = parts[parts.length - 1];
    }

    if (!videoId) {
      throw new NotFoundError('RPMShare: Video ID not found in URL');
    }

    const apiUrl = `https://rpmshare.rpmstream.live/api/v1/video?id=${encodeURIComponent(
      videoId,
    )}&w=2048&h=1152&r=hdmozi.hu`;

    const resp = await ctx.proxiedFetcher<any>(apiUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: 'https://rpmshare.rpmstream.live/',
      },
    });

    const rawText: string =
      typeof resp === 'string'
        ? resp
        : resp instanceof ArrayBuffer || ArrayBuffer.isView(resp)
          ? new TextDecoder().decode(resp)
          : String(resp ?? '');

    const hexText = rawText.trim();
    if (!hexText || hexText.startsWith('{') || hexText.length % 2 !== 0) {
      throw new NotFoundError('RPMShare: Invalid response or video unavailable');
    }

    let jsonStr = '';
    try {
      const cipher = CryptoJS.lib.CipherParams.create({
        ciphertext: CryptoJS.enc.Hex.parse(hexText),
      });
      const decrypted = CryptoJS.AES.decrypt(cipher, KEY, {
        iv: IV,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });
      jsonStr = decrypted.toString(CryptoJS.enc.Utf8);
    } catch (e) {
      throw new NotFoundError('RPMShare: Decryption failed');
    }

    if (!jsonStr) {
      throw new NotFoundError('RPMShare: Failed to decode decrypted payload');
    }

    let data: any;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      throw new NotFoundError('RPMShare: Failed to parse decrypted JSON');
    }

    const playlistUrl = data.source || data.cfNative;
    if (!playlistUrl || typeof playlistUrl !== 'string') {
      throw new NotFoundError('RPMShare: No stream playlist found');
    }

    const captions: Caption[] = [];
    if (data.subtitle && typeof data.subtitle === 'object') {
      for (const [langKey, subUrl] of Object.entries(data.subtitle)) {
        if (typeof subUrl === 'string' && subUrl) {
          const cleanSub = subUrl.startsWith('http') ? subUrl : `https://rpmshare.rpmstream.live${subUrl}`;
          const langMatch = cleanSub.match(/#(hu|en|[a-z]{2})/i);
          const language = langMatch ? langMatch[1].toLowerCase() : langKey.toLowerCase() === 'forced' ? 'hu' : 'hu';
          captions.push({
            id: `sub_${language}`,
            url: cleanSub.split('#')[0],
            type: 'vtt',
            hasCorsRestrictions: false,
            language,
          });
        }
      }
    }

    const streamHeaders = {
      Referer: 'https://rpmshare.rpmstream.live/',
      Origin: 'https://rpmshare.rpmstream.live',
    };

    return {
      stream: [
        {
          id: 'primary',
          type: 'hls',
          playlist: createM3U8ProxyUrl(playlistUrl, ctx.features, streamHeaders),
          flags: [flags.CORS_ALLOWED],
          captions,
          headers: streamHeaders,
          preferredHeaders: streamHeaders,
        },
      ],
    };
  },
});
