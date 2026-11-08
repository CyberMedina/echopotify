/* ==========================================================================
   CONTROLLER: Screen Router, History Stack & Now Playing Overlay Transitions
   ========================================================================== */
'use strict';

// --------------------------------------------------------------------------
// 10. UI NAVIGATION & EVENT HANDLERS
// --------------------------------------------------------------------------
function switchScreen(screenName, opts = {}) {
  const isBack = Boolean(opts.isBack);
  if (!isBack) {
    if (screenName === 'home' || screenName === 'library' || screenName === 'search' || screenName === 'login') {
      state.navStack = [{ screen: screenName }];
    } else {
      if (!Array.isArray(state.navStack)) state.navStack = [{ screen: 'home' }];
      const currentEntry = {
        screen: screenName,
        entityId: state.selectedEntityId,
        artistId: state.selectedArtistId
      };

      // Si la pantalla a la que navegamos ya existe previamente en la pila (ej. Album A -> Artista -> Album A),
      // recortar la pila hasta esa entrada para erradicar cualquier ciclo o bucle infinito de "atrás".
      const existingIdx = state.navStack.findIndex(entry => {
        if (!entry) return false;
        const eScreen = typeof entry === 'string' ? entry : entry.screen;
        if (eScreen !== screenName) return false;
        if (screenName === 'album' && typeof entry === 'object') return entry.entityId === currentEntry.entityId;
        if (screenName === 'artist' && typeof entry === 'object') return entry.artistId === currentEntry.artistId;
        return true;
      });

      if (existingIdx >= 0) {
        state.navStack = state.navStack.slice(0, existingIdx + 1);
      } else {
        state.navStack.push(currentEntry);
      }
    }
  }
  state.activeScreen = screenName;

  document.querySelectorAll('.screen-view').forEach(sec => {
    sec.classList.toggle('active', sec.id === `view-${screenName}`);
  });

  document.querySelectorAll('.dock-tab').forEach(tab => {
    const navTarget = tab.getAttribute('data-nav');
    tab.classList.toggle('active', navTarget === screenName);
  });

  const miniEl = document.getElementById('miniPlayer');
  if (screenName === 'login') {
    document.body.classList.add('login-view-active');
    if (miniEl) miniEl.style.display = 'none';
  } else {
    document.body.classList.remove('login-view-active');
    if (miniEl && state.playingTrackId) miniEl.style.display = 'flex';
  }

  if (screenName === 'album') {
    document.body.classList.add('album-view-active');
    document.body.classList.remove('artist-view-active');
    if (!document.body.classList.contains('album-dark-active') && !document.body.classList.contains('album-light-active')) {
      document.body.classList.add('album-dark-active');
    }
    const currentEntity = liveCatalog.entities[state.selectedEntityId];
    if (currentEntity) {
      if (state.selectedEntityId === 'liked_songs' || currentEntity.type === 'liked') {
        applyNeutralLikedTheme();
      } else {
        const primaryCover = currentEntity.cover || currentEntity.coverLarge;
        if (primaryCover && !primaryCover.startsWith('data:image')) {
          extractDynamicPaletteFromCover(primaryCover, true, [currentEntity.cover, currentEntity.coverLarge]);
        }
      }
    }
  } else if (screenName === 'artist') {
    document.body.classList.add('artist-view-active');
    document.body.classList.remove('album-view-active', 'album-dark-active', 'album-light-active');
    const currentArtist = liveCatalog.entities[state.selectedArtistId];
    if (currentArtist) {
      const primaryCover = currentArtist.cover || currentArtist.coverLarge;
      if (primaryCover && !primaryCover.startsWith('data:image')) {
        extractDynamicPaletteFromCover(primaryCover, true, [currentArtist.cover, currentArtist.coverLarge]);
      } else if (typeof uiLog === 'function') {
        uiLog('TINT', `Artista sin cover aún (${currentArtist.name || state.selectedArtistId}) -> conservando tinte previo`);
      }
    }
  } else {
    document.body.classList.remove('album-view-active', 'artist-view-active', 'album-dark-active', 'album-light-active');
  }

  if (typeof uiLog === 'function') {
    const stackStr = (state.navStack || []).map(s => typeof s === 'object' ? `${s.screen}:${s.entityId || s.artistId || ''}` : s).join(' > ');
    uiLog('NAV', `switchScreen(${screenName})${isBack ? ' [BACK]' : ''} | stack: ${stackStr}`);
  }
}

