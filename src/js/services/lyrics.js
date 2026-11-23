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

function parseMetaDurationSec(str) {
  if (!str) return 0;
  const m = String(str).match(/(?:(\d+):)?(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  if (m[1]) return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
  return parseFloat(m[2]) || 0;
}

function parseLyricsPlusWordSync(lyricsData, expectedDurationSec, cleanTrackTitle) {
  if (!lyricsData || !Array.isArray(lyricsData.lyrics) || lyricsData.lyrics.length === 0) {
    return null;
  }

  // 1. Strict Version & Mix Validation:
  // If the playing track is NOT a mix or radio edit, reject mismatched mixes (e.g. DJ mixes where intros are cut)
  const meta = lyricsData.metadata || {};
  const metaTitle = (meta.title || '').toLowerCase();
  const playingTitle = (cleanTrackTitle || '').toLowerCase();
  
  const isPlayingMix = playingTitle.includes('mix') || playingTitle.includes('remix') || playingTitle.includes('edit');
  const isResultMix = metaTitle.includes('mixed') || metaTitle.includes('dj mix') || metaTitle.includes('radio edit');
  if (!isPlayingMix && isResultMix) {
    lyrLog(`lyricsplus dropped: track is mixed/edit ("${meta.title}") but playing studio track`);
    return null;
  }

  // 2. Strict Duration Validation:
  // Compare expectedDurationSec (from Spotify) with totalDuration reported by LyricsPlus
  const metaDur = parseMetaDurationSec(meta.totalDuration);
  if (expectedDurationSec && expectedDurationSec > 0 && metaDur > 0) {
    const diff = Math.abs(metaDur - expectedDurationSec);
    if (diff > 4.5) {
      lyrLog(`lyricsplus dropped: duration mismatch (lp=${metaDur.toFixed(1)}s vs spotify=${expectedDurationSec}s, diff=${diff.toFixed(1)}s)`);
      return null;
    }
  }

  const lines = lyricsData.lyrics;
  const hasWordSync = lines.some(l => Array.isArray(l.syllabus) && l.syllabus.length > 0);
  if (!hasWordSync) {
    return null;
  }

  // 3. Last line end validation:
  const lastLine = lines[lines.length - 1];
  const lastLineEnd = ((lastLine.time || 0) + (lastLine.duration || 0)) / 1000;
  if (expectedDurationSec && expectedDurationSec > 30 && lastLineEnd < expectedDurationSec * 0.70) {
    lyrLog(`lyricsplus dropped: lyrics end too early (${lastLineEnd.toFixed(1)}s vs track ${expectedDurationSec}s)`);
    return null;
  }

  const parsed = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineStartSec = (rawLine.time || 0) / 1000;
    const lineDurSec = (rawLine.duration || 0) / 1000;
    const lineEndSec = lineStartSec + lineDurSec;
    const nextStartSec = i < lines.length - 1 ? (lines[i + 1].time || 0) / 1000 : (expectedDurationSec || lineEndSec + 4);

    let words = [];

    if (Array.isArray(rawLine.syllabus) && rawLine.syllabus.length > 0) {
      let currentWordText = '';
      let currentWordStart = null;
      let currentWordEnd = null;

      for (let s = 0; s < rawLine.syllabus.length; s++) {
        const syl = rawLine.syllabus[s];
        const sylStart = (syl.time || 0) / 1000;
        const sylDur = (syl.duration || 0) / 1000;
        const sylEnd = sylStart + sylDur;
        const sylText = syl.text || '';

        if (currentWordStart === null) {
          currentWordStart = sylStart;
        }
        currentWordText += sylText;
        currentWordEnd = sylEnd;

        const endsWithSpace = /\s+$/.test(sylText);
        const isLastSyl = s === rawLine.syllabus.length - 1;

        if (endsWithSpace || isLastSyl) {
          const trimmed = currentWordText.trim();
          if (trimmed) {
            words.push({
              text: trimmed,
              start: currentWordStart,
              end: Math.max(currentWordStart + 0.08, currentWordEnd)
            });
          }
          currentWordText = '';
          currentWordStart = null;
          currentWordEnd = null;
        }
      }
    }

    if (words.length > 0) {
      parsed.push({
        text: rawLine.text || words.map(w => w.text).join(' '),
        start: lineStartSec,
        end: lineEndSec > lineStartSec ? lineEndSec : words[words.length - 1].end,
        lineEnd: nextStartSec,
        words: words,
        isRealWordSync: true
      });
    }
  }

  return parsed.length > 0 ? parsed : null;
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
const MAX_LYRICS_CACHE_ENTRIES = 60;
const lyricsPrefetchInFlight = new Map();
const lyricsPrefetchAttempted = new Map();
const LYRICS_PREFETCH_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
let lyricsPrefetchSeq = 0;

const LRCLIB_MAX_DURATION_DIFF_SEC = 7;

function normalizeLyricsTrackMeta(trackName, artistName) {
  const rawTrack = String(trackName || '').trim();
  const rawArtist = String(artistName || '').trim();
  const cleanTrack = rawTrack.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*-\s*.*$/, '').trim() || rawTrack;
  const cleanArtist = rawArtist.replace(/\s*,\s*.*$/, '').trim() || rawArtist;
  const hasVariantTitle = Boolean(rawTrack && cleanTrack && rawTrack.toLowerCase() !== cleanTrack.toLowerCase());
  const keyTrack = hasVariantTitle ? rawTrack : cleanTrack;
  const cacheKey = keyTrack ? `${cleanArtist.toLowerCase()}::${keyTrack.toLowerCase()}` : '';
  return { rawTrack, cleanTrack, cleanArtist, hasVariantTitle, cacheKey };
}

function getLyricsTitleCandidates(meta) {
  if (!meta) return [];
  if (meta.hasVariantTitle && meta.rawTrack) {
    return meta.cleanTrack ? [meta.rawTrack, meta.cleanTrack] : [meta.rawTrack];
  }
  return meta.cleanTrack ? [meta.cleanTrack] : [];
}

function isLrclibDurationValid(candidateDuration, expectedDurationSec) {
  const cand = Number(candidateDuration);
  const exp = Number(expectedDurationSec);
  if (!Number.isFinite(cand) || cand <= 0 || !Number.isFinite(exp) || exp <= 0) {
    return true;
  }
  return Math.abs(cand - exp) <= LRCLIB_MAX_DURATION_DIFF_SEC;
}

function buildLyricsPlusUrl(trackTitle, artistName, durationSec) {
  const durParam = durationSec && durationSec > 0 ? `&duration=${Math.round(durationSec)}` : '';
  return `https://lyricsplus.binimum.org/v2/lyrics/get?title=${encodeURIComponent(trackTitle)}&artist=${encodeURIComponent(artistName)}${durParam}`;
}

function buildLrclibGetUrl(trackTitle, artistName, durationSec) {
  const durParam = durationSec && durationSec > 0 ? `&duration=${Math.round(durationSec)}` : '';
  return `https://lrclib.net/api/get?track_name=${encodeURIComponent(trackTitle)}&artist_name=${encodeURIComponent(artistName)}${durParam}`;
}

async function fetchLyricsPlusCandidates(meta, durationSec, fetchId, tag, timeoutMs, shouldAbortFn) {
  const titles = getLyricsTitleCandidates(meta);
  for (const titleCandidate of titles) {
    if (shouldAbortFn && shouldAbortFn()) return null;
    try {
      const lpUrl = buildLyricsPlusUrl(titleCandidate, meta.cleanArtist, durationSec);
      const lpRes = await timedLyricsFetch(tag, fetchId, lpUrl, timeoutMs);
      if (shouldAbortFn && shouldAbortFn()) return null;
      if (lpRes && lpRes.ok) {
        const lpData = await lpRes.json();
        const wordParsed = parseLyricsPlusWordSync(lpData, durationSec, meta.rawTrack || titleCandidate);
        if (wordParsed && wordParsed.length > 0) {
          return wordParsed;
        }
      }
    } catch (e) { }
  }
  return null;
}

async function fetchLrclibGetCandidates(meta, durationSec, fetchId, tag, timeoutMs, allowRetry, shouldAbortFn) {
  const titles = getLyricsTitleCandidates(meta);
  for (const titleCandidate of titles) {
    if (shouldAbortFn && shouldAbortFn()) return null;
    try {
      const getUrl = buildLrclibGetUrl(titleCandidate, meta.cleanArtist, durationSec);
      let res = await timedLyricsFetch(tag, fetchId, getUrl, timeoutMs);
      if (shouldAbortFn && shouldAbortFn()) return null;

      if (allowRetry && (!res || res.status >= 500)) {
        await new Promise(r => setTimeout(r, 700));
        if (shouldAbortFn && shouldAbortFn()) return null;
        res = await timedLyricsFetch(`${tag}-retry`, fetchId, getUrl, timeoutMs + 1500);
        if (shouldAbortFn && shouldAbortFn()) return null;
      }

      if (res && res.ok) {
        try {
          const data = await res.json();
          if (data && !data.instrumental && data.syncedLyrics) {
            if (isLrclibDurationValid(data.duration, durationSec)) {
              return data.syncedLyrics;
            }
            lyrLog(`#${fetchId} ${tag} dropped duration mismatch (lrc=${data.duration}s vs spotify=${durationSec}s) for "${titleCandidate}"`);
          } else {
            lyrLog(`#${fetchId} ${tag}: no syncedLyrics (instrumental=${data && data.instrumental})`);
          }
        } catch (jsonErr) {
          lyrLog(`#${fetchId} ${tag}: body is not JSON (${jsonErr && jsonErr.message})`);
        }
      }
    } catch (e) { }
  }
  return null;
}

function setLyricsMemoryCache(cacheKey, parsedLines) {
  if (!cacheKey || !Array.isArray(parsedLines) || parsedLines.length === 0) return;
  if (lyricsMemoryCache.has(cacheKey)) {
    lyricsMemoryCache.delete(cacheKey);
  }
  lyricsMemoryCache.set(cacheKey, parsedLines);
  while (lyricsMemoryCache.size > MAX_LYRICS_CACHE_ENTRIES) {
    const oldestKey = lyricsMemoryCache.keys().next().value;
    if (!oldestKey) break;
    lyricsMemoryCache.delete(oldestKey);
  }
}

async function prefetchSingleTrackLyrics(track) {
  if (!track || typeof track !== 'object') return null;
  const trackName = track.title || track.name || '';
  const artistName = (Array.isArray(track.artists) && track.artists[0] && track.artists[0].name)
    ? track.artists[0].name
    : (track.artist || '');
  const meta = normalizeLyricsTrackMeta(trackName, artistName);
  const { cacheKey } = meta;
  if (!cacheKey) return null;
  if (cacheKey === activeLyricTrackKey || cacheKey === state.loadedLyricsKey) return null;

  if (lyricsMemoryCache.has(cacheKey)) {
    return { lines: lyricsMemoryCache.get(cacheKey), triedLyricsPlus: true, triedLrclibGet: false };
  }
  if (lyricsPrefetchInFlight.has(cacheKey)) {
    return lyricsPrefetchInFlight.get(cacheKey);
  }
  const lastMissAt = lyricsPrefetchAttempted.get(cacheKey) || 0;
  if (lastMissAt && (Date.now() - lastMissAt) < LYRICS_PREFETCH_RETRY_COOLDOWN_MS) {
    return null;
  }

  const durationSec = track.duration_ms
    ? Math.round(track.duration_ms / 1000)
    : (track.duration || 0);

  const task = (async () => {
    const wordParsed = await fetchLyricsPlusCandidates(meta, durationSec, 0, 'prefetch-lp', 3600, null);
    if (wordParsed && wordParsed.length > 0) {
      setLyricsMemoryCache(cacheKey, wordParsed);
      lyrLog(`prefetch CACHE HIT (lyricsplus) "${cacheKey}" (${wordParsed.length} lines)`);
      return { lines: wordParsed, triedLyricsPlus: true, triedLrclibGet: false };
    }

    const rawSyncedLrc = await fetchLrclibGetCandidates(meta, durationSec, 0, 'prefetch-get', 4500, false, null);
    if (rawSyncedLrc) {
      const parsed = parseLrcToWordSync(rawSyncedLrc, durationSec);
      if (parsed && parsed.length > 0) {
        setLyricsMemoryCache(cacheKey, parsed);
        lyrLog(`prefetch CACHE HIT (lrclib) "${cacheKey}" (${parsed.length} lines)`);
        return { lines: parsed, triedLyricsPlus: true, triedLrclibGet: true };
      }
    }

    lyricsPrefetchAttempted.set(cacheKey, Date.now());
    if (lyricsPrefetchAttempted.size > 120) {
      const oldestMiss = lyricsPrefetchAttempted.keys().next().value;
      if (oldestMiss) lyricsPrefetchAttempted.delete(oldestMiss);
    }
    return { lines: null, triedLyricsPlus: true, triedLrclibGet: true };
  })().finally(() => {
    lyricsPrefetchInFlight.delete(cacheKey);
  });

  lyricsPrefetchInFlight.set(cacheKey, task);
  return task;
}

async function prefetchUpcomingLyrics(tracksList, maxCount = 2) {
  if (!Array.isArray(tracksList) || tracksList.length === 0) return;
  const slice = tracksList.slice(0, Math.max(1, maxCount));
  const seq = ++lyricsPrefetchSeq;

  if (state.lyricsLoading) {
    await new Promise(r => setTimeout(r, 350));
    if (seq !== lyricsPrefetchSeq) return;
  }

  for (let i = 0; i < slice.length; i++) {
    if (seq !== lyricsPrefetchSeq) return;
    await prefetchSingleTrackLyrics(slice[i]);
  }
}

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
  const meta = normalizeLyricsTrackMeta(trackName, artistName);
  const { rawTrack, cleanTrack, cleanArtist, cacheKey } = meta;
  if (!cleanTrack) return;

  // If lyrics are already loaded and displayed for this exact song, never wipe or re-fetch!
  // (Compare against the key the loaded lyrics belong to; playingTrackTitle is already updated by the caller.)
  if (state.hasValidLyrics && state.activeLyrics && state.activeLyrics.length > 0 && state.loadedLyricsKey === cacheKey) {
    lyrLog(`skip "${cacheKey}": already loaded`);
    state.lyricsLoading = false;
    if (lyricsScrollTrack) lyricsScrollTrack.classList.remove('lyrics-fade-out');
    updateNowPlayingRightPanelMode();
    if (!state.lyricsManualScrolling) {
      updateScrubberAndLyricsUI(true);
    }
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
  if (typeof exitLyricsManualScroll === 'function') {
    exitLyricsManualScroll({ skipSnapBack: true });
  }

  // Check instant in-memory cache (0ms)
  if (lyricsMemoryCache.has(cacheKey)) {
    const cached = lyricsMemoryCache.get(cacheKey);
    if (cached && cached.length > 0) {
      lyrLog(`#${fetchId} memory cache hit (${cached.length} lines)`);
      setLyricsMemoryCache(cacheKey, cached);
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
  updateNowPlayingRightPanelMode();

  // If a background queue prefetch is already in flight for this exact track, join it seamlessly
  let skipLyricsPlus = false;
  let skipLrclibGet = false;
  if (lyricsPrefetchInFlight.has(cacheKey)) {
    try {
      const prefResult = await lyricsPrefetchInFlight.get(cacheKey);
      if (fetchId !== lyricFetchSeq) { lyrLog(`#${fetchId} stale after prefetch join, dropped`); return; }
      if (prefResult && Array.isArray(prefResult.lines) && prefResult.lines.length > 0) {
        lyrLog(`#${fetchId} joined in-flight prefetch (${prefResult.lines.length} lines in ${Date.now() - tStart}ms)`);
        setLyricsMemoryCache(cacheKey, prefResult.lines);
        state.lyricsLoading = false;
        state.hasValidLyrics = true;
        state.loadedLyricsKey = cacheKey;
        state.activeLyrics = prefResult.lines;
        state.activeLineIndex = -1;
        buildLyricsDOM(prefResult.lines);
        updateNowPlayingRightPanelMode();
        updateScrubberAndLyricsUI(true);
        return;
      }
      if (prefResult) {
        skipLyricsPlus = Boolean(prefResult.triedLyricsPlus);
        skipLrclibGet = Boolean(prefResult.triedLrclibGet);
      }
    } catch (e) { }
  }

  const isStaleFetch = () => fetchId !== lyricFetchSeq;

  // STEP 0: High-fidelity Apple Music TTML Word-Sync via LyricsPlus (Truth Source)
  if (!skipLyricsPlus) {
    const wordParsed = await fetchLyricsPlusCandidates(meta, durationSec, fetchId, 'lyricsplus-wordsync', 3800, isStaleFetch);
    if (isStaleFetch()) { lyrLog(`#${fetchId} stale after lyricsplus, dropped`); return; }
    if (wordParsed && wordParsed.length > 0) {
      lyrLog(`#${fetchId} OK REAL APPLE MUSIC WORD-SYNC ${wordParsed.length} lines in ${Date.now() - tStart}ms`);
      setLyricsMemoryCache(cacheKey, wordParsed);
      state.lyricsLoading = false;
      state.hasValidLyrics = true;
      state.loadedLyricsKey = cacheKey;
      state.activeLyrics = wordParsed;
      state.activeLineIndex = -1;
      buildLyricsDOM(wordParsed);
      updateNowPlayingRightPanelMode();
      updateScrubberAndLyricsUI(true);
      return;
    }
  }

  let rawSyncedLrc = null;

  // STEP 1: Direct lookup via /api/get (tries exact track title first, then clean fallback, with duration check)
  if (!skipLrclibGet && !isStaleFetch()) {
    rawSyncedLrc = await fetchLrclibGetCandidates(meta, durationSec, fetchId, 'get', 5000, true, isStaleFetch);
    if (isStaleFetch()) { lyrLog(`#${fetchId} stale after get, dropped`); return; }
  }

  // STEP 2: Fallback search (tries variation title first, then clean title, strictly bounded by duration diff)
  if (!rawSyncedLrc && !isStaleFetch()) {
    const searchTitles = getLyricsTitleCandidates(meta);
    for (const searchTitle of searchTitles) {
      if (isStaleFetch() || rawSyncedLrc) break;
      try {
        const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(searchTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
        const res = await timedLyricsFetch('search', fetchId, searchUrl, 7500);
        if (isStaleFetch()) { lyrLog(`#${fetchId} stale after search, dropped`); return; }
        if (res && res.ok) {
          try {
            const list = await res.json();
            if (Array.isArray(list) && list.length > 0) {
              const syncedCandidates = list.filter(item =>
                item && !item.instrumental && item.syncedLyrics && isLrclibDurationValid(item.duration, durationSec)
              );
              lyrLog(`#${fetchId} search ("${searchTitle}"): ${list.length} results, ${syncedCandidates.length} valid synced`);
              if (syncedCandidates.length > 0) {
                syncedCandidates.sort((a, b) => Math.abs((a.duration || durationSec) - durationSec) - Math.abs((b.duration || durationSec) - durationSec));
                rawSyncedLrc = syncedCandidates[0].syncedLyrics;
              }
            } else {
              lyrLog(`#${fetchId} search ("${searchTitle}"): 0 results`);
            }
          } catch (jsonErr) {
            lyrLog(`#${fetchId} search: body is not JSON (${jsonErr && jsonErr.message})`);
          }
        }
      } catch (e) { }
    }
  }

  // Ensure this is still the active fetch and track/version hasn't changed
  if (fetchId !== lyricFetchSeq) {
    lyrLog(`#${fetchId} stale seq at end (now playing "${state.playingTrackTitle}"), dropped`);
    return;
  }
  const currentMeta = normalizeLyricsTrackMeta(state.playingTrackTitle || '', artistName);
  const sameExactVersion = currentMeta.rawTrack.toLowerCase() === rawTrack.toLowerCase();
  const samePlainTrack = !currentMeta.hasVariantTitle && !meta.hasVariantTitle &&
    currentMeta.cleanTrack.toLowerCase() === cleanTrack.toLowerCase();
  if (!sameExactVersion && !samePlainTrack && state.playingTrackTitle !== trackName) {
    lyrLog(`#${fetchId} stale track at end (now playing "${state.playingTrackTitle}"), dropped`);
    state.lyricsLoading = false;
    return;
  }

  state.lyricsLoading = false;

  // ONLY parse and illuminate genuine timestamped lyrics [mm:ss.xx]
  // Never use fake linear synchronization for plain text lyrics!
  if (rawSyncedLrc) {
    const parsed = parseLrcToWordSync(rawSyncedLrc, durationSec);
    if (parsed && parsed.length > 0) {
      lyrLog(`#${fetchId} OK ${parsed.length} lines, total ${Date.now() - tStart}ms`);
      setLyricsMemoryCache(cacheKey, parsed);
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
  if (lyricsScrollTrack) {
    lyricsScrollTrack.innerHTML = '';
    lyricsScrollTrack.classList.remove('lyrics-fade-out');
  }
  updateNowPlayingRightPanelMode();
}

const lyricsAutoRetryMap = new Set();

function ensureLyricsLoadedForCurrentTrack(reason = 'auto') {
  if (!state.playingTrackTitle || state.lyricsLoading) return;
  const trackName = state.playingTrackTitle;
  const artistName = (Array.isArray(state.playingArtists) && state.playingArtists[0] && state.playingArtists[0].name)
    ? state.playingArtists[0].name
    : (state.playingArtist ? state.playingArtist.split(',')[0].trim() : '');
  const { cacheKey } = normalizeLyricsTrackMeta(trackName, artistName);

  if (state.hasValidLyrics && state.loadedLyricsKey === cacheKey && Array.isArray(state.activeLyrics) && state.activeLyrics.length > 0) {
    if (lyricsScrollTrack) lyricsScrollTrack.classList.remove('lyrics-fade-out');
    if (typeof updateNowPlayingRightPanelMode === 'function') updateNowPlayingRightPanelMode();
    if (typeof updateScrubberAndLyricsUI === 'function') updateScrubberAndLyricsUI(true);
    return;
  }

  if (reason !== 'manual') {
    const bucket = reason === 'duration_update' ? 'dur' : 'auto';
    const retryKey = `${cacheKey}::${bucket}`;
    if (lyricsAutoRetryMap.has(retryKey)) return;
    lyricsAutoRetryMap.add(retryKey);
    if (lyricsAutoRetryMap.size > 80) {
      const oldestKey = lyricsAutoRetryMap.values().next().value;
      if (oldestKey) lyricsAutoRetryMap.delete(oldestKey);
    }
  }

  const dur = state.playingTrackHasRealDuration ? (state.durationSec || 0) : 0;
  fetchSyncedLyricsForTrack(trackName, artistName, state.playingAlbumTitle || '', dur);
}

