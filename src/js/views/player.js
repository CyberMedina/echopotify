/* ==========================================================================
   VIEW: Live Playback Sync, 60fps Apple Music Sing Lyrics & Queue Controller
   ========================================================================== */
'use strict';

// --------------------------------------------------------------------------
// 8. LIVE PLAYBACK POLLING & UI SYNCHRONIZATION
// --------------------------------------------------------------------------
function syncClockWithHardware(allowSnap = false) {
  if (!bridge || !bridge.getPlaybackClockJson) return false;
  try {
    const hw = JSON.parse(bridge.getPlaybackClockJson());
    if (hw && (hw.loading || hw.playing || hw.flowing)) {
      const hwSec = (hw.posMs || 0) / 1000;
      const wasFlowing = !!state.pcmFlowing;
      state.pcmFlowing = !!hw.flowing;
      if (hw.loading) {
        state.clockRate = 1.0;
        if (allowSnap) state.currentTimeSec = 0;
      } else {
        // Guard against spurious 0s: If track is actively playing past 10s and hwSec drops near 0 without allowSnap, ignore!
        if (!allowSnap && state.currentTimeSec > 10 && hwSec < 2) {
          return true;
        }
        const drift = hwSec - state.currentTimeSec;
        if (allowSnap || !wasFlowing || Math.abs(drift) > 0.45) {
          state.currentTimeSec = hwSec;
          state.clockRate = 1.0;
        } else {
          // Soft-PLL drift correction: never jump time backwards during active lyric sync
          state.clockRate = Math.min(1.08, Math.max(0.92, 1.0 + drift * 0.45));
        }
      }
      return true;
    }
  } catch (e) { }
  return false;
}

let coverCrossfadeTimer = null;
let lastCoverCrossfadeAt = 0;
let metaSwapTimer = null;
let scrubberResetTimer = null;

function crossfadeNowPlayingCover( rawCoverUrl, thumbUrl, animateSwap) {
  const coverUrl = ensureHighResSpotifyCover(rawCoverUrl);
  if (!npCoverArt || !coverUrl) return;
  const prevSrc = npCoverArt.getAttribute('src') || npCoverArt.dataset.currentSrc || '';
  const isInitialPlaceholder = !prevSrc || prevSrc.startsWith('data:image/svg+xml');
  const now = Date.now();
  const rapidUpdate = (now - lastCoverCrossfadeAt) < 260;

  npCoverArt.dataset.currentSrc = coverUrl;

  if (!animateSwap || isInitialPlaceholder || !npCoverGhost || prevSrc === coverUrl || rapidUpdate) {
    if (coverUrl.startsWith('data:') || decodedImageUrls.has(coverUrl)) {
      if (npCoverArt.getAttribute('src') !== coverUrl) {
        npCoverArt.src = coverUrl;
      }
      npCoverArt.style.opacity = '1';
      if (npCoverGhost && !coverCrossfadeTimer) {
        npCoverGhost.src = coverUrl;
      }
    } else {
      decodeImageInBackground(coverUrl).then(() => {
        if (state.lastRenderedCover === coverUrl) {
          npCoverArt.src = coverUrl;
          npCoverArt.style.opacity = '1';
          if (npCoverGhost && !coverCrossfadeTimer) {
            npCoverGhost.src = coverUrl;
          }
        }
      });
    }
    if (!rapidUpdate && npCoverGhost) {
      npCoverGhost.style.opacity = '0';
      npCoverGhost.classList.remove('ghost-fading');
    }
    return;
  }

  lastCoverCrossfadeAt = now;

  // Cross-dissolve puro y estable en 1 solo paso (640x640 -> 640x640) sin rebote ni pop final
  const executeAppleMusicCoverTransition = (hdUrl) => {
    if (state.lastRenderedCover !== coverUrl) return;
    clearTimeout(coverCrossfadeTimer);

    npCoverGhost.style.transition = 'none';
    npCoverGhost.classList.remove('ghost-fading');
    if (npCoverGhost.getAttribute('src') !== prevSrc) {
      npCoverGhost.src = prevSrc;
    }
    npCoverGhost.style.opacity = '1';

    npCoverArt.src = hdUrl;
    npCoverArt.style.opacity = '1';

    void npCoverGhost.offsetWidth;
    npCoverGhost.style.transition = '';

    requestAnimationFrame(() => {
      npCoverGhost.classList.add('ghost-fading');
      coverCrossfadeTimer = setTimeout(() => {
        npCoverGhost.style.opacity = '0';
        npCoverGhost.classList.remove('ghost-fading');
        coverCrossfadeTimer = null;
        const settledSrc = npCoverArt.getAttribute('src') || hdUrl;
        if (npCoverGhost.getAttribute('src') !== settledSrc) {
          npCoverGhost.src = settledSrc;
        }
      }, 380);
    });
  };

  if (coverUrl.startsWith('data:') || decodedImageUrls.has(coverUrl)) {
    executeAppleMusicCoverTransition(coverUrl);
    return;
  }

  decodeImageInBackground(coverUrl).then(() => {
    if (state.lastRenderedCover === coverUrl) {
      executeAppleMusicCoverTransition(coverUrl);
    }
  });
}

function resolveArtistIdByName(name) {
  if (!name) return null;
  const clean = name.trim().toLowerCase();
  if (Array.isArray(liveCatalog.artists)) {
    const found = liveCatalog.artists.find(a => a && (a.title || a.name || '').trim().toLowerCase() === clean);
    if (found && found.id) return found.id;
  }
  const entities = Object.values(liveCatalog.entities || {});
  const entityFound = entities.find(e => e && e.type === 'artist' && (e.title || e.name || '').trim().toLowerCase() === clean);
  if (entityFound && entityFound.id) return entityFound.id;
  return clean.replace(/[^a-z0-9]/g, '_') || null;
}

