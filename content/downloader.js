/**
 * downloader.js
 *
 * 指定範囲のHLSセグメントを取得・AES復号・MP4 Mux・ダウンロードする。
 */

'use strict';

// ─── ユーティリティ関数 (テスト可能な純粋関数) ───────────────────────────

/**
 * startMs〜endMs の範囲に含まれるセグメントを抽出する
 *
 * startMs を含む最初のセグメント から
 * endMs   を含む最後のセグメント まで
 *
 * @param {Array<{index:number, url:string, startMs:number, durationMs:number}>} segments
 * @param {number} startMs - 開始時刻 (ms)
 * @param {number} endMs   - 終了時刻 (ms)
 * @returns {Array}
 */
function selectSegments(segments, startMs, endMs) {
  if (!segments || segments.length === 0) return [];

  return segments.filter((seg) => {
    const segEnd = seg.startMs + seg.durationMs;
    // セグメントの区間 [startMs, segEnd) が [startMs, endMs] と重なるかチェック
    return seg.startMs <= endMs && segEnd > startMs;
  });
}

/**
 * AES-128-CBC のIVを生成する
 * #EXT-X-KEY で IV が指定されていない場合はセグメントインデックスをビッグエンディアンで16バイトに格納
 *
 * @param {Uint8Array|null} iv - M3U8から取得したIV (nullならインデックスから生成)
 * @param {number} segmentIndex - セグメントの連番 (1始まり)
 * @returns {Uint8Array}
 */
function getSegmentIV(iv, segmentIndex) {
  if (iv instanceof Uint8Array) return iv;

  const result = new Uint8Array(16); // 16バイト全て0
  const view = new DataView(result.buffer);
  // ビッグエンディアンで最後の4バイトにインデックスを格納
  view.setUint32(12, segmentIndex, false);
  return result;
}

/**
 * ミリ秒を "MM:SS" 形式の文字列に変換する (ファイル名用)
 * @param {number} ms
 * @returns {string}
 */
function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * ダウンロードファイル名を生成する
 * 形式: {title}_{videoId}_クリップ_{MM:SS}-{MM:SS}.mp4
 *
 * @param {string} title  - 動画タイトル（サニタイズ済み）
 * @param {string} videoId
 * @param {number} startMs
 * @param {number} endMs
 * @returns {string}
 */
function buildFilename(title, videoId, startMs, endMs) {
  return `${title}_${videoId}_クリップ_${formatTime(startMs)}-${formatTime(endMs)}.mp4`;
}

/**
 * セッション有効期限が切れているか判定する
 * @param {string|null} expireTime - ISO 8601形式の有効期限 (nullなら無効期限)
 * @returns {boolean}
 */
function isSessionExpired(expireTime) {
  if (!expireTime) return false;
  return new Date(expireTime).getTime() <= Date.now();
}

/**
 * セッション残り時間をミリ秒で返す
 * @param {string|null} expireTime
 * @returns {number} 残りms (負の値は期限切れ)
 */
function getSessionRemainingMs(expireTime) {
  if (!expireTime) return Infinity;
  return new Date(expireTime).getTime() - Date.now();
}

// ─── HLSタイムライン取得 ─────────────────────────────────────────────────

/**
 * 相対URLを絶対URLに変換する
 * @param {string} url
 * @param {string} baseUrl
 * @returns {string}
 */
