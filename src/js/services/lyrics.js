/* ==========================================================================
   SERVICE: LRCLIB Synced Lyrics Client & Word-by-Word Karaoke Parser
   ========================================================================== */
'use strict';

// --------------------------------------------------------------------------
// 5. LRCLIB SYNCED LYRICS ENGINE (APPLE MUSIC WORD-BY-WORD KARAOKE)
// --------------------------------------------------------------------------
const ADLIB_REGEX = /^(ey|eh|yeah|yea|uh|oh|yah|hey|mmm|mm|ok|okay|wuh|wow|ha|no|yes|baby|yo|ya|ah|ajá|aja|dile|tra|brr|prr|pa|shh|uy|ay|olé|ole|uh-huh|uh-oh)$/i;

function estimateWordSyllables(cleanWord) {
  if (!cleanWord) return 1;
  const lower = cleanWord.toLowerCase();
  const vowelGroups = lower.match(/[aeiouáéíóúü]+/g);
  if (!vowelGroups) return Math.max(1, cleanWord.length * 0.45);
  let count = vowelGroups.length;
  // Silent trailing 'e' in common English words (e.g. "love", "time", "make")
  if (count > 1 && /[b-df-hj-np-tv-z]e$/.test(lower) && !/(le|re)$/.test(lower)) {
    count -= 0.35;
  }
  return Math.max(1, count);
}

function parseLrcToWordSync(lrcString, totalDuration) {
  const lines = lrcString.split('\n');
  const parsed = [];
  const timeRegex = /^\s*\[(\d+):(\d+(?:\.\d+)?)\](.*)/;
  const inlineWordRegex = /[<\[](?:\d+):(?:\d+(?:\.\d+)?)[>\]]/g;

  lines.forEach(raw => {
    const m = raw.match(timeRegex);
    if (m) {
      const mins = parseInt(m[1], 10);
      const secs = parseFloat(m[2]);
      const timestamp = mins * 60 + secs;
      let text = m[3].trim();
      // Strip dual-language translation tags (e.g. "Original line ^ English translation")
      if (text.includes('^')) {
        text = text.split('^')[0].trim();
      }
      // Clean inline enhanced-LRC tags if present
      if (inlineWordRegex.test(text)) {
        text = text.replace(inlineWordRegex, ' ').replace(/\s+/g, ' ').trim();
      }
      if (text) {
        parsed.push({ start: timestamp, text, explicitEnd: null });
      } else if (parsed.length > 0 && parsed[parsed.length - 1].explicitEnd === null) {
        // Blank timestamped line in LRC marks the exact end of the previous vocal line
        parsed[parsed.length - 1].explicitEnd = timestamp;
      }
    }
  });

  if (parsed.length === 0) return null;

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const nextStart = i < parsed.length - 1 ? parsed[i + 1].start : (totalDuration || item.start + 5);
    const gap = Math.max(0.2, nextStart - item.start);

    // Clean text to analyze whether this line is an ad-lib or an ongoing verse
    const cleanOnlyLetters = item.text.replace(/[\(\)\[\]¡!¿?.,;:]/g, '').trim();
    const words = cleanOnlyLetters.split(/\s+/).filter(Boolean);
    const isParenthesized = /^\(.*\)$/.test(item.text.trim());
    const isSingleShortWord = words.length === 1 && (words[0].length <= 4 || ADLIB_REGEX.test(words[0]));
    const isAdlibLine = isSingleShortWord || (words.length <= 2 && ADLIB_REGEX.test(words[0])) || (isParenthesized && words.length <= 3);

    let naturalDur;
    if (isAdlibLine) {
      // Short ad-libs and interjections (e.g. "Ey", "Yeah", "Uh", "(Dile)"):
      // Keep snappy (0.30s - 0.52s) so they never crawl in slow motion across 3s of silence
      naturalDur = Math.min(gap - 0.08, words.length === 1 ? 0.36 : 0.54);
      naturalDur = Math.max(0.26, naturalDur);
    } else {
      // Normal singing lines:
      // In vocal tracks, lines with gap <= 4.2s flow directly into each other.
      // Fill the vocal bridge leaving only a gentle 0.12s breath before nextStart,
      // preventing lines from ending prematurely while the singer is still holding notes!
      if (gap <= 4.2) {
        naturalDur = Math.max(0.6, gap - 0.12);
      } else {
        // True instrumental interlude / solo gap (> 4.2s):
        // Calculate singing phrase from syllables and phrase-ending hold, then cut cleanly
        // so the remaining time triggers the Apple Music 3-dot interlude (• • •)
        const totalSyllables = words.reduce((acc, w) => acc + estimateWordSyllables(w), 0);
        const estimatedSingingTime = totalSyllables * 0.30 + words.length * 0.16 + 0.70;
        naturalDur = Math.min(gap - 0.30, Math.min(5.8, Math.max(1.5, estimatedSingingTime)));
      }
    }

    const rawEnd = item.explicitEnd !== null
      ? Math.min(nextStart, item.explicitEnd)
      : (item.start + naturalDur);

    item.end = Math.max(item.start + 0.25, Math.min(nextStart - 0.06, rawEnd));
    item.lineEnd = nextStart;
    item.isAdlib = isAdlibLine;
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
  state.interludeDOMCache = [];
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

