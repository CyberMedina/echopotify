/* ==========================================================================
   MAIN: Application Bootstrap, Alexa HTML SDK, Fullscreen & 60fps Loop
   ========================================================================== */
'use strict';

// --------------------------------------------------------------------------
// 11. STARTUP INITIALIZATION & 60 FPS LYRICS LOOP
// --------------------------------------------------------------------------
if (state.activeLyrics && state.activeLyrics.length > 0) {
  buildLyricsDOM(state.activeLyrics);
}
updateScrubberAndLyricsUI(true);

// Instant Zero-Mockup Cache-First Loading Pattern:
const cachedHome = loadHomeCache();
const hasAuth = !!(spotifyAuth.refreshToken || spotifyAuth.accessToken);

if (!hasAuth) {
  // Si no está autenticado, pantalla de aterrizaje / login limpia
  switchScreen('login');
} else if (cachedHome && cachedHome.jumpCards && cachedHome.jumpCards.length > 0) {
  // Instant Cache Render: popular UI sin parpadeos mientras refresca en paralelo
  switchScreen('home');
  if (cachedHome.entities) {
    Object.assign(liveCatalog.entities, cachedHome.entities);
  }
  if (cachedHome.userProfile) {
    renderUserProfile(cachedHome.userProfile);
  }
  renderHome(cachedHome.jumpCards, cachedHome.recentCards, cachedHome.banners, cachedHome.topArtists, cachedHome.savedAlbums);
  renderSearch(cachedHome.recentCards);
  if (cachedHome.lastTrack && !state.playingTrackId) {
    applyTrackToUI(cachedHome.lastTrack, 0, false);
    const miniEl = document.getElementById('miniPlayer');
    if (miniEl) miniEl.style.display = 'flex';
  }
} else {
  // Autenticado pero sin caché aún: Home limpio con Skeletons shimmer (cero mocks)
  switchScreen('home');
  renderInitialSkeletons();
}

async function initAlexaSDK() {
  if (typeof window !== 'undefined' && window.Alexa && typeof window.Alexa.create === 'function') {
    try {
      console.log('[Alexa HTML SDK] Conectando con Alexa client...');
      const args = await window.Alexa.create({ version: '1.0' });
      const message = args ? args.message : null;
      console.log('[Alexa HTML SDK] Conectado exitosamente! Datos recibidos:', message);
      if (message) {
        if (message.accessToken) {
          spotifyAuth.accessToken = message.accessToken;
          safeStorage.setItem('sp_access_token', message.accessToken);
        }
        if (message.refreshToken) {
          spotifyAuth.refreshToken = message.refreshToken;
          safeStorage.setItem('sp_refresh_token', message.refreshToken);
        }
        if (message.clientId) {
          spotifyAuth.clientId = message.clientId;
          safeStorage.setItem('sp_client_id', message.clientId);
        }
        return !!(spotifyAuth.accessToken || spotifyAuth.refreshToken);
      }
    } catch (err) {
      console.warn('[Alexa HTML SDK] No se pudo inicializar o no está en entorno Echo Show:', err);
    }
  }
  return false;
}

function checkHashToken() {
  if (window.location.hash && window.location.hash.includes('access_token')) {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const token = hashParams.get('access_token');
    if (token) {
      spotifyAuth.accessToken = token;
      safeStorage.setItem('sp_access_token', token);
      window.history.replaceState({}, document.title, window.location.pathname);
      return true;
    }
  }
  return false;
}