function parseArtistsList(trackObj) {
  if (!trackObj) return [];

  if (Array.isArray(trackObj.artists) && trackObj.artists.length > 0) {
    return trackObj.artists.map(a => {
      const rawId = a.id || (a.uri ? a.uri.replace('spotify:artist:', '') : null);
      const name = (a.name || '').trim();
      return {
        id: rawId ? (rawId.startsWith('art_') ? rawId : `art_${rawId}`) : resolveArtistIdByName(name),
        name: name,
        uri: a.uri || (rawId ? `spotify:artist:${rawId}` : null)
      };
    });
  }

  const artistStr = (typeof trackObj.artist === 'string' ? trackObj.artist : (trackObj.artistName || '')).trim();
  if (!artistStr) return [];

  // Split by comma or feat/ft, e.g. "Bad Bunny, Chencho Corleone"
  const splitNames = artistStr.split(/\s*,\s*|\s+feat\.?\s+|\s+ft\.?\s+/i).map(s => s.trim()).filter(Boolean);
  if (splitNames.length === 0) {
    splitNames.push(artistStr);
  }

  return splitNames.map(name => {
    return {
      id: resolveArtistIdByName(name),
      name: name
    };
  });
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderArtistLinksInto(containerEl, artistsList, className) {
  if (!containerEl) return;
  if (!Array.isArray(artistsList) || artistsList.length === 0) {
    containerEl.textContent = state.playingArtist || 'Spotify Echo';
    return;
  }
  containerEl.innerHTML = artistsList.map((art, idx) => {
    const artId = escapeHtml(art.id || '');
    const artName = escapeHtml(art.name || '');
    return `<span class="${className}" data-artist-index="${idx}" data-artist-id="${artId}" data-artist-name="${artName}" role="button" tabindex="0">${artName}</span>`;
  }).join('<span class="artist-sep">, </span>');
}

async function navigateToArtist(artistIdOrRef, artistName) {
  if (state.isNowPlayingOpen) {
    closeNowPlaying();
  }

  let targetId = artistIdOrRef;
  const cleanName = (artistName || '').trim();

  // Conservar el ID real de Spotify si viene desde la canción en reproducción
  if (!targetId || targetId === 'null' || targetId === 'undefined') {
    targetId = resolveArtistIdByName(cleanName);
  }

  await openArtistDetail(targetId, cleanName);
}

function transitionTrackMetadataUI(newTitle, newArtist, thumbUrl, animateSwap) {
  const titleChanged = state.lastRenderedTitle !== newTitle;
  const artistChanged = state.lastRenderedArtistLine !== newArtist;
  const thumbChanged = state.lastRenderedThumb !== thumbUrl;
  if (!titleChanged && !artistChanged && !thumbChanged) return;

  const hadPreviousTitle = Boolean(state.lastRenderedTitle);
  state.lastRenderedTitle = newTitle;
  state.lastRenderedArtistLine = newArtist;
  state.lastRenderedThumb = thumbUrl;

  const applyValues = () => {
    if (titleChanged) {
      miniPlayerTitle.textContent = newTitle;
      npTrackTitle.textContent = newTitle;
      if (npQueueCurrentTitle) {
        npQueueCurrentTitle.textContent = newTitle;
      }
    }
    if (artistChanged || !state.lastRenderedArtistRendered) {
      state.lastRenderedArtistRendered = true;
      // In mini-player: plain text, cannot access artist from mini-player
      miniPlayerArtist.textContent = newArtist;
      // In Now Playing & Queue: interactive artist links (supports 1 or multiple artists)
      renderArtistLinksInto(npTrackArtist, state.playingArtists, 'np-artist-link');
      if (npQueueCurrentArtist) renderArtistLinksInto(npQueueCurrentArtist, state.playingArtists, 'np-artist-link');
    }
    if (thumbChanged && thumbUrl) {
      swapHeroImageAtomically(miniPlayerThumb, thumbUrl, thumbUrl);
      if (npQueueCurrentThumb) swapHeroImageAtomically(npQueueCurrentThumb, thumbUrl, thumbUrl);
    }
  };

  if (!animateSwap || !hadPreviousTitle) {
    applyValues();
    return;
  }

  clearTimeout(metaSwapTimer);
  if (npMetaTextCol) npMetaTextCol.classList.add('track-meta-out');
  if (miniPlayerLeft) miniPlayerLeft.classList.add('track-meta-out');

  metaSwapTimer = setTimeout(() => {
    applyValues();
    if (npMetaTextCol) {
      npMetaTextCol.classList.remove('track-meta-out');
      npMetaTextCol.classList.add('track-meta-in-prep');
    }
    if (miniPlayerLeft) {
      miniPlayerLeft.classList.remove('track-meta-out');
      miniPlayerLeft.classList.add('track-meta-in-prep');
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (npMetaTextCol) npMetaTextCol.classList.remove('track-meta-in-prep');
        if (miniPlayerLeft) miniPlayerLeft.classList.remove('track-meta-in-prep');
      });
    });
  }, 145);
}