function goBack() {
  if (state.isNowPlayingOpen) {
    closeNowPlaying();
    return;
  }

  if (Array.isArray(state.navStack) && state.navStack.length > 1) {
    state.navStack.pop(); // Remover la pantalla actual
    const prev = state.navStack[state.navStack.length - 1];
    const prevScreen = (prev && typeof prev === 'object') ? (prev.screen || 'home') : (prev || 'home');

    // Restaurar los IDs de entidad/artista asociados a la pantalla anterior
    if (prev && typeof prev === 'object') {
      if (prevScreen === 'album' && prev.entityId) {
        state.selectedEntityId = prev.entityId;
        const entity = liveCatalog.entities[prev.entityId];
        if (entity) {
          const detailCoverEl = document.getElementById('albumDetailCover');
          if (detailCoverEl) swapHeroImageAtomically(detailCoverEl, entity.coverLarge || entity.cover, entity.cover);
          const titleEl = document.getElementById('albumDetailTitle');
          if (titleEl) titleEl.textContent = entity.title || 'Álbum';
          renderAlbumDetailArtist(entity);
          const metaEl = document.getElementById('albumDetailMeta');
          if (metaEl) metaEl.textContent = entity.meta || '';
        }
      } else if (prevScreen === 'artist' && prev.artistId) {
        state.selectedArtistId = prev.artistId;
      }
    }

    switchScreen(prevScreen, { isBack: true });
  } else {
    state.navStack = [{ screen: 'home' }];
    switchScreen('home', { isBack: true });
  }
}

let npCloseAnimationTimer = null;
let npOpenTimer = null;

function openNowPlaying(opts = {}) {
  const instant = Boolean(opts && opts.instant);
  state.isNowPlayingOpen = true;
  clearTimeout(npCloseAnimationTimer);
  clearTimeout(npOpenTimer);

  if (instant) {
    document.body.classList.add('np-fully-open');
    nowPlayingOverlay.style.transition = 'none';
    nowPlayingOverlay.classList.add('open');
    nowPlayingOverlay.style.transform = 'translate3d(0, 0, 0)';
  } else {
    // Asegurar que las vistas subyacentes se rendericen durante la transición y no queden en negro
    document.body.classList.remove('np-fully-open');

    // Cancelar cualquier transición previa inmediatamente y arrancar desde abajo
    nowPlayingOverlay.style.transition = 'none';
    nowPlayingOverlay.style.transform = 'translate3d(0, 100%, 0)';
    void nowPlayingOverlay.offsetHeight; // Forzar reflow para registrar posición inicial

    nowPlayingOverlay.classList.add('open');
    nowPlayingOverlay.style.transition = 'transform 0.44s cubic-bezier(0.16, 1, 0.3, 1)';
    nowPlayingOverlay.style.transform = 'translate3d(0, 0, 0)';

    npOpenTimer = setTimeout(() => {
      if (state.isNowPlayingOpen && nowPlayingOverlay.classList.contains('open')) {
        document.body.classList.add('np-fully-open');
        nowPlayingOverlay.style.transition = '';
      }
    }, 480);
  }

  // Al abrir Now Playing, garantizar que el fondo lava refleje fielmente la canción actual
  if (state.playingCover) {
    extractDynamicPaletteFromCover(state.playingCover, false);
  }

  if (typeof updateActiveDeviceBadgeUI === 'function') {
    if (spotifyAuth.activeDeviceName) {
      updateActiveDeviceBadgeUI({
        id: spotifyAuth.activeDeviceId,
        name: spotifyAuth.activeDeviceName,
        type: spotifyAuth.activeDeviceType || 'Computer',
        is_active: true
      });
    } else if (typeof fetchAvailableDevices === 'function') {
      fetchAvailableDevices();
    }
  }

  cacheLyricLineOffsets();
  updateScrubberAndLyricsUI(true);
}

