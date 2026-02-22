# ニコニコ動画 クリップDL Firefox拡張機能 - CLAUDE.md

## プロジェクト概要

ニコニコ動画の視聴ページで、動画の任意の時間範囲をMP4としてダウンロードできるFirefox拡張機能。
動画プレイヤー上にオーバーレイUIを表示し、ドラッグ・数字入力・現在再生位置引き継ぎで開始〜終了時間を指定する。

---

## ファイル構成

```
niconico-clip-dl/
├── manifest.json
├── background/
│   └── background.js
├── content/
│   ├── content.js           # エントリーポイント・各モジュールの初期化
│   ├── hls-interceptor.js   # XHR/fetchフックでHLS情報を取得
│   ├── overlay-ui.js        # プレイヤー上オーバーレイUIの生成・制御
│   └── downloader.js        # セグメント取得・復号・MP4結合・ダウンロード
├── lib/
│   ├── mp4box.min.js        # fMP4 Muxライブラリ (gpac/mp4box.js)
│   └── hls-parser.js        # HLSプレイリスト (.m3u8) テキスト解析
└── assets/
    └── overlay.css          # オーバーレイUIのスタイル
```

---

## 技術スタック・制約

- **Manifest Version**: V2（FirefoxはV3より安定）
- **対象ページ**: `https://www.nicovideo.jp/watch/*`
- **出力形式**: MP4のみ
- **対象画質**: 360p（`video-h264-360p-lowest` + `audio-aac-128kbps`）
- **ログイン状態**: 非ログインでも動作すること
- **外部ライブラリ**: `mp4box.js` のみ（他は自前実装）
- **再エンコード**: 行わない（セグメント単位でのコピー結合のみ）

---

## ニコニコ動画の技術的詳細

### HLS情報取得フロー

ページロード時に以下のAPIが呼ばれる。このレスポンスを傍受して情報を取得する。

```
POST https://nvapi.nicovideo.jp/v1/watch/{videoId}/access-rights/hls

リクエストヘッダー:
  x-access-right-key: {JWTトークン}
  x-frontend-id: 6
  x-frontend-version: 0
  x-request-with: nicovideo

レスポンス:
{
  "data": {
    "contentUrl": "https://delivery.domand.nicovideo.jp/hlsbid/.../variants/....m3u8?...",
    "expireTime": "2026-01-16T20:10:50+09:00"
  }
}
```

取得すべき情報:
- `contentUrl` → HLSマスタープレイリストURL
- `x-access-right-key` リクエストヘッダー → 後続リクエストに使用
- `expireTime` → 有効期限の監視用

### HLSプレイリスト構造

```
contentUrl (マスター)
  └── variants/*.m3u8
        ├── video-h264-360p-lowest.m3u8  # 映像セグメントリスト
        └── audio-aac-128kbps.m3u8       # 音声セグメントリスト

セグメントURL:
  https://asset.domand.nicovideo.jp/{bid}/video/{seg}/video-h264-360p-lowest/
    ├── init01.cmfv   # 初期化セグメント（必須・先頭に付加）
    ├── 01.cmfv
    ├── 02.cmfv
    └── ...

  https://asset.domand.nicovideo.jp/{bid}/audio/{track}/audio-aac-128kbps/
    ├── init01.cmfa
    ├── 01.cmfa
    └── ...
```

### 暗号化

- HLSセグメントは **AES-128-CBC** で暗号化
- キーURLは `.m3u8` 内の `#EXT-X-KEY` タグに記載
- IVも同タグに記載（なければセグメント番号をIVとして使用）

```
#EXT-X-KEY:METHOD=AES-128,URI="https://delivery.domand.nicovideo.jp/hlsbid/{bid}/keys/video-h264-360p-lowest.key",IV=0x...
```

### CloudFront署名付きURL

すべてのURLに署名が含まれる。拡張機能からのfetchはブラウザのCookieを引き継ぐため、基本的に追加処理不要。

```
?session={session_id}&Policy={base64}&Signature={sig}&Key-Pair-Id={id}
```

---

## 各ファイルの実装仕様

### `manifest.json`

```json
{
  "manifest_version": 2,
  "name": "ニコニコ クリップDL",
  "version": "1.0.0",
  "description": "ニコニコ動画の指定区間をMP4でダウンロード",
  "permissions": [
    "downloads",
    "storage",
    "webRequest",
    "webRequestBlocking",
    "*://*.nicovideo.jp/*",
    "*://*.domand.nicovideo.jp/*",
    "*://*.nimg.jp/*"
  ],
  "content_scripts": [{
    "matches": ["*://www.nicovideo.jp/watch/*"],
    "js": [
      "lib/mp4box.min.js",
      "content/hls-interceptor.js",
      "content/overlay-ui.js",
      "content/downloader.js",
      "content/content.js"
    ],
    "css": ["assets/overlay.css"],
    "run_at": "document_start"
  }],
  "background": {
    "scripts": ["background/background.js"]
  }
}
```

---

### `content/hls-interceptor.js`

**役割**: ページのXHR・fetchを `document_start` でフックし、HLS情報を取得する

