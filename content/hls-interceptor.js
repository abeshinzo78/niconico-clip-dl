/**
 * hls-interceptor.js
 *
 * XHR/fetchをページコンテキストでフックし、HLS情報を取得する。
 * document_start で実行されるため、injectScript パターンを使う。
 *
 * ページコンテキスト → content script: window.postMessage で通信。
 */

'use strict';

// ─── テスト用エクスポート関数 ─────────────────────────────────────────────

/**
 * URLがHLSアクセス権限エンドポイントかどうか判定する
 * @param {string} url
 * @returns {boolean}
 */
function isHLSEndpoint(url) {
  return typeof url === 'string' && url.includes('access-rights/hls');
}

/**
 * HLS APIレスポンスJSONからデータを抽出する
 * @param {object} json - APIレスポンスのJSONオブジェクト
 * @param {string} accessRightKey - x-access-right-key ヘッダー値
 * @returns {{ contentUrl, accessRightKey, expireTime }|null}
 */
function extractHLSData(json, accessRightKey) {
  if (!json || !json.data || !json.data.contentUrl) return null;
  return {
    contentUrl: json.data.contentUrl,
    accessRightKey: accessRightKey || null,
    expireTime: json.data.expireTime || null,
  };
}

/**
 * __nicoClipDL グローバル状態の初期オブジェクトを生成する
 * @returns {object}
 */
function buildGlobalState() {
  return {
    contentUrl: null,
    accessRightKey: null,
    expireTime: null,
    hlsTimeline: null,
  };
}

// ─── ブラウザ環境でのみ実行 ───────────────────────────────────────────────