function applyTrackToUI(trackObj, progressSec = 0, isPlaying = false, source = 'user') {
  const artistsList = parseArtistsList(trackObj);
  const artistName = artistsList.map(a => a.name).join(', ') || (trackObj.artist || 'Spotify');
  const albumName = trackObj.album ? (trackObj.album.name || trackObj.album) : '';
  const imgs = (trackObj.album && Array.isArray(trackObj.album.images)) ? trackObj.album.images : [];
  const rawCoverUrl = imgs.length > 0
    ? getSpotifyImage(imgs, 'large')
    : (trackObj.coverLarge || trackObj.cover || state.playingCover);
  const coverUrl = ensureHighResSpotifyCover(rawCoverUrl);
  const thumbUrl = imgs.length > 0
    ? (getSpotifyImage(imgs, 'small') || getSpotifyImage(imgs, 'medium') || coverUrl)
    : (trackObj.thumb || trackObj.cover || coverUrl);
  const durationSec = trackObj.duration_ms ? Math.round(trackObj.duration_ms / 1000) : (trackObj.duration || 220);

  const nextTitle = (trackObj.name || trackObj.title || '').trim();
  const nextId = cleanTrackId(trackObj.id || trackObj.uri || nextTitle);
  const isFirstTrack = !state.playingTrackId && Boolean(nextId || nextTitle);
  const trackChanged = isFirstTrack || (state.playingTrackId !== nextId) || (state.playingTrackTitle !== nextTitle);
  const shouldAnimateTransition = trackChanged && !isFirstTrack;

  // Si es una acción directa del usuario para reproducir/cambiar canción, blindar el estado
  // para que ningún poll o evento rezagado de la canción anterior revierta la UI
  if (source === 'user' && isPlaying) {
    const prevId = state.playingTrackId || state.lastConfirmedApiTrackId || '';
    const prevTitle = state.playingTrackTitle || state.lastConfirmedApiTrackTitle || '';
    const rawUri = trackObj.uri || '';
    const isContextOnly = rawUri.startsWith('spotify:playlist:') || rawUri.startsWith('spotify:album:') || rawUri.startsWith('spotify:artist:');
    lockUserPlaybackIntent('track_switch', {
      durationMs: 4200,
      prevId,
      prevTitle,
      targetId: nextId,
      targetTitle: nextTitle,
      isSpecificTrack: !isContextOnly,
      targetIsPlaying: true
    });
  }

  state.playingTrackId = nextId;
  state.playingTrackUri = trackObj.uri || (nextId ? `spotify:track:${nextId}` : null);
  state.playingTrackTitle = nextTitle;
  state.playingArtist = artistName;
  state.playingArtists = artistsList;
  state.playingArtistId = (artistsList && artistsList[0] && artistsList[0].id) ? artistsList[0].id : state.playingArtistId;
  state.playingAlbumTitle = albumName;
  state.playingCover = coverUrl;
  state.playingThumb = thumbUrl;
  state.durationSec = durationSec;

  // Use hardware PCM clock when playing on Echo Show 8; only fall back to HTTP progress_ms for remote devices
  const usedHwClock = syncClockWithHardware(trackChanged);

  if (!usedHwClock) {
    if (trackChanged || !state.isPlaying || !isPlaying) {
      state.currentTimeSec = progressSec;
      state.clockRate = 1.0;
    } else {
      const drift = progressSec - state.currentTimeSec;
      if (Math.abs(drift) > 1.55) {
        state.currentTimeSec = progressSec;
        state.clockRate = 1.0;
      } else {
        state.clockRate = Math.min(1.08, Math.max(0.92, 1.0 + drift * 0.28));
      }
    }
    state.pcmFlowing = isPlaying;
  }
  state.isPlaying = isPlaying;

  // Guarded DOM mutations with smooth cross-dissolve on song switch
  if (state.lastRenderedCover !== coverUrl && coverUrl) {
    state.lastRenderedCover = coverUrl;
    crossfadeNowPlayingCover(coverUrl, thumbUrl, shouldAnimateTransition);
  }
  transitionTrackMetadataUI(state.playingTrackTitle, artistName, thumbUrl, shouldAnimateTransition);

  updatePlayPauseIcons();

  if (trackChanged) {
    lyrLog(`trackChanged -> "${nextTitle}" id=${nextId} progress=${progressSec.toFixed(1)}s`);
    if (shouldAnimateTransition && npScrubberFill) {
      clearTimeout(scrubberResetTimer);
      npScrubberFill.classList.add('scrubber-resetting');
      scrubberResetTimer = setTimeout(() => {
        npScrubberFill.classList.remove('scrubber-resetting');
      }, 360);
    }
    extractDynamicPaletteFromCover(coverUrl, false);
    fetchSyncedLyricsForTrack(
      state.playingTrackTitle,
      trackObj.artists ? trackObj.artists[0].name : artistName,
      albumName,
      durationSec
    );
    fetchAndRenderQueueForCurrentTrack(trackObj);
    if (trackObj.id) {
      const isLocallyLiked = liveCatalog.likedTrackIds.has(trackObj.id);
      spotifyAuth.isLiked = isLocallyLiked;
      updateLikeButtonsUI(isLocallyLiked);
      spotifyFetch(`/me/tracks/contains?ids=${trackObj.id}`).then(res => {
        if (Array.isArray(res)) {
          spotifyAuth.isLiked = !!res[0];
          if (spotifyAuth.isLiked) {
            liveCatalog.likedTrackIds.add(trackObj.id);
          } else {
            liveCatalog.likedTrackIds.delete(trackObj.id);
          }
          updateLikeButtonsUI(spotifyAuth.isLiked);
        }
      }).catch(e => console.warn('[tracks/contains error]', e));
    } else {
      updateLikeButtonsUI(false);
    }
    updateScrubberAndLyricsUI(true);
  } else if (!state.isPlaying) {
    updateScrubberAndLyricsUI(false);
  }
}

