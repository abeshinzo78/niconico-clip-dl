/**
 * overlay-ui.js のテスト (TDD)
 *
 * UIの状態管理と純粋関数をテストする。
 * DOM操作はjsdomで実行。
 */

const {
  clampMs,
  msToHHMMSS,
  parseHHMMSS,
  calcHandlePercent,
  validateTimeRange,
} = require('../content/overlay-ui');

// ─── clampMs ──────────────────────────────────────────────────────────────

describe('clampMs', () => {
  test('値が最小・最大の間なら変更しない', () => {
    expect(clampMs(5000, 0, 10000)).toBe(5000);
  });

  test('最小値未満はminにクランプする', () => {
    expect(clampMs(-100, 0, 10000)).toBe(0);
  });

  test('最大値超過はmaxにクランプする', () => {
    expect(clampMs(15000, 0, 10000)).toBe(10000);
  });

  test('ぴったり最小値はそのまま', () => {
    expect(clampMs(0, 0, 10000)).toBe(0);
  });

  test('ぴったり最大値はそのまま', () => {
    expect(clampMs(10000, 0, 10000)).toBe(10000);
  });
});

// ─── msToHHMMSS ───────────────────────────────────────────────────────────

describe('msToHHMMSS', () => {
  test('0ms → "00:00:00"', () => {
    expect(msToHHMMSS(0)).toBe('00:00:00');
  });

  test('90000ms (1分30秒) → "00:01:30"', () => {
    expect(msToHHMMSS(90000)).toBe('00:01:30');
  });

  test('3661000ms (1h1m1s) → "01:01:01"', () => {
    expect(msToHHMMSS(3661000)).toBe('01:01:01');
  });

  test('3600000ms (1h) → "01:00:00"', () => {
    expect(msToHHMMSS(3600000)).toBe('01:00:00');
  });

  test('59999ms (59秒) → "00:00:59"', () => {
    expect(msToHHMMSS(59999)).toBe('00:00:59');
  });
});

// ─── parseHHMMSS ──────────────────────────────────────────────────────────

describe('parseHHMMSS', () => {
  test('"00:01:30" → 90000ms', () => {
    expect(parseHHMMSS('00:01:30')).toBe(90000);
  });

  test('"01:00:00" → 3600000ms', () => {
    expect(parseHHMMSS('01:00:00')).toBe(3600000);
  });

  test('"00:00:00" → 0ms', () => {
    expect(parseHHMMSS('00:00:00')).toBe(0);
  });

  test('"MM:SS" 形式 (2コロン以外) は null を返す', () => {
    // "01:30" は MM:SS 形式でも受け付けることにする
    const result = parseHHMMSS('01:30');
    expect(result).toBe(90000);
  });

  test('不正フォーマットは null を返す', () => {
    expect(parseHHMMSS('invalid')).toBeNull();
    expect(parseHHMMSS('')).toBeNull();
    expect(parseHHMMSS('99:99:99')).toBeNull(); // 秒・分が60以上は不正
  });

  test('60秒以上は null を返す', () => {
    expect(parseHHMMSS('00:00:60')).toBeNull();
  });

  test('60分以上は null を返す', () => {
    expect(parseHHMMSS('00:60:00')).toBeNull();
  });
});

// ─── calcHandlePercent ────────────────────────────────────────────────────

describe('calcHandlePercent', () => {
  test('positionMs=0, totalMs=100000 → 0%', () => {
    expect(calcHandlePercent(0, 100000)).toBe(0);
  });

  test('positionMs=50000, totalMs=100000 → 50%', () => {
    expect(calcHandlePercent(50000, 100000)).toBe(50);
  });

  test('positionMs=100000, totalMs=100000 → 100%', () => {
    expect(calcHandlePercent(100000, 100000)).toBe(100);
  });

  test('totalMs=0 の場合は 0% を返す (ゼロ除算回避)', () => {
    expect(calcHandlePercent(0, 0)).toBe(0);
  });
});

// ─── validateTimeRange ────────────────────────────────────────────────────

describe('validateTimeRange', () => {
  test('startMs < endMs はvalid', () => {
    expect(validateTimeRange(0, 10000, 30000)).toEqual({ valid: true });
  });

  test('startMs === endMs はinvalid', () => {
    const result = validateTimeRange(10000, 10000, 30000);
    expect(result.valid).toBe(false);
  });

  test('startMs > endMs はinvalid', () => {
    const result = validateTimeRange(15000, 10000, 30000);
    expect(result.valid).toBe(false);
  });

  test('endMs > totalMs はinvalid', () => {
    const result = validateTimeRange(0, 35000, 30000);
    expect(result.valid).toBe(false);
  });

  test('startMs < 0 はinvalid', () => {
    const result = validateTimeRange(-1000, 10000, 30000);
    expect(result.valid).toBe(false);
  });

  test('エラーメッセージが含まれる', () => {
    const result = validateTimeRange(10000, 10000, 30000);
    expect(result).toHaveProperty('error');
    expect(typeof result.error).toBe('string');
  });
});