**実装要点**:
- `window.XMLHttpRequest` と `window.fetch` を両方ラップする
- レスポンスURLが `/access-rights/hls` を含む場合にJSONをキャプチャ
- `contentUrl` と `x-access-right-key`（リクエストヘッダー）を `window.__nicoClipDL` に保存
- 取得完了後、`CustomEvent("niconico-hls-ready")` を `document` に発火

```javascript
// 保存するグローバル変数の形式
window.__nicoClipDL = {
  contentUrl: null,       // HLSマスタープレイリストURL
  accessRightKey: null,   // x-access-right-key JWT
  expireTime: null,       // ISO 8601形式の有効期限
  hlsTimeline: null,      // hls-parser.jsが解析後に格納するタイムライン
}
```

**注意**: `document_start` で実行するため、ページスクリプトよりも先にXHRをフックできる。
ただし `window` 経由でのアクセスはpage contextとcontent scriptで異なるため、
フックスクリプトを `<script>` タグとしてDOMに注入する方式（`injectScript`パターン）を使うこと。

```javascript
// injectScriptパターンの例
function injectScript(fn) {
  const script = document.createElement('script');
  script.textContent = `(${fn.toString()})();`;
  document.documentElement.appendChild(script);
  script.remove();
}
```

注入されたスクリプトからcontent scriptへのデータ受け渡しは `window.postMessage` を使う。

---

### `lib/hls-parser.js`

**役割**: M3U8テキストを解析してタイムライン配列を生成する

**入力**: M3U8テキスト文字列  
**出力**:

```javascript
{
  initUrl: "https://...init01.cmfv",   // 初期化セグメントURL
  keyUrl: "https://...video-h264-360p-lowest.key",  // AESキーURL
  iv: Uint8Array,                       // AES IV（なければnull）
  segments: [
    {
      index: 1,
      url: "https://...01.cmfv",
      startMs: 0,
      durationMs: 6000,
    },
    ...
  ]
}
```

**パース対象のM3U8タグ**:
- `#EXT-X-KEY` → keyUrl, iv
- `#EXT-X-MAP` → initUrl
- `#EXTINF:{duration}` → 各セグメントのduration
- URIライン → セグメントURL（相対URLは絶対URLに変換）

---

### `content/overlay-ui.js`

**役割**: 動画プレイヤー上にオーバーレイUIを生成・制御する

**DOM注入タイミング**: `niconico-hls-ready` イベント受信後

**プレイヤー要素の特定**:
```javascript
// ニコニコ動画のプレイヤーコンテナを特定する
const playerContainer = document.querySelector('.PlayerContainer')
  || document.querySelector('[class*="player"]')
  || document.querySelector('video')?.parentElement;
```

**UIレイアウト**:
```
┌─────────────────────────────────────────────────────┐
│ 🎬 クリップDL                               [－][×] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ░░░░████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │
│        ↑S                              ↑E           │
│                                                     │
│  開始: [00]:[01]:[30]  [▶現在位置]                 │
│  終了: [00]:[03]:[45]  [▶現在位置]                 │
│                                                     │
│  クリップ長: 2分15秒                                │
├─────────────────────────────────────────────────────┤
│  [📥 MP4でダウンロード]     進捗: ████░░ 67%        │
└─────────────────────────────────────────────────────┘
```

**状態管理**:
```javascript
const state = {
  startMs: 0,        // 開始時刻（ミリ秒）
  endMs: 0,          // 終了時刻（ミリ秒）
  totalMs: 0,        // 動画全体の長さ（ミリ秒）
  isDragging: null,  // 'start' | 'end' | null
  isDownloading: false,
  progress: 0,       // 0〜100
}
```

**シークバー実装**:
- SハンドルとEハンドルはそれぞれ `position: absolute` で配置
- `mousedown` → `document.mousemove` → `document.mouseup` でドラッグ
- ハンドル位置 (%) = `positionMs / totalMs * 100`
- ドラッグ中はSがEを追い越せないようにバリデーション

**数字入力フィールド**:
- `HH:MM:SS` 形式（時間が1時間未満なら `MM:SS` でも可）
- 入力確定（`change`イベント）でシークバーハンドルも連動更新
- 無効値（範囲外・フォーマット不正）はフィールドを赤くして無視

**「▶現在位置」ボタン**:
```javascript
const video = document.querySelector('video');
state.startMs = Math.floor(video.currentTime * 1000);
// UIを更新
```

**ダウンロードボタン**:
- クリックで `downloader.js` の `startDownload(startMs, endMs)` を呼ぶ
- ダウンロード中は非活性化し、進捗バーを表示

---

### `content/downloader.js`

**役割**: 指定範囲のセグメント取得・AES復号・MP4 Mux・ダウンロード

**エクスポート関数**:
```javascript
async function startDownload(startMs, endMs)
```

**処理フロー**:

```
1. window.__nicoClipDL からcontentUrl・タイムラインを取得

2. 対象セグメントインデックスを特定
   startIdx = タイムラインで startMs を含む最初のセグメント
   endIdx   = タイムラインで endMs   を含む最後のセグメント

3. AES-128キーをfetchで取得
   const keyBytes = await fetch(keyUrl).then(r => r.arrayBuffer());
   const cryptoKey = await crypto.subtle.importKey(
     "raw", keyBytes, "AES-CBC", false, ["decrypt"]
   );

4. 映像セグメントをfetch・復号（init + 対象セグメント群）
   各セグメントを順次fetch → crypto.subtle.decrypt → ArrayBufferとして保持

5. 音声セグメントも同様に処理

6. mp4box.jsでMP4コンテナに映像・音声をMux
   （mp4box.jsのAPIに従いappendBuffer → save）

7. Blobを生成してbrowser.runtime.sendMessage でbackground.jsに送信
   background.jsがbrowser.downloads.download()を実行

8. ダウンロード完了後、BlobのURLをrevoke
```

**進捗通知**:
```javascript
// セグメント取得ごとにoverlay-ui.jsに進捗を通知
document.dispatchEvent(new CustomEvent('niconico-download-progress', {
  detail: { progress: 67 } // 0〜100
}));
```

**エラーハンドリング**:
- `expireTime` を超過している場合: 「セッションの有効期限が切れました。ページをリロードしてください」を表示
- fetchが401/403の場合: 同上
- その他のネットワークエラー: エラーメッセージをオーバーレイに表示

---

### `background/background.js`

**役割**: content scriptからのメッセージを受け取り `downloads` APIを実行

```javascript
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DOWNLOAD_MP4') {
    browser.downloads.download({
      url: message.blobUrl,
      filename: message.filename,  // 例: "ニコニコ_sm9_01m30s-03m45s.mp4"
      saveAs: true
    });
    sendResponse({ ok: true });
  }
});
```

**ファイル名の形式**: `ニコニコ_{videoId}_{開始時間}-{終了時間}.mp4`
- 時間形式: `01m30s` など

---

### `assets/overlay.css`

- オーバーレイパネルは `position: absolute; z-index: 99999` でプレイヤーの右上or下部に配置
- 背景は半透明の黒（`rgba(0,0,0,0.8)`）
- フォントは `sans-serif`、文字色は白
- シークバーの選択範囲は青、ハンドルは白い円
- ボタンはシンプルなフラットデザイン
- ダウンロード中の進捗バーはアニメーション付き

---

## 実装上の注意点・ハマりやすいポイント

### 1. injectScriptパターンが必須
content scriptの `window` とページの `window` は別コンテキスト。
XHR/fetchをフックするには `<script>` タグをDOMに注入し、ページコンテキストで実行する必要がある。
フックされたスクリプトからcontent scriptへのデータ受け渡しは `window.postMessage` + content script側の `window.addEventListener('message', ...)` で行う。

### 2. セグメント結合はinitセグメントが必須
fMP4形式（`.cmfv`, `.cmfa`）はinitセグメント（`init01.cmfv`）なしでは再生できない。
必ず先頭に付加すること。

### 3. AES復号のIV
IVが `#EXT-X-KEY` タグにない場合、セグメント番号（連番）を16バイトのビッグエンディアン整数として使う。

```javascript
function getIv(segmentIndex) {
  const iv = new Uint8Array(16);
  const view = new DataView(iv.buffer);
  view.setUint32(12, segmentIndex, false); // ビッグエンディアン
  return iv;
}
```

### 4. mp4box.jsのMux方法
映像と音声を別々のトラックとして追加する。
公式ドキュメントと examples/ を参照すること。
`MP4Box.createFile()` → 映像トラック追加 → 音声トラック追加 → セグメントappend → `save()`

### 5. 有効期限の監視
`expireTime` をパースして残り時間を定期チェック（1分ごと）。
残り5分でオレンジ色の警告をUIに表示。
残り0分（期限切れ）でダウンロードボタンを無効化してリロードを促す。

### 6. 大容量ファイルのメモリ管理
長い動画区間の場合、セグメント数が多くなりメモリを圧迫する可能性がある。
`ArrayBuffer` を都度結合せず、配列に保持しておき最後にまとめて結合すること。
ダウンロード完了後は `URL.revokeObjectURL()` を必ず呼ぶ。

---

## 開発・デバッグのヒント

- Firefoxの拡張機能デバッグ: `about:debugging` → 「この Firefox」→「一時的な拡張機能を読み込む」
- content scriptのログ: ブラウザの通常のDevToolsコンソールに出る
- background scriptのログ: `about:debugging` の拡張機能ページから「検査」をクリック
- XHRフックの確認: DevTools → ネットワークタブで `access-rights/hls` を探す
- HLSプレイリストの確認: `contentUrl` をブラウザで直接開いてM3U8の内容を確認

---

## 参考リソース

- [mp4box.js GitHub](https://github.com/gpac/mp4box.js)
- [Firefox Extension Workshop](https://extensionworkshop.com/)
- [MDN: Web Extensions API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
- [MDN: Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/decrypt)
- [HLS仕様 RFC 8216](https://datatracker.ietf.org/doc/html/rfc8216)