function reconcileIncomingPlaybackState(item, rawSec, incomingIsPlaying, source = 'poll') {
  if (!item) return;
  const apiId = cleanTrackId(item.id || item.uri || item.name);
  const apiTitle = (item.name || item.title || '').trim();
  const now = Date.now();
  const intent = state.userIntent;

  if (intent && now < intent.expiresAt) {
    if (intent.type === 'play_pause') {
      if (incomingIsPlaying !== intent.targetIsPlaying) {
        // Ignorar estado antiguo que aún no refleja el Play/Pause del usuario
        incomingIsPlaying = intent.targetIsPlaying;
      }
    } else if (intent.type === 'track_switch') {
      const prevIdMatch = Boolean(intent.prevId && apiId === intent.prevId);
      const prevTitleMatch = Boolean(intent.prevTitle && apiTitle.toLowerCase() === intent.prevTitle.toLowerCase());
      const targetIdMatch = Boolean(intent.targetId && apiId === intent.targetId);
      const targetTitleMatch = Boolean(intent.targetTitle && apiTitle.toLowerCase() === intent.targetTitle.toLowerCase());
      const switchingToDifferentTrack = (intent.prevId !== intent.targetId) ||
        (intent.prevTitle.toLowerCase() !== intent.targetTitle.toLowerCase());

      // 1. Si el reporte entrante todavía trae la canción anterior, descartarlo por completo
      if (switchingToDifferentTrack && (prevIdMatch || prevTitleMatch) && !targetIdMatch && !targetTitleMatch) {
        return;
      }

      // 2. Si el usuario eligió una canción específica y llega otra distinta mientras carga, descartarla
      if (intent.isSpecificTrack && !targetIdMatch && !targetTitleMatch && (now < intent.startedAt + 3400)) {
        return;
      }

      // 3. Ya llegó la nueva canción: mantener isPlaying = true mientras termina de hacer buffer
      if (now < intent.startedAt + 2400) {
        incomingIsPlaying = true;
      }
      if ((targetIdMatch || targetTitleMatch) && incomingIsPlaying && rawSec > 0.05) {
        state.userIntent = null;
      }
    } else if (intent.type === 'seek') {
      incomingIsPlaying = intent.targetIsPlaying;
      if (Math.abs(rawSec - intent.targetSeekSec) > 2.5) {
        rawSec = intent.targetSeekSec;
      } else {
        state.userIntent = null;
      }
    }
  }

  state.lastConfirmedApiTrackId = apiId;
  state.lastConfirmedApiTrackTitle = apiTitle;
  applyTrackToUI(item, rawSec, incomingIsPlaying, source);
}

async function pollSpotifyCurrentPlayback() {
  if (!spotifyAuth.accessToken) return;
  const pollSeq = playbackActionSeq;

  // Si el Web Player local está activo y reproduciendo en este navegador, consultar primero su estado en memoria (0ms de lag)
  if (isLocalWebPlayerActive() && typeof webPlayer.getCurrentState === 'function') {
    try {
      const localState = await webPlayer.getCurrentState();
      if (pollSeq !== playbackActionSeq) return;
      if (localState && localState.track_window && localState.track_window.current_track) {
        handleWebPlayerStateChanged(localState);
        return;
      }
    } catch (e) { }
  }

  const pb = await spotifyFetch('/me/player');
  // Si el usuario ejecutó cualquier acción mientras el request HTTP estaba en vuelo, descartar esta respuesta vieja
  if (pollSeq !== playbackActionSeq) return;

  if (pb && pb.item) {
    if (pb.device && pb.device.id) {
      spotifyAuth.activeDeviceId = pb.device.id;
    }
    spotifyAuth.shuffleState = !!pb.shuffle_state;
    spotifyAuth.repeatState = pb.repeat_state || 'off';
    const rawSec = (pb.progress_ms || 0) / 1000;
    reconcileIncomingPlaybackState(pb.item, rawSec, !!pb.is_playing, 'poll');
  }
}

// --------------------------------------------------------------------------
// 9. LYRICS DOM & 60 FPS APPLE MUSIC SING RENDERING (ZERO-LAG + HELD GLOW)
// --------------------------------------------------------------------------
state.lyricDOMCache = [];
state.lastRenderedSec = -1;
state.lastScrubberRatio = -1;
state.clockRate = 1.0;
state.isNowPlayingOpen = false;
let npFullyOpenTimer = null;

function getLyricLineClass(idx, activeIdx) {
  const diff = idx - activeIdx;
  if (diff === 0) return 'lyric-line active';
  if (diff === -1) return 'lyric-line distance-prev';
  if (diff <= -2) return 'lyric-line distance-prev-far';
  if (diff === 1) return 'lyric-line distance-1';
  if (diff === 2) return 'lyric-line distance-2';
  if (diff === 3) return 'lyric-line distance-3';
  if (diff === 4) return 'lyric-line distance-4';
  return 'lyric-line distance-far';
}

function cacheLyricLineOffsets() {
  const cache = state.lyricDOMCache;
  if (!cache || cache.length === 0) return;
  for (let i = 0; i < cache.length; i++) {
    cache[i].targetOffset = Math.max(0, cache[i].el.offsetTop - 210);
  }
}

