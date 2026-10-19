import { flags } from '@/entrypoint/utils/targets';
import { makeEmbed } from '@/providers/base';
import { Caption } from '@/providers/captions';
import { Qualities, StreamFile } from '@/providers/streams';
import { NotFoundError } from '@/utils/errors';
import { createM3U8ProxyUrl } from '@/utils/proxy';

interface ExtractedVkData {
  files: Record<string, string>;
  subtitles?: Array<{ url?: string; lang?: string; title?: string }>;
}

function extractVkData(html: string): ExtractedVkData | null {
  // Method 1: Check apiPrefetchCache in window.cur
  const prefetchIdx = html.indexOf('"apiPrefetchCache":');
  if (prefetchIdx !== -1) {
    const arrayStart = html.indexOf('[', prefetchIdx);
    if (arrayStart !== -1) {
      let depth = 0;
      let inString = false;
      let escape = false;
      let endIdx = -1;
      for (let i = arrayStart; i < html.length; i++) {
        const c = html[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === '"' && !escape) {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (c === '[') depth++;
          else if (c === ']') {
            depth--;
            if (depth === 0) {
              endIdx = i + 1;
              break;
            }
          }
        }
      }
      if (endIdx !== -1) {
        try {
          const cache = JSON.parse(html.slice(arrayStart, endIdx));
          const videoItem = cache.find((c: any) => c.method === 'video.get')?.response?.items?.[0];
          if (videoItem?.files && typeof videoItem.files === 'object' && Object.keys(videoItem.files).length > 0) {
            return {
              files: videoItem.files,
              subtitles: Array.isArray(videoItem.subtitles) ? videoItem.subtitles : undefined,
            };
          }
        } catch {
          // Fall through
        }
      }
    }
  }

  // Method 2: Extract "files": { ... } with brace counting
  const filesIdx = html.indexOf('"files":');
  if (filesIdx !== -1) {
    const braceStart = html.indexOf('{', filesIdx);
    if (braceStart !== -1) {
      let depth = 0;
      let inString = false;
      let escape = false;
      let endIdx = -1;
      for (let i = braceStart; i < html.length; i++) {
        const c = html[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === '"' && !escape) {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) {
              endIdx = i + 1;
              break;
            }
          }
        }
      }
      if (endIdx !== -1) {
        try {
          const files = JSON.parse(html.slice(braceStart, endIdx));
          if (files && typeof files === 'object' && Object.keys(files).length > 0) {
            return { files };
          }
        } catch {
          // Fall through
        }
      }
    }
  }

  // Method 3: Regex fallback
  const match = html.match(/"files":\s*(\{.*?\})/s);
  if (match) {
    try {
      const files = JSON.parse(match[1]);
      if (files && typeof files === 'object' && Object.keys(files).length > 0) {
        return { files };
      }
    } catch {
      // Fall through
    }
  }

  return null;
}

export const vkScraper = makeEmbed({
  id: 'vk',
  name: 'VK Video',
  rank: 187,
  disabled: false,
  flags: [flags.CORS_ALLOWED],
  async scrape(ctx) {
    let targetUrl = ctx.url;
    if (targetUrl.startsWith('//')) {
      targetUrl = `https:${targetUrl}`;
    }

    // Standardize domain to vk.com
    targetUrl = targetUrl.replace('vkvideo.ru', 'vk.com');

    const streamHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Referer: 'https://vk.com/',
    };

    // Try Mozisarok Referer first, fallback to VK Referer
    const referersToTry: Record<string, string>[] = [
      {
        Referer: 'https://mozisarok.hu/',
        Origin: 'https://mozisarok.hu',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
      {
        Referer: 'https://vk.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    ];

    let extractedData: ExtractedVkData | null = null;
    let lastHtml = '';

    for (const headers of referersToTry) {
      try {
        const rawResp = await ctx.proxiedFetcher<any>(targetUrl, { headers });
        const html: string =
          typeof rawResp === 'string'
            ? rawResp
            : typeof rawResp?.body === 'string'
              ? rawResp.body
              : String(rawResp ?? '');

        if (!html || html.length < 100) continue;
        lastHtml = html;

        extractedData = extractVkData(html);
        if (extractedData) break;
      } catch {
        // Try next referer
      }
    }

    if (!extractedData) {
      if (lastHtml.includes('id="video_ext_msg"') || lastHtml.includes('light_cry_dog')) {
        throw new NotFoundError('VK: Video is restricted or private');
      }
      if (
        lastHtml.includes('Video unavailable') ||
        lastHtml.includes('This video has been removed') ||
        lastHtml.includes('Video has been deleted') ||
        lastHtml.includes('error_box')
      ) {
        throw new NotFoundError('VK: Video unavailable or removed');
      }
      throw new NotFoundError('VK: Video stream files not found');
    }

    const { files, subtitles } = extractedData;

    // Extract subtitles if present
    const captions: Caption[] = [];
    if (Array.isArray(subtitles)) {
      for (const s of subtitles) {
        if (s.url && s.lang) {
          const isSrt = s.title?.toLowerCase().endsWith('.srt') || s.url.includes('.srt');
          captions.push({
            id: s.url,
            language: String(s.lang).toLowerCase(),
            hasCorsRestrictions: false,
            type: isSrt ? 'srt' : 'vtt',
            url: s.url,
          });
        }
      }
    }

    // Fallback regex subtitle extraction if none in prefetch
    if (captions.length === 0) {
      const subMatch = lastHtml.match(/"subtitles":\s*(\[.*?\])/s);
      if (subMatch) {
        try {
          const subs = JSON.parse(subMatch[1]);
          if (Array.isArray(subs)) {
            for (const s of subs) {
              if (s.url && s.lang) {
                const isSrt = s.title?.toLowerCase().endsWith('.srt') || s.url.includes('.srt');
                captions.push({
                  id: s.url,
                  language: String(s.lang).toLowerCase(),
                  hasCorsRestrictions: false,
                  type: isSrt ? 'srt' : 'vtt',
                  url: s.url,
                });
              }
            }
          }
        } catch {
          // Ignore subtitle parse errors
        }
      }
    }

    // Prefer HLS master playlist if available
    if (files.hls) {
      const playlist = createM3U8ProxyUrl(files.hls, ctx.features, streamHeaders);
      return {
        stream: [
          {
            id: 'primary',
            type: 'hls',
            playlist,
            preferredHeaders: streamHeaders,
            headers: streamHeaders,
            flags: [flags.CORS_ALLOWED],
            captions,
          },
        ],
      };
    }

    // Fallback to direct MP4 streams with qualities
    const qualities: Partial<Record<Qualities, StreamFile>> = {};
    const qualityMap: Record<string, Qualities> = {
      mp4_2160: '4k',
      mp4_1440: '1080',
      mp4_1080: '1080',
      mp4_720: '720',
      mp4_480: '480',
      mp4_360: '360',
      mp4_240: '360',
    };

    for (const [key, q] of Object.entries(qualityMap)) {
      if (files[key] && !qualities[q]) {
        qualities[q] = {
          type: 'mp4',
          url: files[key],
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
            preferredHeaders: streamHeaders,
            flags: [flags.CORS_ALLOWED],
            captions,
          },
        ],
      };
    }

    throw new NotFoundError('VK: No playable video streams found');
  },
});
