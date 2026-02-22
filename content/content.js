/**
 * content.js
 *
 * エントリーポイント。各モジュールを初期化する。
 *
 * 読み込み順 (manifest.json):
 *   1. lib/mp4box.min.js
 *   2. content/hls-interceptor.js  (XHR/fetchフック + niconico-hls-ready イベント)
 *   3. content/overlay-ui.js       (niconico-hls-ready を受けてUI生成)
 *   4. content/downloader.js       (startDownload 関数を定義 + HLSタイムライン取得)
 *   5. content/content.js          ← ここ (HLSタイムライン取得はdownloader.jsに移動済み)
 */

'use strict';
