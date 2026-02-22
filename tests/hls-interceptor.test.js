/**
 * hls-interceptor.js のテスト (TDD)
 *
 * injectScriptパターンはDOM注入を使うため、
 * postMessage 経由のデータ受け渡しロジックをテストする。
 */

// hls-interceptorはDOM注入のため、テストではメッセージ処理関数を直接テストする
const {
  extractHLSData,
  buildGlobalState,
  isHLSEndpoint,
} = require('../content/hls-interceptor');

describe('isHLSEndpoint', () => {
  test('access-rights/hls を含むURLを検出する', () => {
    expect(
      isHLSEndpoint(
        'https://nvapi.nicovideo.jp/v1/watch/sm9/access-rights/hls'
      )
    ).toBe(true);
  });

  test('access-rights/hls を含まないURLは false', () => {
    expect(
      isHLSEndpoint('https://nvapi.nicovideo.jp/v1/watch/sm9/something-else')
    ).toBe(false);
  });

  test('空文字列は false', () => {
    expect(isHLSEndpoint('')).toBe(false);
  });
});

describe('extractHLSData', () => {
  const validResponse = {
    meta: { status: 201 },
    data: {
      contentUrl:
        'https://delivery.domand.nicovideo.jp/hlsbid/abc123/variants/xxxx.m3u8?session=1',
      createTime: '2026-01-15T20:10:50+09:00',
      expireTime: '2026-01-16T20:10:50+09:00',
    },
  };

  test('contentUrl を正しく抽出する', () => {
    const result = extractHLSData(validResponse, 'jwt-token-abc');
    expect(result.contentUrl).toBe(validResponse.data.contentUrl);
  });

  test('accessRightKey (JWT) を保持する', () => {
    const result = extractHLSData(validResponse, 'jwt-token-abc');
    expect(result.accessRightKey).toBe('jwt-token-abc');
  });

  test('expireTime を保持する', () => {
    const result = extractHLSData(validResponse, 'jwt-token-abc');
    expect(result.expireTime).toBe('2026-01-16T20:10:50+09:00');
  });

  test('data フィールドがない場合は null を返す', () => {
    const result = extractHLSData({ meta: { status: 400 } }, '');
    expect(result).toBeNull();
  });

  test('contentUrl がない場合は null を返す', () => {
    const result = extractHLSData({ data: {} }, '');
    expect(result).toBeNull();
  });
});

describe('buildGlobalState', () => {
  test('__nicoClipDL の初期構造を返す', () => {
    const state = buildGlobalState();
    expect(state).toHaveProperty('contentUrl', null);
    expect(state).toHaveProperty('accessRightKey', null);
    expect(state).toHaveProperty('expireTime', null);
    expect(state).toHaveProperty('hlsTimeline', null);
  });

  test('extractHLSData の結果で更新できる', () => {
    const state = buildGlobalState();
    const data = {
      contentUrl: 'https://example.com/master.m3u8',
      accessRightKey: 'jwt-abc',
      expireTime: '2026-01-16T20:10:50+09:00',
    };
    Object.assign(state, data);
    expect(state.contentUrl).toBe('https://example.com/master.m3u8');
    expect(state.accessRightKey).toBe('jwt-abc');
  });
});
