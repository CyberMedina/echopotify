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

function openNowPlaying() {
  state.isNowPlayingOpen = true;
  clearTimeout(npFullyOpenTimer);
  clearTimeout(npCloseAnimationTimer);

  // Asegurar que las vistas subyacentes se rendericen durante la transición
  document.body.classList.remove('np-fully-open');

  // Si no estaba abierto, arrancar limpiamente desde abajo (100%)
  if (!nowPlayingOverlay.classList.contains('open')) {
    nowPlayingOverlay.style.transition = 'none';
    nowPlayingOverlay.style.transform = 'translate3d(0, 100%, 0)';
    void nowPlayingOverlay.offsetHeight; // Forzar reflow para registrar posición inicial
  }

  nowPlayingOverlay.classList.add('open');
  nowPlayingOverlay.style.transition = 'transform 0.44s cubic-bezier(0.16, 1, 0.3, 1)';
  nowPlayingOverlay.style.transform = 'translate3d(0, 0, 0)';

  // Al abrir Now Playing, garantizar que el fondo lava refleje fielmente la canción actual
  if (state.playingCover) {
    extractDynamicPaletteFromCover(state.playingCover, false);
  }

  cacheLyricLineOffsets();
  updateScrubberAndLyricsUI(true);

  npFullyOpenTimer = setTimeout(() => {
    if (state.isNowPlayingOpen) {
      document.body.classList.add('np-fully-open');
      nowPlayingOverlay.style.transition = '';
      nowPlayingOverlay.style.transform = '';
    }
  }, 460);
}

function closeNowPlaying(opts = {}) {
  if (!state.isNowPlayingOpen && !nowPlayingOverlay.classList.contains('open')) return;

  state.isNowPlayingOpen = false;
  clearTimeout(npFullyOpenTimer);
  clearTimeout(npCloseAnimationTimer);

  // Revelar de inmediato las vistas subyacentes, miniplayer y dock para ver el fondo al bajar
  document.body.classList.remove('np-fully-open');

  const skipTransition = Boolean(opts && opts.skipTransition);
  if (skipTransition) {
    nowPlayingOverlay.classList.remove('open');
    nowPlayingOverlay.style.transition = '';
    nowPlayingOverlay.style.transform = '';
    return;
  }

  // Animación de salida idéntica y simétrica en fluidez (deslizamiento hacia abajo a 60fps)
  const duration = (opts && typeof opts.duration === 'number') ? opts.duration : 0.38;
  nowPlayingOverlay.style.transition = `transform ${duration}s cubic-bezier(0.22, 1, 0.36, 1)`;
  nowPlayingOverlay.style.transform = 'translate3d(0, 100%, 0)';

  let finished = false;
  const finishClose = () => {
    if (finished) return;
    finished = true;
    nowPlayingOverlay.classList.remove('open');
    nowPlayingOverlay.style.transition = '';
    nowPlayingOverlay.style.transform = '';
  };

  const onTransEnd = (e) => {
    if (e.target === nowPlayingOverlay && e.propertyName === 'transform') {
      nowPlayingOverlay.removeEventListener('transitionend', onTransEnd);
      finishClose();
    }
  };
  nowPlayingOverlay.addEventListener('transitionend', onTransEnd);
  npCloseAnimationTimer = setTimeout(finishClose, Math.round(duration * 1000) + 50);
}