if (typeof document !== 'undefined' && typeof module === 'undefined') {
  /**
   * ページコンテキストにスクリプトを注入してXHR/fetchをフックする
   * (content script の window とページの window は別コンテキストのため必須)
   */
  function injectScript(fn) {
    const script = document.createElement('script');
    script.textContent = `(${fn.toString()})();`;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }

  // ページコンテキストで実行されるフック関数
  function pageContextHook() {
    // __nicoClipDL グローバル初期化
    window.__nicoClipDL = {
      contentUrl: null,
      accessRightKey: null,
      expireTime: null,
      hlsTimeline: null,
    };

    const HLS_API_PATH = 'access-rights/hls';
    // delivery.domand.nicovideo.jp への任意の .m3u8 リクエスト
    const M3U8_RE = /delivery\.domand\.nicovideo\.jp.*\.m3u8/;

    // 二重発火防止フラグ
    let _readyFired = false;

    // マスタープレイリストかどうかをレスポンス内容で判定する
    // (バリアント/メディアプレイリストと区別)
    function isMasterPlaylist(text) {
      return text.includes('#EXT-X-STREAM-INF') || text.includes('#EXT-X-MEDIA:');
    }

    function fireReady(contentUrl) {
      if (_readyFired) return;
      _readyFired = true;
      window.__nicoClipDL.contentUrl = contentUrl;
      window.postMessage(
        {
          type: '__NICO_CLIP_DL_HLS_READY__',
          payload: {
            contentUrl,
            accessRightKey: window.__nicoClipDL.accessRightKey,
            expireTime: window.__nicoClipDL.expireTime,
          },
        },
        '*'
      );
    }

    // ── fetch フック ────────────────────────────────────────────────────
    const _origFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const response = await _origFetch.apply(this, arguments);

      if (url.includes(HLS_API_PATH)) {
        // access-rights/hls: アクセスキー・有効期限を取得
        const key =
          init && init.headers && (
            init.headers['x-access-right-key'] ||
            (typeof init.headers.get === 'function'
              ? init.headers.get('x-access-right-key')
              : null)
          );
        try {
          const clone = response.clone();
          const json = await clone.json();
          if (json && json.data) {
            window.__nicoClipDL.accessRightKey = key || null;
            window.__nicoClipDL.expireTime = json.data.expireTime || null;
            // contentUrlが絶対URLの場合のみ即時発火 (相対URLは無視)
            const cu = json.data.contentUrl;
            if (cu && /^https?:\/\//.test(cu)) {
              fireReady(cu);
            }
          }
        } catch (e) {
          // JSONパース失敗は無視
        }
      } else if (!_readyFired && M3U8_RE.test(url)) {
        // delivery.domand への m3u8 リクエストをインターセプト
        // レスポンス内容を確認してマスタープレイリストかどうか判定する
        try {
          const clone = response.clone();
          const text = await clone.text();
          if (isMasterPlaylist(text)) {
            fireReady(url);
          }
        } catch (e) {
          // 無視
        }
      }

      return response;
    };

    // ── XMLHttpRequest フック ────────────────────────────────────────────
    const _origOpen = XMLHttpRequest.prototype.open;
    const _origSetReqHeader = XMLHttpRequest.prototype.setRequestHeader;
    const _origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__nicoUrl = url || '';
      this.__nicoKey = null;
      this.__isHLSApi = this.__nicoUrl.includes(HLS_API_PATH);
      this.__isM3U8 = M3U8_RE.test(this.__nicoUrl);
      return _origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (name.toLowerCase() === 'x-access-right-key') {
        this.__nicoKey = value;
      }
      return _origSetReqHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      if (this.__isHLSApi) {
        this.addEventListener('load', () => {
          try {
            const json = JSON.parse(this.responseText);
            if (json && json.data) {
              window.__nicoClipDL.accessRightKey = this.__nicoKey || null;
              window.__nicoClipDL.expireTime = json.data.expireTime || null;
              const cu = json.data.contentUrl;
              if (cu && /^https?:\/\//.test(cu)) {
                fireReady(cu);
              }
            }
          } catch (e) {
            // 無視
          }
        });
      } else if (this.__isM3U8) {
        // レスポンス内容でマスタープレイリストか確認してから発火
        this.addEventListener('load', () => {
          if (!_readyFired && this.responseText && isMasterPlaylist(this.responseText)) {
            fireReady(this.__nicoUrl);
          }
        });
      }
      return _origSend.apply(this, arguments);
    };
  }

  // ページコンテキストにフック注入
  injectScript(pageContextHook);

  // content script 側: ページコンテキストからの postMessage を受け取る
  window.addEventListener('message', (event) => {
    if (
      event.source === window &&
      event.data &&
      event.data.type === '__NICO_CLIP_DL_HLS_READY__'
    ) {
      // グローバル状態を更新 (content script 側のコンテキスト)
      window.__nicoClipDL = window.__nicoClipDL || buildGlobalState();
      Object.assign(window.__nicoClipDL, event.data.payload);

      // 他のモジュールに通知
      document.dispatchEvent(new CustomEvent('niconico-hls-ready', {
        detail: event.data.payload,
      }));
    }
  });

  // ── background.js との連携 ──────────────────────────────────────────────
  // CSPでinjectScriptがブロックされた場合でも動作するよう、2つの経路でm3u8 URLを取得する。
  //
  // 経路A: background.js が webRequest でm3u8を検出 → M3U8_DETECTED メッセージ (即時)
  // 経路B: content scriptが 500msごとにbackground.jsにGET_M3U8_URLをポーリング (確実)

  if (typeof browser !== 'undefined' && browser.runtime) {

    // 経路A: background.jsから直接通知 (タイミングが合えば即時)
    browser.runtime.onMessage.addListener((message) => {
      if (message.type === 'M3U8_DETECTED') {
        _applyM3U8Url(message.url);
      }
    });

    // 経路B: 500msごとにbackground.jsにポーリング (最大30秒 = 60回)
    let _pollCount = 0;
    const _pollTimer = setInterval(() => {
      // すでにcontentUrlが取得済みなら停止
      if (window.__nicoClipDL && window.__nicoClipDL.contentUrl) {
        clearInterval(_pollTimer);
        return;
      }
      if (++_pollCount > 60) {
        clearInterval(_pollTimer);
        return;
      }
      browser.runtime.sendMessage({ type: 'GET_M3U8_URL' })
        .then((response) => {
          if (response && response.url) {
            _applyM3U8Url(response.url);
            clearInterval(_pollTimer);
          }
        })
        .catch(() => { /* background.jsが未起動など */ });
    }, 500);
  }

  /**
   * background.jsから取得したm3u8 URLを適用してniconico-hls-readyを発火する
   * @param {string} url
   */
  function _applyM3U8Url(url) {
    if (!url) return;
    window.__nicoClipDL = window.__nicoClipDL || buildGlobalState();
    if (window.__nicoClipDL.contentUrl) return; // すでに取得済み
    window.__nicoClipDL.contentUrl = url;
    document.dispatchEvent(new CustomEvent('niconico-hls-ready', {
      detail: {
        contentUrl: url,
        accessRightKey: window.__nicoClipDL.accessRightKey,
        expireTime: window.__nicoClipDL.expireTime,
      },
    }));
  }
}

// ─── CommonJS エクスポート (テスト用) ────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isHLSEndpoint, extractHLSData, buildGlobalState };
}