// Initialize fresh OAuth token, start native librespot engine, and load user data
(async function initSpotifyEcho() {
  // 0. Revisar si recibimos token por Alexa HTML SDK o por URL hash
  checkHashToken();
  await initAlexaSDK();

  // 1. Revisar si venimos de regreso de una autenticación PKCE con ?code=...
  const justAuthed = await checkPKCEAuthCallback();
  const hasAuthNow = !!(spotifyAuth.refreshToken || spotifyAuth.accessToken);

  if (!hasAuthNow) {
    switchScreen('login');
    return;
  }

  switchScreen('home');
  if (!cachedHome || !cachedHome.jumpCards || cachedHome.jumpCards.length === 0) {
    renderInitialSkeletons();
  }

  if (spotifyAuth.refreshToken && spotifyAuth.clientId) {
    await refreshSpotifyAccessToken();
  } else if (spotifyAuth.accessToken) {
    startNativeEngine();
  }

  initWebPlayer();
  setTimeout(initWebPlayer, 600);
  setTimeout(initWebPlayer, 1800);
  await loadAllRealSpotifyData();
  await pollSpotifyCurrentPlayback();
})();

// Poll Spotify live player state every 4s and auto-refresh token every 40 mins
setInterval(pollSpotifyCurrentPlayback, 4000);
setInterval(refreshSpotifyAccessToken, 40 * 60 * 1000);

let lastTick = performance.now();
let lastHwPoll = 0;
let lastUiSync = 0;

function tick(now) {
  const dt = Math.min(0.1, Math.max(0, (now - lastTick) / 1000));
  lastTick = now;

  if (bridge && bridge.getPlaybackClockJson) {
    const pollInterval = state.isNowPlayingOpen ? 320 : 800;
    if (now - lastHwPoll >= pollInterval) {
      lastHwPoll = now;
      syncClockWithHardware(false);
    }
    if (state.isPlaying && state.pcmFlowing) {
      state.currentTimeSec += dt * (state.clockRate || 1.0);
      if (state.isNowPlayingOpen && (now - lastUiSync >= 65)) {
        lastUiSync = now;
        updateScrubberAndLyricsUI(false);
      }
    }
  } else if (state.isPlaying) {
    state.currentTimeSec += dt * (state.clockRate || 1.0);
    if (state.currentTimeSec >= state.durationSec) {
      state.currentTimeSec = 0;
    }
    if (state.isNowPlayingOpen && (now - lastUiSync >= 65)) {
      lastUiSync = now;
      updateScrubberAndLyricsUI(false);
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// --------------------------------------------------------------------------
// FULLSCREEN CONTROLLER FOR SILK BROWSER (ECHO SHOW 8)
// --------------------------------------------------------------------------
function isFullscreenActive() {
  const doc = document;
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);
}

function syncFullscreenSwitchUI() {
  const isFs = isFullscreenActive();
  const sw = document.getElementById('fullscreenToggleSwitch');
  if (sw) {
    sw.classList.toggle('active', isFs);
    sw.setAttribute('aria-checked', isFs ? 'true' : 'false');
  }
  if (typeof uiLog === 'function') {
    uiLog('FS', `fullscreenchange -> active=${isFs} (${window.innerWidth}x${window.innerHeight})`);
  }
}

function toggleFullscreen() {
  const doc = document;
  const docEl = doc.documentElement;
  const requestFs = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
  const exitFs = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;

  const isFs = isFullscreenActive();
  if (typeof uiLog === 'function') {
    uiLog('FS', `toggleFullscreen() solicitado (actual=${isFs})`);
  }

  if (!isFs) {
    if (requestFs) {
      requestFs.call(docEl)
        .then(() => syncFullscreenSwitchUI())
        .catch(err => {
          console.warn('Error fullscreen:', err);
          if (typeof uiLog === 'function') uiLog('FS', `Error entrar FS: ${err.message || err}`);
        });
    }
  } else {
    if (exitFs) {
      exitFs.call(doc)
        .then(() => syncFullscreenSwitchUI())
        .catch(err => {
          console.warn('Error exit fullscreen:', err);
          if (typeof uiLog === 'function') uiLog('FS', `Error salir FS: ${err.message || err}`);
        });
    }
  }
}

document.addEventListener('fullscreenchange', syncFullscreenSwitchUI);
document.addEventListener('webkitfullscreenchange', syncFullscreenSwitchUI);
document.addEventListener('mozfullscreenchange', syncFullscreenSwitchUI);
document.addEventListener('MSFullscreenChange', syncFullscreenSwitchUI);

const fsBtn = document.getElementById('fullscreenBtn');
if (fsBtn) {
  fsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });
}