// Apple Music / Native Gesture: Swipe-Down on Now Playing overlay to Dismiss
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
    // 3. Botones dock inferiores (Letra / Cola) & botón cerrar & botones favoritos / opciones
    if (target.closest('.np-dock-btn') || target.closest('.np-circle-btn') || target.closest('#npCloseBtn')) return true;
    // 4. Lista de cola scrolleada hacia abajo: permitir scroll interno de la cola
    const queueList = target.closest('#npQueueListContainer');
    if (queueList && queueList.scrollTop > 5) return true;
    return false;
  }

  function onPointerDown(e) {
    if (!state.isNowPlayingOpen) return;
    if (e.button !== undefined && e.button !== 0) return; // Solo click principal o touch
    if (shouldIgnoreEvent(e.target)) return;

    startX = e.clientX;
    startY = e.clientY;
    startTime = Date.now();
    isTracking = true;
    isDragging = false;
    currentDy = 0;
  }

  function onPointerMove(e) {
    if (!isTracking) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!isDragging) {
      // Reconocer intención clara de scroll/deslizamiento hacia abajo:
      // Movimiento vertical > 8px y predominantemente hacia abajo vs horizontal
      if (dy > 8 && dy > Math.abs(dx) * 1.05) {
        isDragging = true;
        state.isSwipingNowPlaying = true;
        clearTimeout(npFullyOpenTimer);
        clearTimeout(npCloseAnimationTimer);
        document.body.classList.remove('np-fully-open');
        overlay.style.transition = 'none';
      } else if (Math.abs(dx) > 14 || dy < -12) {
        // Gesto lateral o hacia arriba: cancelar tracking para no interferir
        isTracking = false;
        return;
      }
    }

    if (isDragging) {
      if (e.cancelable) e.preventDefault();
      currentDy = Math.max(0, dy);
      // Seguimiento directo 1:1 ultra-intuitivo con amortiguación suave si excede 520px
      const visualDy = currentDy > 520 ? 520 + Math.round((currentDy - 520) * 0.38) : currentDy;
      overlay.style.transform = `translate3d(0, ${visualDy}px, 0)`;

      if (grabberPill) {
        grabberPill.style.transform = 'scaleX(1.30)';
        grabberPill.style.background = 'rgba(255, 255, 255, 0.90)';
      }
    }
  }

  function onPointerUp(e) {
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

    // Descartar/volver si se deslizó más de 65px O con un flick rápido hacia abajo (> 0.32 px/ms y > 25px)
    if (currentDy > 65 || (currentDy > 25 && velocityY > 0.32)) {
      state.isNowPlayingOpen = false;
      clearTimeout(npFullyOpenTimer);
      clearTimeout(npCloseAnimationTimer);

      const remaining = Math.max(0, 800 - currentDy);
      const exitDuration = Math.min(0.38, Math.max(0.24, remaining / (Math.max(velocityY, 1.4) * 1000)));

      overlay.style.transition = `transform ${exitDuration.toFixed(2)}s cubic-bezier(0.22, 1, 0.36, 1)`;
      overlay.style.transform = 'translate3d(0, 100%, 0)';

      let ended = false;
      const finishDismiss = () => {
        if (ended) return;
        ended = true;
        overlay.classList.remove('open');
        overlay.style.transition = '';
        overlay.style.transform = '';
        setTimeout(() => {
          state.isSwipingNowPlaying = false;
        }, 60);
      };

      const onEnd = (evt) => {
        if (evt.target === overlay && evt.propertyName === 'transform') {
          overlay.removeEventListener('transitionend', onEnd);
          finishDismiss();
        }
      };
      overlay.addEventListener('transitionend', onEnd);
      npCloseAnimationTimer = setTimeout(finishDismiss, Math.round(exitDuration * 1000) + 50);
    } else {
      // Rebotar suavemente a la posición abierta
      overlay.style.transition = 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)';
      overlay.style.transform = 'translate3d(0, 0, 0)';

      setTimeout(() => {
        if (state.isNowPlayingOpen) {
          overlay.style.transition = '';
          overlay.style.transform = '';
          document.body.classList.add('np-fully-open');
        }
        state.isSwipingNowPlaying = false;
      }, 300);
    }
  }

  // Pointer Events para touch nativo en Echo Show y mouse en desktop
  overlay.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerUp, { passive: true });

  // Soporte de rueda de ratón (wheel scroll down) para ir atrás
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
      if (wheelAccumulator > 75) {
        wheelAccumulator = 0;
        closeNowPlaying();
      }
    } else {
      wheelAccumulator = 0;
    }
  }, { passive: true });
})();