function resolveUrl(url, baseUrl) {
  if (/^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

/**
 * バリアントM3U8テキストから映像・音声のメディアプレイリストURLを抽出する
 *
 * 品質の優先順位:
 *   映像: video-h264-360p-lowest > video-h264-360p > video-h264-480p > video-h264-720p > video-h264-1080p > その他
 *   音声: audio-aac-128kbps > audio-aac-64kbps > audio-aac-192kbps > audio-aac-320kbps > その他
 *
 * @param {string} text
 * @param {string} baseUrl
 * @returns {{ videoUrl: string|null, audioUrl: string|null }}
 */
function extractMediaUrls(text, baseUrl) {
  const lines = text.split('\n').map((l) => l.trim());

  const videoCandidates = {};
  const audioCandidates = {};

  // プレーンなURLライン (非タグ行) — クエリパラメータ付き (.m3u8?Policy=...) にも対応
  for (const line of lines) {
    if (line.startsWith('#') || !/\.m3u8(\?|$)/.test(line)) continue;
    const url = resolveUrl(line, baseUrl);
    if (line.includes('video-h264')) {
      const qm = line.match(/(video-h264-[^./]+)/);
      const key = qm ? qm[1] : 'video-unknown';
      videoCandidates[key] = url;
    } else if (line.includes('audio-aac')) {
      const qm = line.match(/(audio-aac-[^./]+)/);
      const key = qm ? qm[1] : 'audio-unknown';
      audioCandidates[key] = url;
    }
  }

  // EXT-X-MEDIA / EXT-X-STREAM-INF タグからも収集
  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA') && !line.startsWith('#EXT-X-STREAM-INF')) continue;
    const uriMatch = line.match(/URI="([^"]+)"/);
    if (!uriMatch) continue;
    const uri = resolveUrl(uriMatch[1], baseUrl);
    if (uri.includes('video-h264')) {
      const qm = uri.match(/(video-h264-[^./]+)/);
      const key = qm ? qm[1] : 'video-unknown';
      if (!videoCandidates[key]) videoCandidates[key] = uri;
    } else if (uri.includes('audio-aac')) {
      const qm = uri.match(/(audio-aac-[^./]+)/);
      const key = qm ? qm[1] : 'audio-unknown';
      if (!audioCandidates[key]) audioCandidates[key] = uri;
    }
  }

  // 優先順位で選択
  const videoPriority = [
    'video-h264-360p-lowest', 'video-h264-360p',
    'video-h264-480p', 'video-h264-720p', 'video-h264-1080p',
  ];
  const audioPriority = [
    'audio-aac-128kbps', 'audio-aac-192kbps', 'audio-aac-320kbps', 'audio-aac-64kbps',
  ];

  let videoUrl = null;
  for (const q of videoPriority) {
    if (videoCandidates[q]) { videoUrl = videoCandidates[q]; break; }
  }
  if (!videoUrl) videoUrl = Object.values(videoCandidates)[0] || null;

  let audioUrl = null;
  for (const q of audioPriority) {
    if (audioCandidates[q]) { audioUrl = audioCandidates[q]; break; }
  }
  if (!audioUrl) audioUrl = Object.values(audioCandidates)[0] || null;

  console.log('[NicoClipDL] 検出された映像URLs:', videoCandidates);
  console.log('[NicoClipDL] 検出された音声URLs:', audioCandidates);
  console.log('[NicoClipDL] 選択: video=' + videoUrl + ', audio=' + audioUrl);

  return { videoUrl, audioUrl };
}

/**
 * マスターM3U8 → バリアントM3U8 → 映像・音声タイムラインをパースして
 * window.__nicoClipDL.hlsTimeline に格納する
 *
 * @param {string} masterUrl - マスタープレイリストURL
 */
async function fetchAndParseHLSTimeline(masterUrl) {
  console.log('[NicoClipDL] マスターM3U8取得:', masterUrl);

  const masterResp = await fetch(masterUrl, { credentials: 'include' });
  if (!masterResp.ok) throw new Error(`マスターM3U8 取得失敗: ${masterResp.status}`);
  const masterText = await masterResp.text();
  console.log('[NicoClipDL] マスターM3U8内容 (先頭500文字):\n', masterText.slice(0, 500));

  const { videoUrl, audioUrl } = extractMediaUrls(masterText, masterUrl);

  if (!videoUrl) throw new Error('映像プレイリストが見つかりません');
  if (!audioUrl) throw new Error('音声プレイリストが見つかりません');

  const [videoResp, audioResp] = await Promise.all([
    fetch(videoUrl, { credentials: 'include' }),
    fetch(audioUrl, { credentials: 'include' }),
  ]);

  const [videoText, audioText] = await Promise.all([
    videoResp.text(),
    audioResp.text(),
  ]);

  const videoTimeline = HLSParser.parseM3U8(videoText, videoUrl);
  const audioTimeline = HLSParser.parseM3U8(audioText, audioUrl);

  if (!window.__nicoClipDL) window.__nicoClipDL = {};
  window.__nicoClipDL.hlsTimeline = {
    video: videoTimeline,
    audio: audioTimeline,
  };

  console.log('[NicoClipDL] HLSタイムライン取得完了', {
    videoSegments: videoTimeline.segments.length,
    audioSegments: audioTimeline.segments.length,
  });
}

// ─── メインダウンロード処理 ───────────────────────────────────────────────

