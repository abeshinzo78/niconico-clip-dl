/**
 * hls-parser.js のテスト (TDD)
 *
 * Red → Green → Refactor サイクルで実装する。
 * テストが通るまで lib/hls-parser.js を実装しないこと。
 */

const { parseM3U8 } = require('../lib/hls-parser');

// ─── テスト用M3U8フィクスチャ ───────────────────────────────────────────

const BASE_URL = 'https://delivery.domand.nicovideo.jp/hlsbid/abc123/playlists/media/';

const M3U8_WITH_KEY_AND_IV = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:7
#EXT-X-KEY:METHOD=AES-128,URI="https://delivery.domand.nicovideo.jp/hlsbid/abc123/keys/video-h264-360p-lowest.key",IV=0x00000000000000000000000000000001
#EXT-X-MAP:URI="https://asset.domand.nicovideo.jp/abc123/video/001/video-h264-360p-lowest/init01.cmfv"
#EXTINF:6.006,
https://asset.domand.nicovideo.jp/abc123/video/001/video-h264-360p-lowest/01.cmfv
#EXTINF:6.006,
https://asset.domand.nicovideo.jp/abc123/video/001/video-h264-360p-lowest/02.cmfv
#EXTINF:3.003,
https://asset.domand.nicovideo.jp/abc123/video/001/video-h264-360p-lowest/03.cmfv
#EXT-X-ENDLIST`;

const M3U8_WITHOUT_IV = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-KEY:METHOD=AES-128,URI="https://delivery.domand.nicovideo.jp/hlsbid/abc123/keys/video-h264-360p-lowest.key"
#EXT-X-MAP:URI="https://asset.domand.nicovideo.jp/abc123/video/001/video-h264-360p-lowest/init01.cmfv"
#EXTINF:6.006,
https://asset.domand.nicovideo.jp/abc123/video/001/video-h264-360p-lowest/01.cmfv
#EXT-X-ENDLIST`;

const M3U8_WITH_RELATIVE_URLS = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-KEY:METHOD=AES-128,URI="../keys/video-h264-360p-lowest.key"
#EXT-X-MAP:URI="init01.cmfv"
#EXTINF:6.006,
01.cmfv
#EXT-X-ENDLIST`;

const M3U8_AUDIO = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-KEY:METHOD=AES-128,URI="https://delivery.domand.nicovideo.jp/hlsbid/abc123/keys/audio-aac-128kbps.key",IV=0x00000000000000000000000000000001
#EXT-X-MAP:URI="https://asset.domand.nicovideo.jp/abc123/audio/001/audio-aac-128kbps/init01.cmfa"
#EXTINF:6.006,
https://asset.domand.nicovideo.jp/abc123/audio/001/audio-aac-128kbps/01.cmfa
#EXTINF:6.006,
https://asset.domand.nicovideo.jp/abc123/audio/001/audio-aac-128kbps/02.cmfa
#EXT-X-ENDLIST`;

// ─── テスト群 ──────────────────────────────────────────────────────────────

