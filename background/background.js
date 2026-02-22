/**
 * background.js
 *
 * content scriptからのメッセージを受け取り、downloads APIを実行する。
 * webRequest APIでm3u8リクエストを監視し、URLをキャッシュしてcontent scriptに提供する。
 */

'use strict';

// ─── m3u8 URLキャッシュ (タブID → URL) ───────────────────────────────────────
// webRequest で最初に検出したマスタープレイリストURLを保持する。
// content scriptが polling で問い合わせた際に返せるようにする。
const detectedM3U8 = new Map();

// ─── メッセージハンドラ ────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // MP4ダウンロード
  if (message.type === 'DOWNLOAD_MP4') {
    if (!message.blobUrl) {
      sendResponse({ ok: false, error: 'blobUrl が指定されていません' });
      return;
    }
    browser.downloads.download({
      url: message.blobUrl,
      filename: message.filename,
      saveAs: true,
    });
    sendResponse({ ok: true });
    return;
  }

  // content scriptからのポーリング: キャッシュしたm3u8 URLを返す
  if (message.type === 'GET_M3U8_URL') {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const url = tabId != null ? (detectedM3U8.get(tabId) || null) : null;
    sendResponse({ url });
    return;
  }
});

// ─── webRequest でm3u8を検出してキャッシュ ───────────────────────────────────
// fetch/XHRフックがCSPでブロックされた場合のバックアップとして機能する。
// delivery.domand.nicovideo.jp へのm3u8リクエストが完了したら:
//   1. URLをキャッシュ (content scriptがポーリングで取得)
//   2. content scriptにも直接通知 (タイミングが合えば即時反応)

browser.webRequest.onCompleted.addListener(
  (details) => {
    if (details.statusCode !== 200) return;
    if (!details.url.includes('.m3u8')) return;
    // 同一タブには最初の1件のみ (マスタープレイリストは最初に取得される)
    if (detectedM3U8.has(details.tabId)) return;

    detectedM3U8.set(details.tabId, details.url);

    // 直接通知も試みる (タイミングが合えば即座に反応)
    browser.tabs.sendMessage(details.tabId, {
      type: 'M3U8_DETECTED',
      url: details.url,
    }).catch(() => {
      // content scriptがまだ準備できていない場合はポーリングで回収される
    });
  },
  { urls: ['*://delivery.domand.nicovideo.jp/*'] }
);

// ─── タブが閉じたらキャッシュをクリア ────────────────────────────────────────

browser.tabs.onRemoved.addListener((tabId) => {
  detectedM3U8.delete(tabId);
});

// ─── テスト用エクスポート ────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _detectedM3U8: detectedM3U8 };
}
