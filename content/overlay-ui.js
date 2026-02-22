/**
 * overlay-ui.js
 *
 * MutationObserver でニコニコ動画のコメントオンオフボタンを検出し、
 * その左に「✂ クリップ」ボタンを挿入する。
 * クリックでクリップ設定パネルを表示/非表示する。
 */

'use strict';

// ─── 純粋ユーティリティ関数 (テスト可能) ──────────────────────────────────

function clampMs(ms, min, max) {
  return Math.max(min, Math.min(max, ms));
}

function msToHHMMSS(ms) {
  const totalSec = Math.floor(ms / 1000);
  const hours   = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':');
}

function parseHHMMSS(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split(':');
  let hours, minutes, seconds;
  if (parts.length === 3) {
    [hours, minutes, seconds] = parts.map(Number);
  } else if (parts.length === 2) {
    hours = 0;
    [minutes, seconds] = parts.map(Number);
  } else {
    return null;
  }
  if ([hours, minutes, seconds].some(isNaN)) return null;
  if (minutes < 0 || minutes >= 60) return null;
  if (seconds < 0 || seconds >= 60) return null;
  if (hours < 0) return null;
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

function calcHandlePercent(positionMs, totalMs) {
  if (!totalMs) return 0;
  return (positionMs / totalMs) * 100;
}

function validateTimeRange(startMs, endMs, totalMs) {
  if (startMs < 0) {
    return { valid: false, error: '開始時刻は0以上にしてください' };
  }
  if (endMs > totalMs) {
    return { valid: false, error: `終了時刻は動画の長さ (${msToHHMMSS(totalMs)}) 以内にしてください` };
  }
  if (startMs >= endMs) {
    return { valid: false, error: '開始時刻は終了時刻より前にしてください' };
  }
  return { valid: true };
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes === 0) return `${seconds}秒`;
  if (seconds === 0) return `${minutes}分`;
  return `${minutes}分${seconds}秒`;
}

// ─── UIの状態 ─────────────────────────────────────────────────────────────

const state = {
  startMs: 0,
  endMs: 30000,  // デフォルト30秒 (動画長さ取得前でもボタンを押せるよう)
  totalMs: 0,
  isDragging: null,
  isDownloading: false,
  progress: 0,
  hlsReady: false,
  panelOpen: false,
};

/**
 * コメントオンオフボタンを探す
 *
 * 戦略1: aria-label / title / data-* 属性に "コメント" を含むボタン
 * 戦略2: video要素から親を辿ってプレイヤーコンテナを特定し
 *         全ボタンを走査して "コメント" を探す
 * 戦略3: 見つからなければ全ボタン情報をコンソールに出力
 *
 * @returns {Element|null}
 */
function findCommentButton() {
  // ── 戦略1: 直接セレクタ ──────────────────────────────────────────────────
  const directSelectors = [
    'button[aria-label*="コメント"]',
    '[role="button"][aria-label*="コメント"]',
    'button[title*="コメント"]',
    '[data-testid*="comment"]',
    '[data-cy*="comment"]',
    '[data-tracking*="comment"]',
  ];
  for (const sel of directSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        console.log('[NicoClipDL] コメントボタン発見 (直接セレクタ):', sel);
        return el;
      }
    } catch (_) {}
  }

  // ── 戦略2: video要素からプレイヤーコンテナを辿って走査 ────────────────────
  const video = document.querySelector('video');
  if (video) {
    let container = video.parentElement;
    for (let i = 0; i < 10; i++) {
      if (!container || container === document.body) break;
      const btns = container.querySelectorAll('button, [role="button"]');
      if (btns.length >= 5) {
        for (const btn of btns) {
          const attrValues = Array.from(btn.attributes).map((a) => a.value).join(' ');
          const text = btn.textContent;
          if (
            attrValues.includes('コメント') ||
            text.includes('コメント') ||
            attrValues.toLowerCase().includes('comment')
          ) {
            console.log('[NicoClipDL] コメントボタン発見 (video起点走査):', btn);
            return btn;
          }
        }
        // 見つからない場合はデバッグ情報を出力して終了
        console.log(
          '[NicoClipDL] プレイヤー内ボタン一覧 (コメントボタン特定できず):',
          Array.from(btns).map((b) => ({
            ariaLabel: b.getAttribute('aria-label'),
            title: b.getAttribute('title'),
            text: b.textContent.trim().slice(0, 30),
            dataAttrs: Array.from(b.attributes)
              .filter((a) => a.name.startsWith('data-'))
              .map((a) => `${a.name}="${a.value}"`)
              .join(' '),
            class: b.className.toString().slice(0, 60),
          }))
        );
        break;
      }
      container = container.parentElement;
    }
  }

  return null;
}

