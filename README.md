# ニコニコ クリップDL

[**まじめな解説読みたい人はここから**](https://github.com/abeshinzo78/niconico-clip-dl/tree/main?tab=readme-ov-file#%E7%9C%9F%E9%9D%A2%E7%9B%AE%E3%81%AA%E8%A7%A3%E8%AA%AC)
 
 ＼ﾃﾚﾚﾚｯﾃﾚｰ／

小傘「Githubをご覧の皆様！ぬえちゃんショッピングの時間です！さあぬえちゃん！今日はどんな拡張機能を紹介してくれるのかな？」

ぬえ「小傘よ、ふとニコニコの一場面をクリップしたくなったことってない？　私は動画を見るとさ、クリップして共有しなきゃ、って思うんだよ」

小傘「いや全く。今ニコニコに公開してるくらいだしそのまま誰かが見るんじゃない？」

ぬえ「そこで！」

(ｼﾞｬｰﾝ)

ぬえ「このniconico-clip-dl！栄養たっぷりのコードが入っているから設定いらず！」

ぬえ「これをブラウザに入れてダウンロードしたい秒数を指定するだけで動画の一場面をダウンロードできるよ！」

小傘「うわすっごい！秒数を指定できるから素材集めもサクサクだね！」

ぬえ「皆様のインターネットに動画の場面をまきましょう！」

小傘「この商品、気になるお値段は？」

ぬえ「ハイ！なんと0円！とってもおとく！」

小傘「これで今日からあなたも歩く動画共有者！」

ぬえ「そして今ならなんと自由に使えてコーディング初心者にもオススメのThe Unlicenseも付けちゃいます！」

小傘「コードを自分なりに変えるなんてそれだけでもオシャレだね！近所のインターネットにもまいて機能豊かな町作り！」

二人「それでは　issues　お待ちしてます！」 

# 真面目な解説

ニコニコ動画の視聴ページで、動画の**任意の時間範囲をMP4でダウンロード**できるブラウザ拡張機能。

Firefox・Chrome の両ブラウザに対応。

---

## ダウンロード・インストール

### ZIPをダウンロードする（ビルド不要・簡単）

1. このページ右側の **[Releases](../../releases)** を開く
2. 最新バージョンのアセットから使用するブラウザのZIPをダウンロード:
   - `niconico-clip-dl-firefox.xpi` — Firefox用
   - `niconico-clip-dl-chrome.zip` — Chrome用

---

### Firefox へのインストール

1. Releasesからniconico-clip-dl-firefox.xpiを選んでアドオンのインストールを許可すればインストールされます。

### Chrome へのインストール

> Chrome は署名なし拡張をデベロッパーモードでのみ読み込めます。

1. ダウンロードした `niconico-clip-dl-chrome.zip` を右クリック →「すべて展開」で任意のフォルダに展開
2. Chrome のアドレスバーに `chrome://extensions` と入力
3. 右上の「デベロッパーモード」をオンにする
4. 「パッケージ化されていない拡張機能を読み込む」をクリック
5. 手順1で展開したフォルダを選択

---

## 使い方

1. ニコニコ動画の動画ページ（`nicovideo.jp/watch/smXXXXX`）を開く
2. 動画プレイヤーのコメントオンオフボタンの左に **「✂ クリップ」** ボタンが表示される
3. クリックしてパネルを開く
4. 開始・終了時間をドラッグまたは数値入力で指定
5. **「MP4でダウンロード」** をクリック
6. ダウンロード完了後、以下のファイル名で保存される:
   ```
   動画タイトル_smXXXXX_クリップ_00_00_01_30.mp4
   ```

---

## 機能

- 動画プレイヤー上にオーバーレイUIを表示
- 開始・終了時間をドラッグまたは数値入力で指定
- 「▶ 現在位置」ボタンで再生中の位置を即座に反映
- AES-128-CBC 復号 + fMP4バイナリマージ（**再エンコードなし**・高速）
- セッション有効期限の監視と警告表示

---

## ソースからビルドする（開発者向け）

### 必要なもの

- PowerShell（Windows標準）
- Node.js（テスト実行用）

### 手順

```powershell
# リポジトリをクローン
git clone https://github.com/abeshinzo78/niconico-clip-dl.git
cd niconico-clip-dl

# ZIPを生成
.\build.ps1
```

- `niconico-clip-dl-firefox.zip` — Firefox用
- `niconico-clip-dl-chrome.zip` — Chrome用

### テスト

```powershell
npm install
npm test
```

---

## ファイル構成

```
niconico-clip-dl/
├── manifest.json          # Firefox (Manifest V2)
├── background/
│   └── background.js      # Firefox バックグラウンドスクリプト
├── content/
│   ├── hls-interceptor.js # XHR/fetch フックでHLS情報を取得
│   ├── overlay-ui.js      # オーバーレイUI
│   ├── downloader.js      # セグメント取得・AES復号・MP4結合
│   └── content.js         # エントリーポイント
├── lib/
│   ├── browser-compat.js  # Chrome互換シム (browser → chrome)
│   ├── mp4box.min.js      # fMP4ライブラリ
│   └── hls-parser.js      # M3U8パーサー
├── assets/
│   └── overlay.css        # オーバーレイスタイル
├── chrome/
│   ├── manifest.json      # Chrome (Manifest V3)
│   └── background.js      # Chrome サービスワーカー
├── tests/                 # 自動テスト (Jest)
└── build.ps1              # ビルドスクリプト
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
