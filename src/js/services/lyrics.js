/* ==========================================================================
   SERVICE: LRCLIB Synced Lyrics Client & Word-by-Word Karaoke Parser
   ========================================================================== */
'use strict';

// --------------------------------------------------------------------------
// 5. LRCLIB SYNCED LYRICS ENGINE (APPLE MUSIC WORD-BY-WORD KARAOKE)
// --------------------------------------------------------------------------
function parseLrcToWordSync(lrcString, totalDuration) {
  const lines = lrcString.split('\n');
  const parsed = [];
  const timeRegex = /\[(\d+):(\d+(?:\.\d+)?)\](.*)/;

  lines.forEach(raw => {
    const m = raw.match(timeRegex);
    if (m) {
      const mins = parseInt(m[1], 10);
      const secs = parseFloat(m[2]);
      let text = m[3].trim();
      // Strip dual-language translation tags (e.g. "Original line ^ English translation")
      if (text.includes('^')) {
        text = text.split('^')[0].trim();
      }
      if (text) {
        parsed.push({ start: mins * 60 + secs, text });
      }
    }
  });

  if (parsed.length === 0) return null;

  for (let i = 0; i < parsed.length; i++) {
    const nextStart = i < parsed.length - 1 ? parsed[i + 1].start : (totalDuration || parsed[i].start + 6);
    // Cap active word illumination duration to a natural singing phrase length (max 6.5s)
    parsed[i].end = Math.min(nextStart, parsed[i].start + 6.5);
    parsed[i].lineEnd = nextStart;
  }
  return parsed;
}

function parsePlainLyricsToFallbackSync(plainString, totalDuration) {
  const lines = plainString.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const step = Math.max(3.5, (totalDuration || 180) / (lines.length + 1));
  return lines.map((text, idx) => ({
    start: idx * step,
    end: (idx + 0.85) * step,
    lineEnd: (idx + 1) * step,
    text
  }));
}

let lyricFetchSeq = 0;
let activeLyricTrackKey = '';
const lyricsMemoryCache = new Map();

// Diagnostics: forwarded to logcat (tag EchoJS) via WebChromeClient.onConsoleMessage
function lyrLog(msg) {
  try { console.log(`[LYR ${Date.now() % 100000}] ${msg}`); } catch (e) { }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, credentials: 'omit', signal: controller.signal });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    return null;
  }
}

// Same as fetchWithTimeout but logs status, elapsed ms and failure reason
async function timedLyricsFetch(tag, fetchId, url, timeoutMs) {
  const t0 = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const res = await fetch(url, { credentials: 'omit', signal: controller.signal });
    clearTimeout(timeout);
    lyrLog(`#${fetchId} ${tag} HTTP ${res.status} in ${Date.now() - t0}ms`);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    lyrLog(`#${fetchId} ${tag} FAIL ${timedOut ? 'TIMEOUT(' + timeoutMs + 'ms)' : (err && err.name) + ': ' + (err && err.message)} after ${Date.now() - t0}ms`);
    return null;
  }
}