describe('parseM3U8', () => {
  // ── keyUrl の抽出 ──────────────────────────────────────────────────────
  describe('EXT-X-KEY タグの解析', () => {
    test('keyUrl を正しく抽出できる', () => {
      const result = parseM3U8(M3U8_WITH_KEY_AND_IV, BASE_URL);
      expect(result.keyUrl).toBe(
        'https://delivery.domand.nicovideo.jp/hlsbid/abc123/keys/video-h264-360p-lowest.key'
      );
    });

    test('IV (0x...) を Uint8Array として抽出できる', () => {
      const result = parseM3U8(M3U8_WITH_KEY_AND_IV, BASE_URL);
      expect(result.iv).toBeInstanceOf(Uint8Array);
      expect(result.iv.length).toBe(16);
      // IV = 0x00000000000000000000000000000001 → 最後の1バイトが 0x01
      expect(result.iv[15]).toBe(1);
      expect(result.iv[0]).toBe(0);
    });

    test('IV がない場合は null を返す', () => {
      const result = parseM3U8(M3U8_WITHOUT_IV, BASE_URL);
      expect(result.iv).toBeNull();
    });
  });

  // ── initUrl の抽出 ─────────────────────────────────────────────────────
  describe('EXT-X-MAP タグの解析', () => {
    test('initUrl を正しく抽出できる', () => {
      const result = parseM3U8(M3U8_WITH_KEY_AND_IV, BASE_URL);
      expect(result.initUrl).toBe(
        'https://asset.domand.nicovideo.jp/abc123/video/001/video-h264-360p-lowest/init01.cmfv'
      );
    });
  });

  // ── セグメントリストの抽出 ─────────────────────────────────────────────
  describe('EXTINF タグとセグメントURLの解析', () => {
    test('セグメント数が正しい', () => {
      const result = parseM3U8(M3U8_WITH_KEY_AND_IV, BASE_URL);
      expect(result.segments.length).toBe(3);
    });

    test('各セグメントに index, url, startMs, durationMs が含まれる', () => {
      const result = parseM3U8(M3U8_WITH_KEY_AND_IV, BASE_URL);
      const seg = result.segments[0];
      expect(seg).toHaveProperty('index');
      expect(seg).toHaveProperty('url');
      expect(seg).toHaveProperty('startMs');
      expect(seg).toHaveProperty('durationMs');
    });

    test('1番目のセグメントの index は 1 から始まる', () => {
      const result = parseM3U8(M3U8_WITH_KEY_AND_IV, BASE_URL);
      expect(result.segments[0].index).toBe(1);
    });

    test('1番目のセグメントの startMs は 0', () => {
      const result = parseM3U8(M3U8_WITH_KEY_AND_IV, BASE_URL);
      expect(result.segments[0].startMs).toBe(0);
    });

    test('durationMs が秒数×1000 に近い値になる', () => {
      const result = parseM3U8(M3U8_WITH_KEY_AND_IV, BASE_URL);
      // 6.006秒 → 6006ms
      expect(result.segments[0].durationMs).toBeCloseTo(6006, 0);
    });

    test('2番目のセグメントの startMs = 1番目の durationMs', () => {
      const result = parseM3U8(M3U8_WITH_KEY_AND_IV, BASE_URL);
      expect(result.segments[1].startMs).toBeCloseTo(
        result.segments[0].durationMs,
        0
      );
    });

    test('3番目のセグメントの durationMs は 3003ms', () => {
      const result = parseM3U8(M3U8_WITH_KEY_AND_IV, BASE_URL);
      expect(result.segments[2].durationMs).toBeCloseTo(3003, 0);
    });

    test('セグメントURLが絶対URLになっている', () => {
      const result = parseM3U8(M3U8_WITH_KEY_AND_IV, BASE_URL);
      expect(result.segments[0].url).toMatch(/^https:\/\//);
    });
  });

  // ── 相対URL解決 ────────────────────────────────────────────────────────
  describe('相対URLの絶対URL変換', () => {
    test('セグメントの相対URLを絶対URLに変換する', () => {
      const result = parseM3U8(M3U8_WITH_RELATIVE_URLS, BASE_URL);
      expect(result.segments[0].url).toMatch(/^https:\/\//);
    });

    test('initUrl の相対URLを絶対URLに変換する', () => {
      const result = parseM3U8(M3U8_WITH_RELATIVE_URLS, BASE_URL);
      expect(result.initUrl).toMatch(/^https:\/\//);
    });

    test('keyUrl の相対URLを絶対URLに変換する', () => {
      const result = parseM3U8(M3U8_WITH_RELATIVE_URLS, BASE_URL);
      expect(result.keyUrl).toMatch(/^https:\/\//);
    });
  });

  // ── 音声M3U8のテスト ────────────────────────────────────────────────────
  describe('音声 M3U8 の解析', () => {
    test('音声セグメント数が正しい', () => {
      const result = parseM3U8(M3U8_AUDIO, BASE_URL);
      expect(result.segments.length).toBe(2);
    });

    test('音声 initUrl が .cmfa で終わる', () => {
      const result = parseM3U8(M3U8_AUDIO, BASE_URL);
      expect(result.initUrl).toMatch(/\.cmfa$/);
    });
  });

  // ── エラー処理 ──────────────────────────────────────────────────────────
  describe('エラー処理', () => {
    test('空文字列を渡すと空のセグメント配列を返す', () => {
      const result = parseM3U8('', BASE_URL);
      expect(result.segments).toEqual([]);
    });

    test('EXTM3U ヘッダーなしでも解析できる', () => {
      const m3u8 = '#EXTINF:6.0,\nhttps://example.com/01.cmfv\n';
      const result = parseM3U8(m3u8, 'https://example.com/');
      expect(result.segments.length).toBe(1);
    });
  });
});
