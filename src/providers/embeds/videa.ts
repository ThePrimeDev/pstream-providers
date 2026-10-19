import { load } from 'cheerio';
import { customAlphabet } from 'nanoid';

import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { Caption, getCaptionTypeFromUrl, labelToLanguageCode } from '@/providers/captions';
import { Qualities, StreamFile } from '@/providers/streams';
import { NotFoundError } from '@/utils/errors';
import { getValidQualityFromString } from '@/utils/quality';

// Videa uses an 8-character random alphanumeric seed
const generateRandomSeed = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 8);

const STATIC_SECRET = 'xHb0ZvME5q8CBcoQi6AngerDu3FGO9fkUlwPmLVY_RTzj2hJIS4NasXWKy1td7p';

function rc4(cipherText: Uint8Array, key: string): string {
  const S = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key.charCodeAt(i % key.length)) % 256;
    [S[i], S[j]] = [S[j], S[i]];
  }

  let i = 0;
  j = 0;
  const decrypted = new Uint8Array(cipherText.length);
  for (let m = 0; m < cipherText.length; m++) {
    i = (i + 1) % 256;
    j = (j + S[i]) % 256;
    [S[i], S[j]] = [S[j], S[i]];
    const k = S[(S[i] + S[j]) % 256];
    decrypted[m] = k ^ cipherText[m];
  }
  return new TextDecoder().decode(decrypted);
}