async function fetchSyncedLyricsForTrack(trackName, artistName, albumName, durationSec) {
  if (!trackName) return;
  const cleanTrack = (trackName || '').replace(/\s*\(.*?\)\s*/g, '').replace(/\s*-\s*.*$/, '').trim() || trackName;
  const cleanArtist = (artistName || '').replace(/\s*,\s*.*$/, '').trim() || artistName;
  const cacheKey = `${cleanArtist.toLowerCase()}::${cleanTrack.toLowerCase()}`;

  // If lyrics are already loaded and displayed for this exact song, never wipe or re-fetch!
  // (Compare against the key the loaded lyrics belong to; playingTrackTitle is already updated by the caller.)
  if (state.hasValidLyrics && state.activeLyrics && state.activeLyrics.length > 0 && state.loadedLyricsKey === cacheKey) {
    lyrLog(`skip "${cacheKey}": already loaded`);
    return;
  }

  // If an async fetch is already in flight for this exact track, let it finish instead of duplicate fetches!
  if (state.lyricsLoading && activeLyricTrackKey === cacheKey) {
    lyrLog(`skip "${cacheKey}": fetch already in flight`);
    return;
  }

  const fetchId = ++lyricFetchSeq;
  const tStart = Date.now();
  lyrLog(`#${fetchId} START "${cacheKey}" dur=${durationSec}s`);
  activeLyricTrackKey = cacheKey;
  state.lyricsLoading = true;

  // Check instant in-memory cache (0ms)
  if (lyricsMemoryCache.has(cacheKey)) {
    const cached = lyricsMemoryCache.get(cacheKey);
    if (cached && cached.length > 0) {
      lyrLog(`#${fetchId} memory cache hit (${cached.length} lines)`);
      state.lyricsLoading = false;
      state.hasValidLyrics = true;
      state.loadedLyricsKey = cacheKey;
      state.activeLyrics = cached;
      state.activeLineIndex = -1;
      buildLyricsDOM(cached);
      updateNowPlayingRightPanelMode();
      updateScrubberAndLyricsUI(true);
      return;
    }
  }

  state.hasValidLyrics = false;
  state.loadedLyricsKey = '';
  state.activeLyrics = [];
  state.lyricDOMCache = [];
  state.activeLineIndex = -1;
  if (lyricsScrollTrack) {
    lyricsScrollTrack.classList.add('lyrics-fade-out');
  }
  updateNowPlayingRightPanelMode();

  let rawSyncedLrc = null;

  // STEP 1: Direct lookup via /api/get (returns exact syncedLyrics)
  try {
    const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTrack)}&artist_name=${encodeURIComponent(cleanArtist)}`;
    let res = await timedLyricsFetch('get', fetchId, getUrl, 5000);
    if (fetchId !== lyricFetchSeq) { lyrLog(`#${fetchId} stale after get, dropped`); return; }

    // One retry on timeout / network error / 5xx (not on 404 = genuinely missing)
    if (!res || res.status >= 500) {
      await new Promise(r => setTimeout(r, 700));
      if (fetchId !== lyricFetchSeq) return;
      res = await timedLyricsFetch('get-retry', fetchId, getUrl, 6500);
    }

    if (fetchId !== lyricFetchSeq) { lyrLog(`#${fetchId} stale after get-retry, dropped`); return; }
    if (res && res.ok) {
      try {
        const data = await res.json();
        if (data && !data.instrumental && data.syncedLyrics) {
          rawSyncedLrc = data.syncedLyrics;
        } else {
          lyrLog(`#${fetchId} get: no syncedLyrics (instrumental=${data && data.instrumental})`);
        }
      } catch (jsonErr) {
        lyrLog(`#${fetchId} get: body is not JSON (${jsonErr && jsonErr.message})`);
      }
    }
  } catch (e) { }

  // STEP 2: Fallback search if direct get didn't find it or had naming discrepancy
  if (!rawSyncedLrc && fetchId === lyricFetchSeq) {
    try {
      const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTrack)}&artist_name=${encodeURIComponent(cleanArtist)}`;
      const res = await timedLyricsFetch('search', fetchId, searchUrl, 7500);
      if (fetchId !== lyricFetchSeq) { lyrLog(`#${fetchId} stale after search, dropped`); return; }
      if (res && res.ok) {
        try {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) {
            const syncedCandidates = list.filter(item => !item.instrumental && item.syncedLyrics);
            lyrLog(`#${fetchId} search: ${list.length} results, ${syncedCandidates.length} synced`);
            if (syncedCandidates.length > 0) {
              syncedCandidates.sort((a, b) => Math.abs((a.duration || durationSec) - durationSec) - Math.abs((b.duration || durationSec) - durationSec));
              rawSyncedLrc = syncedCandidates[0].syncedLyrics;
            }
          } else {
            lyrLog(`#${fetchId} search: 0 results`);
          }
        } catch (jsonErr) {
          lyrLog(`#${fetchId} search: body is not JSON (${jsonErr && jsonErr.message})`);
        }
      }
    } catch (e) { }
  }

  // Ensure this is still the active fetch and track hasn't changed
  if (fetchId !== lyricFetchSeq || state.playingTrackTitle !== trackName) {
    lyrLog(`#${fetchId} stale at end (now playing "${state.playingTrackTitle}"), dropped`);
    return;
  }

  state.lyricsLoading = false;

  // ONLY parse and illuminate genuine timestamped lyrics [mm:ss.xx]
  // Never use fake linear synchronization for plain text lyrics!
  if (rawSyncedLrc) {
    const parsed = parseLrcToWordSync(rawSyncedLrc, durationSec);
    if (parsed && parsed.length > 0) {
      lyrLog(`#${fetchId} OK ${parsed.length} lines, total ${Date.now() - tStart}ms`);
      lyricsMemoryCache.set(cacheKey, parsed);
      state.hasValidLyrics = true;
      state.loadedLyricsKey = cacheKey;
      state.activeLyrics = parsed;
      state.activeLineIndex = -1;
      buildLyricsDOM(parsed);
      updateNowPlayingRightPanelMode();
      updateScrubberAndLyricsUI(true);
      return;
    }
  }

  // Truly no synced lyrics found
  lyrLog(`#${fetchId} NO LYRICS shown, total ${Date.now() - tStart}ms`);
  state.hasValidLyrics = false;
  state.activeLyrics = [];
  state.lyricDOMCache = [];
  state.activeLineIndex = -1;
  if (lyricsScrollTrack) lyricsScrollTrack.innerHTML = '';
  updateNowPlayingRightPanelMode();
}