function buildLyricsDOM(lyricsArray) {
  lyricsScrollTrack.innerHTML = lyricsArray.map((line, lineIdx) => {
    const words = line.text.trim().split(/\s+/);
    const lineDuration = Math.max(0.85, (line.end || line.start + 4) - line.start);

    // Weight each word's singing duration by syllable/character length + phrase-ending sustain
    const weights = words.map((w, idx) => {
      const cleanLen = Math.max(2, w.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ]/g, '').length);
      const isLastWord = idx === words.length - 1;
      const hasPausePunct = /[,.;:!?\u2026~-]$/.test(w);
      const hasRepeatedVowel = /([aeiouáéíóú])\1/i.test(w);
      let mult = 1.0;
      if (isLastWord) mult *= 1.65;      // Singers naturally hold the final word of a line
      if (hasPausePunct) mult *= 1.35;   // Held before a comma/breath
      if (hasRepeatedVowel) mult *= 1.4; // Stretched vowel
      return cleanLen * mult;
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    let cursorSec = line.start;

    const wordsHtml = words.map((w, wIdx) => {
      const dur = (weights[wIdx] / totalWeight) * lineDuration;
      const wStart = cursorSec;
      const wEnd = cursorSec + dur;
      cursorSec = wEnd;
      const isLast = wIdx === words.length - 1;
      const isHeld = dur >= 0.50 || isLast;
      return `<span class="lyric-word pending" data-wstart="${wStart.toFixed(3)}" data-wend="${wEnd.toFixed(3)}" data-held="${isHeld ? '1' : '0'}" data-last="${isLast ? '1' : '0'}">${w}${!isLast ? ' ' : ''}</span>`;
    }).join('');

    const initialCls = getLyricLineClass(lineIdx, 0);
    return `<div class="${initialCls}" data-line-idx="${lineIdx}" data-start="${line.start}" data-end="${line.end}">${wordsHtml}</div>`;
  }).join('');

  // Pre-cache all DOM references & timing floats so the 60fps loop does zero DOM queries or layout reads
  const lineEls = Array.from(lyricsScrollTrack.querySelectorAll('.lyric-line'));
  state.lyricDOMCache = lineEls.map((lineEl, idx) => {
    const lineData = lyricsArray[idx] || {};
    const wordEls = Array.from(lineEl.querySelectorAll('.lyric-word'));
    const initialCls = getLyricLineClass(idx, 0);
    return {
      el: lineEl,
      lastClass: initialCls,
      targetOffset: Math.max(0, lineEl.offsetTop - 210),
      start: lineData.start || 0,
      end: lineData.end || ((lineData.start || 0) + 4),
      lineEnd: lineData.lineEnd || lineData.end || ((lineData.start || 0) + 5),
      words: wordEls.map(wEl => ({
        el: wEl,
        wStart: parseFloat(wEl.getAttribute('data-wstart')) || 0,
        wEnd: parseFloat(wEl.getAttribute('data-wend')) || 0.4,
        isHeld: wEl.getAttribute('data-held') === '1',
        isLast: wEl.getAttribute('data-last') === '1',
        state: 'pending'
      }))
    };
  });
  lyricsScrollTrack.classList.add('lyrics-fade-out');
  requestAnimationFrame(() => {
    cacheLyricLineOffsets();
    requestAnimationFrame(() => {
      lyricsScrollTrack.classList.remove('lyrics-fade-out');
    });
  });
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

// Hardware PCM clock already accounts for AudioTrack + AudioFlinger buffer latency
const LYRIC_SYNC_LEAD_SEC = 0.0;

function updateScrubberAndLyricsUI(forceScroll = false) {
  if (!forceScroll && !state.isNowPlayingOpen) return;

  const ratio = Math.min(1, Math.max(0, state.currentTimeSec / Math.max(1, state.durationSec)));
  if (forceScroll || Math.abs(ratio - state.lastScrubberRatio) >= 0.0008) {
    state.lastScrubberRatio = ratio;
    npScrubberFill.style.transform = `scaleX(${ratio.toFixed(4)})`;
  }

  // Only update time text DOM once per integer second (never 60x/sec)
  const curIntSec = Math.floor(state.currentTimeSec);
  if (forceScroll || curIntSec !== state.lastRenderedSec) {
    state.lastRenderedSec = curIntSec;
    npTimeElapsed.textContent = formatTime(curIntSec);
    const remaining = Math.max(0, state.durationSec - curIntSec);
    npTimeRemaining.textContent = `-${formatTime(remaining)}`;
  }

  const cache = state.lyricDOMCache;
  if (!cache || cache.length === 0) return;

  const lyricTime = state.currentTimeSec + LYRIC_SYNC_LEAD_SEC;
  let newActiveIdx = 0;
  for (let i = 0; i < cache.length; i++) {
    if (lyricTime >= cache[i].start && lyricTime < cache[i].lineEnd) {
      newActiveIdx = i;
      break;
    } else if (lyricTime >= cache[i].lineEnd) {
      newActiveIdx = i;
    }
  }

  const lineChanged = forceScroll || newActiveIdx !== state.activeLineIndex;

  if (lineChanged) {
    if (state.activeLineIndex >= 0 && cache[state.activeLineIndex]) {
      const oldWords = cache[state.activeLineIndex].words;
      for (let w = 0; w < oldWords.length; w++) {
        if (oldWords[w].state !== 'pending') {
          oldWords[w].state = 'pending';
          oldWords[w].el.className = 'lyric-word pending';
        }
      }
    }

    for (let idx = 0; idx < cache.length; idx++) {
      const item = cache[idx];
      const nextCls = getLyricLineClass(idx, newActiveIdx);
      if (item.lastClass !== nextCls) {
        item.lastClass = nextCls;
        item.el.className = nextCls;
      }
    }
  }

  const activeLine = cache[newActiveIdx];
  if (activeLine) {
    const words = activeLine.words;
    for (let i = 0; i < words.length; i++) {
      const wObj = words[i];
      if (lyricTime >= wObj.wEnd) {
        if (wObj.state !== 'sung') {
          wObj.state = 'sung';
          wObj.el.className = wObj.isLast ? 'lyric-word sung last-word-hold' : 'lyric-word sung';
        }
      } else if (lyricTime >= wObj.wStart) {
        if (wObj.state !== 'singing') {
          wObj.state = 'singing';
          wObj.el.className = wObj.isHeld ? 'lyric-word singing held' : 'lyric-word singing';
        }
      } else {
        if (wObj.state !== 'pending') {
          wObj.state = 'pending';
          wObj.el.className = 'lyric-word pending';
        }
      }
    }
  }

  if (lineChanged) {
    state.activeLineIndex = newActiveIdx;
    if (activeLine) {
      const targetOffset = typeof activeLine.targetOffset === 'number'
        ? activeLine.targetOffset
        : Math.max(0, activeLine.el.offsetTop - 210);
      lyricsScrollTrack.style.transform = `translate3d(0, -${targetOffset}px, 0)`;
    }
  }
}

function updatePlayPauseIcons() {
  if (npQueueEq) npQueueEq.classList.toggle('playing', !!state.isPlaying);
  if (npCoverStage) npCoverStage.classList.toggle('is-paused', !state.isPlaying);
  if (state.lastRenderedIsPlaying === state.isPlaying) return;
  state.lastRenderedIsPlaying = state.isPlaying;
  const pauseMarkup = `
    <rect x="5" y="3" width="5.2" height="18" rx="1.4"></rect>
    <rect x="13.8" y="3" width="5.2" height="18" rx="1.4"></rect>
  `;
  const playMarkup = `<polygon points="6 3.5 20 12 6 20.5 6 3.5"></polygon>`;
  npPlayPauseSvg.innerHTML = state.isPlaying ? pauseMarkup : playMarkup;
  document.getElementById('miniPauseIcon').innerHTML = state.isPlaying ? pauseMarkup : playMarkup;
}

// --------------------------------------------------------------------------
// 9B. RIGHT PANEL CONTROLLER: LYRICS vs QUEUE ("A CONTINUACIÓN")
//     Priorities:
//     1. Pending tracks in queue -> show "A continuación"
//     2. Only 1 song playing -> show elegant empty state
//     3. If API provides recommendations -> offer musical discovery
// --------------------------------------------------------------------------
function normalizeApiTrack(t) {
  if (!t) return null;
  const title = t.name || t.title;
  if (!title) return null;
  const artist = Array.isArray(t.artists)
    ? t.artists.map(a => a.name).join(', ')
    : (t.artist || 'Spotify');
  const album = (t.album && typeof t.album === 'object') ? (t.album.name || '') : (t.album || '');
  const imgs = (t.album && Array.isArray(t.album.images)) ? t.album.images : [];
  const cover = imgs.length > 0
    ? getSpotifyImage(imgs, 'large')
    : (t.coverLarge || t.cover || DEFAULT_ALBUM_COVER);
  const thumb = imgs.length > 0
    ? (getSpotifyImage(imgs, 'small') || getSpotifyImage(imgs, 'medium') || cover)
    : (t.thumb || t.cover || cover);
  const duration = t.duration_ms ? Math.round(t.duration_ms / 1000) : (t.duration || 210);
  return {
    id: t.id || t.uri || title,
    uri: t.uri || '',
    title,
    artist,
    album,
    thumb,
    cover,
    duration
  };
}

const LYRICS_ICON_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-9 11H7V9h4v4zm6 0h-4V9h4v4z"/></svg>`;
const QUEUE_ICON_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><circle cx="4" cy="6" r="1.5" fill="currentColor"></circle><circle cx="4" cy="12" r="1.5" fill="currentColor"></circle><circle cx="4" cy="18" r="1.5" fill="currentColor"></circle></svg>`;
const CENTERED_ICON_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"></rect><circle cx="12" cy="12" r="3.5"></circle></svg>`;
const EXPAND_PANEL_ICON_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"></rect><line x1="15" y1="3" x2="15" y2="21"></line></svg>`;

function buildQueueRowHTML(track, idx, sourceType = 'queue') {
  const safeTitle = (track.title || '').replace(/"/g, '&quot;');
  const safeArtist = (track.artist || '').replace(/"/g, '&quot;');
  const safeAlbum = (track.album || '').replace(/"/g, '&quot;');
  const coverUrl = track.cover || DEFAULT_ALBUM_COVER;
  const thumbUrl = track.thumb || coverUrl;
  const durSec = track.duration || 210;
  const durFormatted = formatTime(durSec);
  return `
    <div class="np-queue-row"
         data-queue-source="${sourceType}"
         data-queue-idx="${idx}"
         data-track-id="${track.id || ''}"
         data-track-uri="${track.uri || ''}"
         data-track-title="${safeTitle}"
         data-track-artist="${safeArtist}"
         data-track-album="${safeAlbum}"
         data-track-thumb="${thumbUrl}"
         data-track-cover="${coverUrl}"
         data-track-duration="${durSec}">
      <span class="np-queue-index">${idx + 1}</span>
      ${renderOptImg(thumbUrl, safeTitle, 'np-queue-thumb')}
      <div class="np-queue-meta">
        <div class="np-queue-title">${track.title}</div>
        <div class="np-queue-artist">${track.artist}</div>
      </div>
      <div class="np-queue-duration">${durFormatted}</div>
    </div>
  `;
}

function renderQueuePanelUI() {
  if (!npQueueListContainer) return;

  // Do not duplicate the current track card in the right column, as Now Playing
  // is already permanently featured in large format on the left column
  if (npQueueCurrentCard) {
    npQueueCurrentCard.style.display = 'none';
  }

  const queue = state.liveQueueTracks || [];
  const discovery = state.discoveryTracks || [];

  // Priority 1: Pending tracks exist in queue
  if (queue.length > 0) {
    if (npQueueHeading) npQueueHeading.textContent = 'A continuación';
    if (npQueueSubheading) {
      npQueueSubheading.textContent = `Siguiente en la lista • ${queue.length} canción${queue.length === 1 ? '' : 'es'}`;
      npQueueSubheading.style.display = 'block';
    }
    if (npQueueSeeAllBtn) npQueueSeeAllBtn.style.display = 'none';
    npQueueListContainer.innerHTML = queue.slice(0, 25).map((t, i) => buildQueueRowHTML(t, i, 'queue')).join('');
    hydrateImages(npQueueListContainer);
    return;
  }

  // Priority 2: Musical Discovery when no pending queue exists and API returned recommendations
  if (discovery.length > 0) {
    if (npQueueHeading) npQueueHeading.textContent = 'Descubrimiento musical';
    if (npQueueSubheading) {
      npQueueSubheading.textContent = state.playingArtist
        ? `Sugerencias basadas en ${state.playingArtist}`
        : 'Para seguir escuchando según esta canción';
      npQueueSubheading.style.display = 'block';
    }
    if (npQueueSeeAllBtn) npQueueSeeAllBtn.style.display = 'none';

    npQueueListContainer.innerHTML = discovery.slice(0, 8).map((t, i) => buildQueueRowHTML(t, i, 'discovery')).join('');
    hydrateImages(npQueueListContainer);
    return;
  }

  // Priority 3: Fallback empty state only when neither queue nor discovery tracks are available
  if (npQueueHeading) npQueueHeading.textContent = 'A continuación';
  if (npQueueSubheading) npQueueSubheading.style.display = 'none';
  if (npQueueSeeAllBtn) npQueueSeeAllBtn.style.display = 'none';

  npQueueListContainer.innerHTML = `
    <div class="np-queue-empty-state">
      <div class="np-queue-empty-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>
      </div>
      <div>
        <div class="np-queue-empty-title">Cola de reproducción vacía</div>
        <div class="np-queue-empty-sub">Agrega canciones o elige una lista para continuar</div>
      </div>
    </div>
  `;
}

async function fetchAndRenderQueueForCurrentTrack(trackObj) {
  // If tracks are available from local context:
  if (Array.isArray(state.contextUpcomingTracks) && state.contextUpcomingTracks.length > 0) {
    const currentIdx = state.contextUpcomingTracks.findIndex(t => (t.id && t.id === state.playingTrackId) || (t.title && t.title === state.playingTrackTitle));
    const sliceStart = currentIdx >= 0 ? currentIdx + 1 : 0;
    state.liveQueueTracks = state.contextUpcomingTracks
      .slice(sliceStart)
      .map(normalizeApiTrack)
      .filter(t => t && t.title !== state.playingTrackTitle);
  }
  state.queueLoading = Boolean(spotifyAuth.accessToken);

  renderQueuePanelUI();
  if (state.liveQueueTracks.length > 0) {
    // Pre-decodificar tanto las portadas HD (640x640) de las próximas canciones como las miniaturas de la lista
    prewarmImageUrls(state.liveQueueTracks.slice(0, 8).map(t => t.cover));
    prewarmImageUrls(state.liveQueueTracks.slice(0, 15).map(t => t.thumb || t.cover));
  }

  if (!spotifyAuth.accessToken) {
    state.queueLoading = false;
    return;
  }

  // Priority 1: Check real Spotify Player Queue (/me/player/queue)
  const qRes = await spotifyFetch('/me/player/queue');
  if (qRes && Array.isArray(qRes.queue) && qRes.queue.length > 0) {
    const seen = new Set();
    const apiQueue = [];
    for (let i = 0; i < qRes.queue.length; i++) {
      const norm = normalizeApiTrack(qRes.queue[i]);
      if (!norm) continue;
      // Skip duplicate of currently playing track
      if (i === 0 && (norm.id === state.playingTrackId || norm.title === state.playingTrackTitle)) continue;
      const key = norm.id || `${norm.title}|${norm.artist}`;
      if (seen.has(key)) continue;
      seen.add(key);
      apiQueue.push(norm);
      if (apiQueue.length >= 25) break;
    }
    if (apiQueue.length > 0) {
      state.liveQueueTracks = apiQueue;
      state.queueLoading = false;
      renderQueuePanelUI();
      prewarmImageUrls(apiQueue.slice(0, 8).map(t => t.cover));
      prewarmImageUrls(apiQueue.slice(0, 15).map(t => t.thumb || t.cover));
      updateNowPlayingRightPanelMode();
      return;
    }
  }

  if (state.liveQueueTracks.length > 0) {
    state.queueLoading = false;
    renderQueuePanelUI();
    updateNowPlayingRightPanelMode();
    return;
  }

  // Priority 2: Queue is empty -> Query API for musical discovery alternatives
  const discovered = [];
  const seenDisc = new Set([state.playingTrackId, state.playingTrackTitle]);

  if (state.playingTrackId && /^[a-zA-Z0-9]{22}$/.test(state.playingTrackId)) {
    const recRes = await spotifyFetch(`/recommendations?seed_tracks=${state.playingTrackId}&limit=6`);
    if (recRes && Array.isArray(recRes.tracks)) {
      recRes.tracks.forEach(t => {
        const norm = normalizeApiTrack(t);
        if (norm && !seenDisc.has(norm.id) && !seenDisc.has(norm.title)) {
          seenDisc.add(norm.id);
          seenDisc.add(norm.title);
          discovered.push(norm);
        }
      });
    }
  }

  if (discovered.length === 0 && state.playingArtistId) {
    const artTop = await spotifyFetch(`/artists/${state.playingArtistId}/top-tracks?market=from_token`);
    if (artTop && Array.isArray(artTop.tracks)) {
      artTop.tracks.forEach(t => {
        const norm = normalizeApiTrack(t);
        if (norm && !seenDisc.has(norm.id) && !seenDisc.has(norm.title)) {
          seenDisc.add(norm.id);
          seenDisc.add(norm.title);
          discovered.push(norm);
        }
      });
    }
  }

  if (discovered.length === 0 && Array.isArray(liveCatalog.likedTracks) && liveCatalog.likedTracks.length > 0) {
    liveCatalog.likedTracks.slice(0, 6).forEach(t => {
      const norm = normalizeApiTrack(t);
      if (norm && !seenDisc.has(norm.id) && !seenDisc.has(norm.title)) {
        seenDisc.add(norm.id);
        seenDisc.add(norm.title);
        discovered.push(norm);
      }
    });
  }

  state.discoveryTracks = discovered.slice(0, 8);
  state.queueLoading = false;
  renderQueuePanelUI();
  if (state.discoveryTracks.length > 0) {
    prewarmImageUrls(state.discoveryTracks.map(t => t.thumb || t.cover));
  }
  updateNowPlayingRightPanelMode();
}

function updateNowPlayingRightPanelMode() {
  const npMainGrid = document.querySelector('.np-main-grid');
  const hasLyrics = Boolean(state.hasValidLyrics || state.lyricsLoading);
  const hasQueue = Boolean(
    (Array.isArray(state.liveQueueTracks) && state.liveQueueTracks.length > 0) ||
    (Array.isArray(state.discoveryTracks) && state.discoveryTracks.length > 0) ||
    state.queueLoading
  );

  let mode = state.nowPlayingMode || 'lyrics';

  // 1. Validation & Auto-detection:
  if (state.userForcedCentered) {
    mode = 'centered';
  } else if (!hasLyrics && !hasQueue) {
    // Song has no queue AND no lyrics -> automatically center!
    mode = 'centered';
  } else if (mode === 'lyrics') {
    if (!hasLyrics && hasQueue) {
      mode = 'queue';
    } else if (!hasLyrics && !hasQueue) {
      mode = 'centered';
    }
  } else if (mode === 'queue') {
    if (!hasQueue && hasLyrics) {
      mode = 'lyrics';
    } else if (!hasQueue && !hasLyrics) {
      mode = 'centered';
    }
  } else if (mode !== 'centered') {
    mode = hasLyrics ? 'lyrics' : (hasQueue ? 'queue' : 'centered');
  }

  state.nowPlayingMode = mode;
  const isCentered = (mode === 'centered');
  const showLyrics = (mode === 'lyrics');
  const showQueue = (mode === 'queue');

  // 2. 60fps GPU Hardware-Accelerated Centered Mode (slide & scale)
  if (npMainGrid) {
    npMainGrid.classList.toggle('centered-layout', isCentered);
  }

  // 3. Toggle Right Column Sub-Panels (No display:none interruption)
  if (npRightLyrics) npRightLyrics.classList.toggle('hidden', !showLyrics);
  if (npRightQueue) npRightQueue.classList.toggle('hidden', !showQueue);

  // 4. Update Dual Control Buttons ([ 💬 Letra ] and [ ≡ Cola ])
  if (npToggleLyricsBtn) {
    npToggleLyricsBtn.classList.toggle('active', showLyrics);
    npToggleLyricsBtn.classList.toggle('disabled', !hasLyrics);
    npToggleLyricsBtn.title = hasLyrics ? (showLyrics ? 'Ocultar letras' : 'Mostrar letras') : 'No hay letras para esta canción';
  }

  if (npToggleQueueBtn) {
    npToggleQueueBtn.classList.toggle('active', showQueue);
    npToggleQueueBtn.classList.toggle('disabled', !hasQueue);
    npToggleQueueBtn.title = hasQueue ? (showQueue ? 'Ocultar cola' : 'Mostrar a continuación') : 'Cola de reproducción vacía';
  }

  // 5. Update Active Sub-Mode Contents
  if (showLyrics) {
    if (state.hasValidLyrics) {
      requestAnimationFrame(() => {
        cacheLyricLineOffsets();
        updateScrubberAndLyricsUI(true);
      });
    } else if (state.lyricsLoading) {
      if (lyricsScrollTrack) {
        lyricsScrollTrack.innerHTML = `
          <div class="lyric-line distance-1" style="opacity: 0.65; font-size: 22px; margin-top: 140px; text-align: left;">
            Buscando letra...
          </div>
        `;
      }
    }
  } else if (showQueue) {
    renderQueuePanelUI();
  }
}