export const videaScraper = makeEmbed({
  id: 'videa',
  name: 'Videa',
  rank: 180,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    let playerUrl = ctx.url.startsWith('//') ? `https:${ctx.url}` : ctx.url;

    // Check if we need to extract the player iframe URL from a regular video page
    if (!playerUrl.includes('/player')) {
      const pageResp = await ctx.proxiedFetcher.full<string>(playerUrl);
      const $ = load(pageResp.body);
      let iframeSrc = $('iframe[src*="player"]').attr('src');
      if (!iframeSrc) {
        const match = pageResp.body.match(/<iframe[^>]+src=["']([^"']*player[^"']*)["']/i);
        if (match) iframeSrc = match[1];
      }
      if (!iframeSrc) {
        throw new NotFoundError('Videa: Player iframe not found');
      }
      if (iframeSrc.startsWith('//')) {
        iframeSrc = `https:${iframeSrc}`;
      }
      playerUrl = new URL(iframeSrc, playerUrl).toString();
    }

    // Fetch the actual player page to extract the nonce (_xt)
    const playerResp = await ctx.proxiedFetcher.full<string>(playerUrl);
    const nonceMatch = playerResp.body.match(/_xt\s*=\s*["']([^"']+)["']/);
    if (!nonceMatch) {
      throw new NotFoundError('Videa: Nonce (_xt) not found on player page');
    }
    const nonce = nonceMatch[1];
    const l = nonce.slice(0, 32);
    const s = nonce.slice(32);

    // Calculate the 'result' string used for auth tokens using the static secret
    let result = '';
    for (let i = 0; i < 32; i++) {
      let idx = i - (STATIC_SECRET.indexOf(l[i]) - 31);
      idx %= 32;
      if (idx < 0) idx += 32;
      result += s[idx];
    }

    // Parse query parameters to find the video identifier ('f' or 'v')
    const parsedUrl = new URL(playerUrl);
    const vParam = parsedUrl.searchParams.get('v');
    const fParam = parsedUrl.searchParams.get('f');
    let paramStr = fParam ? `f=${fParam}` : `v=${vParam}`;
    if (!fParam && !vParam) {
      const pathMatch = parsedUrl.pathname.match(/\/player\/v\/([^/?#]+)/);
      if (pathMatch) paramStr = `v=${pathMatch[1]}`;
    }

    const randomSeed = generateRandomSeed();
    const tParam = result.slice(0, 16);

    // Request the XML configuration for the video
    const xmlUrl = `https://videa.hu/player/xml?platform=desktop&${paramStr}&_s=${randomSeed}&_t=${tParam}`;
    const xmlResp = await ctx.proxiedFetcher.full<string>(xmlUrl, {
      method: 'GET',
      headers: {
        Referer: playerUrl,
      },
      readHeaders: ['x-videa-xs'],
    });

    let xmlText = xmlResp.body;

    // Decrypt the XML if it doesn't start with standard XML tag
    if (!xmlText.trim().startsWith('<?xml')) {
      const xVideaXs = xmlResp.headers.get('x-videa-xs') || '';

      const rc4Key = result.slice(16) + randomSeed + xVideaXs;

      const b64Decoded = atob(xmlText.trim().replace(/\s+/g, ''));
      const cipherText = new Uint8Array(b64Decoded.length);
      for (let i = 0; i < b64Decoded.length; i++) {
        cipherText[i] = b64Decoded.charCodeAt(i);
      }
      xmlText = rc4(cipherText, rc4Key);
    }

    // Parse out video sources from the XML structure
    const sourcesMatch = Array.from(
      xmlText.matchAll(
        /<video_source[^>]*name="([^"]+)"[^>]*exp="([^"]+)"[^>]*>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/video_source>/g,
      ),
    );
    const hashesMatch = Array.from(
      xmlText.matchAll(/<hash_value_([^>]+)>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/hash_value_\1>/g),
    );

    if (!sourcesMatch.length) {
      // Check if Videa restricted direct embedding (e.g. panelstyle="noembed") and provided a canonical URL
      const canonicalMatch = xmlText.match(/<error[^>]*>(?:<!\[CDATA\[)?(https?:\/\/[^<\]]+)(?:\]\]>)?<\/error>/i);
      if (canonicalMatch && canonicalMatch[1] && canonicalMatch[1] !== playerUrl) {
        const canonicalUrl = canonicalMatch[1].trim();
        const canonicalResp = await ctx.proxiedFetcher.full<string>(canonicalUrl);
        let iframeSrc = canonicalResp.body.match(/<iframe[^>]+src=["']([^"']*player[^"']*)["']/i)?.[1];
        if (iframeSrc) {
          iframeSrc = iframeSrc.replace(/&amp;/g, '&');
          if (iframeSrc.startsWith('//')) iframeSrc = `https:${iframeSrc}`;
          const fallbackPlayerUrl = new URL(iframeSrc, canonicalUrl).toString();
          if (fallbackPlayerUrl !== playerUrl) {
            return await videaScraper.scrape({ ...ctx, url: fallbackPlayerUrl });
          }
        }
      }

      throw new NotFoundError('Videa: No video sources found in XML');
    }

    const hashes: Record<string, string> = {};
    for (const m of hashesMatch) {
      hashes[m[1]] = m[2];
    }

    const qualities: Partial<Record<Qualities, StreamFile>> = {};

    for (const source of sourcesMatch) {
      const resolution = source[1];
      const exp = source[2];
      const rawUrl = source[3];
      const hash = hashes[resolution];

      if (hash && rawUrl) {
        const normalizedUrl = rawUrl.startsWith('http') ? rawUrl : `https:${rawUrl}`;
        const finalDownloadUrl = `${normalizedUrl}?md5=${hash}&expires=${exp}`;
        const qualityKey = getValidQualityFromString(resolution);

        qualities[qualityKey] = {
          type: 'mp4',
          url: finalDownloadUrl,
        };
      }
    }

    if (Object.keys(qualities).length === 0) {
      throw new NotFoundError('Videa: Failed to map direct playback urls');
    }

    // Parse subtitles if present in XML
    const subtitlesMatch = Array.from(xmlText.matchAll(/<subtitle[^>]*src="([^"]+)"[^>]*title="([^"]+)"/g));
    const captions: Caption[] = [];
    for (const sub of subtitlesMatch) {
      const subUrl = sub[1].startsWith('http') ? sub[1] : `https:${sub[1]}`;
      const title = sub[2];
      const language = labelToLanguageCode(title) ?? 'hu';
      const captionType = getCaptionTypeFromUrl(subUrl) ?? 'srt';
      captions.push({
        id: subUrl,
        language,
        hasCorsRestrictions: false,
        type: captionType,
        url: subUrl,
      });
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
            Referer: 'https://videa.hu/',
          },
          preferredHeaders: {
            Referer: 'https://videa.hu/',
          },
        },
      ],
    };
  },
});