/**
 * AES-128-CBC で暗号化されたセグメントを復号する
 *
 * @param {ArrayBuffer} encryptedData - 暗号化済みデータ
 * @param {CryptoKey} cryptoKey - AESキー
 * @param {Uint8Array} iv - 初期ベクトル
 * @returns {Promise<ArrayBuffer>}
 */
async function decryptSegment(encryptedData, cryptoKey, iv) {
  return crypto.subtle.decrypt(
    { name: 'AES-CBC', iv },
    cryptoKey,
    encryptedData
  );
}

/**
 * URLからセグメントをfetchして復号したArrayBufferを返す
 *
 * @param {string} url
 * @param {CryptoKey} cryptoKey
 * @param {Uint8Array} iv
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchAndDecryptSegment(url, cryptoKey, iv) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  const encrypted = await response.arrayBuffer();
  return decryptSegment(encrypted, cryptoKey, iv);
}

// ─── fMP4バイナリマージャー ───────────────────────────────────────────────────
// mp4box.js の再muxは avcC/esds などのコーデック初期化ボックスが欠落する問題があるため、
// fMP4バイナリをそのまま結合するバイナリマージ方式に変更。

/**
 * ArrayBufferのトップレベルMP4ボックスをパースする
 * @param {ArrayBuffer} buffer
 * @returns {Array<{type:string, start:number, size:number}>}
 */
function parseTopBoxes(buffer) {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const boxes = [];
  let offset = 0;
  while (offset + 8 <= buffer.byteLength) {
    const size = view.getUint32(offset, false);
    if (size < 8 || offset + size > buffer.byteLength) break;
    const type = String.fromCharCode(u8[offset+4], u8[offset+5], u8[offset+6], u8[offset+7]);
    boxes.push({ type, start: offset, size });
    offset += size;
  }
  return boxes;
}

/**
 * 指定ボックス内の直接子ボックスをパースする (絶対オフセット使用)
 */
function parseChildBoxes(buffer, parentStart, parentSize) {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const boxes = [];
  let offset = parentStart + 8;
  const end = parentStart + parentSize;
  while (offset + 8 <= end) {
    const size = view.getUint32(offset, false);
    if (size < 8 || offset + size > end) break;
    const type = String.fromCharCode(u8[offset+4], u8[offset+5], u8[offset+6], u8[offset+7]);
    boxes.push({ type, start: offset, size });
    offset += size;
  }
  return boxes;
}

/**
 * Uint8Array の指定オフセットに uint32 をビッグエンディアンで書く
 */
function setU32(u8, offset, value) {
  u8[offset]   = (value >>> 24) & 0xff;
  u8[offset+1] = (value >>> 16) & 0xff;
  u8[offset+2] = (value >>>  8) & 0xff;
  u8[offset+3] =  value         & 0xff;
}

/**
 * [size:4][type:4][...parts] 形式のMP4ボックスを組み立てる
 * @param {string} type - 4文字のボックスタイプ
 * @param {...Uint8Array} parts - コンテンツ
 * @returns {Uint8Array}
 */
function buildMP4Box(type, ...parts) {
  const contentSize = parts.reduce((s, p) => s + p.byteLength, 0);
  const box = new Uint8Array(8 + contentSize);
  setU32(box, 0, 8 + contentSize);
  for (let i = 0; i < 4; i++) box[4 + i] = type.charCodeAt(i);
  let off = 8;
  for (const p of parts) { box.set(p, off); off += p.byteLength; }
  return box;
}

/**
 * trak box内のtkhd track_id を newId に変更したコピーを返す
 */
function patchTrakTrackId(trakU8, newId) {
  const u8 = trakU8.slice(0);
  let offset = 8;
  while (offset + 8 <= u8.byteLength) {
    const size = (u8[offset]<<24)|(u8[offset+1]<<16)|(u8[offset+2]<<8)|u8[offset+3];
    const type = String.fromCharCode(u8[offset+4], u8[offset+5], u8[offset+6], u8[offset+7]);
    if (type === 'tkhd') {
      const version = u8[offset + 8];
      // [size:4][type:4][version:1][flags:3][ctime][mtime][track_id:4]
      const timeSize = version === 1 ? 16 : 8;
      setU32(u8, offset + 12 + timeSize, newId);
      break;
    }
    if (size < 8) break;
    offset += size;
  }
  return u8;
}

/**
 * moof box内のtfhd track_id を newId に変更したコピーを返す
 */
