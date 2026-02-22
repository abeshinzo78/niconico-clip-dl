/**
 * background.js (Chrome MV3 Service Worker)
 *
 * content scriptからのメッセージを受け取り、webRequestでm3u8を監視する。
 * chrome.* API を使用 (browser.* は使用しない)
 */

'use strict';

// ─── m3u8 URLキャッシュ (タブID → URL) ───────────────────────────────────────
const detectedM3U8 = new Map();

// ─── メッセージハンドラ ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // content scriptからのポーリング: キャッシュしたm3u8 URLを返す
  if (message.type === 'GET_M3U8_URL') {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const url = tabId != null ? (detectedM3U8.get(tabId) || null) : null;
    sendResponse({ url });
    return true; // 非同期レスポンスのためチャンネルを維持
  }
});

// ─── webRequest でm3u8を検出してキャッシュ ───────────────────────────────────

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.statusCode !== 200) return;
    if (!details.url.includes('.m3u8')) return;
    if (detectedM3U8.has(details.tabId)) return;

    detectedM3U8.set(details.tabId, details.url);

    chrome.tabs.sendMessage(details.tabId, {
      type: 'M3U8_DETECTED',
      url: details.url,
    }).catch(() => {
      // content scriptがまだ準備できていない場合はポーリングで回収される
    });
  },
  { urls: ['*://delivery.domand.nicovideo.jp/*'] }
);

// ─── タブが閉じたらキャッシュをクリア ────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  detectedM3U8.delete(tabId);
});
