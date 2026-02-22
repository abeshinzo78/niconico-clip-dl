/**
 * browser-compat.js
 *
 * Chrome互換シム: content scriptで browser.* が未定義の場合に chrome.* を割り当てる。
 * Chrome MV3では browser グローバルが存在しないため、chrome をエイリアスとして設定する。
 * Firefox では browser が既に定義されているためこのシムは何もしない。
 *
 * このファイルは Chrome の manifest.json の content_scripts で最初に読み込む。
 */

/* global chrome */

// eslint-disable-next-line no-unused-vars
if (typeof browser === 'undefined' && typeof chrome !== 'undefined') {
  var browser = chrome; // var でグローバルスコープに公開 (後続スクリプトから参照可能)
}
