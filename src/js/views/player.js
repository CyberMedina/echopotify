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
let trackWorkDeferTimer = null;

function crossfadeNowPlayingCover(rawCoverUrl, thumbUrl, animateSwap) {
  const coverUrl = ensureHighResSpotifyCover(rawCoverUrl);
  if (!npCoverArt || !coverUrl) return;
  const prevSrc = npCoverArt.getAttribute('src') || npCoverArt.dataset.currentSrc || '';
  const isInitialPlaceholder = !prevSrc || prevSrc.startsWith('data:image/svg+xml');
  const now = Date.now();
  const rapidUpdate = (now - lastCoverCrossfadeAt) < 260;

  npCoverArt.dataset.currentSrc = coverUrl;

  if (!animateSwap || isInitialPlaceholder || !npCoverGhost || prevSrc === coverUrl || rapidUpdate) {
    const immediateSrc = (coverUrl.startsWith('data:') || decodedImageUrls.has(coverUrl))
      ? coverUrl
      : ((thumbUrl && decodedImageUrls.has(thumbUrl)) ? thumbUrl : null);

    if (immediateSrc) {
      if (npCoverArt.getAttribute('src') !== immediateSrc) {
        npCoverArt.src = immediateSrc;
      }
      npCoverArt.style.opacity = '1';
      if (npCoverGhost && !coverCrossfadeTimer) {
        npCoverGhost.src = immediateSrc;
      }
    }
    if (immediateSrc !== coverUrl) {
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

  // Cross-dissolve en 0ms sin forzar reflow síncrono (sin offsetWidth) y pausando blobs durante los 360ms
  const executeAppleMusicCoverTransition = (displayUrl) => {
    if (state.lastRenderedCover !== coverUrl) return;
    clearTimeout(coverCrossfadeTimer);

    if (nowPlayingOverlay) nowPlayingOverlay.classList.add('np-switching');
    npCoverGhost.style.transition = 'none';
    npCoverGhost.classList.remove('ghost-fading');
    if (npCoverGhost.getAttribute('src') !== prevSrc) {
      npCoverGhost.src = prevSrc;
    }
    npCoverGhost.style.opacity = '1';

    npCoverArt.src = displayUrl;
    npCoverArt.style.opacity = '1';

    requestAnimationFrame(() => {
      npCoverGhost.style.transition = '';
      requestAnimationFrame(() => {
        npCoverGhost.classList.add('ghost-fading');
        coverCrossfadeTimer = setTimeout(() => {
          npCoverGhost.style.opacity = '0';
          npCoverGhost.classList.remove('ghost-fading');
          if (nowPlayingOverlay) nowPlayingOverlay.classList.remove('np-switching');
          coverCrossfadeTimer = null;
          const settledSrc = npCoverArt.getAttribute('src') || displayUrl;
          if (npCoverGhost.getAttribute('src') !== settledSrc) {
            npCoverGhost.src = settledSrc;
          }
        }, 380);
      });
    });
  };

  if (coverUrl.startsWith('data:') || decodedImageUrls.has(coverUrl)) {
    executeAppleMusicCoverTransition(coverUrl);
    return;
  }

  // Si la miniatura (thumbUrl) o versión media ya está en caché/DOM, iniciar el crossfade en 0ms con ella
  // para que la portada cambie al unísono con el título sin esperar 300ms de red, y actualizar a HD en silencio
  const hasReadyThumb = thumbUrl && (decodedImageUrls.has(thumbUrl) || (document.images && Array.from(document.images).some(img => img.complete && img.naturalWidth > 0 && img.src === thumbUrl)));
  if (hasReadyThumb) {
    executeAppleMusicCoverTransition(thumbUrl);
    decodeImageInBackground(coverUrl).then(() => {
      if (state.lastRenderedCover === coverUrl) {
        npCoverArt.src = coverUrl;
        if (!coverCrossfadeTimer && npCoverGhost) {
          npCoverGhost.src = coverUrl;
        }
      }
    });
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

let npMarqueeRafId = null;
let npMarqueeSettleTimer = null;

function applyAppleMarqueeToElement(el) {
  if (!el || typeof el.clientWidth !== 'number' || typeof el.scrollWidth !== 'number') return;

  if (el.classList.contains('is-marquee') && el.dataset && el.dataset.marqueeBaseHtml !== undefined) {
    el.innerHTML = el.dataset.marqueeBaseHtml;
  }
  el.classList.remove('is-marquee');
  if (el.style && typeof el.style.removeProperty === 'function') {
    el.style.removeProperty('--marquee-shift');
    el.style.removeProperty('--marquee-duration');
  }

  const containerW = el.clientWidth;
  const contentW = el.scrollWidth;
  if (containerW <= 0 || contentW <= containerW + 2) {
    if (el.dataset) delete el.dataset.marqueeBaseHtml;
    return;
  }

  const baseHtml = el.innerHTML;
  if (el.dataset) el.dataset.marqueeBaseHtml = baseHtml;
  el.innerHTML = `<span class="np-marquee-track"><span class="np-marquee-item">${baseHtml}</span><span class="np-marquee-item" aria-hidden="true">${baseHtml}</span></span>`;

  const firstItem = (typeof el.querySelector === 'function') ? el.querySelector('.np-marquee-item') : null;
  const shiftPx = ((firstItem && firstItem.offsetWidth) || contentW) + 48;
  const durationSec = Math.max(7.5, Math.min(26, (shiftPx / 38) + 2.6)).toFixed(2);

  if (el.style && typeof el.style.setProperty === 'function') {
    el.style.setProperty('--marquee-shift', `-${shiftPx}px`);
    el.style.setProperty('--marquee-duration', `${durationSec}s`);
  }
  el.classList.add('is-marquee');
}

function scheduleNowPlayingMarqueeRefresh(waitForTransition = false) {
  const probe = npTrackTitle || npTrackArtist;
  if (!probe || typeof probe.clientWidth !== 'number') return;

  if (npMarqueeRafId && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(npMarqueeRafId);
  }
  clearTimeout(npMarqueeSettleTimer);

  const runMeasure = () => {
    applyAppleMarqueeToElement(npTrackTitle);
    applyAppleMarqueeToElement(npTrackArtist);
  };

  if (typeof requestAnimationFrame === 'function') {
    npMarqueeRafId = requestAnimationFrame(runMeasure);
  } else {
    runMeasure();
  }

  if (waitForTransition) {
    npMarqueeSettleTimer = setTimeout(runMeasure, 540);
  }
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
      if (npTrackTitle) {
        npTrackTitle.classList.remove('is-marquee');
        if (npTrackTitle.dataset) delete npTrackTitle.dataset.marqueeBaseHtml;
        npTrackTitle.textContent = newTitle;
      }
      if (npQueueCurrentTitle) {
        npQueueCurrentTitle.textContent = newTitle;
      }
    }
    if (artistChanged || !state.lastRenderedArtistRendered) {
      state.lastRenderedArtistRendered = true;
      // In mini-player: plain text, cannot access artist from mini-player
      miniPlayerArtist.textContent = newArtist;
      // In Now Playing & Queue: interactive artist links (supports 1 or multiple artists)
      if (npTrackArtist) {
        npTrackArtist.classList.remove('is-marquee');
        if (npTrackArtist.dataset) delete npTrackArtist.dataset.marqueeBaseHtml;
      }
      renderArtistLinksInto(npTrackArtist, state.playingArtists, 'np-artist-link');
      if (npQueueCurrentArtist) renderArtistLinksInto(npQueueCurrentArtist, state.playingArtists, 'np-artist-link');
    }
    if (titleChanged || artistChanged) {
      scheduleNowPlayingMarqueeRefresh(false);
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
  const prevDurationSec = state.durationSec || 0;
  const hasRealDuration = Boolean(
    (trackObj.duration_ms && trackObj.duration_ms > 0) ||
    (trackObj.duration && trackObj.duration > 0)
  );
  const durationSec = trackObj.duration_ms ? Math.round(trackObj.duration_ms / 1000) : (trackObj.duration || 220);

  const nextTitle = (trackObj.name || trackObj.title || '').trim();
  const nextId = cleanTrackId(trackObj.id || trackObj.uri || nextTitle);
  const isFirstTrack = !state.playingTrackId && Boolean(nextId || nextTitle);
  const trackChanged = isFirstTrack || (state.playingTrackId !== nextId) || (state.playingTrackTitle !== nextTitle);
  const shouldAnimateTransition = trackChanged && !isFirstTrack;
  state.isCachedPlaceholderTrack = (source === 'cache');
  if (source === 'cache' && trackObj) {
    if (trackObj.contextType) state.activeContextType = trackObj.contextType;
    if (trackObj.contextName) state.activeContextName = trackObj.contextName;
    if (trackObj.contextId) state.activeContextId = trackObj.contextId;
    if (trackObj.contextUri) state.activeContextUri = trackObj.contextUri;
    if (trackObj.contextType === 'liked' || trackObj.contextType === 'artist') {
      state.isLocalContextQueue = true;
    }
  }

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

  // Record natural playback outcome (30s rule / completion) & sequential transition before overwriting active track
  if (trackChanged && !isFirstTrack && state.playingTrackId && typeof EchoRadio !== 'undefined') {
    const prevSessionEntry = (state.isAutoplayQueue && Array.isArray(state.autoplaySessionTracks) && state.autoplaySessionIndex >= 0)
      ? state.autoplaySessionTracks[state.autoplaySessionIndex]
      : null;
    const prevTrackSnapshot = {
      id: state.playingTrackId,
      uri: state.playingTrackUri,
      title: state.playingTrackTitle,
      artist: state.playingArtist,
      artists: state.playingArtists,
      duration: state.durationSec || 210,
      radioChannel: prevSessionEntry ? prevSessionEntry.radioChannel : null
    };
    if (source !== 'user' && source !== 'cache' && typeof EchoRadio.recordPlaybackOutcome === 'function') {
      EchoRadio.recordPlaybackOutcome(prevTrackSnapshot, state.currentTimeSec || 0, state.durationSec || 210, 'change');
    }
    if (source !== 'cache' && typeof EchoRadio.recordLiveTransition === 'function') {
      EchoRadio.recordLiveTransition(prevTrackSnapshot, {
        id: nextId,
        uri: trackObj.uri || (nextId ? `spotify:track:${nextId}` : ''),
        artists: artistsList
      });
    }
  }

  state.playingTrackId = nextId;
  state.playingTrackUri = trackObj.uri || (nextId ? `spotify:track:${nextId}` : null);
  state.playingTrackTitle = nextTitle;
  state.playingArtist = artistName;
  state.playingArtists = artistsList;
  state.playingArtistId = (artistsList && artistsList[0] && artistsList[0].id) ? artistsList[0].id : state.playingArtistId;

  if (trackChanged && state.isAutoplayQueue && Array.isArray(state.autoplaySessionTracks) && state.autoplaySessionTracks.length > 0) {
    const foundIdx = state.autoplaySessionTracks.findIndex(t =>
      (nextId && cleanTrackId(t.id || t.uri) === nextId) ||
      (nextTitle && t.title && t.title.toLowerCase() === nextTitle.toLowerCase())
    );
    if (foundIdx >= 0) {
      state.autoplaySessionIndex = foundIdx;
      const upcoming = state.autoplaySessionTracks.slice(foundIdx + 1);
      state.liveQueueTracks = upcoming;
      state.contextUpcomingTracks = upcoming;
      if (typeof recordAutoplayHistory === 'function') {
        recordAutoplayHistory(nextId || state.playingTrackUri);
      }
      if (upcoming.length < 5 && typeof replenishAutoplayQueue === 'function') {
        replenishAutoplayQueue();
      }
    }
  }
  state.playingAlbumTitle = albumName;
  state.playingCover = coverUrl;
  state.playingThumb = thumbUrl;
  state.durationSec = durationSec;
  state.playingTrackHasRealDuration = hasRealDuration;

  if (
    source !== 'cache' &&
    nextTitle &&
    (nextId || state.playingTrackUri) &&
    !String(state.playingTrackUri || '').match(/^spotify:(album|playlist|artist):/) &&
    typeof saveLastPlayedTrack === 'function'
  ) {
    saveLastPlayedTrack({
      id: nextId,
      uri: state.playingTrackUri,
      name: nextTitle,
      artist: artistName,
      artists: artistsList,
      album: albumName,
      thumb: thumbUrl,
      cover: coverUrl,
      coverLarge: coverUrl,
      duration: hasRealDuration ? durationSec : 0,
      contextType: state.activeContextType || '',
      contextName: state.activeContextName || '',
      contextId: state.activeContextId || '',
      contextUri: state.activeContextUri || ''
    });
  }

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

    // Pasar todas las variantes de URL ([coverUrl, rawCoverUrl, thumbUrl]) para lograr 0ms Cache HIT / DOM SYNC
    // desde la miniatura ya cargada en el DOM y evitar una segunda extracción asíncrona
    extractDynamicPaletteFromCover(coverUrl, false, [coverUrl, rawCoverUrl, thumbUrl]);

    // Actualizar barra de progreso e íconos de me gusta locales en 0ms
    const cleanId = cleanTrackId(trackObj.id || trackObj.uri);
    const isValidSpotifyId = Boolean(cleanId && /^[0-9A-Za-z]{22}$/.test(cleanId));
    if (isValidSpotifyId) {
      const isLocallyLiked = liveCatalog.likedTrackIds.has(cleanId);
      spotifyAuth.isLiked = isLocallyLiked;
      updateLikeButtonsUI(isLocallyLiked);
    } else {
      updateLikeButtonsUI(false);
    }

    // Desvanecer letras anteriores suavemente sin reconstruir DOM pesado en mitad de la animación de 60fps
    if (typeof exitLyricsManualScroll === 'function') {
      exitLyricsManualScroll({ skipSnapBack: true });
    }
    state.lyricsScrollOffset = 0;
    if (shouldAnimateTransition && lyricsScrollTrack) {
      lyricsScrollTrack.classList.add('lyrics-fade-out');
    }
    updateScrubberAndLyricsUI(true);

    // Diferir reconstrucción de DOM de letras/cola y peticiones de red secundarias 220ms
    // cuando hay animación activa para que el crossfade de portada y texto corra a 60fps puros en el Echo Show 8
    clearTimeout(trackWorkDeferTimer);
    const runSecondaryTrackWork = () => {
      const primaryArtistForLyrics = (Array.isArray(trackObj.artists) && trackObj.artists[0] && trackObj.artists[0].name)
        ? trackObj.artists[0].name
        : (artistName ? artistName.split(',')[0].trim() : '');
      fetchSyncedLyricsForTrack(
        state.playingTrackTitle,
        primaryArtistForLyrics,
        albumName,
        hasRealDuration ? durationSec : 0
      );
      fetchAndRenderQueueForCurrentTrack(trackObj);
      if (isValidSpotifyId) {
        spotifyFetch(`/me/tracks/contains?ids=${cleanId}`).then(res => {
          if (Array.isArray(res) && typeof res[0] === 'boolean' && state.playingTrackId === nextId) {
            spotifyAuth.isLiked = !!res[0];
            if (spotifyAuth.isLiked) {
              liveCatalog.likedTrackIds.add(cleanId);
            } else {
              liveCatalog.likedTrackIds.delete(cleanId);
            }
            updateLikeButtonsUI(spotifyAuth.isLiked);
            document.querySelectorAll(`[data-track-id="${cleanId}"]`).forEach(btn => {
              btn.classList.toggle('liked', spotifyAuth.isLiked);
              btn.setAttribute('title', spotifyAuth.isLiked ? 'Eliminar de Tus me gusta' : 'Guardar en Tus me gusta');
              const svg = btn.querySelector('svg');
              if (svg) {
                svg.setAttribute('fill', spotifyAuth.isLiked ? '#1ed760' : 'none');
                svg.setAttribute('stroke', spotifyAuth.isLiked ? '#1ed760' : 'currentColor');
              }
            });
          }
        }).catch(e => console.warn('[tracks/contains error]', e));
      }
    };

    if (shouldAnimateTransition && state.isNowPlayingOpen) {
      trackWorkDeferTimer = setTimeout(runSecondaryTrackWork, 220);
    } else {
      runSecondaryTrackWork();
    }
  } else {
    if (!state.isPlaying) {
      updateScrubberAndLyricsUI(false);
    }
    if (!state.hasValidLyrics && !state.lyricsLoading && state.playingTrackTitle && typeof ensureLyricsLoadedForCurrentTrack === 'function') {
      if (hasRealDuration && Math.abs(durationSec - prevDurationSec) > 4) {
        ensureLyricsLoadedForCurrentTrack('duration_update');
      } else if (isPlaying && source !== 'user') {
        ensureLyricsLoadedForCurrentTrack(source);
      }
    }
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

async function pollSpotifyCurrentPlayback(opts = {}) {
  if (!spotifyAuth.accessToken) return null;
  const pollSeq = playbackActionSeq;
  const autoOpenIfPlaying = Boolean(opts && opts.autoOpenIfPlaying);

  // Si el Web Player local está activo y reproduciendo en este navegador, consultar primero su estado en memoria (0ms de lag)
  if (isLocalWebPlayerActive() && typeof webPlayer.getCurrentState === 'function') {
    try {
      const localState = await webPlayer.getCurrentState();
      if (pollSeq !== playbackActionSeq) return null;
      if (localState && localState.track_window && localState.track_window.current_track) {
        handleWebPlayerStateChanged(localState);
        const isPlaying = !localState.paused;
        if (isPlaying && state.isBuffering && typeof setPlaybackBuffering === 'function') {
          setPlaybackBuffering(false);
        }
        updateActiveDeviceBadgeUI({
          id: webPlayerDeviceId,
          name: 'SpotiEcho Web Player',
          type: 'Computer',
          is_active: true
        });
        if (autoOpenIfPlaying && isPlaying && !state.isNowPlayingOpen && !state.startupPlaybackChecked) {
          state.startupPlaybackChecked = true;
          openNowPlaying({ instant: true });
        } else if (autoOpenIfPlaying) {
          state.startupPlaybackChecked = true;
        }
        return { isPlaying, item: localState.track_window.current_track };
      }
    } catch (e) { }
  }

  const pb = await spotifyFetch('/me/player');
  // Si el usuario ejecutó cualquier acción mientras el request HTTP estaba en vuelo, descartar esta respuesta vieja
  if (pollSeq !== playbackActionSeq) return null;

  if (pb && pb.item) {
    const isPlaying = Boolean(pb.is_playing);
    if (isPlaying && state.isBuffering && typeof setPlaybackBuffering === 'function') {
      setPlaybackBuffering(false);
    }
    // Solo adoptar el dispositivo remoto si está reproduciendo activamente, si es el Web Player local, o si el usuario lo eligió manualmente
    if (pb.device && pb.device.id) {
      const shouldAdoptDevice = Boolean(
        isPlaying ||
        (webPlayerDeviceId && pb.device.id === webPlayerDeviceId) ||
        (state.userSelectedDeviceId && pb.device.id === state.userSelectedDeviceId)
      );
      if (shouldAdoptDevice) {
        spotifyAuth.activeDeviceId = pb.device.id;
        spotifyAuth.activeDeviceName = (pb.device.id === webPlayerDeviceId) ? 'SpotiEcho Web Player' : pb.device.name;
        spotifyAuth.activeDeviceType = pb.device.type;
        if (isPlaying) {
          state.lastConfirmedApiDeviceId = pb.device.id;
        }
        updateActiveDeviceBadgeUI({
          ...pb.device,
          name: spotifyAuth.activeDeviceName
        });
      }
    }
    const nowMs = Date.now();
    const pollShuffle = !!pb.shuffle_state;
    if (nowMs >= (state.shuffleToggleLockUntil || 0) || pollShuffle === Boolean(spotifyAuth.shuffleState)) {
      if (pollShuffle === Boolean(spotifyAuth.shuffleState)) state.shuffleToggleLockUntil = 0;
      spotifyAuth.shuffleState = pollShuffle;
    }
    const pollRepeat = pb.repeat_state || 'off';
    if (nowMs >= (state.repeatToggleLockUntil || 0) || pollRepeat === (spotifyAuth.repeatState || 'off')) {
      if (pollRepeat === (spotifyAuth.repeatState || 'off')) state.repeatToggleLockUntil = 0;
      spotifyAuth.repeatState = pollRepeat;
    }
    if (typeof updateShuffleButtonUI === 'function') updateShuffleButtonUI();
    if (typeof updateRepeatButtonUI === 'function') updateRepeatButtonUI();
    const rawSec = (pb.progress_ms || 0) / 1000;
    reconcileIncomingPlaybackState(pb.item, rawSec, isPlaying, 'poll');

    if (autoOpenIfPlaying && isPlaying && !state.isNowPlayingOpen && !state.startupPlaybackChecked) {
      state.startupPlaybackChecked = true;
      openNowPlaying({ instant: true });
    } else if (autoOpenIfPlaying) {
      state.startupPlaybackChecked = true;
    }
    return { isPlaying, item: pb.item };
  } else if (autoOpenIfPlaying) {
    state.startupPlaybackChecked = true;
  }
  if (!spotifyAuth.activeDeviceName && typeof fetchAvailableDevices === 'function') {
    fetchAvailableDevices();
  }
  return null;
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
  if (activeIdx < 0) {
    if (idx === 0) return 'lyric-line distance-1';
    if (idx === 1) return 'lyric-line distance-2';
    if (idx === 2) return 'lyric-line distance-3';
    return 'lyric-line distance-far';
  }
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

const FAST_CONNECTOR_WORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'al', 'a', 'en', 'con', 'por',
  'que', 'y', 'o', 'e', 'u', 'me', 'te', 'se', 'lo', 'le', 'mi', 'tu', 'su', 'si', 'no',
  'the', 'an', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'and', 'or', 'but', 'is', 'it',
  'as', 'be', 'my', 'you', 'we', 'he', 'she', 'im', 'its'
]);

const LYRICS_ANCHOR_OFFSET = 170;
const LYRICS_SNAP_BACK_DELAY_MS = 4000;
const LYRICS_RESUME_SNAP_BACK_DELAY_MS = 2500;
const LYRICS_DRAG_THRESHOLD_PX = 8;
const LYRICS_OVERSCROLL_MAX_PX = 84;

let lyricsSnapBackTimer = null;
let lyricsSnapBackClassTimer = null;
let lyricsInertiaRaf = null;
let lyricsWheelClearTimer = null;
let isLyricsPointerDragging = false;

function cacheLyricLineOffsets() {
  const cache = state.lyricDOMCache;
  if (!cache || cache.length === 0) return;
  for (let i = 0; i < cache.length; i++) {
    cache[i].targetOffset = Math.max(0, cache[i].el.offsetTop - LYRICS_ANCHOR_OFFSET);
  }
}

function getLyricsActiveTargetOffset() {
  const cache = state.lyricDOMCache;
  if (!cache || cache.length === 0) return 0;
  const active = (state.activeLineIndex >= 0 && cache[state.activeLineIndex]) ? cache[state.activeLineIndex] : null;
  if (!active) return 0;
  return typeof active.targetOffset === 'number'
    ? active.targetOffset
    : Math.max(0, active.el.offsetTop - LYRICS_ANCHOR_OFFSET);
}

function getLyricsMaxScrollOffset() {
  const cache = state.lyricDOMCache;
  if (!cache || cache.length === 0) return 0;
  const lastLine = cache[cache.length - 1];
  const lastTarget = typeof lastLine.targetOffset === 'number'
    ? lastLine.targetOffset
    : Math.max(0, (lastLine.el && lastLine.el.offsetTop ? lastLine.el.offsetTop : 0) - LYRICS_ANCHOR_OFFSET);
  const viewH = (npRightLyrics && npRightLyrics.clientHeight) ? npRightLyrics.clientHeight : 0;
  const trackH = (lyricsScrollTrack && lyricsScrollTrack.scrollHeight) ? lyricsScrollTrack.scrollHeight : 0;
  return Math.max(0, lastTarget, trackH > viewH ? (trackH - viewH) : 0);
}

function rubberBandLyricsOffset(rawOffset, maxOffset) {
  if (rawOffset < 0) {
    const over = -rawOffset;
    return -Math.round((1 - (1 / ((over / 220) + 1))) * LYRICS_OVERSCROLL_MAX_PX * 100) / 100;
  }
  if (rawOffset > maxOffset) {
    const over = rawOffset - maxOffset;
    return maxOffset + Math.round((1 - (1 / ((over / 220) + 1))) * LYRICS_OVERSCROLL_MAX_PX * 100) / 100;
  }
  return rawOffset;
}

function applyLyricsScrollOffset(offsetPx) {
  const safeOffset = Number.isFinite(offsetPx) ? offsetPx : 0;
  state.lyricsScrollOffset = safeOffset;
  if (lyricsScrollTrack) {
    lyricsScrollTrack.style.transform = `translate3d(0, ${(-safeOffset).toFixed(2)}px, 0)`;
  }
}

function cancelLyricsInertia() {
  if (lyricsInertiaRaf !== null) {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(lyricsInertiaRaf);
    } else {
      clearTimeout(lyricsInertiaRaf);
    }
    lyricsInertiaRaf = null;
  }
}

function scheduleLyricsSnapBack(delayMs = LYRICS_SNAP_BACK_DELAY_MS) {
  clearTimeout(lyricsSnapBackTimer);
  lyricsSnapBackTimer = null;
  if (!state.lyricsManualScrolling || !state.isPlaying || isLyricsPointerDragging) return;
  const waitMs = (typeof delayMs === 'number' && delayMs >= 0) ? delayMs : LYRICS_SNAP_BACK_DELAY_MS;
  lyricsSnapBackTimer = setTimeout(() => {
    lyricsSnapBackTimer = null;
    if (state.lyricsManualScrolling && state.isPlaying && !isLyricsPointerDragging) {
      exitLyricsManualScroll({ animate: true });
    }
  }, waitMs);
}

function enterLyricsManualScroll(opts = {}) {
  if (!state.hasValidLyrics || state.lyricsLoading || !state.lyricDOMCache || state.lyricDOMCache.length === 0) {
    return false;
  }
  state.lyricsManualScrolling = true;
  if (npRightLyrics) npRightLyrics.classList.add('is-manual-scroll');
  if (!opts.keepTimer) {
    clearTimeout(lyricsSnapBackTimer);
    lyricsSnapBackTimer = null;
  }
  clearTimeout(lyricsSnapBackClassTimer);
  if (lyricsScrollTrack) lyricsScrollTrack.classList.remove('is-snapping-back');
  if (opts.scheduleSnapBack) {
    scheduleLyricsSnapBack(opts.delayMs);
  }
  return true;
}

function exitLyricsManualScroll(opts = {}) {
  clearTimeout(lyricsSnapBackTimer);
  lyricsSnapBackTimer = null;
  clearTimeout(lyricsWheelClearTimer);
  lyricsWheelClearTimer = null;
  clearTimeout(lyricsSnapBackClassTimer);
  lyricsSnapBackClassTimer = null;
  cancelLyricsInertia();

  isLyricsPointerDragging = false;
  state.lyricsManualScrolling = false;
  if (npRightLyrics) {
    npRightLyrics.classList.remove('is-manual-scroll', 'is-dragging');
  }
  if (lyricsScrollTrack) {
    lyricsScrollTrack.classList.remove('is-dragging', 'is-wheel-scrolling', 'is-snapping-back');
  }

  if (!opts.skipSnapBack && lyricsScrollTrack) {
    const target = getLyricsActiveTargetOffset();
    if (opts.animate !== false) {
      lyricsScrollTrack.classList.add('is-snapping-back');
      applyLyricsScrollOffset(target);
      lyricsSnapBackClassTimer = setTimeout(() => {
        lyricsSnapBackClassTimer = null;
        if (lyricsScrollTrack) lyricsScrollTrack.classList.remove('is-snapping-back');
      }, 660);
    } else {
      applyLyricsScrollOffset(target);
    }
  }
}

function scrollLyricsByDelta(deltaPx, opts = {}) {
  cancelLyricsInertia();
  if (!enterLyricsManualScroll({ keepTimer: false })) return false;
  const maxOffset = getLyricsMaxScrollOffset();
  const nextOffset = Math.max(0, Math.min(maxOffset, (state.lyricsScrollOffset || 0) + (deltaPx || 0)));

  if (opts.smoothWheel && lyricsScrollTrack) {
    lyricsScrollTrack.classList.add('is-wheel-scrolling');
    clearTimeout(lyricsWheelClearTimer);
    lyricsWheelClearTimer = setTimeout(() => {
      lyricsWheelClearTimer = null;
      if (lyricsScrollTrack) lyricsScrollTrack.classList.remove('is-wheel-scrolling');
    }, 160);
  }

  applyLyricsScrollOffset(nextOffset);
  scheduleLyricsSnapBack(opts.snapDelayMs);
  return true;
}

(function initLyricsManualScroll() {
  if (!npRightLyrics || !lyricsScrollTrack) return;

  let pointerMode = null; // 'touch' | 'mouse' | null
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let lastTime = 0;
  let dragOriginOffset = 0;
  let hasDragged = false;
  let scrollVelocity = 0; // px/ms, positive moves lyrics toward bottom (offset increases)

  function isLyricsPanelActive() {
    return Boolean(state.isNowPlayingOpen && state.nowPlayingMode === 'lyrics');
  }

  function canScrollLyricsNow() {
    return Boolean(
      isLyricsPanelActive() &&
      state.hasValidLyrics &&
      !state.lyricsLoading &&
      state.lyricDOMCache &&
      state.lyricDOMCache.length > 0
    );
  }

  function handlePointerStart(mode, clientX, clientY) {
    if (!canScrollLyricsNow()) return false;
    cancelLyricsInertia();
    clearTimeout(lyricsSnapBackTimer);
    lyricsSnapBackTimer = null;
    clearTimeout(lyricsSnapBackClassTimer);
    lyricsScrollTrack.classList.remove('is-snapping-back', 'is-wheel-scrolling');

    pointerMode = mode;
    startX = clientX;
    startY = clientY;
    lastY = clientY;
    lastTime = Date.now();
    dragOriginOffset = Number.isFinite(state.lyricsScrollOffset) ? state.lyricsScrollOffset : getLyricsActiveTargetOffset();
    hasDragged = false;
    scrollVelocity = 0;
    return true;
  }

  function handlePointerMove(clientX, clientY, cancelableEvent) {
    if (!pointerMode) return;
    const vpScale = window._echoViewportScale || 1;
    const dx = (clientX - startX) / vpScale;
    const dy = (clientY - startY) / vpScale;

    if (!hasDragged) {
      if (Math.abs(dy) >= LYRICS_DRAG_THRESHOLD_PX && Math.abs(dy) >= Math.abs(dx) * 0.8) {
        hasDragged = true;
        isLyricsPointerDragging = true;
        enterLyricsManualScroll({ keepTimer: false });
        npRightLyrics.classList.add('is-dragging');
        lyricsScrollTrack.classList.add('is-dragging');
      } else if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        pointerMode = null;
        return;
      } else {
        return;
      }
    }

    if (cancelableEvent) {
      if (typeof cancelableEvent.stopPropagation === 'function') {
        cancelableEvent.stopPropagation();
      }
      if (cancelableEvent.cancelable) {
        cancelableEvent.preventDefault();
      }
    }

    const now = Date.now();
    const dt = Math.max(4, now - lastTime);
    const stepDeltaScroll = (lastY - clientY) / vpScale;
    const instVel = stepDeltaScroll / dt;
    scrollVelocity = scrollVelocity * 0.45 + instVel * 0.55;
    lastY = clientY;
    lastTime = now;

    const maxOffset = getLyricsMaxScrollOffset();
    const rawOffset = dragOriginOffset - dy;
    applyLyricsScrollOffset(rubberBandLyricsOffset(rawOffset, maxOffset));
  }

  function settleToBoundsAndScheduleSnap() {
    const maxOffset = getLyricsMaxScrollOffset();
    const cur = state.lyricsScrollOffset || 0;
    if (cur < 0 || cur > maxOffset) {
      const clamped = Math.max(0, Math.min(maxOffset, cur));
      lyricsScrollTrack.classList.add('is-snapping-back');
      applyLyricsScrollOffset(clamped);
      clearTimeout(lyricsSnapBackClassTimer);
      lyricsSnapBackClassTimer = setTimeout(() => {
        lyricsSnapBackClassTimer = null;
        if (lyricsScrollTrack) lyricsScrollTrack.classList.remove('is-snapping-back');
      }, 660);
    }
    scheduleLyricsSnapBack();
  }

  function handlePointerEnd() {
    if (!pointerMode) return;
    const endedDrag = hasDragged;
    const releaseVel = scrollVelocity;
    const timeSinceMove = Date.now() - lastTime;

    pointerMode = null;
    isLyricsPointerDragging = false;
    npRightLyrics.classList.remove('is-dragging');

    if (!endedDrag) {
      lyricsScrollTrack.classList.remove('is-dragging');
      if (state.lyricsManualScrolling) {
        scheduleLyricsSnapBack();
      }
      return;
    }

    state.lyricsLastDragEndAt = Date.now();
    const maxOffset = getLyricsMaxScrollOffset();
    const currentOffset = state.lyricsScrollOffset || 0;

    if (currentOffset < 0 || currentOffset > maxOffset) {
      lyricsScrollTrack.classList.remove('is-dragging');
      settleToBoundsAndScheduleSnap();
      return;
    }

    if (Math.abs(releaseVel) > 0.14 && timeSinceMove <= 90) {
      let vel = Math.max(-2.6, Math.min(2.6, releaseVel));
      let prevFrameTime = Date.now();

      const stepInertia = () => {
        lyricsInertiaRaf = null;
        if (!state.lyricsManualScrolling || pointerMode) {
          lyricsScrollTrack.classList.remove('is-dragging');
          return;
        }
        const now = Date.now();
        const frameMs = Math.min(48, Math.max(8, now - prevFrameTime));
        prevFrameTime = now;

        const nextOffset = (state.lyricsScrollOffset || 0) + vel * frameMs;
        vel *= Math.pow(0.935, frameMs / 16.67);

        if (nextOffset < 0 || nextOffset > maxOffset) {
          applyLyricsScrollOffset(Math.max(0, Math.min(maxOffset, nextOffset)));
          lyricsScrollTrack.classList.remove('is-dragging');
          scheduleLyricsSnapBack();
          return;
        }

        applyLyricsScrollOffset(nextOffset);
        if (Math.abs(vel) >= 0.05) {
          lyricsInertiaRaf = requestAnimationFrame(stepInertia);
        } else {
          lyricsScrollTrack.classList.remove('is-dragging');
          scheduleLyricsSnapBack();
        }
      };

      lyricsInertiaRaf = requestAnimationFrame(stepInertia);
      return;
    }

    lyricsScrollTrack.classList.remove('is-dragging');
    scheduleLyricsSnapBack();
  }

  npRightLyrics.addEventListener('touchstart', (e) => {
    if (isLyricsPanelActive() && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    if (!e.touches || e.touches.length !== 1) {
      if (pointerMode === 'touch') handlePointerEnd();
      return;
    }
    handlePointerStart('touch', e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  npRightLyrics.addEventListener('touchmove', (e) => {
    if (isLyricsPanelActive() && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    if (pointerMode !== 'touch') return;
    if (!e.touches || e.touches.length !== 1) {
      handlePointerEnd();
      return;
    }
    handlePointerMove(e.touches[0].clientX, e.touches[0].clientY, e);
  }, { passive: false });

  npRightLyrics.addEventListener('touchend', (e) => {
    if (isLyricsPanelActive() && e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    if (pointerMode === 'touch') handlePointerEnd();
  }, { passive: true });

  npRightLyrics.addEventListener('touchcancel', (e) => {
    if (isLyricsPanelActive() && e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    if (pointerMode === 'touch') handlePointerEnd();
  }, { passive: true });

  npRightLyrics.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (isLyricsPanelActive() && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    handlePointerStart('mouse', e.clientX, e.clientY);
  });

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('touchend', () => {
      if (pointerMode === 'touch') handlePointerEnd();
    }, { passive: true });

    window.addEventListener('touchcancel', () => {
      if (pointerMode === 'touch') handlePointerEnd();
    }, { passive: true });

    window.addEventListener('mousemove', (e) => {
      if (pointerMode === 'mouse') handlePointerMove(e.clientX, e.clientY, e);
    });

    window.addEventListener('mouseup', () => {
      if (pointerMode === 'mouse') handlePointerEnd();
    });
  }

  npRightLyrics.addEventListener('wheel', (e) => {
    if (!isLyricsPanelActive()) return;
    if (typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    if (!canScrollLyricsNow()) return;
    const scaleY = e.deltaMode === 1 ? 32 : (e.deltaMode === 2 ? 320 : 1);
    const rawDelta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? (e.deltaY * scaleY) : 0;
    if (e.cancelable) e.preventDefault();
    if (!rawDelta) return;
    const clampedDelta = Math.max(-180, Math.min(180, rawDelta));
    scrollLyricsByDelta(clampedDelta, { smoothWheel: true });
  }, { passive: false });
})();

function buildLyricsSkeletonHTML() {
  const rows = [
    { width: '74%', opacity: '0.86', delay: '0ms' },
    { width: '54%', opacity: '0.70', delay: '110ms' },
    { width: '82%', opacity: '0.54', delay: '220ms' },
    { width: '46%', opacity: '0.39', delay: '330ms' },
    { width: '68%', opacity: '0.26', delay: '440ms' },
    { width: '58%', opacity: '0.15', delay: '550ms' }
  ];
  const linesHtml = rows.map(r => (
    `<div class="lyrics-skeleton-line" style="width: ${r.width}; --skel-opacity: ${r.opacity}; --skel-delay: ${r.delay};"></div>`
  )).join('');
  return `
    <div class="lyrics-skeleton-list" aria-hidden="true">
      <div class="lyrics-skeleton-dots">
        <span class="lyrics-skeleton-dot"></span>
        <span class="lyrics-skeleton-dot"></span>
        <span class="lyrics-skeleton-dot"></span>
      </div>
      ${linesHtml}
    </div>
  `;
}

function renderLyricsLoadingSkeleton() {
  if (!lyricsScrollTrack) return;
  if (!lyricsScrollTrack.querySelector('.lyrics-skeleton-list')) {
    lyricsScrollTrack.innerHTML = buildLyricsSkeletonHTML();
    applyLyricsScrollOffset(0);
    lyricsScrollTrack.classList.add('lyrics-fade-out');
    requestAnimationFrame(() => {
      if (state.lyricsLoading && !state.hasValidLyrics && lyricsScrollTrack) {
        lyricsScrollTrack.classList.remove('lyrics-fade-out');
      }
    });
  } else {
    lyricsScrollTrack.classList.remove('lyrics-fade-out');
  }
}

function buildLyricsDOM(lyricsArray) {
  exitLyricsManualScroll({ skipSnapBack: true });
  applyLyricsScrollOffset(0);
  const firstLineStart = (lyricsArray[0] && lyricsArray[0].start) || 0;
  const hasIntroInterlude = firstLineStart >= 4.0;
  const introHtml = hasIntroInterlude
    ? `<div class="amll-interlude-dots" data-istart="0" data-iend="${(firstLineStart - 0.15).toFixed(2)}"><span class="amll-interlude-dot"></span><span class="amll-interlude-dot"></span><span class="amll-interlude-dot"></span></div>`
    : '';

  lyricsScrollTrack.innerHTML = introHtml + lyricsArray.map((line, lineIdx) => {
    let wordsHtml = '';

    if (Array.isArray(line.words) && line.words.length > 0) {
      // 100% REAL APPLE MUSIC TIMESTAMPS (Truth Source from LyricsPlus)
      wordsHtml = line.words.map((wObj, wIdx) => {
        const isLast = wIdx === line.words.length - 1;
        const dur = Math.max(0.08, wObj.end - wObj.start);
        const cleanWord = wObj.text.replace(/[^a-zA-ZáéíóúñüÁÉÍÓÚÑÜ']/g, '');
        const syllables = estimateWordSyllables(cleanWord);
        const isPunchy = cleanWord.length <= 3 && syllables <= 1.1;
        const isHeld = dur >= 0.48 || (isLast && dur >= 0.32);
        return `<span class="lyric-word pending" data-wstart="${wObj.start.toFixed(3)}" data-wend="${wObj.end.toFixed(3)}" data-punchy="${isPunchy ? '1' : '0'}" data-held="${isHeld ? '1' : '0'}" data-last="${isLast ? '1' : '0'}">${wObj.text}</span>`;
      }).join('');
    } else {
      // FALLBACK TO REFINED ALGORITHMIC PHONETIC ENGINE (for LRCLIB plain line lyrics)
      const words = line.text.trim().split(/\s+/);
      const lineDuration = Math.max(0.40, (line.end || line.start + 3.6) - line.start);

      // 1. Detect intra-line breath pauses after punctuation
      const rawPauses = words.map((w, idx) => {
        if (idx === words.length - 1) return 0;
        if (/[.;:!?\u2026—-]$/.test(w)) return 0.16;
        if (/[,]$/.test(w)) return 0.10;
        return 0;
      });
      const totalRawPause = rawPauses.reduce((a, b) => a + b, 0);
      const maxAllowedPause = lineDuration * 0.18;
      const pauseScale = totalRawPause > maxAllowedPause ? (maxAllowedPause / totalRawPause) : 1;
      const pauses = rawPauses.map(p => p * pauseScale);
      const singingBudget = Math.max(0.3, lineDuration - pauses.reduce((a, b) => a + b, 0));

      // 2. Weight each word's singing duration by syllables & phonetic articulation
      const weights = words.map((w, idx) => {
        const cleanWord = w.replace(/[^a-zA-ZáéíóúñüÁÉÍÓÚÑÜ']/g, '');
        const lowerClean = cleanWord.replace(/'/g, '').toLowerCase();
        const syllables = estimateWordSyllables(cleanWord);
        
        // Base articulation budget + duration per vowel syllable
        let weight = 0.60 + syllables * 0.85;

        const isLastWord = idx === words.length - 1;
        const hasPausePunct = /[,.;:!?\u2026~-]$/.test(w);
        const hasRepeatedVowel = /([aeiouáéíóú])\1/i.test(cleanWord);

        // Fast functional connectors (articles, short pronouns, prepositions)
        if (FAST_CONNECTOR_WORDS.has(lowerClean) && !isLastWord && !hasPausePunct) {
          weight *= 0.68;
        }
        // Gentle balanced phrase-ending sustain (1.18x instead of 1.58x so earlier words aren't squished)
        if (isLastWord) weight *= 1.18;
        if (hasPausePunct) weight *= 1.15;
        if (hasRepeatedVowel) weight *= 1.30;
        return weight;
      });

      const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
      let cursorSec = line.start;

      wordsHtml = words.map((w, wIdx) => {
        const dur = (weights[wIdx] / totalWeight) * singingBudget;
        const wStart = cursorSec;
        const wEnd = cursorSec + dur;
        cursorSec = wEnd + pauses[wIdx];
        const isLast = wIdx === words.length - 1;
        const cleanWord = w.replace(/[^a-zA-ZáéíóúñüÁÉÍÓÚÑÜ']/g, '');
        const syllables = estimateWordSyllables(cleanWord);
        const isPunchy = cleanWord.length <= 3 && syllables <= 1.1;
        const isHeld = dur >= 0.48 || (isLast && dur >= 0.32);
        return `<span class="lyric-word pending" data-wstart="${wStart.toFixed(3)}" data-wend="${wEnd.toFixed(3)}" data-punchy="${isPunchy ? '1' : '0'}" data-held="${isHeld ? '1' : '0'}" data-last="${isLast ? '1' : '0'}">${w}</span>`;
      }).join('');
    }

    const gapAfter = (line.lineEnd || line.end) - line.end;
    const interludeAfterHtml = gapAfter >= 4.2
      ? `<div class="amll-interlude-dots" data-istart="${(line.end + 0.15).toFixed(2)}" data-iend="${(line.lineEnd - 0.15).toFixed(2)}"><span class="amll-interlude-dot"></span><span class="amll-interlude-dot"></span><span class="amll-interlude-dot"></span></div>`
      : '';

    const initialCls = getLyricLineClass(lineIdx, -1);
    return `<div class="${initialCls}" data-line-idx="${lineIdx}" data-start="${line.start}" data-end="${line.end}">${wordsHtml}</div>${interludeAfterHtml}`;
  }).join('');

  lyricsScrollTrack.classList.toggle('mode-line', state.wordByWordLyrics === false);

  // Pre-cache all DOM references & timing floats so the 60fps loop does zero DOM queries or layout reads
  const lineEls = Array.from(lyricsScrollTrack.querySelectorAll('.lyric-line'));
  const interludeEls = Array.from(lyricsScrollTrack.querySelectorAll('.amll-interlude-dots'));

  state.interludeDOMCache = interludeEls.map(iEl => {
    const dots = Array.from(iEl.querySelectorAll('.amll-interlude-dot'));
    const iStart = parseFloat(iEl.getAttribute('data-istart')) || 0;
    const iEnd = parseFloat(iEl.getAttribute('data-iend')) || (iStart + 4);
    return {
      el: iEl,
      dots,
      dotStates: [false, false, false],
      iStart,
      iEnd,
      iDur: Math.max(0.5, iEnd - iStart),
      active: false
    };
  });

  state.lyricDOMCache = lineEls.map((lineEl, idx) => {
    const lineData = lyricsArray[idx] || {};
    const wordEls = Array.from(lineEl.querySelectorAll('.lyric-word'));
    const initialCls = getLyricLineClass(idx, -1);
    return {
      el: lineEl,
      lastClass: initialCls,
      targetOffset: 0,
      start: lineData.start || 0,
      end: lineData.end || ((lineData.start || 0) + 4),
      lineEnd: lineData.lineEnd || lineData.end || ((lineData.start || 0) + 5),
      words: wordEls.map(wEl => {
        const wStart = parseFloat(wEl.getAttribute('data-wstart')) || 0;
        const wEnd = parseFloat(wEl.getAttribute('data-wend')) || (wStart + 0.4);
        return {
          el: wEl,
          wStart,
          wEnd,
          wDur: Math.max(0.08, wEnd - wStart),
          isPunchy: wEl.getAttribute('data-punchy') === '1',
          isHeld: wEl.getAttribute('data-held') === '1',
          isLast: wEl.getAttribute('data-last') === '1',
          state: 'pending',
          lastWipe: -999
        };
      })
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
const LYRIC_SYNC_LEAD_SEC = 0.04;

function updateScrubberAndLyricsUI(forceScroll = false) {
  if (!forceScroll && !state.isNowPlayingOpen) return;
  // Si hay una transición de portada o scrub activo, ceder el control de UI sin peleas con el reloj
  if (!forceScroll && coverCrossfadeTimer) return;
  if (!forceScroll && state.isScrubbing) return;

  const ratio = Math.min(1, Math.max(0, state.currentTimeSec / Math.max(1, state.durationSec)));
  if (forceScroll || Math.abs(ratio - state.lastScrubberRatio) >= 0.0035) {
    state.lastScrubberRatio = ratio;
    npScrubberFill.style.transform = `scaleX(${ratio.toFixed(3)})`;
  }

  // Only update time text DOM once per integer second (never 60x/sec)
  const curIntSec = Math.floor(state.currentTimeSec);
  if (forceScroll || curIntSec !== state.lastRenderedSec) {
    state.lastRenderedSec = curIntSec;
    npTimeElapsed.textContent = formatTime(curIntSec);
    const remaining = Math.max(0, state.durationSec - curIntSec);
    npTimeRemaining.textContent = `-${formatTime(remaining)}`;

    if (
      (state.hasCustomReorderedQueue || (state.isLocalContextQueue && state.singleTrackPlayback) || state.isAutoplayQueue) &&
      state.isPlaying &&
      !state.isBuffering &&
      state.durationSec >= 15 &&
      (state.durationSec - state.currentTimeSec) <= 1.2 &&
      Array.isArray(state.liveQueueTracks) &&
      state.liveQueueTracks.length > 0 &&
      typeof skipNextTrack === 'function'
    ) {
      skipNextTrack();
    }

    // Proactive 50% pre-calculation for uninterrupted Radio transitions
    if (
      state.isPlaying &&
      state.isAutoplayQueue &&
      !state.autoplayLoading &&
      state.durationSec >= 30 &&
      ratio >= 0.5 &&
      (state.liveQueueTracks || []).length < 5 &&
      typeof replenishAutoplayQueue === 'function'
    ) {
      replenishAutoplayQueue();
    }
  }

  const cache = state.lyricDOMCache;
  if (!cache || cache.length === 0) return;

  const lyricTime = state.currentTimeSec + LYRIC_SYNC_LEAD_SEC;

  // Update AMLL Interlude Dots (• • •) if any exist
  const interludes = state.interludeDOMCache;
  if (interludes && interludes.length > 0) {
    for (let k = 0; k < interludes.length; k++) {
      const inter = interludes[k];
      const isNowActive = lyricTime >= inter.iStart && lyricTime < inter.iEnd;
      if (isNowActive !== inter.active) {
        inter.active = isNowActive;
        inter.el.classList.toggle('active', isNowActive);
        if (!isNowActive) {
          for (let d = 0; d < 3; d++) {
            if (inter.dotStates[d]) {
              inter.dotStates[d] = false;
              inter.dots[d].classList.remove('lit');
            }
          }
        }
      }
      if (isNowActive) {
        const iProg = (lyricTime - inter.iStart) / inter.iDur;
        const thresholds = [0.06, 0.36, 0.66];
        for (let d = 0; d < 3; d++) {
          const shouldLight = iProg >= thresholds[d];
          if (shouldLight !== inter.dotStates[d]) {
            inter.dotStates[d] = shouldLight;
            inter.dots[d].classList.toggle('lit', shouldLight);
          }
        }
      }
    }
  }

  let newActiveIdx = -1;
  if (cache.length > 0 && lyricTime >= cache[0].start) {
    for (let i = 0; i < cache.length; i++) {
      if (lyricTime >= cache[i].start && lyricTime < cache[i].lineEnd) {
        newActiveIdx = i;
        break;
      } else if (lyricTime >= cache[i].lineEnd) {
        newActiveIdx = i;
      }
    }
  }

  const lineChanged = forceScroll || newActiveIdx !== state.activeLineIndex;

  if (lineChanged) {
    if (state.activeLineIndex >= 0 && cache[state.activeLineIndex]) {
      const oldWords = cache[state.activeLineIndex].words;
      for (let w = 0; w < oldWords.length; w++) {
        if (oldWords[w].state !== 'pending') {
          oldWords[w].state = 'pending';
          oldWords[w].lastWipe = -999;
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

  const isWordByWord = (state.wordByWordLyrics !== false);
  const activeLine = (newActiveIdx >= 0) ? cache[newActiveIdx] : null;
  if (activeLine && isWordByWord) {
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
        // Real Human Vocal Curve (Attack-Sustain):
        // Articulation sweeps the word across the first ~72%, and the sustained vowel
        // holds 100% lit through the final 28% of the duration so it never cuts out early!
        const rawProg = Math.min(1, Math.max(0, (lyricTime - wObj.wStart) / wObj.wDur));
        const attackThreshold = wObj.isPunchy ? 0.28 : 0.72;
        const wipeProg = rawProg < attackThreshold ? (rawProg / attackThreshold) : 1.0;

        const wipeLeft = Math.round(wipeProg * 114 - 14);
        if (wipeLeft !== wObj.lastWipe) {
          wObj.lastWipe = wipeLeft;
          wObj.el.style.setProperty('--wipe-left', `${wipeLeft}%`);
          wObj.el.style.setProperty('--wipe-right', `${wipeLeft + 22}%`);
        }
      } else {
        if (wObj.state !== 'pending') {
          wObj.state = 'pending';
          wObj.lastWipe = -999;
          wObj.el.className = 'lyric-word pending';
        }
      }
    }
  }

  if (lineChanged) {
    state.activeLineIndex = newActiveIdx;
    if (!state.lyricsManualScrolling) {
      if (activeLine) {
        const targetOffset = typeof activeLine.targetOffset === 'number'
          ? activeLine.targetOffset
          : Math.max(0, activeLine.el.offsetTop - LYRICS_ANCHOR_OFFSET);
        applyLyricsScrollOffset(targetOffset);
      } else {
        applyLyricsScrollOffset(0);
      }
    }
  }
}

let bufferingSafetyTimer = null;

function setPlaybackBuffering(isBuffering) {
  const next = Boolean(isBuffering);
  if (bufferingSafetyTimer) {
    clearTimeout(bufferingSafetyTimer);
    bufferingSafetyTimer = null;
  }

  state.isBuffering = next;
  state.bufferingStartedAt = next ? Date.now() : 0;

  const scrubberWrap = typeof document !== 'undefined' ? document.querySelector('.np-scrubber-wrap') : null;
  if (npScrubberTrack) npScrubberTrack.classList.toggle('is-buffering', next);
  if (scrubberWrap) scrubberWrap.classList.toggle('is-buffering', next);
  if (npCoverStage) npCoverStage.classList.toggle('is-buffering', next);
  if (npPlayPauseBtn) npPlayPauseBtn.classList.toggle('is-buffering', next);
  if (miniPlayer) miniPlayer.classList.toggle('is-buffering', next);

  if (next) {
    bufferingSafetyTimer = setTimeout(async () => {
      bufferingSafetyTimer = null;
      if (!state.isBuffering) return;
      if (typeof isLocalWebPlayerActive === 'function' && isLocalWebPlayerActive() && webPlayer && typeof webPlayer.getCurrentState === 'function') {
        try {
          const sdkState = await webPlayer.getCurrentState();
          if (!state.isBuffering) return;
          if (!sdkState || !sdkState.track_window || !sdkState.track_window.current_track || sdkState.paused) {
            state.isPlaying = false;
            setPlaybackBuffering(false);
            updatePlayPauseIcons();
            if (typeof showToast === 'function') {
              showToast('No se pudo activar el audio; toca Play de nuevo');
            }
            return;
          }
        } catch (e) { }
      }
      setPlaybackBuffering(false);
    }, 6500);
  }
}

function triggerControlPop(el) {
  if (!el || !el.classList) return;
  el.classList.remove('is-popping');
  if (el._popClearTimer) {
    clearTimeout(el._popClearTimer);
    el._popClearTimer = null;
  }
  const applyPop = () => {
    el.classList.add('is-popping');
    el._popClearTimer = setTimeout(() => {
      el.classList.remove('is-popping');
      el._popClearTimer = null;
    }, 340);
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(applyPop);
  } else {
    applyPop();
  }
}

function updateShuffleButtonUI() {
  const shufBtn = typeof document !== 'undefined' ? document.getElementById('npShuffleBtn') : null;
  if (!shufBtn) return;
  const active = Boolean(spotifyAuth.shuffleState);
  shufBtn.classList.toggle('active', active);
  shufBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  shufBtn.title = active ? 'Aleatorio (activo)' : 'Aleatorio';
}

function updateRepeatButtonUI() {
  const repBtn = typeof document !== 'undefined' ? document.getElementById('npRepeatBtn') : null;
  if (!repBtn) return;
  const mode = spotifyAuth.repeatState || 'off';
  const isActive = mode !== 'off';
  repBtn.classList.toggle('active', isActive);
  repBtn.classList.toggle('is-repeat-track', mode === 'track');
  repBtn.setAttribute('data-repeat-mode', mode);
  repBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  repBtn.title = mode === 'track'
    ? 'Repetir canción actual (activo)'
    : (mode === 'context' ? 'Repetir en bucle (activo)' : 'Repetir en bucle');
}

function updatePlayPauseIcons() {
  if (npQueueEq) npQueueEq.classList.toggle('playing', !!state.isPlaying);
  if (npCoverStage) npCoverStage.classList.toggle('is-paused', !state.isPlaying);
  updateShuffleButtonUI();
  updateRepeatButtonUI();
  if (state.lyricsManualScrolling) {
    if (!state.isPlaying) {
      clearTimeout(lyricsSnapBackTimer);
      lyricsSnapBackTimer = null;
    } else if (!lyricsSnapBackTimer && !isLyricsPointerDragging) {
      scheduleLyricsSnapBack(LYRICS_RESUME_SNAP_BACK_DELAY_MS);
    }
  }
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

const QUEUE_DRAG_HANDLE_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><line x1="4" y1="8" x2="20" y2="8"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="16" x2="20" y2="16"></line></svg>`;

const QUEUE_SKELETON_TITLE_WIDTHS = ['64%', '52%', '72%', '58%', '68%', '48%'];
const QUEUE_SKELETON_ARTIST_WIDTHS = ['40%', '34%', '44%', '36%', '42%', '30%'];

function buildQueueSkeletonRowsHTML(count = 6, startIndex = 0) {
  const safeCount = Math.max(0, Math.floor(count || 0));
  if (safeCount === 0) return '';
  let html = '';
  for (let i = 0; i < safeCount; i++) {
    const slotIdx = startIndex + i;
    const titleW = QUEUE_SKELETON_TITLE_WIDTHS[slotIdx % QUEUE_SKELETON_TITLE_WIDTHS.length];
    const artistW = QUEUE_SKELETON_ARTIST_WIDTHS[slotIdx % QUEUE_SKELETON_ARTIST_WIDTHS.length];
    const opacity = Math.max(0.24, 0.78 - slotIdx * 0.09).toFixed(2);
    const delayMs = slotIdx * 90;
    html += `
      <div class="np-queue-skeleton-row" aria-hidden="true" style="--skel-opacity: ${opacity}; --skel-delay: ${delayMs}ms;">
        <div class="np-queue-skeleton-thumb"></div>
        <div class="np-queue-skeleton-meta">
          <div class="np-queue-skeleton-title" style="width: ${titleW};"></div>
          <div class="np-queue-skeleton-artist" style="width: ${artistW};"></div>
        </div>
        <div class="np-queue-skeleton-handle"></div>
      </div>
    `;
  }
  return html;
}

function buildQueueRowHTML(track, idx, sourceType = 'queue', animateEnter = false, enterOrder = 0) {
  const safeTitle = (track.title || '').replace(/"/g, '&quot;');
  const safeArtist = (track.artist || '').replace(/"/g, '&quot;');
  const safeAlbum = (track.album || '').replace(/"/g, '&quot;');
  const coverUrl = track.cover || DEFAULT_ALBUM_COVER;
  const thumbUrl = track.thumb || coverUrl;
  const durSec = track.duration || 210;
  const handleHtml = sourceType === 'queue'
    ? `<div class="np-queue-drag-handle" aria-label="Reordenar" title="Arrastra para reordenar">${QUEUE_DRAG_HANDLE_SVG}</div>`
    : '';
  const enterClass = animateEnter ? ' np-queue-row-enter' : '';
  const enterStyle = animateEnter ? ` style="--queue-enter-delay: ${Math.min(enterOrder, 6) * 28}ms;"` : '';
  return `
    <div class="np-queue-row${enterClass}"${enterStyle}
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
      ${renderOptImg(thumbUrl, safeTitle, 'np-queue-thumb')}
      <div class="np-queue-meta">
        <div class="np-queue-title">${track.title}</div>
        <div class="np-queue-artist">${track.artist}</div>
      </div>
      ${handleHtml}
    </div>
  `;
}

let lastQueueRenderedIds = [];
let lastQueueHadSkeleton = false;
let lastQueueRenderSignature = '';

function renderQueuePanelUI() {
  if (!npQueueListContainer || state.isDraggingQueueRow) return;

  // Do not duplicate the current track card in the right column, as Now Playing
  // is already permanently featured in large format on the left column
  if (npQueueCurrentCard) {
    npQueueCurrentCard.style.display = 'none';
  }

  updateShuffleButtonUI();

  const queue = state.liveQueueTracks || [];
  const discovery = state.discoveryTracks || [];
  const primaryArtist = state.playingArtist ? state.playingArtist.split(',')[0].trim() : '';

  // Priority 1: Pending tracks exist in queue ("A continuación")
  if (queue.length > 0) {
    let sub = '';
    if (state.isAutoplayQueue) {
      sub = primaryArtist ? `Reproducción automática · ${primaryArtist}` : 'Reproducción automática';
    } else if (state.hasCustomReorderedQueue) {
      sub = 'Orden personalizado';
    } else if (state.activeContextName || state.playingAlbumTitle) {
      sub = `Continuando desde ${state.activeContextName || state.playingAlbumTitle}`;
    }

    if (npQueueHeading) npQueueHeading.textContent = 'A continuación';
    if (npQueueSubheading) {
      if (sub) {
        npQueueSubheading.textContent = sub;
        npQueueSubheading.style.display = 'block';
      } else {
        npQueueSubheading.textContent = '';
        npQueueSubheading.style.display = 'none';
      }
    }
    if (npQueueSeeAllBtn) npQueueSeeAllBtn.style.display = 'none';

    const maxVisible = state.isAutoplayQueue ? 12 : 25;
    const visibleTracks = queue.slice(0, maxVisible);
    const skeletonCount = (state.queueLoading && visibleTracks.length < 6) ? (6 - visibleTracks.length) : 0;
    const visibleIds = visibleTracks.map(t => cleanTrackId(t.id || t.uri) || (t.title || ''));
    const renderSig = `q|${visibleIds.join(',')}|sk:${skeletonCount}|sub:${sub || ''}`;
    if (renderSig === lastQueueRenderSignature && npQueueListContainer.innerHTML) {
      return;
    }

    const shouldAnimateNewRows = lastQueueHadSkeleton && !(state.hasCustomReorderedQueue && !lastQueueHadSkeleton);
    const prevIdsSet = new Set(lastQueueRenderedIds);
    let enterOrder = 0;

    const rowsHtml = visibleTracks.map((t, i) => {
      const tid = visibleIds[i];
      const isNewAfterSkeleton = Boolean(shouldAnimateNewRows && tid && !prevIdsSet.has(tid));
      const order = isNewAfterSkeleton ? enterOrder++ : 0;
      return buildQueueRowHTML(t, i, 'queue', isNewAfterSkeleton, order);
    }).join('');
    const skeletonHtml = skeletonCount > 0 ? buildQueueSkeletonRowsHTML(skeletonCount, visibleTracks.length) : '';

    npQueueListContainer.innerHTML = rowsHtml + skeletonHtml;
    lastQueueRenderedIds = visibleIds;
    lastQueueHadSkeleton = skeletonCount > 0;
    lastQueueRenderSignature = renderSig;
    hydrateImages(npQueueListContainer);
    return;
  }

  // Priority 1.5: Skeleton placeholders while queue/autoplay is loading with no seeded tracks yet
  if (state.queueLoading || state.autoplayLoading) {
    if (npQueueHeading) npQueueHeading.textContent = 'A continuación';
    if (npQueueSubheading) {
      npQueueSubheading.textContent = '';
      npQueueSubheading.style.display = 'none';
    }
    if (npQueueSeeAllBtn) npQueueSeeAllBtn.style.display = 'none';

    const renderSig = 'loading:6';
    if (renderSig === lastQueueRenderSignature && npQueueListContainer.innerHTML) {
      return;
    }
    npQueueListContainer.innerHTML = buildQueueSkeletonRowsHTML(6, 0);
    lastQueueRenderedIds = [];
    lastQueueHadSkeleton = true;
    lastQueueRenderSignature = renderSig;
    return;
  }

  // Priority 2: Musical Discovery when no pending queue exists and API returned recommendations
  if (discovery.length > 0) {
    if (npQueueHeading) npQueueHeading.textContent = 'Reproducción automática';
    if (npQueueSubheading) {
      npQueueSubheading.textContent = primaryArtist
        ? `Similar a ${primaryArtist}`
        : 'Sugerencias para continuar';
      npQueueSubheading.style.display = 'block';
    }
    if (npQueueSeeAllBtn) npQueueSeeAllBtn.style.display = 'none';

    const animateDiscovery = lastQueueHadSkeleton;
    npQueueListContainer.innerHTML = discovery.slice(0, 8).map((t, i) => buildQueueRowHTML(t, i, 'discovery', animateDiscovery, i)).join('');
    lastQueueRenderedIds = [];
    lastQueueHadSkeleton = false;
    lastQueueRenderSignature = '';
    hydrateImages(npQueueListContainer);
    return;
  }

  // Priority 3: Fallback empty state only when neither queue nor discovery tracks are available
  if (npQueueHeading) npQueueHeading.textContent = 'A continuación';
  if (npQueueSubheading) {
    npQueueSubheading.textContent = '';
    npQueueSubheading.style.display = 'none';
  }
  if (npQueueSeeAllBtn) npQueueSeeAllBtn.style.display = 'none';

  lastQueueRenderedIds = [];
  lastQueueHadSkeleton = false;
  lastQueueRenderSignature = 'empty';
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
        <div class="np-queue-empty-title">Sin canciones a continuación</div>
        <div class="np-queue-empty-sub">Agrega canciones o elige una lista para continuar</div>
      </div>
    </div>
  `;
}

function reorderQueueTrack(fromIdx, toIdx) {
  const queue = state.liveQueueTracks;
  if (!Array.isArray(queue) || queue.length < 2) return false;
  if (fromIdx < 0 || fromIdx >= queue.length || toIdx < 0 || toIdx >= queue.length || fromIdx === toIdx) {
    return false;
  }

  const nextQueue = [...queue];
  const [moved] = nextQueue.splice(fromIdx, 1);
  nextQueue.splice(toIdx, 0, moved);

  state.liveQueueTracks = nextQueue;
  state.contextUpcomingTracks = [...nextQueue];
  state.sdkNextTracks = [];
  state.hasCustomReorderedQueue = true;

  if (state.isAutoplayQueue && Array.isArray(state.autoplaySessionTracks) && state.autoplaySessionTracks.length > 0) {
    const curIdx = Math.max(0, state.autoplaySessionIndex || 0);
    state.autoplaySessionTracks = state.autoplaySessionTracks.slice(0, curIdx + 1).concat(nextQueue);
  }

  renderQueuePanelUI();
  if (typeof prefetchUpcomingLyrics === 'function') {
    prefetchUpcomingLyrics(nextQueue, 2);
  }
  return true;
}

(function initQueueDragReorder() {
  if (!npQueueListContainer) return;

  let activeMode = null; // 'touch' | 'mouse' | null
  let dragRows = [];
  let draggedRow = null;
  let fromIdx = -1;
  let targetIdx = -1;
  let startY = 0;
  let rowStride = 66;

  function beginDrag(mode, clientY, target) {
    if (!target || !target.closest) return false;
    const handle = target.closest('.np-queue-drag-handle');
    if (!handle) return false;
    const row = handle.closest('.np-queue-row');
    if (!row || row.getAttribute('data-queue-source') !== 'queue') return false;

    const rows = Array.from(npQueueListContainer.querySelectorAll('.np-queue-row[data-queue-source="queue"]'));
    const idx = parseInt(row.getAttribute('data-queue-idx'), 10);
    if (!Number.isFinite(idx) || idx < 0 || rows.length < 2) return false;

    activeMode = mode;
    dragRows = rows;
    draggedRow = row;
    fromIdx = idx;
    targetIdx = idx;
    startY = clientY;
    rowStride = rows.length > 1
      ? Math.max(48, (rows[1].offsetTop || 0) - (rows[0].offsetTop || 0))
      : (row.offsetHeight || 66);

    state.isDraggingQueueRow = true;
    row.classList.add('is-dragging');
    return true;
  }

  function moveDrag(clientY, cancelableEvent) {
    if (!activeMode || !draggedRow) return;
    if (cancelableEvent && cancelableEvent.cancelable) {
      cancelableEvent.preventDefault();
    }
    if (cancelableEvent && typeof cancelableEvent.stopPropagation === 'function') {
      cancelableEvent.stopPropagation();
    }

    const vpScale = window._echoViewportScale || 1;
    const dy = (clientY - startY) / vpScale;
    draggedRow.style.transform = `translate3d(0, ${dy.toFixed(1)}px, 0) scale(1.02)`;

    const nextTarget = Math.max(0, Math.min(dragRows.length - 1, fromIdx + Math.round(dy / rowStride)));
    if (nextTarget !== targetIdx) {
      targetIdx = nextTarget;
      for (let i = 0; i < dragRows.length; i++) {
        const r = dragRows[i];
        if (i === fromIdx || r === draggedRow) continue;
        r.classList.add('is-displaced');
        let shift = 0;
        if (fromIdx < targetIdx && i > fromIdx && i <= targetIdx) {
          shift = -rowStride;
        } else if (fromIdx > targetIdx && i >= targetIdx && i < fromIdx) {
          shift = rowStride;
        }
        r.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
      }
    }
  }

  function finishDrag(applyOrder) {
    if (!activeMode) return;
    const finalFrom = fromIdx;
    const finalTarget = targetIdx;

    for (let i = 0; i < dragRows.length; i++) {
      dragRows[i].classList.remove('is-dragging', 'is-displaced');
      dragRows[i].style.transform = '';
    }

    activeMode = null;
    dragRows = [];
    draggedRow = null;
    fromIdx = -1;
    targetIdx = -1;
    state.isDraggingQueueRow = false;

    if (applyOrder && finalTarget !== finalFrom) {
      reorderQueueTrack(finalFrom, finalTarget);
    }
  }

  npQueueListContainer.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    if (beginDrag('touch', e.touches[0].clientY, e.target)) {
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (activeMode !== 'touch' || !e.touches || e.touches.length !== 1) return;
    moveDrag(e.touches[0].clientY, e);
  }, { passive: false });

  window.addEventListener('touchend', () => {
    if (activeMode === 'touch') finishDrag(true);
  }, { passive: true });

  window.addEventListener('touchcancel', () => {
    if (activeMode === 'touch') finishDrag(false);
  }, { passive: true });

  npQueueListContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (beginDrag('mouse', e.clientY, e.target)) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (activeMode === 'mouse') moveDrag(e.clientY, e);
  });

  window.addEventListener('mouseup', () => {
    if (activeMode === 'mouse') finishDrag(true);
  });
})();

async function fetchAndRenderQueueForCurrentTrack(trackObj) {
  const reqTrackId = state.playingTrackId;
  const reqActionSeq = playbackActionSeq;

  // Helper ligero: pre-calentar solo las próximas 3 canciones (portada HD + miniatura + paleta de color en caché)
  // sin saturar la red ni el decodificador de imágenes del Echo Show con 25 descargas simultáneas
  const prewarmUpcomingSlice = (tracksList) => {
    if (!Array.isArray(tracksList) || tracksList.length === 0) return;
    const nextThree = tracksList.slice(0, 3);
    prewarmImageUrls(nextThree.map(t => t.cover));
    prewarmImageUrls(nextThree.map(t => t.thumb || t.cover));
    if (typeof prewarmTrackPalette === 'function') {
      nextThree.forEach(t => {
        if (t && t.cover) prewarmTrackPalette(t.cover, [t.cover, t.thumb]);
      });
    }
    if (typeof prefetchUpcomingLyrics === 'function') {
      prefetchUpcomingLyrics(tracksList, 2);
    }
  };

  if (!state.isAutoplayQueue && (state.hasCustomReorderedQueue || state.isLocalContextQueue) && Array.isArray(state.liveQueueTracks) && state.liveQueueTracks.length > 0) {
    state.discoveryTracks = [];
    state.queueLoading = false;
    if (state.nowPlayingMode === 'queue') {
      renderQueuePanelUI();
    }
    prewarmUpcomingSlice(state.liveQueueTracks);
    updateNowPlayingRightPanelMode();
    return;
  }

  const curCid = cleanTrackId(state.playingTrackId || state.playingTrackUri);
  const curTitleLow = (state.playingTrackTitle || '').trim().toLowerCase();
  const buildMergedQueue = (...lists) => {
    const out = [];
    const seen = new Set();
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const rawItem of list) {
        const norm = (rawItem && rawItem.title && !rawItem.name && !rawItem.album?.images)
          ? rawItem
          : normalizeApiTrack(rawItem);
        if (!norm) continue;
        const cid = cleanTrackId(norm.id || norm.uri);
        const tLow = (norm.title || '').trim().toLowerCase();
        if ((curCid && cid === curCid) || (curTitleLow && tLow === curTitleLow)) continue;
        const key = cid || `${tLow}|${(norm.artist || '').toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(norm);
        if (out.length >= 25) return out;
      }
    }
    return out;
  };

  // Autoplay Radio session manages its own bidirectional queue without losing history
  if (state.isAutoplayQueue && Array.isArray(state.autoplaySessionTracks) && state.autoplaySessionTracks.length > 0) {
    const idx = Math.max(0, state.autoplaySessionIndex || 0);
    state.liveQueueTracks = state.autoplaySessionTracks.slice(idx + 1);
    state.contextUpcomingTracks = state.liveQueueTracks;
    state.discoveryTracks = [];
    state.queueLoading = false;
    if (state.liveQueueTracks.length < 5 && !state.autoplayLoading && typeof replenishAutoplayQueue === 'function') {
      replenishAutoplayQueue();
    }
    if (state.nowPlayingMode === 'queue') {
      renderQueuePanelUI();
    }
    prewarmUpcomingSlice(state.liveQueueTracks);
    updateNowPlayingRightPanelMode();
    return;
  }

  // Priority 0: Exact in-memory next_tracks from active Web Playback SDK (0ms lag, respects real shuffle & Connect queue)
  if (typeof isLocalWebPlayerActive === 'function' && isLocalWebPlayerActive() && typeof webPlayer.getCurrentState === 'function') {
    try {
      const localState = await webPlayer.getCurrentState();
      if (reqActionSeq !== playbackActionSeq || reqTrackId !== state.playingTrackId) return;
      const localCur = localState && localState.track_window ? localState.track_window.current_track : null;
      const localCurCid = localCur ? cleanTrackId(localCur.id || localCur.uri) : '';
      const localCurTitle = localCur ? (localCur.name || '').trim().toLowerCase() : '';
      const sdkMatchesCurrentTrack = Boolean(
        localCur && (
          (curCid && localCurCid === curCid) ||
          (curTitleLow && localCurTitle === curTitleLow)
        )
      );
      if (sdkMatchesCurrentTrack && Array.isArray(localState.track_window.next_tracks)) {
        state.sdkNextTracks = buildMergedQueue(localState.track_window.next_tracks);
      } else if (!sdkMatchesCurrentTrack) {
        state.sdkNextTracks = [];
      }
    } catch (e) { }
  }

  // Seed initial liveQueueTracks before API call: prefer SDK next_tracks; preserve live tail or aligned context
  if (Array.isArray(state.sdkNextTracks) && state.sdkNextTracks.length > 0) {
    let alignedContext = [];
    if (!spotifyAuth.shuffleState && Array.isArray(state.contextUpcomingTracks) && state.contextUpcomingTracks.length > 0) {
      const firstSdkCid = cleanTrackId(state.sdkNextTracks[0].id || state.sdkNextTracks[0].uri);
      const firstSdkTitle = (state.sdkNextTracks[0].title || '').trim().toLowerCase();
      const matchPos = state.contextUpcomingTracks.findIndex(t =>
        (firstSdkCid && cleanTrackId(t.id || t.uri) === firstSdkCid) ||
        (firstSdkTitle && (t.title || t.name || '').trim().toLowerCase() === firstSdkTitle)
      );
      if (matchPos >= 0) {
        alignedContext = state.contextUpcomingTracks.slice(matchPos + 1);
      } else if (Array.isArray(state.liveQueueTracks) && state.liveQueueTracks.length > state.sdkNextTracks.length) {
        alignedContext = state.liveQueueTracks;
      }
    } else if (Array.isArray(state.liveQueueTracks) && state.liveQueueTracks.length > state.sdkNextTracks.length) {
      alignedContext = state.liveQueueTracks;
    }
    state.liveQueueTracks = buildMergedQueue(state.sdkNextTracks, alignedContext);
  } else if (!spotifyAuth.shuffleState && Array.isArray(state.contextUpcomingTracks) && state.contextUpcomingTracks.length > 0) {
    const currentIdx = state.contextUpcomingTracks.findIndex(t => (t.id && t.id === state.playingTrackId) || (t.title && t.title === state.playingTrackTitle));
    const sliceStart = currentIdx >= 0 ? currentIdx + 1 : 0;
    state.liveQueueTracks = buildMergedQueue(state.contextUpcomingTracks.slice(sliceStart));
  }

  if (state.liveQueueTracks.length > 0) {
    state.discoveryTracks = [];
  }
  state.queueLoading = Boolean(spotifyAuth.accessToken);

  if (state.nowPlayingMode === 'queue') {
    renderQueuePanelUI();
  }
  if (state.liveQueueTracks.length > 0) {
    prewarmUpcomingSlice(state.liveQueueTracks);
  }

  if (!spotifyAuth.accessToken) {
    state.queueLoading = false;
    return;
  }

  // Priority 1: Check real Spotify Player Queue (/me/player/queue)
  const qRes = await spotifyFetch('/me/player/queue');
  if (reqActionSeq !== playbackActionSeq || reqTrackId !== state.playingTrackId) return;

  const hasCurPlayingField = Boolean(qRes && 'currently_playing' in qRes);
  const qCur = (qRes && qRes.currently_playing) ? qRes.currently_playing : null;
  const qCurCid = qCur ? cleanTrackId(qCur.id || qCur.uri) : '';
  const qCurTitleLow = qCur ? (qCur.name || qCur.title || '').trim().toLowerCase() : '';
  const queueMatchesCurrentTrack = !hasCurPlayingField
    ? true
    : Boolean(qCur && ((curCid && qCurCid === curCid) || (curTitleLow && qCurTitleLow === curTitleLow)));

  if (qRes && Array.isArray(qRes.queue) && qRes.queue.length > 0 && queueMatchesCurrentTrack) {
    const apiQueue = buildMergedQueue(qRes.queue);
    if (apiQueue.length > 0) {
      const usingLocalSdk = typeof isLocalWebPlayerActive === 'function' && isLocalWebPlayerActive();
      const mergedQueue = (usingLocalSdk && Array.isArray(state.sdkNextTracks) && state.sdkNextTracks.length > 0)
        ? buildMergedQueue(state.sdkNextTracks, apiQueue)
        : apiQueue;
      state.liveQueueTracks = mergedQueue;
      state.discoveryTracks = [];
      state.queueLoading = false;
      if (state.nowPlayingMode === 'queue') {
        renderQueuePanelUI();
      }
      prewarmUpcomingSlice(mergedQueue);
      updateNowPlayingRightPanelMode();
      return;
    }
  }

  if (state.liveQueueTracks.length > 0) {
    state.discoveryTracks = [];
    state.queueLoading = false;
    if (state.nowPlayingMode === 'queue') {
      renderQueuePanelUI();
    }
    updateNowPlayingRightPanelMode();
    return;
  }

  // If autoplay recommendations are currently being fetched in parallel, wait for playSingleTrackWithAutoplay to populate
  if (state.autoplayLoading) {
    return;
  }

  // Priority 2: Queue is empty -> Query Spotify-native EchoRadio for musical discovery
  let discovered = [];
  if (typeof fetchSpotifyAutoplayTracks === 'function' && state.playingTrackId) {
    discovered = await fetchSpotifyAutoplayTracks({
      id: state.playingTrackId,
      uri: state.playingTrackUri,
      name: state.playingTrackTitle,
      artist: state.playingArtist,
      artists: state.playingArtists,
      artistId: state.playingArtistId,
      duration: state.durationSec || 210
    }, 8);
    if (reqActionSeq !== playbackActionSeq || reqTrackId !== state.playingTrackId) return;
  }

  state.discoveryTracks = Array.isArray(discovered) ? discovered.slice(0, 8) : [];
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
  const prefersLyrics = state.userPrefersLyrics !== false;

  // 1. Validation & Auto-detection:
  if (state.userForcedCentered) {
    mode = 'centered';
  } else if (!hasLyrics && !hasQueue) {
    // Song has no queue AND no lyrics -> automatically center!
    mode = 'centered';
  } else if (state.hasValidLyrics && prefersLyrics && mode !== 'lyrics') {
    mode = 'lyrics';
  } else if (mode === 'centered') {
    mode = (hasLyrics && prefersLyrics) ? 'lyrics' : (hasQueue ? 'queue' : 'lyrics');
  } else if (mode === 'lyrics' && !hasLyrics && hasQueue) {
    mode = 'queue';
  } else if (mode === 'queue' && !hasQueue && hasLyrics) {
    mode = 'lyrics';
  } else if (mode !== 'lyrics' && mode !== 'queue') {
    mode = (hasLyrics && prefersLyrics) ? 'lyrics' : (hasQueue ? 'queue' : 'centered');
  }

  state.nowPlayingMode = mode;
  const isCentered = (mode === 'centered');
  const showLyrics = (mode === 'lyrics');
  const showQueue = (mode === 'queue');

  // 2. 60fps GPU Hardware-Accelerated Centered Mode (slide & scale)
  if (npMainGrid) {
    npMainGrid.classList.toggle('centered-layout', isCentered);
  }
  scheduleNowPlayingMarqueeRefresh(true);

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
  if (!showLyrics && state.lyricsManualScrolling && typeof exitLyricsManualScroll === 'function') {
    exitLyricsManualScroll({ skipSnapBack: true });
  }

  if (showLyrics) {
    if (state.hasValidLyrics) {
      if (lyricsScrollTrack) lyricsScrollTrack.classList.remove('lyrics-fade-out');
      requestAnimationFrame(() => {
        cacheLyricLineOffsets();
        if (!state.lyricsManualScrolling) {
          updateScrubberAndLyricsUI(true);
        }
      });
    } else if (state.lyricsLoading) {
      renderLyricsLoadingSkeleton();
    }
  } else if (showQueue) {
    renderQueuePanelUI();
  }
}

// --------------------------------------------------------------------------
// 12. SPOTIFY CONNECT: DEVICES LIST, SWITCHING & BADGES
// --------------------------------------------------------------------------
function getDeviceTypeSvg(type = '') {
  const t = (type || '').toLowerCase();
  if (t === 'tv' || t === 'casttv') {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"></rect><polyline points="8 21 12 17 16 21"></polyline></svg>`;
  }
  if (t === 'speaker' || t === 'castaudio' || t === 'audiodongle') {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="3"></rect><circle cx="12" cy="7" r="1.5" fill="currentColor"></circle><circle cx="12" cy="15" r="3.5"></circle><circle cx="12" cy="15" r="1.5" fill="currentColor"></circle></svg>`;
  }
  if (t === 'smartphone' || t === 'phone') {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"></rect><line x1="11" y1="18" x2="13" y2="18"></line></svg>`;
  }
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1"></path><line x1="6" y1="20" x2="10" y2="20"></line><line x1="8" y1="16" x2="8" y2="20"></line><rect x="13" y="9" width="9" height="12" rx="2"></rect><circle cx="17.5" cy="12.2" r="0.8" fill="currentColor" stroke="none"></circle><circle cx="17.5" cy="16.5" r="2.2"></circle></svg>`;
}

function getDeviceTypeLabel(type = '') {
  const t = (type || '').toLowerCase();
  if (t === 'tv' || t === 'casttv') return 'Televisor';
  if (t === 'computer') return 'Computadora';
  if (t === 'speaker' || t === 'castaudio' || t === 'audiodongle') return 'Altavoz';
  if (t === 'smartphone' || t === 'phone') return 'Teléfono';
  return 'Dispositivo';
}

function setDeviceConnectingUI(mode = 'connecting') {
  if (spotifyAuth.activeDeviceId) return;
  const npDeviceName = document.getElementById('npActiveDeviceName');
  const npDeviceOverline = document.getElementById('npActiveDeviceOverline');
  const npDevRow = document.getElementById('npDeviceIndicatorRow');

  if (mode === 'connecting') {
    if (npDeviceOverline) npDeviceOverline.textContent = 'CONECTANDO AUDIO';
    if (npDeviceName) npDeviceName.textContent = 'Conectando SpotiEcho…';
    if (npDevRow) {
      npDevRow.classList.remove('has-device', 'is-external-device');
      npDevRow.classList.add('is-connecting');
      npDevRow.title = 'Conectando SpotiEcho Web Player…';
    }
  } else {
    if (npDeviceOverline) npDeviceOverline.textContent = 'SALIDA DE AUDIO';
    if (npDeviceName) npDeviceName.textContent = 'Elegir dispositivo';
    if (npDevRow) {
      npDevRow.classList.remove('is-connecting', 'is-external-device');
      npDevRow.title = 'Salida de audio: Elegir dispositivo';
    }
  }
}

function updateActiveDeviceBadgeUI(device) {
  if (!device) return;
  const name = device.name || 'Dispositivo';
  spotifyAuth.activeDeviceName = name;
  if (device.id) spotifyAuth.activeDeviceId = device.id;
  if (device.type) spotifyAuth.activeDeviceType = device.type;
  try {
    if (name && name !== 'Dispositivos disponibles' && name !== 'Conectando SpotiEcho…' && name !== 'Elegir dispositivo') {
      safeStorage.setItem('sp_active_device_name', name);
    }
    if (device.id) safeStorage.setItem('sp_active_device_id', device.id);
    if (device.type) safeStorage.setItem('sp_active_device_type', device.type);
  } catch (e) {}

  const npDeviceOverline = document.getElementById('npActiveDeviceOverline');
  if (npDeviceOverline) {
    npDeviceOverline.textContent = 'REPRODUCIENDO EN';
  }
  const npDeviceName = document.getElementById('npActiveDeviceName');
  if (npDeviceName) {
    npDeviceName.textContent = name;
  }
  const npDevRow = document.getElementById('npDeviceIndicatorRow');
  if (npDevRow) {
    const isLocalDevice = Boolean(
      (webPlayerDeviceId && device.id && device.id === webPlayerDeviceId) ||
      (spotifyAuth.engineDeviceId && device.id && device.id === spotifyAuth.engineDeviceId) ||
      (name && name.toLowerCase().includes('spotiecho'))
    );
    npDevRow.classList.remove('is-connecting');
    npDevRow.classList.add('has-device');
    npDevRow.classList.toggle('is-external-device', !isLocalDevice);
    npDevRow.title = `Escuchando en: ${name} (toca para cambiar)`;
    if (device.type) {
      const oldIcon = npDevRow.querySelector('.np-device-icon');
      if (oldIcon) {
        const temp = document.createElement('div');
        temp.innerHTML = getDeviceTypeSvg(device.type);
        const newSvg = temp.firstElementChild;
        if (newSvg) {
          newSvg.classList.add('np-device-icon');
          oldIcon.replaceWith(newSvg);
        }
      }
    }
  }
}

async function openDevicesModal() {
  const modal = document.getElementById('devicesModal');
  const container = document.getElementById('devicesListContainer');
  if (!modal || !container) return;

  const npCoverEl = document.getElementById('devicesNowPlayingCover');
  const npTitleEl = document.getElementById('devicesNowPlayingTitle');
  const npArtistEl = document.getElementById('devicesNowPlayingArtist');
  if (npCoverEl) {
    npCoverEl.src = state.playingThumb || state.playingCover || DEFAULT_ALBUM_COVER;
  }
  if (npTitleEl) {
    npTitleEl.textContent = state.playingTrackTitle || 'Salida de audio';
  }
  if (npArtistEl) {
    npArtistEl.textContent = state.playingArtist || 'Elige dónde escuchar';
  }

  modal.classList.add('open');
  container.innerHTML = `
    <div class="devices-loading-shimmer">
      <div class="devices-spinner"></div>
      <span>Buscando dispositivos en tu red...</span>
    </div>
  `;

  const devices = await fetchAvailableDevices();
  renderDevicesList(devices);
}

function closeDevicesModal() {
  const modal = document.getElementById('devicesModal');
  if (modal) modal.classList.remove('open');
}

function renderDevicesList(devices = []) {
  const container = document.getElementById('devicesListContainer');
  if (!container) return;

  if (!devices || devices.length === 0) {
    container.innerHTML = `
      <div class="devices-empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p>No se encontraron otros dispositivos activos.</p>
        <span class="devices-hint">Asegúrate de que Spotify esté abierto en tu teléfono, altavoz o PC en la misma cuenta.</span>
      </div>
    `;
    return;
  }

  // Identify active device
  const activeDev = (spotifyAuth.activeDeviceId && devices.find(d => d.id === spotifyAuth.activeDeviceId))
    || (webPlayerDeviceId && devices.find(d => d.id === webPlayerDeviceId))
    || devices.find(d => d.is_active)
    || devices[0];
  const otherDevs = devices.filter(d => d.id !== activeDev.id);

  let html = '';

  // 1. Active Device Card (Apple Music monochrome selection + solid white check)
  if (activeDev) {
    const activeIcon = getDeviceTypeSvg(activeDev.type);
    html += `
      <div class="device-active-card" data-device-id="${activeDev.id}" data-device-name="${escapeHtml(activeDev.name)}">
        <div class="device-card-left">
          <div class="device-card-icon">
            ${activeIcon}
          </div>
          <div class="device-card-meta">
            <div class="device-card-name">${escapeHtml(activeDev.name)}</div>
            <div class="device-card-status">
              <span>Reproduciendo aquí</span>
            </div>
          </div>
        </div>
        <div class="device-card-check">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
      </div>
    `;
  }

  // 2. Section Heading: ALTAVOCES Y TV
  if (otherDevs.length > 0) {
    html += `
      <div class="devices-section-heading">ALTAVOCES Y TV</div>
      <div class="devices-other-list">
    `;
    otherDevs.forEach(d => {
      const icon = getDeviceTypeSvg(d.type);
      const label = getDeviceTypeLabel(d.type);
      html += `
        <div class="device-other-row" data-device-id="${d.id}" data-device-name="${escapeHtml(d.name)}" role="button" tabindex="0">
          <div class="device-other-left">
            <div class="device-other-icon">
              ${icon}
            </div>
            <div class="device-other-meta">
              <div class="device-other-name">${escapeHtml(d.name)}</div>
              <div class="device-other-sub">${label}</div>
            </div>
          </div>
          <div class="device-other-right">
            <span class="device-radio-ring" aria-hidden="true"></span>
          </div>
        </div>
      `;
    });
    html += `</div>`;
  }

  container.innerHTML = html;

  // Click handler on other devices
  container.querySelectorAll('.device-other-row').forEach(row => {
    row.addEventListener('click', async () => {
      const devId = row.getAttribute('data-device-id');
      const devName = row.getAttribute('data-device-name');
      if (!devId) return;

      row.classList.add('switching');
      if (typeof showToast === 'function') showToast(`Cambiando audio a ${devName}...`, true);
      const ok = await transferPlaybackToDevice(devId, true);
      if (ok) {
        state.userSelectedDeviceId = devId;
        if (typeof showToast === 'function') showToast(`Reproduciendo en ${devName}`, true);
        spotifyAuth.activeDeviceName = devName;
        updateActiveDeviceBadgeUI({ id: devId, name: devName, is_active: true });
        setTimeout(async () => {
          const freshDevs = await fetchAvailableDevices();
          renderDevicesList(freshDevs);
          setTimeout(closeDevicesModal, 450);
        }, 500);
      } else {
        row.classList.remove('switching');
      }
    });
  });
}

window.updateActiveDeviceBadgeUI = updateActiveDeviceBadgeUI;
if (spotifyAuth.activeDeviceName) {
  updateActiveDeviceBadgeUI({
    id: spotifyAuth.activeDeviceId,
    name: spotifyAuth.activeDeviceName,
    type: spotifyAuth.activeDeviceType || 'Computer',
    is_active: true
  });
}
