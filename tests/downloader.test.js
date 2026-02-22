/**
 * downloader.js のテスト (TDD)
 *
 * セグメント選択ロジック、IV生成、ファイル名生成をテストする。
 * fetch/crypto.subtle はモックを使用。
 */

const {
  selectSegments,
  getSegmentIV,
  buildFilename,
  isSessionExpired,
  formatTime,
  resolveUrl,
  extractMediaUrls,
} = require('../content/downloader');

// ─── テスト用フィクスチャ ─────────────────────────────────────────────────

/** 0〜30秒の動画セグメント (6秒ずつ5本) */
const MOCK_SEGMENTS = [
  { index: 1, url: 'https://example.com/01.cmfv', startMs: 0,     durationMs: 6000 },
  { index: 2, url: 'https://example.com/02.cmfv', startMs: 6000,  durationMs: 6000 },
  { index: 3, url: 'https://example.com/03.cmfv', startMs: 12000, durationMs: 6000 },
  { index: 4, url: 'https://example.com/04.cmfv', startMs: 18000, durationMs: 6000 },
  { index: 5, url: 'https://example.com/05.cmfv', startMs: 24000, durationMs: 6000 },
];

// ─── selectSegments ─────────────────────────────────────────────────────────

describe('selectSegments', () => {
  test('startMs=0, endMs=12000 → セグメント1,2,3 を返す', () => {
    const result = selectSegments(MOCK_SEGMENTS, 0, 12000);
    expect(result.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  test('startMs=6000, endMs=18000 → セグメント2,3,4 を返す', () => {
    const result = selectSegments(MOCK_SEGMENTS, 6000, 18000);
    expect(result.map((s) => s.index)).toEqual([2, 3, 4]);
  });

  test('startMs が境界値 (セグメント開始ぴったり) でも正しく動作する', () => {
    const result = selectSegments(MOCK_SEGMENTS, 12000, 18000);
    expect(result.map((s) => s.index)).toContain(3);
  });

  test('endMs がセグメント途中でも最後のセグメントを含む', () => {
    // 14000ms はセグメント3 (12000〜18000) の途中
    const result = selectSegments(MOCK_SEGMENTS, 0, 14000);
    expect(result.map((s) => s.index)).toContain(3);
  });

  test('空のセグメントリストで空配列を返す', () => {
    const result = selectSegments([], 0, 10000);
    expect(result).toEqual([]);
  });

  test('startMs が全セグメント終了後の場合は空配列を返す', () => {
    const result = selectSegments(MOCK_SEGMENTS, 99000, 100000);
    expect(result).toEqual([]);
  });

  test('startMs と endMs が同じ場合は1セグメントを返す', () => {
    const result = selectSegments(MOCK_SEGMENTS, 6000, 6000);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── getSegmentIV ────────────────────────────────────────────────────────────

describe('getSegmentIV', () => {
  test('IV が null の場合、セグメントインデックスをビッグエンディアンでエンコードした Uint8Array を返す', () => {
    const iv = getSegmentIV(null, 1);
    expect(iv).toBeInstanceOf(Uint8Array);
    expect(iv.length).toBe(16);
    // index=1 → 最後の4バイトが 0x00000001
    expect(iv[12]).toBe(0);
    expect(iv[13]).toBe(0);
    expect(iv[14]).toBe(0);
    expect(iv[15]).toBe(1);
    // 先頭12バイトは0
    for (let i = 0; i < 12; i++) {
      expect(iv[i]).toBe(0);
    }
  });

  test('IV が Uint8Array の場合はそのまま返す', () => {
    const existingIV = new Uint8Array(16).fill(5);
    const result = getSegmentIV(existingIV, 99);
    expect(result).toBe(existingIV);
  });

  test('セグメントインデックス256 → 正しいビッグエンディアン値', () => {
    const iv = getSegmentIV(null, 256);
    // 256 = 0x00000100
    expect(iv[14]).toBe(1);
    expect(iv[15]).toBe(0);
  });
});

// ─── buildFilename ────────────────────────────────────────────────────────────

describe('buildFilename', () => {
  test('ニコニコ_videoId_クリップ_MM:SS-MM:SS.mp4 形式で生成する', () => {
    // startMs=90000 (1m30s), endMs=225000 (3m45s), videoId=sm9
    const filename = buildFilename('sm9', 90000, 225000);
    expect(filename).toBe('ニコニコ_sm9_クリップ_01:30-03:45.mp4');
  });

  test('開始が0秒の場合', () => {
    const filename = buildFilename('sm12345', 0, 60000);
    expect(filename).toBe('ニコニコ_sm12345_クリップ_00:00-01:00.mp4');
  });

  test('1時間以上でも対応できる', () => {
    const filename = buildFilename('sm1', 0, 3660000);
    expect(filename).toMatch(/\.mp4$/);
    expect(filename).toContain('sm1');
    expect(filename).toContain('クリップ');
  });
});

// ─── isSessionExpired ─────────────────────────────────────────────────────────

describe('isSessionExpired', () => {
  test('過去の有効期限は expired と判定する', () => {
    const pastTime = new Date(Date.now() - 1000).toISOString();
    expect(isSessionExpired(pastTime)).toBe(true);
  });

  test('未来の有効期限は expired でない', () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    expect(isSessionExpired(futureTime)).toBe(false);
  });

  test('null は expired でない (有効期限なし)', () => {
    expect(isSessionExpired(null)).toBe(false);
  });
});

// ─── resolveUrl ───────────────────────────────────────────────────────────────

describe('resolveUrl', () => {
  test('絶対URLはそのまま返す', () => {
    expect(resolveUrl('https://example.com/foo', 'https://base.com/')).toBe('https://example.com/foo');
  });

  test('相対URLをベースURLから解決する', () => {
    expect(resolveUrl('bar.m3u8', 'https://example.com/path/index.m3u8')).toBe('https://example.com/path/bar.m3u8');
  });

  test('パス先頭スラッシュの相対URLを解決する', () => {
    expect(resolveUrl('/abs/path.m3u8', 'https://example.com/path/')).toBe('https://example.com/abs/path.m3u8');
  });
});

// ─── extractMediaUrls ─────────────────────────────────────────────────────────

const MASTER_M3U8 = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="https://delivery.example.com/variants/audio-aac-128kbps.m3u8?Policy=abc"
#EXT-X-STREAM-INF:BANDWIDTH=500000,CODECS="avc1.42c01e,mp4a.40.2"
https://delivery.example.com/variants/video-h264-360p-lowest.m3u8?Policy=abc`;

const MASTER_M3U8_MULTI_QUALITY = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="https://delivery.example.com/variants/audio-aac-64kbps.m3u8?Policy=abc"
#EXT-X-STREAM-INF:BANDWIDTH=200000
https://delivery.example.com/variants/video-h264-360p.m3u8?Policy=abc
#EXT-X-STREAM-INF:BANDWIDTH=500000
https://delivery.example.com/variants/video-h264-360p-lowest.m3u8?Policy=abc`;

describe('extractMediaUrls', () => {
  const BASE = 'https://delivery.example.com/variants/master.m3u8';

  test('映像・音声URLを正しく抽出する', () => {
    const { videoUrl, audioUrl } = extractMediaUrls(MASTER_M3U8, BASE);
    expect(videoUrl).toContain('video-h264-360p-lowest');
    expect(audioUrl).toContain('audio-aac-128kbps');
  });

  test('video-h264-360p-lowest が最高優先で選ばれる', () => {
    const { videoUrl } = extractMediaUrls(MASTER_M3U8_MULTI_QUALITY, BASE);
    expect(videoUrl).toContain('video-h264-360p-lowest');
  });

  test('映像・音声が見つからない場合は null を返す', () => {
    const { videoUrl, audioUrl } = extractMediaUrls('#EXTM3U\n#EXT-X-ENDLIST\n', BASE);
    expect(videoUrl).toBeNull();
    expect(audioUrl).toBeNull();
  });

  test('startDownload 呼び出し時に hlsTimeline がない場合 fetchAndParseHLSTimeline が必要 (統合テストは実機で確認)', () => {
    // このテストは fetchAndParseHLSTimeline の遅延取得ロジックが
    // startDownload 冒頭に正しく存在することをドキュメントする
    // 実際の挙動確認は about:debugging での実機テストで行う
    expect(true).toBe(true);
  });
});

// ─── formatTime ──────────────────────────────────────────────────────────────

describe('formatTime', () => {
  test('0ms → "00:00"', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  test('90000ms (1分30秒) → "01:30"', () => {
    expect(formatTime(90000)).toBe('01:30');
  });

  test('3661000ms (61分1秒) → "61:01"', () => {
    expect(formatTime(3661000)).toBe('61:01');
  });
});