function patchMoofTrackId(moofU8, newId) {
  const u8 = moofU8.slice(0);
  let offset = 8;
  outer: while (offset + 8 <= u8.byteLength) {
    const size = (u8[offset]<<24)|(u8[offset+1]<<16)|(u8[offset+2]<<8)|u8[offset+3];
    const type = String.fromCharCode(u8[offset+4], u8[offset+5], u8[offset+6], u8[offset+7]);
    if (type === 'traf') {
      let inner = offset + 8;
      while (inner + 8 <= offset + size) {
        const iSize = (u8[inner]<<24)|(u8[inner+1]<<16)|(u8[inner+2]<<8)|u8[inner+3];
        const iType = String.fromCharCode(u8[inner+4], u8[inner+5], u8[inner+6], u8[inner+7]);
        if (iType === 'tfhd') {
          // [size:4][type:4][version:1][flags:3][track_id:4]
          setU32(u8, inner + 12, newId);
          break outer;
        }
        if (iSize < 8) break;
        inner += iSize;
      }
    }
    if (size < 8) break;
    offset += size;
  }
  return u8;
}

/**
 * 映像(track_id=1)と音声(track_id=1)のfMP4をバイナリレベルで結合する
 *
 * 処理内容:
 *   1. 音声moovのtrakをtrack_id=2にパッチして映像moovに追加
 *   2. 映像mvexに音声trexを追加
 *   3. 音声moofのtrack_idを2にパッチ
 *   4. 出力: ftyp + mergedMoov + 映像フラグメント + 音声フラグメント
 *
 * @param {Uint8Array} videoData
 * @param {Uint8Array} audioData
 * @returns {ArrayBuffer}
 */
function mergeFMP4(videoData, audioData) {
  const vBuf = videoData.buffer.slice(videoData.byteOffset, videoData.byteOffset + videoData.byteLength);
  const aBuf = audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength);

  const vBoxes = parseTopBoxes(vBuf);
  const aBoxes = parseTopBoxes(aBuf);

  const vFtypInfo = vBoxes.find(b => b.type === 'ftyp');
  const vMoovInfo = vBoxes.find(b => b.type === 'moov');
  const aMoovInfo = aBoxes.find(b => b.type === 'moov');

  if (!vMoovInfo) throw new Error('映像のmoovボックスが見つかりません');
  if (!aMoovInfo) throw new Error('音声のmoovボックスが見つかりません');

  // ── 音声 trak を抽出してtrack_id=2にパッチ ──────────────────────────────
  const aChildren = parseChildBoxes(aBuf, aMoovInfo.start, aMoovInfo.size);
  const aTrakInfo = aChildren.find(b => b.type === 'trak');
  if (!aTrakInfo) throw new Error('音声のtrakボックスが見つかりません');
  const aTrakPatched = patchTrakTrackId(new Uint8Array(aBuf, aTrakInfo.start, aTrakInfo.size), 2);

  // ── 映像mvexに音声trexを追加した新mvexを作成 ────────────────────────────
  const vChildren = parseChildBoxes(vBuf, vMoovInfo.start, vMoovInfo.size);
  const vMvexInfo = vChildren.find(b => b.type === 'mvex');

  let newMvex;
  if (vMvexInfo) {
    const mvexChildren = parseChildBoxes(vBuf, vMvexInfo.start, vMvexInfo.size);
    const vTrexInfo = mvexChildren.find(b => b.type === 'trex');
    let aTrex;
    if (vTrexInfo) {
      aTrex = new Uint8Array(vBuf, vTrexInfo.start, vTrexInfo.size).slice(0);
      setU32(aTrex, 12, 2); // track_id = 2
    } else {
      aTrex = new Uint8Array(20);
      setU32(aTrex, 0, 20);
      ['t','r','e','x'].forEach((c, i) => { aTrex[4+i] = c.charCodeAt(0); });
      setU32(aTrex, 12, 2);
      setU32(aTrex, 16, 1);
    }
    const mvexParts = mvexChildren.map(c => new Uint8Array(vBuf, c.start, c.size));
    newMvex = buildMP4Box('mvex', ...mvexParts, aTrex);
  } else {
    const aTrex = new Uint8Array(20);
    setU32(aTrex, 0, 20);
    ['t','r','e','x'].forEach((c, i) => { aTrex[4+i] = c.charCodeAt(0); });
    setU32(aTrex, 12, 2);
    setU32(aTrex, 16, 1);
    newMvex = buildMP4Box('mvex', aTrex);
  }

  // ── 新しいmoovを組み立てる ─────────────────────────────────────────────────
  const moovParts = [];
  for (const child of vChildren) {
    if (child.type === 'mvex') {
      moovParts.push(newMvex);
    } else {
      moovParts.push(new Uint8Array(vBuf, child.start, child.size));
      if (child.type === 'trak') {
        moovParts.push(aTrakPatched); // video trakの直後にaudio trakを挿入
      }
    }
  }
  if (!vMvexInfo) moovParts.push(newMvex);

  const newMoov = buildMP4Box('moov', ...moovParts);

  // ── 出力バッファを組み立てる ──────────────────────────────────────────────
  const outputParts = [];

  if (vFtypInfo) {
    outputParts.push(new Uint8Array(vBuf, vFtypInfo.start, vFtypInfo.size));
  }
  outputParts.push(newMoov);

  // 映像フラグメント (moof+mdat) をそのまま追加
  for (const b of vBoxes) {
    if (b.type === 'moof' || b.type === 'mdat') {
      outputParts.push(new Uint8Array(vBuf, b.start, b.size));
    }
  }

  // 音声フラグメント: moof は track_id を2にパッチ、mdat はそのまま
  for (const b of aBoxes) {
    if (b.type === 'moof') {
      outputParts.push(patchMoofTrackId(new Uint8Array(aBuf, b.start, b.size), 2));
    } else if (b.type === 'mdat') {
      outputParts.push(new Uint8Array(aBuf, b.start, b.size));
    }
  }

  return concatBuffers(outputParts).buffer;
}

