/**
 * hls-parser.js
 * M3U8テキストを解析してタイムライン配列を生成する
 *
 * 入力: M3U8テキスト文字列、ベースURL
 * 出力: { initUrl, keyUrl, iv, segments[] }
 */

'use strict';

/**
 * 相対URLを絶対URLに変換する
 * @param {string} url - 変換対象URL (絶対または相対)
 * @param {string} baseUrl - ベースURL
 * @returns {string} 絶対URL
 */
function resolveUrl(url, baseUrl) {
  if (!url) return url;
  // すでに絶対URLならそのまま返す
  if (/^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

/**
 * HLS EXT-X-KEY タグからIVを Uint8Array として抽出する
 * 例: IV=0x00000000000000000000000000000001
 * @param {string} ivHex - 16進数文字列 (0x... または ...)
 * @returns {Uint8Array|null}
 */
function parseIV(ivHex) {
  if (!ivHex) return null;
  // 0x プレフィックスを除去
  const hex = ivHex.replace(/^0x/i, '').padStart(32, '0');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * EXT-X-KEY タグから属性を抽出する
 * 例: METHOD=AES-128,URI="...",IV=0x...
 * @param {string} tagValue - EXT-X-KEY: の後ろの文字列
 * @returns {{ uri: string|null, iv: string|null }}
 */
function parseKeyTag(tagValue) {
  const uriMatch = tagValue.match(/URI="([^"]+)"/);
  const ivMatch = tagValue.match(/IV=(0x[0-9a-fA-F]+)/i);
  return {
    uri: uriMatch ? uriMatch[1] : null,
    iv: ivMatch ? ivMatch[1] : null,
  };
}

/**
 * EXT-X-MAP タグからURIを抽出する
 * 例: URI="https://..."
 * @param {string} tagValue
 * @returns {string|null}
 */
function parseMapTag(tagValue) {
  const match = tagValue.match(/URI="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * M3U8テキストを解析してタイムライン情報を返す
 *
 * @param {string} m3u8Text - M3U8テキスト
 * @param {string} baseUrl  - 相対URL解決のためのベースURL
 * @returns {{
 *   initUrl: string|null,
 *   keyUrl: string|null,
 *   iv: Uint8Array|null,
 *   segments: Array<{index: number, url: string, startMs: number, durationMs: number}>
 * }}
 */
function parseM3U8(m3u8Text, baseUrl) {
  const result = {
    initUrl: null,
    keyUrl: null,
    iv: null,
    segments: [],
  };

  if (!m3u8Text) return result;

  const lines = m3u8Text.split('\n').map((l) => l.trim()).filter(Boolean);
  let pendingDuration = null;
  let segmentIndex = 1;
  let accumulatedMs = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // EXT-X-KEY
    if (line.startsWith('#EXT-X-KEY:')) {
      const tagValue = line.slice('#EXT-X-KEY:'.length);
      const { uri, iv } = parseKeyTag(tagValue);
      if (uri) result.keyUrl = resolveUrl(uri, baseUrl);
      result.iv = parseIV(iv);
      continue;
    }

    // EXT-X-MAP
    if (line.startsWith('#EXT-X-MAP:')) {
      const tagValue = line.slice('#EXT-X-MAP:'.length);
      const uri = parseMapTag(tagValue);
      if (uri) result.initUrl = resolveUrl(uri, baseUrl);
      continue;
    }

    // EXTINF
    if (line.startsWith('#EXTINF:')) {
      // #EXTINF:6.006, または #EXTINF:6.006
      const durationStr = line.slice('#EXTINF:'.length).split(',')[0];
      pendingDuration = parseFloat(durationStr);
      continue;
    }

    // セグメントURL (コメント行・タグ行以外)
    if (!line.startsWith('#') && pendingDuration !== null) {
      const url = resolveUrl(line, baseUrl);
      const durationMs = Math.round(pendingDuration * 1000);

      result.segments.push({
        index: segmentIndex,
        url,
        startMs: accumulatedMs,
        durationMs,
      });

      accumulatedMs += durationMs;
      segmentIndex++;
      pendingDuration = null;
    }
  }

  return result;
}

// CommonJS エクスポート (テスト用)
// ブラウザ環境では window.HLSParser として公開する
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseM3U8, resolveUrl, parseIV };
} else {
  window.HLSParser = { parseM3U8, resolveUrl, parseIV };
}