const fsSwitch = document.getElementById('fullscreenToggleSwitch');
if (fsSwitch) {
  fsSwitch.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });
}

const fsRow = document.getElementById('fullscreenSettingRow');
if (fsRow) {
  fsRow.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });
}

// Botón de Login en Landing Page (OAuth 2.0 PKCE)
const landingLoginBtn = document.getElementById('landingLoginBtn');
if (landingLoginBtn) {
  landingLoginBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startSpotifyPKCELogin();
  });
}

// Cerrar Sesión (Logout)
function logoutUser() {
  safeStorage.removeItem('sp_access_token');
  safeStorage.removeItem('sp_refresh_token');
  safeStorage.removeItem(HOME_CACHE_KEY);
  safeStorage.removeItem(PKCE_VERIFIER_KEY);
  spotifyAuth.accessToken = '';
  spotifyAuth.refreshToken = '';
  state.isPlaying = false;
  state.pcmFlowing = false;
  state.playingTrackId = null;

  if (webPlayer) {
    try { webPlayer.disconnect(); } catch (e) {}
    webPlayer = null;
    webPlayerDeviceId = null;
  }

  const audio = document.getElementById('nativeAudioPlayer');
  if (audio) {
    audio.pause();
    audio.src = '';
  }

  if (spotifyModal) {
    spotifyModal.classList.remove('open');
  }

  const miniEl = document.getElementById('miniPlayer');
  if (miniEl) miniEl.style.display = 'none';

  showToast('Sesión de Spotify cerrada');
  switchScreen('login');
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    logoutUser();
  });
}

// --------------------------------------------------------------------------
// ON-SCREEN DIAGNOSTIC LOGGER WIRING (Echo Show 8 / Silk Browser)
// --------------------------------------------------------------------------
(function initOnScreenDiagnosticLogger() {
  const toggleBtn = document.getElementById('debugLogToggleBtn');
  const panel = document.getElementById('debugLogPanel');
  const pauseBtn = document.getElementById('debugLogPauseBtn');
  const clearBtn = document.getElementById('debugLogClearBtn');
  const closeBtn = document.getElementById('debugLogCloseBtn');

  if (toggleBtn && panel) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('open');
      if (panel.classList.contains('open') && typeof renderDebugLogEntries === 'function') {
        renderDebugLogEntries();
      }
    });
  }
  if (closeBtn && panel) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.remove('open');
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Array.isArray(window._echoLogs)) window._echoLogs.length = 0;
      if (typeof renderDebugLogEntries === 'function') renderDebugLogEntries();
    });
  }
  if (pauseBtn) {
    pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window._echoLogsPaused = !window._echoLogsPaused;
      pauseBtn.classList.toggle('active', window._echoLogsPaused);
      pauseBtn.textContent = window._echoLogsPaused ? 'Reanudar' : 'Pausar';
      if (!window._echoLogsPaused && typeof renderDebugLogEntries === 'function') {
        renderDebugLogEntries();
      }
    });
  }

  // Registrar toques/clics globales en botones/tarjetas para diagnosticar eventos en el Echo Show
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('#debugLogPanel, #debugLogToggleBtn')) return;
    const btn = e.target && e.target.closest ? e.target.closest('button, [data-open-entity], [data-nav], .artist-track-item, .track-row, .album-artist-link') : null;
    if (btn && typeof uiLog === 'function') {
      const id = btn.id ? `#${btn.id}` : (btn.getAttribute('data-open-entity') || btn.getAttribute('data-nav') || btn.className.split(' ')[0] || btn.tagName);
      uiLog('TOUCH', `click en ${id} (y=${Math.round(e.clientY)}, fs=${isFullscreenActive()})`);
    }
  }, true);

  if (typeof uiLog === 'function') {
    uiLog('BOOT', `App v3.6 lista | viewport=${window.innerWidth}x${window.innerHeight} | fs=${isFullscreenActive()}`);
  }
})();