function closeNowPlaying(opts = {}) {
  state.startupPlaybackChecked = true;
  if (!state.isNowPlayingOpen && !nowPlayingOverlay.classList.contains('open')) return;

  state.isNowPlayingOpen = false;
  clearTimeout(npOpenTimer);
  clearTimeout(npCloseAnimationTimer);

  // Revelar de inmediato las vistas subyacentes, miniplayer y dock para ver el fondo al bajar
  document.body.classList.remove('np-fully-open');

  const skipTransition = Boolean(opts && opts.skipTransition);
  if (skipTransition) {
    nowPlayingOverlay.classList.remove('open');
    nowPlayingOverlay.style.transition = '';
    nowPlayingOverlay.style.transform = 'translate3d(0, 100%, 0)';
    return;
  }

  // Animación de salida idéntica y simétrica en fluidez (deslizamiento hacia abajo a 60fps)
  const duration = (opts && typeof opts.duration === 'number') ? opts.duration : 0.38;
  nowPlayingOverlay.style.transition = `transform ${duration}s cubic-bezier(0.22, 1, 0.36, 1)`;
  nowPlayingOverlay.style.transform = 'translate3d(0, 100%, 0)';

  npCloseAnimationTimer = setTimeout(() => {
    if (!state.isNowPlayingOpen) {
      nowPlayingOverlay.classList.remove('open');
      nowPlayingOverlay.style.transition = '';
      nowPlayingOverlay.style.transform = 'translate3d(0, 100%, 0)';
    }
  }, Math.round(duration * 1000) + 30);
}

