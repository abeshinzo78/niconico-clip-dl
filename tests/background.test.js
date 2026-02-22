/**
 * background.js のテスト (TDD)
 *
 * browser.runtime.onMessage のハンドラと
 * browser.downloads.download の呼び出しをテストする。
 * webRequest によるm3u8検出もテストする。
 */

// background.js を読み込む (リスナーが登録される)
// ※ require はモジュールキャッシュされるため、beforeEach より先に1度だけ実行される
const bg = require('../background/background.js');

beforeEach(() => {
  browser.downloads.download.mockClear();
  browser.tabs.sendMessage.mockClear();
  // テスト間でm3u8キャッシュをリセット
  bg._detectedM3U8.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('background.js: DOWNLOAD_MP4 メッセージハンドラ', () => {
  test('DOWNLOAD_MP4 メッセージを受け取ると downloads.download を呼ぶ', () => {
    browser.runtime.onMessage._fire({
      type: 'DOWNLOAD_MP4',
      blobUrl: 'blob:mock-url',
      filename: 'ニコニコ_sm9_01m30s-03m45s.mp4',
    });

    expect(browser.downloads.download).toHaveBeenCalledTimes(1);
    expect(browser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'blob:mock-url',
        filename: 'ニコニコ_sm9_01m30s-03m45s.mp4',
        saveAs: true,
      })
    );
  });

  test('DOWNLOAD_MP4 以外のメッセージでは downloads.download を呼ばない', () => {
    browser.runtime.onMessage._fire({
      type: 'SOMETHING_ELSE',
      data: 'foo',
    });

    expect(browser.downloads.download).not.toHaveBeenCalled();
  });

  test('sendResponse に { ok: true } を返す', () => {
    const response = browser.runtime.onMessage._fire({
      type: 'DOWNLOAD_MP4',
      blobUrl: 'blob:test',
      filename: 'test.mp4',
    });

    expect(response).toEqual({ ok: true });
  });

  test('blobUrl がない場合は downloads.download を呼ばない', () => {
    browser.runtime.onMessage._fire({
      type: 'DOWNLOAD_MP4',
      filename: 'test.mp4',
      // blobUrl なし
    });

    expect(browser.downloads.download).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('background.js: webRequest m3u8検出', () => {
  const M3U8_URL = 'https://delivery.domand.nicovideo.jp/hlsbid/abc/playlists/variants/def.m3u8?Policy=x&Signature=y';

  test('.m3u8 URLを検出してcontent scriptにM3U8_DETECTEDを送信する', () => {
    browser.webRequest.onCompleted._fire({
      url: M3U8_URL,
      statusCode: 200,
      tabId: 10,
    });

    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(10, {
      type: 'M3U8_DETECTED',
      url: M3U8_URL,
    });
  });

  test('.m3u8 を含まないURLは無視する', () => {
    browser.webRequest.onCompleted._fire({
      url: 'https://delivery.domand.nicovideo.jp/hlsbid/abc/01.cmfv',
      statusCode: 200,
      tabId: 10,
    });

    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test('200以外のステータスコードは無視する', () => {
    browser.webRequest.onCompleted._fire({
      url: M3U8_URL,
      statusCode: 403,
      tabId: 10,
    });

    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  test('同一タブへの2回目のm3u8は送信しない (最初のみ)', () => {
    browser.webRequest.onCompleted._fire({ url: M3U8_URL, statusCode: 200, tabId: 20 });
    browser.webRequest.onCompleted._fire({ url: M3U8_URL + '2', statusCode: 200, tabId: 20 });

    expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(1);
  });

  test('異なるタブには別々に送信する', () => {
    browser.webRequest.onCompleted._fire({ url: M3U8_URL, statusCode: 200, tabId: 30 });
    browser.webRequest.onCompleted._fire({ url: M3U8_URL, statusCode: 200, tabId: 31 });

    expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });

  test('検出したURLをキャッシュに保存する', () => {
    browser.webRequest.onCompleted._fire({ url: M3U8_URL, statusCode: 200, tabId: 40 });

    expect(bg._detectedM3U8.get(40)).toBe(M3U8_URL);
  });

  test('タブが閉じるとキャッシュがクリアされる', () => {
    browser.webRequest.onCompleted._fire({ url: M3U8_URL, statusCode: 200, tabId: 50 });
    expect(bg._detectedM3U8.has(50)).toBe(true);

    browser.tabs.onRemoved._fire(50);
    expect(bg._detectedM3U8.has(50)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('background.js: GET_M3U8_URL メッセージハンドラ', () => {
  const M3U8_URL = 'https://delivery.domand.nicovideo.jp/hlsbid/abc/playlists/variants/def.m3u8?x=1';

  test('キャッシュされたURLを返す', () => {
    // まずwebRequestでURLをキャッシュ
    browser.webRequest.onCompleted._fire({ url: M3U8_URL, statusCode: 200, tabId: 60 });

    const response = browser.runtime.onMessage._fire(
      { type: 'GET_M3U8_URL' },
      { tab: { id: 60 } }
    );

    expect(response).toEqual({ url: M3U8_URL });
  });

  test('URLがキャッシュされていない場合は { url: null } を返す', () => {
    const response = browser.runtime.onMessage._fire(
      { type: 'GET_M3U8_URL' },
      { tab: { id: 999 } }
    );

    expect(response).toEqual({ url: null });
  });

  test('sender.tab がない場合は { url: null } を返す', () => {
    const response = browser.runtime.onMessage._fire(
      { type: 'GET_M3U8_URL' },
      {}  // tab なし
    );

    expect(response).toEqual({ url: null });
  });
});