// ─── ボタン挿入 ───────────────────────────────────────────────────────────

/**
 * コメントボタンの左に「✂ クリップ」ボタンを挿入する
 * @param {Element} commentBtn - コメントオンオフボタン要素
 */
function insertClipButton(commentBtn) {
  // すでに挿入済みなら何もしない
  if (document.getElementById('ncd-clip-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'ncd-clip-btn';
  btn.title = 'クリップDL';
  btn.setAttribute('aria-label', 'クリップDL');
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>';

  // コメントボタンと同じスタイルを引き継ぐ (できる限り)
  btn.className = commentBtn.className;
  // IDだけ上書き
  btn.id = 'ncd-clip-btn';

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel();
  });

  // コメントボタンの「左」に挿入
  commentBtn.parentNode.insertBefore(btn, commentBtn);
}

// ─── パネル ───────────────────────────────────────────────────────────────

/**
 * クリップ設定パネルを生成してDOMに追加する (初回のみ)
 */
function createPanel() {
  if (document.getElementById('ncd-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'ncd-panel';
  panel.innerHTML = `
    <div id="ncd-panel-header">
      <span>✂ クリップDL</span>
      <button id="ncd-panel-close" title="閉じる">×</button>
    </div>
    <div id="ncd-panel-body">
      <div id="ncd-status-msg"></div>
      <div id="ncd-seekbar-container">
        <div id="ncd-seekbar">
          <div id="ncd-range"></div>
          <div id="ncd-handle-start" data-handle="start" title="開始点 (ドラッグ)"></div>
          <div id="ncd-handle-end"   data-handle="end"   title="終了点 (ドラッグ)"></div>
        </div>
      </div>
      <div class="ncd-time-row">
        <label>開始</label>
        <input id="ncd-start-input" type="text" value="00:00:00" />
        <button class="ncd-pos-btn" data-target="start">▶ 現在位置</button>
      </div>
      <div class="ncd-time-row">
        <label>終了</label>
        <input id="ncd-end-input" type="text" value="00:00:00" />
        <button class="ncd-pos-btn" data-target="end">▶ 現在位置</button>
      </div>
      <div id="ncd-duration-label">クリップ長: -</div>
      <div id="ncd-error-msg"></div>
    </div>
    <div id="ncd-panel-footer">
      <button id="ncd-download-btn">📥 MP4でダウンロード</button>
      <div id="ncd-progress-wrap">
        <div id="ncd-progress-bar"><div id="ncd-progress-fill"></div></div>
        <span id="ncd-progress-label"></span>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  setupPanelEvents();
  updatePanel();
}

/**
 * パネルの表示/非表示を切り替える
 */
function togglePanel() {
  createPanel();
  state.panelOpen = !state.panelOpen;
  const panel = document.getElementById('ncd-panel');
  if (panel) {
    panel.style.display = state.panelOpen ? 'flex' : 'none';
  }
  // クリップボタンをアクティブ表示
  const clipBtn = document.getElementById('ncd-clip-btn');
  if (clipBtn) {
    clipBtn.classList.toggle('ncd-active', state.panelOpen);
  }
}

// ─── パネルのイベント設定 ─────────────────────────────────────────────────

function setupPanelEvents() {
  // 閉じるボタン
  document.getElementById('ncd-panel-close').addEventListener('click', () => {
    state.panelOpen = false;
    document.getElementById('ncd-panel').style.display = 'none';
    const clipBtn = document.getElementById('ncd-clip-btn');
    if (clipBtn) clipBtn.classList.remove('ncd-active');
  });

  // シークバードラッグ
  const seekbar = document.getElementById('ncd-seekbar');

  ['ncd-handle-start', 'ncd-handle-end'].forEach((id) => {
    document.getElementById(id).addEventListener('mousedown', (e) => {
      e.preventDefault();
      state.isDragging = document.getElementById(id).dataset.handle;
    });
  });

  document.addEventListener('mousemove', (e) => {
    if (!state.isDragging) return;
    const rect = seekbar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ms = Math.round(ratio * state.totalMs);
    if (state.isDragging === 'start') {
      state.startMs = clampMs(ms, 0, state.endMs - 1000);
    } else {
      state.endMs = clampMs(ms, state.startMs + 1000, state.totalMs);
    }
    updatePanel();
  });

  document.addEventListener('mouseup', () => {
    state.isDragging = null;
  });

  // テキスト入力
  document.getElementById('ncd-start-input').addEventListener('change', (e) => {
    const ms = parseHHMMSS(e.target.value);
    if (ms === null || ms >= state.endMs || ms < 0) {
      e.target.style.borderColor = '#f55';
      return;
    }
    e.target.style.borderColor = '';
    state.startMs = ms;
    updatePanel();
  });

  document.getElementById('ncd-end-input').addEventListener('change', (e) => {
    const ms = parseHHMMSS(e.target.value);
    if (ms === null || ms <= state.startMs || ms > state.totalMs) {
      e.target.style.borderColor = '#f55';
      return;
    }
    e.target.style.borderColor = '';
    state.endMs = ms;
    updatePanel();
  });

  // ▶ 現在位置ボタン
  document.querySelectorAll('.ncd-pos-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const video = document.querySelector('video');
      if (!video) return;
      const currentMs = Math.floor(video.currentTime * 1000);
      if (btn.dataset.target === 'start') {
        state.startMs = clampMs(currentMs, 0, state.endMs - 1000);
      } else {
        state.endMs = clampMs(currentMs, state.startMs + 1000, state.totalMs);
      }
      updatePanel();
    });
  });

  // ダウンロードボタン
  document.getElementById('ncd-download-btn').addEventListener('click', () => {
    if (state.isDownloading) return;

    // 開始・終了のチェック
    if (state.startMs >= state.endMs) {
      showError('開始時刻は終了時刻より前にしてください');
      return;
    }

    // 動画長さが判明している場合のみ範囲チェック
    if (state.totalMs > 0) {
      const validation = validateTimeRange(state.startMs, state.endMs, state.totalMs);
      if (!validation.valid) {
        showError(validation.error);
        return;
      }
    }

    hideError();
    state.isDownloading = true;
    updatePanel();
    if (typeof startDownload === 'function') {
      startDownload(state.startMs, state.endMs);
    }
  });

  // 進捗イベント
  document.addEventListener('niconico-download-progress', (e) => {
    state.progress = e.detail.progress;
    if (state.progress >= 100) {
      state.isDownloading = false;
    }
    updatePanel();
  });

  // エラーイベント
  document.addEventListener('niconico-download-error', (e) => {
    state.isDownloading = false;
    state.progress = 0;
    showError(e.detail.message);
    updatePanel();
  });
}

// ─── パネル表示更新 ───────────────────────────────────────────────────────

function updatePanel() {
  const startInput    = document.getElementById('ncd-start-input');
  const endInput      = document.getElementById('ncd-end-input');
  const handleStart   = document.getElementById('ncd-handle-start');
  const handleEnd     = document.getElementById('ncd-handle-end');
  const rangeEl       = document.getElementById('ncd-range');
  const durationLabel = document.getElementById('ncd-duration-label');
  const downloadBtn   = document.getElementById('ncd-download-btn');
  const progressWrap  = document.getElementById('ncd-progress-wrap');
  const progressFill  = document.getElementById('ncd-progress-fill');
  const progressLabel = document.getElementById('ncd-progress-label');
  const statusMsg     = document.getElementById('ncd-status-msg');

  if (!startInput) return;

  // HLS準備状態の表示
  if (statusMsg) {
    if (state.totalMs === 0) {
      statusMsg.textContent = '⏳ 動画情報を取得中...';
      statusMsg.style.display = '';
    } else if (!state.hlsReady) {
      statusMsg.textContent = '⚠ HLS情報未取得 (ダウンロードボタンを押すと自動取得します)';
      statusMsg.style.color = '#fa0';
      statusMsg.style.display = '';
    } else {
      statusMsg.style.display = 'none';
    }
  }

  startInput.value = msToHHMMSS(state.startMs);
  endInput.value   = msToHHMMSS(state.endMs);

  const startPct = calcHandlePercent(state.startMs, state.totalMs);
  const endPct   = calcHandlePercent(state.endMs,   state.totalMs);
  handleStart.style.left = `${startPct}%`;
  handleEnd.style.left   = `${endPct}%`;
  rangeEl.style.left  = `${startPct}%`;
  rangeEl.style.width = `${endPct - startPct}%`;

  durationLabel.textContent = `クリップ長: ${formatDuration(state.endMs - state.startMs)}`;

  // ダウンロード中以外は常に押せる
  downloadBtn.disabled = state.isDownloading;
  downloadBtn.textContent = state.isDownloading ? '⏳ ダウンロード中...' : '📥 MP4でダウンロード';
  downloadBtn.classList.toggle('ncd-downloading', state.isDownloading);

  if (state.isDownloading || state.progress > 0) {
    progressWrap.style.display = '';
    progressFill.style.width   = `${state.progress}%`;
    progressLabel.textContent  = `${Math.round(state.progress)}%`;
  } else {
    progressWrap.style.display = 'none';
  }
}

function showError(msg) {
  const el = document.getElementById('ncd-error-msg');
  if (!el) return;
  el.textContent = msg;
  el.style.display = '';
  setTimeout(() => { el.style.display = 'none'; }, 6000);
}

function hideError() {
  const el = document.getElementById('ncd-error-msg');
  if (el) el.style.display = 'none';
}

// ─── 動画情報の反映 ───────────────────────────────────────────────────────

/**
 * 動画の総長をvideoタグから取得して状態を更新する
 * 動画要素がまだない場合は500msごとにリトライする
 */
function syncVideoMeta() {
  const video = document.querySelector('video');
  if (!video) {
    setTimeout(syncVideoMeta, 500);
    return;
  }

  const updateFromVideo = () => {
    const dur = video.duration;
    if (dur && isFinite(dur) && dur > 0) {
      state.totalMs = Math.floor(dur * 1000);
      // endMsが初期値(30秒)または動画長超えの場合のみ上書き
      if (state.endMs === 30000 || state.endMs > state.totalMs) {
        state.endMs = state.totalMs;
      }
      updatePanel();
    }
  };

  if (video.readyState >= 1 && video.duration > 0) {
    updateFromVideo();
  } else {
    // loadedmetadata と durationchange 両方を待つ
    video.addEventListener('loadedmetadata', updateFromVideo, { once: true });
    video.addEventListener('durationchange', updateFromVideo, { once: true });
  }
}

// ─── 有効期限の監視 ───────────────────────────────────────────────────────

let _expireTimer = null;

function startExpireWatch(expireTime) {
  if (_expireTimer) clearInterval(_expireTimer);
  _expireTimer = setInterval(() => {
    if (!expireTime) return;
    const remainMs = new Date(expireTime).getTime() - Date.now();
    const errorEl = document.getElementById('ncd-error-msg');
    const downloadBtn = document.getElementById('ncd-download-btn');
    if (remainMs <= 0) {
      if (errorEl) {
        errorEl.textContent = '⚠ セッションの有効期限が切れました。ページをリロードしてください。';
        errorEl.style.display = '';
        errorEl.style.color = '#f55';
      }
      if (downloadBtn) downloadBtn.disabled = true;
      clearInterval(_expireTimer);
    } else if (remainMs <= 5 * 60 * 1000) {
      if (errorEl) {
        errorEl.textContent = `⚠ セッションの有効期限まで残り${Math.ceil(remainMs / 60000)}分です。`;
        errorEl.style.display = '';
        errorEl.style.color = '#fa0';
      }
    }
  }, 60 * 1000);
}

// ─── MutationObserver でコメントボタンを監視 ─────────────────────────────

let _observer = null;
let _insertAttempts = 0;

/**
 * コメントボタンへの挿入を試みる
 * @returns {boolean} 成功したか
 */
function tryInsertButton() {
  if (document.getElementById('ncd-clip-btn')) return true; // すでに挿入済み

  const commentBtn = findCommentButton();
  if (commentBtn) {
    insertClipButton(commentBtn);
    syncVideoMeta();
    console.log('[NicoClipDL] クリップボタンを挿入しました');
    return true;
  }
  return false;
}

/**
 * MutationObserver を起動してコメントボタンの出現を監視する
 */
function watchForCommentButton() {
  // すでにいれば即時挿入
  if (tryInsertButton()) return;

  _observer = new MutationObserver(() => {
    _insertAttempts++;
    if (tryInsertButton()) {
      _observer.disconnect();
      _observer = null;
    }
    // 5分経っても見つからなければ諦める
    if (_insertAttempts > 3000) {
      _observer.disconnect();
      _observer = null;
      console.warn('[NicoClipDL] コメントボタンが見つかりませんでした。フォールバック表示します。');
      insertFallbackButton();
    }
  });

  _observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * コメントボタンが見つからない場合のフォールバック:
 * プレイヤー右下に固定ボタンを配置する
 */
function insertFallbackButton() {
  if (document.getElementById('ncd-clip-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'ncd-clip-btn';
  btn.id = 'ncd-clip-btn-fallback';
  btn.title = 'クリップDL';
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg> クリップ';
  btn.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 16px;
    z-index: 99999;
    background: rgba(0,0,0,0.75);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.3);
    border-radius: 4px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 13px;
  `;
  btn.addEventListener('click', togglePanel);
  document.body.appendChild(btn);
  syncVideoMeta();
}

// ─── HLS情報受信後の処理 ──────────────────────────────────────────────────

/**
 * niconico-hls-ready イベントを受けてUIを活性化する
 */
function onHLSReady(detail) {
  state.hlsReady = true;
  syncVideoMeta();
  updatePanel();
  if (detail && detail.expireTime) {
    startExpireWatch(detail.expireTime);
  }
}

// ─── ブラウザ環境でのエントリーポイント ──────────────────────────────────

if (typeof document !== 'undefined' && typeof module === 'undefined') {
  // ページ読み込み開始からコメントボタンを監視
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForCommentButton);
  } else {
    watchForCommentButton();
  }

  // HLS情報取得後にUIを活性化
  document.addEventListener('niconico-hls-ready', (e) => {
    onHLSReady(e.detail);
  });
}

// ─── CommonJS エクスポート (テスト用) ────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    clampMs,
    msToHHMMSS,
    parseHHMMSS,
    calcHandlePercent,
    validateTimeRange,
    formatDuration,
  };
}
