/**
 * Firefox拡張機能APIのモック
 * テスト環境でbrowser.*APIをシミュレートする
 */

// browser.downloads APIモック
const mockDownloads = {
  download: jest.fn().mockResolvedValue(1),
};

// browser.runtime APIモック
const mockRuntime = {
  onMessage: {
    _listeners: [],
    addListener(fn) {
      this._listeners.push(fn);
    },
    // テスト用: メッセージを手動で発火させる
    _fire(message, sender) {
      let response;
      this._listeners.forEach((fn) => {
        const sendResponse = (r) => { response = r; };
        fn(message, sender || {}, sendResponse);
      });
      return response;
    },
  },
  sendMessage: jest.fn().mockResolvedValue(null),
};

// browser.webRequest APIモック (コールバックをキャプチャして _fire で呼べるようにする)
const mockWebRequest = {
  onCompleted: {
    _callback: null,
    addListener: jest.fn(function (callback) {
      this._callback = callback;
    }),
    // テスト用: webRequest.onCompleted を手動で発火
    _fire(details) {
      if (this._callback) this._callback(details);
    },
  },
};

// browser.tabs APIモック
const mockTabs = {
  sendMessage: jest.fn().mockResolvedValue({}),
  onRemoved: {
    _callback: null,
    addListener: jest.fn(function (callback) {
      this._callback = callback;
    }),
    // テスト用: tabs.onRemoved を手動で発火
    _fire(tabId) {
      if (this._callback) this._callback(tabId);
    },
  },
};

// browser グローバル
global.browser = {
  downloads: mockDownloads,
  runtime: mockRuntime,
  webRequest: mockWebRequest,
  tabs: mockTabs,
};

// crypto.subtle モック (AES-128-CBC)
// Node.jsのWebCrypto APIを使用
const { webcrypto } = require('crypto');
Object.defineProperty(global, 'crypto', {
  value: webcrypto,
  writable: true,
});

// TextEncoder/TextDecoder: Node.js の util から取得 (jsdom初期化前対応)
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// URL.createObjectURL モック
global.URL = global.URL || {};
global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url');
global.URL.revokeObjectURL = jest.fn();

// CustomEvent モック (jsdomに含まれているが念のため)
global.CustomEvent = CustomEvent;

// clearInterval/setInterval は既にjsdomに含まれる
