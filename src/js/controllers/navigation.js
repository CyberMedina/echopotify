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
      state.navStack = [screenName];
    } else {
      if (!Array.isArray(state.navStack)) state.navStack = ['home'];
      if (state.navStack.length === 0 || state.navStack[state.navStack.length - 1] !== screenName) {
        state.navStack.push(screenName);
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
    const currentEntity = liveCatalog.entities[state.selectedEntityId];
    if (currentEntity) {
      if (state.selectedEntityId === 'liked_songs' || currentEntity.type === 'liked') {
        applyNeutralLikedTheme();
      } else {
        const cover = currentEntity.coverLarge || currentEntity.cover;
        if (cover && !cover.startsWith('data:image')) {
          extractDynamicPaletteFromCover(cover, true);
        }
      }
    }
  } else if (screenName === 'artist') {
    document.body.classList.add('artist-view-active');
    document.body.classList.remove('album-view-active', 'album-dark-active', 'album-light-active');
    const currentArtist = liveCatalog.entities[state.selectedArtistId];
    if (currentArtist) {
      const cover = currentArtist.coverLarge || currentArtist.cover;
      if (cover && !cover.startsWith('data:image')) {
        extractDynamicPaletteFromCover(cover, true);
      }
    }
  } else {
    document.body.classList.remove('album-view-active', 'artist-view-active', 'album-dark-active', 'album-light-active');
  }
}

function goBack() {
  if (state.isNowPlayingOpen) {
    closeNowPlaying();
    return;
  }

  if (Array.isArray(state.navStack) && state.navStack.length > 1) {
    state.navStack.pop(); // Remove current screen
    const prevScreen = state.navStack[state.navStack.length - 1] || 'home';
    switchScreen(prevScreen, { isBack: true });
  } else {
    state.navStack = ['home'];
    switchScreen('home', { isBack: true });
  }
}

function openNowPlaying() {
  state.isNowPlayingOpen = true;
  clearTimeout(npFullyOpenTimer);
  nowPlayingOverlay.style.transform = '';
  nowPlayingOverlay.classList.add('open');

  // Al abrir Now Playing, garantizar que el fondo lava refleje fielmente la canción actual
  if (state.playingCover) {
    extractDynamicPaletteFromCover(state.playingCover, false);
  }

  cacheLyricLineOffsets();
  updateScrubberAndLyricsUI(true);
  npFullyOpenTimer = setTimeout(() => {
    if (state.isNowPlayingOpen) {
      document.body.classList.add('np-fully-open');
    }
  }, 390);
}

function closeNowPlaying() {
  state.isNowPlayingOpen = false;
  clearTimeout(npFullyOpenTimer);
  document.body.classList.remove('np-fully-open');
  nowPlayingOverlay.style.transform = '';
  nowPlayingOverlay.classList.remove('open');
}

// Apple Music Swipe-Down Gesture on Left Player / Grabber Tab to Dismiss Now Playing
(function initNowPlayingSwipeDown() {
  const leftArea = document.getElementById('npLeftPlayer') || nowPlayingOverlay;
  let startY = null;
  let currentDy = 0;

  leftArea.addEventListener('touchstart', (e) => {
    if (e.target.closest('#npScrubberTrack') || e.target.closest('.np-transport-btn')) return;
    if (e.touches && e.touches.length === 1) {
      startY = e.touches[0].clientY;
      currentDy = 0;
      document.body.classList.remove('np-fully-open');
      nowPlayingOverlay.style.transition = 'none';
    }
  }, { passive: true });

  leftArea.addEventListener('touchmove', (e) => {
    if (startY === null || !e.touches || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) {
      currentDy = dy;
      nowPlayingOverlay.style.transform = `translate3d(0, ${Math.round(dy * 0.85)}px, 0)`;
    }
  }, { passive: true });

  function endSwipe() {
    if (startY === null) return;
    startY = null;
    nowPlayingOverlay.style.transition = '';
    if (currentDy > 72) {
      closeNowPlaying();
    } else {
      nowPlayingOverlay.style.transform = '';
      if (state.isNowPlayingOpen) {
        document.body.classList.add('np-fully-open');
      }
    }
    currentDy = 0;
  }

  leftArea.addEventListener('touchend', endSwipe, { passive: true });
  leftArea.addEventListener('touchcancel', endSwipe, { passive: true });
})();
