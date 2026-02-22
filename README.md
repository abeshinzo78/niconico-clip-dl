# ニコニコ クリップDL

ニコニコ動画の視聴ページで、動画の任意の時間範囲を **MP4** としてダウンロードできるブラウザ拡張機能。

Firefox・Chrome の両ブラウザに対応。

---

## 機能

- 動画プレイヤー上にオーバーレイUIを表示
- 開始・終了時間をドラッグまたは数値入力で指定
- AES-128-CBC 復号 + fMP4バイナリマージ（再エンコードなし）
- 指定区間を MP4 形式でダウンロード

---

## インストール方法

### ビルド

PowerShell から以下を実行して ZIP を生成:

```powershell
.\build.ps1
```

- `niconico-clip-dl-firefox.zip` — Firefox用
- `niconico-clip-dl-chrome.zip` — Chrome用（展開して使用）

---

### Firefox（永続インストール）

1. `build.ps1` を実行して `niconico-clip-dl-firefox.zip` を生成
2. Firefox で `about:addons` を開く
3. 歯車アイコン →「ファイルからアドオンをインストール」→ ZIP ファイルを選択

> 一時的なインストール: `about:debugging` →「この Firefox」→「一時的な拡張機能を読み込む」→ ZIP 内の `manifest.json` を選択

---

### Chrome

1. `build.ps1` を実行して `niconico-clip-dl-chrome.zip` を生成し展開
2. Chrome で `chrome://extensions` を開く
3. 「デベロッパーモード」をオン
4. 「パッケージ化されていない拡張機能を読み込む」→ 展開したフォルダを選択

---

## 使い方

1. ニコニコ動画の動画ページ (`nicovideo.jp/watch/smXXXXX`) を開く
2. プレイヤー右下付近に「✂ クリップ」ボタンが表示される
3. クリックでパネルを開き、開始・終了時間を設定
4. 「MP4でダウンロード」をクリック
5. ダウンロードが完了すると `ニコニコ_smXXXXX_クリップ_MM:SS-MM:SS.mp4` が保存される

---

## ファイル構成

```
niconico-kirinuki/
├── manifest.json          # Firefox (Manifest V2)
├── background/
│   └── background.js      # Firefox バックグラウンドスクリプト
├── content/
│   ├── hls-interceptor.js # XHR/fetch フック
│   ├── overlay-ui.js      # オーバーレイUI
│   ├── downloader.js      # セグメント取得・復号・Mux
│   └── content.js         # エントリーポイント
├── lib/
│   ├── browser-compat.js  # Chrome互換シム
│   ├── mp4box.min.js      # fMP4ライブラリ
│   └── hls-parser.js      # M3U8パーサー
├── assets/
│   └── overlay.css        # オーバーレイスタイル
├── chrome/
│   ├── manifest.json      # Chrome (Manifest V3)
│   └── background.js      # Chrome サービスワーカー
├── tests/                 # 自動テスト (Jest)
├── build.ps1              # ビルドスクリプト
└── README.md
```

---

## 技術仕様

| 項目 | 詳細 |
|------|------|
| Firefox | Manifest V2 |
| Chrome | Manifest V3 (Service Worker) |
| 暗号化 | AES-128-CBC |
| セグメント形式 | fMP4 (.cmfv / .cmfa) |
| 対象画質 | 360p (video-h264-360p-lowest + audio-aac-128kbps) |
| 出力形式 | MP4 |

---

## テスト

```bash
npm test
```