/**
 * 映像データと音声データを結合してMP4コンテナを生成する
 * @param {Uint8Array} videoData - 映像 fMP4 (init + segments)
 * @param {Uint8Array} audioData - 音声 fMP4 (init + segments)
 * @returns {Promise<ArrayBuffer>}
 */
async function muxVideoAudio(videoData, audioData) {
  return mergeFMP4(videoData, audioData);
}

/**
 * ArrayBuffer の配列を1つに結合する
 * @param {ArrayBuffer[]} buffers
 * @returns {Uint8Array}
 */
function concatBuffers(buffers) {
  const totalSize = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result;
}

/**
 * 進捗をUIに通知する
 * @param {number} progress - 0〜100
 */
function notifyProgress(progress) {
  document.dispatchEvent(
    new CustomEvent('niconico-download-progress', {
      detail: { progress: Math.round(progress) },
    })
  );
}

/**
 * エラーをUIに通知する
 * @param {string} message
 */
function notifyError(message) {
  document.dispatchEvent(
    new CustomEvent('niconico-download-error', {
      detail: { message },
    })
  );
}

/**
 * 動画IDをURLから抽出する
 * @returns {string}
 */
function getVideoId() {
  const match = location.pathname.match(/\/watch\/([^/?#]+)/);
  return match ? match[1] : 'unknown';
}

/**
 * ページタイトルから動画タイトルを取得する
 * document.title は "タイトル - ニコニコ動画" の形式のためサフィックスを除去する
 * ファイル名として無効な文字 (\ / : * ? " < > |) はアンダースコアに置換する
 * @returns {string}
 */
function getVideoTitle() {
  const raw = document.title.replace(/\s*[-–—]\s*ニコニコ動画\s*$/, '').trim();
  return raw.replace(/[\\/:*?"<>|]/g, '_') || 'ニコニコ';
}

/**
 * メインダウンロード関数
 * @param {number} startMs - 開始時刻 (ms)
 * @param {number} endMs   - 終了時刻 (ms)
 */
async function startDownload(startMs, endMs) {
  const state = window.__nicoClipDL;

  if (!state || !state.contentUrl) {
    notifyError('HLS情報が取得できていません。ページをリロードしてください。');
    return;
  }

  if (isSessionExpired(state.expireTime)) {
    notifyError('セッションの有効期限が切れました。ページをリロードしてください。');
    return;
  }

  // hlsTimeline がなければその場で取得（遅延取得）
  if (!state.hlsTimeline || !state.hlsTimeline.video || !state.hlsTimeline.audio) {
    notifyProgress(2);
    try {
      await fetchAndParseHLSTimeline(state.contentUrl);
    } catch (err) {
      notifyError(`プレイリスト取得失敗: ${err.message}`);
      return;
    }
    if (!state.hlsTimeline) {
      notifyError('プレイリストの解析に失敗しました。ページをリロードしてください。');
      return;
    }
  }

  const timeline = state.hlsTimeline;

  try {
    const videoTimeline = timeline.video;
    const audioTimeline = timeline.audio;

    // ── AESキー取得 ──────────────────────────────────────────────────────
    const [videoKeyResp, audioKeyResp] = await Promise.all([
      fetch(videoTimeline.keyUrl, { credentials: 'include' }),
      fetch(audioTimeline.keyUrl, { credentials: 'include' }),
    ]);

    if (!videoKeyResp.ok || !audioKeyResp.ok) {
      notifyError('セッションの有効期限が切れました。ページをリロードしてください。');
      return;
    }

    const [videoKeyBytes, audioKeyBytes] = await Promise.all([
      videoKeyResp.arrayBuffer(),
      audioKeyResp.arrayBuffer(),
    ]);

    const [videoCryptoKey, audioCryptoKey] = await Promise.all([
      crypto.subtle.importKey('raw', videoKeyBytes, 'AES-CBC', false, ['decrypt']),
      crypto.subtle.importKey('raw', audioKeyBytes, 'AES-CBC', false, ['decrypt']),
    ]);

    // ── 対象セグメントを特定 ─────────────────────────────────────────────
    const videoSegments = selectSegments(videoTimeline.segments, startMs, endMs);
    const audioSegments = selectSegments(audioTimeline.segments, startMs, endMs);

    const totalSegments = videoSegments.length + audioSegments.length;
    let completedSegments = 0;

    // ── initセグメント取得 ────────────────────────────────────────────────
    const [videoInitResp, audioInitResp] = await Promise.all([
      fetch(videoTimeline.initUrl, { credentials: 'include' }),
      fetch(audioTimeline.initUrl, { credentials: 'include' }),
    ]);

    const [videoInitBuf, audioInitBuf] = await Promise.all([
      videoInitResp.arrayBuffer(),
      audioInitResp.arrayBuffer(),
    ]);

    // ── 映像セグメント取得・復号 ──────────────────────────────────────────
    const videoBuffers = [videoInitBuf];
    for (const seg of videoSegments) {
      const iv = getSegmentIV(videoTimeline.iv, seg.index);
      const buf = await fetchAndDecryptSegment(seg.url, videoCryptoKey, iv);
      videoBuffers.push(buf);
      completedSegments++;
      notifyProgress((completedSegments / totalSegments) * 90);
    }

    // ── 音声セグメント取得・復号 ──────────────────────────────────────────
    const audioBuffers = [audioInitBuf];
    for (const seg of audioSegments) {
      const iv = getSegmentIV(audioTimeline.iv, seg.index);
      const buf = await fetchAndDecryptSegment(seg.url, audioCryptoKey, iv);
      audioBuffers.push(buf);
      completedSegments++;
      notifyProgress((completedSegments / totalSegments) * 90);
    }

    // ── MP4 Mux (mp4box.js v0.5.x) ──────────────────────────────────────
    notifyProgress(92);

    const videoData = concatBuffers(videoBuffers);
    const audioData = concatBuffers(audioBuffers);

    const muxedBuffer = await muxVideoAudio(videoData, audioData);

    // ── Blob生成・ダウンロード ─────────────────────────────────────────────
    notifyProgress(97);

    const videoBlob = new Blob([muxedBuffer], { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(videoBlob);

    const videoId = getVideoId();
    const title = getVideoTitle();
    const filename = buildFilename(title, videoId, startMs, endMs);

    // コンテンツスクリプト内で直接ダウンロード実行
    // (blob URLはnicovideo.jpオリジンに紐づくためbackground.jsからはアクセス不可)
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    notifyProgress(100);

    // Blob URLのrevoke (ダウンロード開始を待ってから解放)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  } catch (error) {
    console.error('[NicoClipDL] ダウンロードエラー:', error);
    if (error.message && (error.message.includes('401') || error.message.includes('403'))) {
      notifyError('セッションの有効期限が切れました。ページをリロードしてください。');
    } else {
      notifyError(`ダウンロードエラー: ${error.message}`);
    }
  }
}

// ─── CommonJS エクスポート (テスト用) ────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    selectSegments,
    getSegmentIV,
    buildFilename,
    formatTime,
    isSessionExpired,
    getSessionRemainingMs,
    concatBuffers,
    resolveUrl,
    extractMediaUrls,
    fetchAndParseHLSTimeline,
    getVideoTitle,
  };
}