// Native Touch & Mouse Swipe-Down on Now Playing overlay to Dismiss
(function initNowPlayingSwipeDown() {
  const overlay = nowPlayingOverlay;
  if (!overlay) return;

  const grabberPill = document.getElementById('npGrabberPill');
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let isTracking = false;
  let isDragging = false;
  let currentDy = 0;

  function shouldIgnoreEvent(target) {
    if (!target) return false;
    // 1. Scrubber track & volume track (interacción precisa de seek)
    if (target.closest('#npScrubberTrack') || target.closest('#npVolumeTrack')) return true;
    // 2. Botones de transporte (play, pause, next, prev, shuffle, repeat)
    if (target.closest('.np-transport-btn')) return true;
    // 3. Botones dock inferiores (Letra / Cola) & favoritos
    if (target.closest('.np-dock-btn') || target.closest('.np-circle-btn')) return true;
    // 4. Lista de cola scrolleada hacia abajo: permitir scroll interno de la cola
    const queueList = target.closest('#npQueueListContainer');
    if (queueList && queueList.scrollTop > 5) return true;
    return false;
  }

  function handleStart(clientX, clientY, target) {
    if (!state.isNowPlayingOpen) return false;
    if (shouldIgnoreEvent(target)) return false;

    startX = clientX;
    startY = clientY;
    startTime = Date.now();
    isTracking = true;
    isDragging = false;
    currentDy = 0;
    return true;
  }

  function handleMove(clientX, clientY, cancelableEvent) {
    if (!isTracking) return;

    const dx = clientX - startX;
    const dy = clientY - startY;

    if (!isDragging) {
      // Iniciar arrastre si el movimiento es hacia abajo (> 6px) y vertical
      if (dy > 6 && dy > Math.abs(dx) * 0.85) {
        isDragging = true;
        state.isSwipingNowPlaying = true;
        clearTimeout(npOpenTimer);
        clearTimeout(npCloseAnimationTimer);
        document.body.classList.remove('np-fully-open');
        overlay.style.transition = 'none';
      } else if (Math.abs(dx) > 12 || dy < -10) {
        // Gesto lateral o hacia arriba: cancelar tracking
        isTracking = false;
        return;
      }
    }

    if (isDragging) {
      if (cancelableEvent && cancelableEvent.cancelable) {
        cancelableEvent.preventDefault();
      }
      currentDy = Math.max(0, dy);
      const visualDy = currentDy > 520 ? 520 + Math.round((currentDy - 520) * 0.38) : currentDy;
      overlay.style.transform = `translate3d(0, ${visualDy}px, 0)`;

      if (grabberPill) {
        grabberPill.style.transform = 'scaleX(1.30)';
        grabberPill.style.background = 'rgba(255, 255, 255, 0.90)';
      }
    }
  }

  function handleEnd() {
    if (!isTracking && !isDragging) return;
    isTracking = false;

    if (!isDragging) {
      state.isSwipingNowPlaying = false;
      return;
    }

    const elapsed = Math.max(1, Date.now() - startTime);
    const velocityY = currentDy / elapsed; // px/ms

    if (grabberPill) {
      grabberPill.style.transform = '';
      grabberPill.style.background = '';
    }

    // Umbral súper intuitivo: más de 45px O velocidad rápida hacia abajo (> 0.20 px/ms y > 18px)
    if (currentDy > 45 || (currentDy > 18 && velocityY > 0.20)) {
      state.isNowPlayingOpen = false;
      clearTimeout(npOpenTimer);
      clearTimeout(npCloseAnimationTimer);
      document.body.classList.remove('np-fully-open');

      const remaining = Math.max(0, 800 - currentDy);
      const exitDuration = Math.min(0.38, Math.max(0.20, remaining / (Math.max(velocityY, 1.4) * 1000)));

      overlay.style.transition = `transform ${exitDuration.toFixed(2)}s cubic-bezier(0.22, 1, 0.36, 1)`;
      overlay.style.transform = 'translate3d(0, 100%, 0)';

      npCloseAnimationTimer = setTimeout(() => {
        if (!state.isNowPlayingOpen) {
          overlay.classList.remove('open');
          overlay.style.transition = '';
          overlay.style.transform = 'translate3d(0, 100%, 0)';
        }
        state.isSwipingNowPlaying = false;
      }, Math.round(exitDuration * 1000) + 30);
    } else {
      // Rebotar suavemente a la posición abierta
      overlay.style.transition = 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)';
      overlay.style.transform = 'translate3d(0, 0, 0)';

      setTimeout(() => {
        if (state.isNowPlayingOpen && overlay.classList.contains('open')) {
          overlay.style.transition = '';
          document.body.classList.add('np-fully-open');
        }
        state.isSwipingNowPlaying = false;
      }, 300);
    }
  }

  // 1. TOUCH EVENTS (Nativo Echo Show 8 / Android)
  overlay.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    handleStart(e.touches[0].clientX, e.touches[0].clientY, e.target);
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!isTracking || !e.touches || e.touches.length !== 1) return;
    handleMove(e.touches[0].clientX, e.touches[0].clientY, e);
  }, { passive: false });

  window.addEventListener('touchend', () => {
    handleEnd();
  }, { passive: true });

  window.addEventListener('touchcancel', () => {
    // Si ya se había desplazado significativamente (> 40px), proceder con dismiss en vez de abortar
    if (isDragging && currentDy > 40) {
      handleEnd();
    } else {
      isTracking = false;
      if (isDragging) {
        overlay.style.transition = 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)';
        overlay.style.transform = 'translate3d(0, 0, 0)';
        setTimeout(() => {
          if (state.isNowPlayingOpen && overlay.classList.contains('open')) {
            overlay.style.transition = '';
            document.body.classList.add('np-fully-open');
          }
          state.isSwipingNowPlaying = false;
        }, 300);
      }
    }
  }, { passive: true });

  // 2. MOUSE EVENTS (Para pruebas en desktop)
  overlay.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    handleStart(e.clientX, e.clientY, e.target);
  });

  window.addEventListener('mousemove', (e) => {
    if (!isTracking) return;
    handleMove(e.clientX, e.clientY, e);
  });

  window.addEventListener('mouseup', () => {
    if (isTracking || isDragging) handleEnd();
  });

  // 3. WHEEL SCROLL DOWN
  let wheelAccumulator = 0;
  let wheelResetTimer = null;
  overlay.addEventListener('wheel', (e) => {
    if (!state.isNowPlayingOpen) return;
    const queueList = e.target.closest('#npQueueListContainer');
    if (queueList && queueList.scrollHeight > queueList.clientHeight && queueList.scrollTop > 5) return;

    if (e.deltaY > 0) {
      wheelAccumulator += e.deltaY;
      clearTimeout(wheelResetTimer);
      wheelResetTimer = setTimeout(() => { wheelAccumulator = 0; }, 260);
      if (wheelAccumulator > 70) {
        wheelAccumulator = 0;
        closeNowPlaying();
      }
    } else {
      wheelAccumulator = 0;
    }
  }, { passive: true });
})();
