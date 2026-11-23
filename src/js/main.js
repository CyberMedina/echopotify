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
  const startupLastTrack = (typeof loadLastPlayedTrack === 'function' ? loadLastPlayedTrack() : null)
    || (cachedHome && cachedHome.lastTrack ? cachedHome.lastTrack : null);
  if (startupLastTrack && !state.playingTrackId) {
    applyTrackToUI(startupLastTrack, 0, false, 'cache');
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

  if (!spotifyAuth.accessToken) {
    switchScreen('login');
    return;
  }

  // Comprobar instantáneamente si hay música sonando al entrar a la aplicación:
  // Si detecta reproducción activa, abre inmediatamente el reproductor a pantalla completa
  const initialPlaybackPromise = pollSpotifyCurrentPlayback({ autoOpenIfPlaying: true });

  initWebPlayer();
  setTimeout(initWebPlayer, 600);
  setTimeout(initWebPlayer, 1800);

  await Promise.allSettled([
    initialPlaybackPromise,
    loadAllRealSpotifyData()
  ]);
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
      const syncInterval = (state.hasValidLyrics && state.nowPlayingMode === 'lyrics') ? 28 : 65;
      if (state.isNowPlayingOpen && (now - lastUiSync >= syncInterval)) {
        lastUiSync = now;
        updateScrubberAndLyricsUI(false);
      }
    }
  } else if (state.isPlaying && !state.isBuffering) {
    state.currentTimeSec += dt * (state.clockRate || 1.0);
    if (state.currentTimeSec >= state.durationSec) {
      state.currentTimeSec = 0;
    }
    const syncInterval = (state.hasValidLyrics && state.nowPlayingMode === 'lyrics') ? 28 : 65;
    if (state.isNowPlayingOpen && (now - lastUiSync >= syncInterval)) {
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
  if (typeof scheduleFitViewport === 'function') {
    scheduleFitViewport();
  } else if (typeof fitViewport === 'function') {
    fitViewport();
  }
  if (typeof uiLog === 'function') {
    uiLog('FS', `fullscreenchange -> active=${isFs} (${window.innerWidth}x${window.innerHeight}) | dpr=${window.devicePixelRatio || 1} | scale=${(window._echoViewportScale || 1).toFixed(2)}`);
  }
}

const SILK_FS_MODES = ['doc', 'viewport', 'viewport-plain'];

function isSilkAutoHideBarMode() {
  const docEl = document.documentElement;
  return Boolean(docEl && docEl.classList && typeof docEl.classList.contains === 'function' && docEl.classList.contains('silk-autohide-bar'));
}

function getSilkFsTargetMode() {
  const saved = typeof safeStorage !== 'undefined' && safeStorage ? safeStorage.getItem('sp_silk_fs_target') : null;
  return SILK_FS_MODES.includes(saved) ? saved : 'doc';
}

function getSilkFsTargetElement(mode) {
  if (mode === 'viewport' || mode === 'viewport-plain') {
    return document.getElementById('echoViewport') || document.documentElement;
  }
  return document.documentElement;
}

function requestConfiguredFullscreen(explicitMode) {
  const mode = SILK_FS_MODES.includes(explicitMode) ? explicitMode : getSilkFsTargetMode();
  const targetEl = getSilkFsTargetElement(mode);
  if (!targetEl) return null;

  if (typeof targetEl.requestFullscreen === 'function') {
    if (mode === 'viewport-plain') {
      return targetEl.requestFullscreen();
    }
    return targetEl.requestFullscreen({ navigationUI: 'hide' }).catch(() => targetEl.requestFullscreen());
  }

  const vendorReq = targetEl.webkitRequestFullscreen || targetEl.mozRequestFullScreen || targetEl.msRequestFullscreen;
  return vendorReq ? Promise.resolve(vendorReq.call(targetEl)) : null;
}

function toggleFullscreen() {
  const doc = document;
  const exitFs = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;

  const isFs = isFullscreenActive();
  const fsMode = getSilkFsTargetMode();
  if (typeof uiLog === 'function') {
    uiLog('FS', `toggleFullscreen() solicitado (actual=${isFs}, mode=${fsMode})`);
  }

  if (!isFs) {
    const req = requestConfiguredFullscreen(fsMode);
    if (req && typeof req.then === 'function') {
      req
        .then(() => syncFullscreenSwitchUI())
        .catch(err => {
          console.warn('Error fullscreen:', err);
          if (typeof uiLog === 'function') uiLog('FS', `Error entrar FS: ${err.message || err}`);
        });
    }
  } else {
    if (exitFs) {
      Promise.resolve(exitFs.call(doc))
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

// --------------------------------------------------------------------------
// LYRICS MODE CONTROLLER: PALABRA POR PALABRA (AMLL) VS LÍNEA COMPLETA
// --------------------------------------------------------------------------
function syncLyricsModeUI() {
  const isWbw = (state.wordByWordLyrics !== false);
  const sw = document.getElementById('wordByWordLyricsSwitch');
  if (sw) {
    sw.classList.toggle('active', isWbw);
    sw.setAttribute('aria-checked', isWbw ? 'true' : 'false');
  }
  const track = document.getElementById('lyricsScrollTrack');
  if (track) {
    track.classList.toggle('mode-line', !isWbw);
  }
}

function toggleLyricsMode() {
  state.wordByWordLyrics = (state.wordByWordLyrics === false) ? true : false;
  safeStorage.setItem('sp_lyrics_word_by_word', state.wordByWordLyrics ? 'true' : 'false');
  syncLyricsModeUI();
  if (typeof updateScrubberAndLyricsUI === 'function') {
    updateScrubberAndLyricsUI(true);
  }
  if (typeof showToast === 'function') {
    showToast(state.wordByWordLyrics ? 'Letras: Palabra por palabra' : 'Letras: Línea completa');
  }
}

const lyricsSwitch = document.getElementById('wordByWordLyricsSwitch');
if (lyricsSwitch) {
  lyricsSwitch.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLyricsMode();
  });
}

const lyricsRow = document.getElementById('lyricsModeSettingRow');
if (lyricsRow) {
  lyricsRow.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLyricsMode();
  });
}

syncLyricsModeUI();

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
  if (typeof LAST_TRACK_CACHE_KEY !== 'undefined') safeStorage.removeItem(LAST_TRACK_CACHE_KEY);
  safeStorage.removeItem(PKCE_VERIFIER_KEY);
  if (typeof EchoRadio !== 'undefined' && typeof EchoRadio.clearOnLogout === 'function') {
    EchoRadio.clearOnLogout();
  }
  spotifyAuth.accessToken = '';
  spotifyAuth.refreshToken = '';
  state.isPlaying = false;
  state.isBuffering = false;
  state.bufferingStartedAt = 0;
  state.isCachedPlaceholderTrack = false;
  state.userSelectedDeviceId = null;
  state.pcmFlowing = false;
  state.playingTrackId = null;

  if (webPlayer) {
    try { webPlayer.disconnect(); } catch (e) { }
    webPlayer = null;
  }
  webPlayerDeviceId = null;
  webPlayerTransferredOnce = false;
  webPlayerAudioActivated = false;
  if (typeof resetWebPlayerReadyPromise === 'function') {
    resetWebPlayerReadyPromise();
  }
  spotifyAuth.activeDeviceId = null;
  spotifyAuth.activeDeviceName = '';
  spotifyAuth.activeDeviceType = '';
  state.lastConfirmedApiDeviceId = null;

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
// Controlled via Developer Options in Settings (zero logging overhead when disabled)
// --------------------------------------------------------------------------
function syncDevModeUI() {
  const isEnabled = !!state.devModeEnabled;
  const sw = document.getElementById('devModeToggleSwitch');
  if (sw) {
    sw.classList.toggle('active', isEnabled);
    sw.setAttribute('aria-checked', isEnabled ? 'true' : 'false');
  }
  const toggleBtn = document.getElementById('debugLogToggleBtn');
  if (toggleBtn) {
    toggleBtn.classList.toggle('hidden', !isEnabled);
  }
  const panel = document.getElementById('debugLogPanel');
  if (!isEnabled && panel) {
    panel.classList.remove('open');
  }
  const labBox = document.getElementById('silkFsLabBox');
  if (labBox) {
    labBox.style.display = isEnabled ? 'block' : 'none';
  }
}

function toggleDevMode() {
  state.devModeEnabled = !state.devModeEnabled;
  safeStorage.setItem('sp_dev_mode', state.devModeEnabled ? 'true' : 'false');
  syncDevModeUI();
  if (state.devModeEnabled) {
    if (typeof uiLog === 'function') {
      uiLog('DEV', `Opciones de desarrollador activadas | viewport=${window.innerWidth}x${window.innerHeight} | fs=${isFullscreenActive()} | dpr=${window.devicePixelRatio || 1} | scale=${(window._echoViewportScale || 1).toFixed(2)}`);
    }
  } else {
    if (Array.isArray(window._echoLogs)) window._echoLogs.length = 0;
  }
}

const devSwitch = document.getElementById('devModeToggleSwitch');
if (devSwitch) {
  devSwitch.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDevMode();
  });
}

const devRow = document.getElementById('devModeSettingRow');
if (devRow) {
  devRow.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDevMode();
  });
}

// Inicializar estado de opciones de desarrollador
syncDevModeUI();

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

  // Registrar toques/clics globales SOLO si las opciones de desarrollador están habilitadas
  document.addEventListener('click', (e) => {
    if (!state.devModeEnabled) return;
    if (e.target && e.target.closest && e.target.closest('#debugLogPanel, #debugLogToggleBtn')) return;
    const btn = e.target && e.target.closest ? e.target.closest('button, [data-open-entity], [data-nav], .artist-track-item, .track-row, .album-artist-link') : null;
    if (btn && typeof uiLog === 'function') {
      const id = btn.id ? `#${btn.id}` : (btn.getAttribute('data-open-entity') || btn.getAttribute('data-nav') || btn.className.split(' ')[0] || btn.tagName);
      uiLog('TOUCH', `click en ${id} (y=${Math.round(e.clientY)}, fs=${isFullscreenActive()})`);
    }
  }, true);

  if (state.devModeEnabled && typeof uiLog === 'function') {
    uiLog('BOOT', `App v4.0 lista | viewport=${window.innerWidth}x${window.innerHeight} | fs=${isFullscreenActive()} | dpr=${window.devicePixelRatio || 1} | scale=${(window._echoViewportScale || 1).toFixed(2)}`);
  }
})();

// ============================================================================
// PWA SERVICE WORKER + AUTO-FULLSCREEN (PRIMER GESTO) + LANDSCAPE EN MÓVIL
// ============================================================================
(function initPwaAndFullscreen() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('[PWA SW]', err);
      });
    });
  }

  // En Echo Show nativo con bridge no es necesario pedir fullscreen web
  if (typeof bridge !== 'undefined' && bridge) return;

  const hasMatchMedia = typeof window.matchMedia === 'function';
  const isDisplayFullscreen = Boolean(hasMatchMedia && window.matchMedia('(display-mode: fullscreen)').matches);
  const isStandalonePwa = Boolean(
    (hasMatchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true
  );

  const lockLandscapeIfMobile = () => {
    const isTouchDevice = (navigator.maxTouchPoints || 0) > 0 || /Android|iPhone|iPad/i.test(navigator.userAgent || '');
    if (isTouchDevice && screen.orientation && typeof screen.orientation.lock === 'function') {
      screen.orientation.lock('landscape').catch(() => { });
    }
    if (typeof scheduleFitViewport === 'function') {
      scheduleFitViewport();
    } else if (typeof fitViewport === 'function') {
      fitViewport();
    }
  };

  if (isDisplayFullscreen || isStandalonePwa) {
    lockLandscapeIfMobile();
  }

  if (isDisplayFullscreen || window.navigator.standalone === true) {
    return;
  }

  let autoFsAttempted = false;
  const requestAutoFullscreen = () => {
    if (autoFsAttempted) return;
    autoFsAttempted = true;
    document.removeEventListener('pointerdown', requestAutoFullscreen, true);
    document.removeEventListener('keydown', requestAutoFullscreen, true);

    if (isSilkAutoHideBarMode()) {
      if (typeof uiLog === 'function' && state.devModeEnabled) {
        uiLog('SILK-BAR', 'auto-fullscreen omitido (modo barra auto-oculta)');
      }
      return;
    }

    if (typeof isFullscreenActive === 'function' && isFullscreenActive()) {
      lockLandscapeIfMobile();
      return;
    }

    const req = requestConfiguredFullscreen();

    if (req && typeof req.then === 'function') {
      req.then(lockLandscapeIfMobile).catch(() => { });
    }
  };

  document.addEventListener('pointerdown', requestAutoFullscreen, { capture: true, passive: true });
  document.addEventListener('keydown', requestAutoFullscreen, { capture: true, passive: true });
})();

// ============================================================================
// SILK BROWSER / PWA UPDATE DETECTOR & 1-TAP CACHE-BUST RELOAD
// ============================================================================
(function initSilkUpdateController() {
  const buildMeta = document.querySelector('meta[name="app-build"]');
  const currentBuild = buildMeta ? (buildMeta.getAttribute('content') || '').trim() : '';
  const buildLabel = document.getElementById('appBuildVersionLabel');
  if (buildLabel && currentBuild) {
    buildLabel.textContent = `v${currentBuild}`;
  }

  let isReloading = false;
  async function forceHardReloadApp(tag) {
    if (isReloading) return;
    isReloading = true;
    try {
      if ('caches' in window && typeof caches.keys === 'function') {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (e) { }
    try {
      if ('serviceWorker' in navigator && typeof navigator.serviceWorker.getRegistrations === 'function') {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.update().catch(() => { })));
      }
    } catch (e) { }
    const bust = encodeURIComponent(tag || String(Date.now()));
    window.location.replace(`${window.location.pathname}?r=${bust}`);
  }

  const forceUpdateBtn = document.getElementById('forceUpdateAppBtn');
  if (forceUpdateBtn) {
    forceUpdateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof showToast === 'function') {
        showToast('Actualizando SpotiEcho...', true);
      }
      forceHardReloadApp(String(Date.now()));
    });
  }

  if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
    return;
  }

  let lastCheckAt = 0;
  async function checkForRemoteAppUpdate() {
    if (!currentBuild || isReloading) return;
    const now = Date.now();
    if (now - lastCheckAt < 180000) return;
    lastCheckAt = now;

    try {
      const res = await fetch(`./index.html?_=${now}`, { cache: 'no-store' });
      if (!res || !res.ok) return;
      const html = await res.text();
      const match = html.match(/<meta[^>]+name=["']app-build["'][^>]+content=["']([^"']+)["']/i);
      const remoteBuild = match ? match[1].trim() : '';
      if (!remoteBuild || remoteBuild === currentBuild) return;

      let alreadyAutoReloaded = false;
      try {
        alreadyAutoReloaded = sessionStorage.getItem('sp_auto_reloaded_build') === remoteBuild;
      } catch (e) { }

      if (!state.isPlaying && !alreadyAutoReloaded) {
        try {
          sessionStorage.setItem('sp_auto_reloaded_build', remoteBuild);
        } catch (e) { }
        forceHardReloadApp(remoteBuild);
      } else if (typeof showToast === 'function') {
        showToast('Nueva versión lista · Actualiza desde Perfil', true);
      }
    } catch (e) { }
  }

  setTimeout(checkForRemoteAppUpdate, 2500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForRemoteAppUpdate();
    }
  });
})();

// ============================================================================
// SILK FULLSCREEN DIAGNOSTIC & EXPERIMENT LAB (DEVELOPER MODE ONLY)
// ============================================================================
(function initSilkFullscreenDiagnostic() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const CONSUME_EXCLUDE_SELECTOR = [
    'input',
    'textarea',
    'select',
    '#npRightLyrics',
    '#npQueueListContainer',
    '#npScrubberTrack',
    '.np-scrubber-wrap',
    '#npVolumeTrack',
    '#npGrabberZone',
    '#debugLogPanel',
    '#debugLogToggleBtn',
    '.scroll-container',
    '.view-scroll',
    '.modal-body-scroll'
  ].join(', ');

  const CLICKABLE_SELECTOR = [
    'button',
    'a',
    '[role="button"]',
    '[role="switch"]',
    '[data-open-entity]',
    '[data-nav]',
    '.track-row',
    '.artist-track-item',
    '.album-card',
    '.jump-card',
    '.np-transport-btn',
    '.np-dock-btn',
    '.np-circle-btn',
    '.modal-action-card-btn',
    '.modal-setting-row'
  ].join(', ');

  function normalizeTarget(raw) {
    return (raw && raw.nodeType === 3) ? raw.parentElement : raw;
  }

  function describeEl(el) {
    const node = normalizeTarget(el);
    if (!node || !node.tagName) return 'none';
    const tag = String(node.tagName).toLowerCase();
    if (node.id) return `${tag}#${node.id}`;
    const cls = typeof node.className === 'string'
      ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      : '';
    return cls ? `${tag}.${cls}` : tag;
  }

  function getFullscreenEl() {
    return document.fullscreenElement
      || document.webkitFullscreenElement
      || document.mozFullScreenElement
      || document.msFullscreenElement
      || null;
  }

  function getViewportSnapshot() {
    const vv = window.visualViewport;
    const vvStr = vv ? `${Math.round(vv.width)}x${Math.round(vv.height)}@${Math.round(vv.offsetTop)}` : 'na';
    const scrollY = typeof window.scrollY === 'number' ? Math.round(window.scrollY) : 0;
    return `inner=${window.innerWidth}x${window.innerHeight} vv=${vvStr} scrollY=${scrollY} fsEl=${describeEl(getFullscreenEl())} active=${describeEl(document.activeElement)}`;
  }

  function silkLog(msg) {
    if (state.devModeEnabled && typeof uiLog === 'function') {
      uiLog('SILK-FS', msg);
    }
  }

  function isConsumeTouchEnabled() {
    return typeof safeStorage !== 'undefined' && safeStorage && safeStorage.getItem('sp_silk_consume_touch') === 'true';
  }

  function syncSilkLabControlsUI() {
    const mode = getSilkFsTargetMode();
    const targetLabel = document.getElementById('silkFsTargetLabel');
    if (targetLabel) {
      targetLabel.textContent = mode;
    }

    const consumeOn = isConsumeTouchEnabled();
    const consumeSwitch = document.getElementById('silkConsumeTouchSwitch');
    if (consumeSwitch) {
      consumeSwitch.classList.toggle('active', consumeOn);
      consumeSwitch.setAttribute('aria-checked', consumeOn ? 'true' : 'false');
    }
  }

  syncSilkLabControlsUI();

  const targetBtn = document.getElementById('silkFsTargetBtn');
  if (targetBtn) {
    targetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const current = getSilkFsTargetMode();
      const idx = SILK_FS_MODES.indexOf(current);
      const nextMode = SILK_FS_MODES[(idx + 1) % SILK_FS_MODES.length];
      if (typeof safeStorage !== 'undefined' && safeStorage) {
        safeStorage.setItem('sp_silk_fs_target', nextMode);
      }
      syncSilkLabControlsUI();
      silkLog(`target=${nextMode} | ${getViewportSnapshot()}`);

      const req = requestConfiguredFullscreen(nextMode);
      if (req && typeof req.then === 'function') {
        req
          .then(() => {
            syncFullscreenSwitchUI();
            silkLog(`requestFS ok (${nextMode}) | ${getViewportSnapshot()}`);
          })
          .catch((err) => {
            silkLog(`requestFS err (${nextMode}): ${(err && err.message) || err}`);
          });
      }
    });
  }

  function toggleConsumeTouchMode(e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    const next = !isConsumeTouchEnabled();
    if (typeof safeStorage !== 'undefined' && safeStorage) {
      safeStorage.setItem('sp_silk_consume_touch', next ? 'true' : 'false');
    }
    syncSilkLabControlsUI();
    silkLog(`consumeTouch=${next} | ${getViewportSnapshot()}`);
  }

  const consumeRow = document.getElementById('silkConsumeTouchRow');
  if (consumeRow) consumeRow.addEventListener('click', toggleConsumeTouchMode);
  const consumeSwitch = document.getElementById('silkConsumeTouchSwitch');
  if (consumeSwitch) consumeSwitch.addEventListener('click', toggleConsumeTouchMode);

  let lastViewportSnapshot = getViewportSnapshot();
  function logViewportChange(source) {
    const snap = getViewportSnapshot();
    if (source.indexOf('fullscreen') === 0 || snap !== lastViewportSnapshot) {
      lastViewportSnapshot = snap;
      silkLog(`${source} | ${snap}`);
    }
  }

  document.addEventListener('fullscreenchange', () => logViewportChange('fullscreenchange'));
  document.addEventListener('webkitfullscreenchange', () => logViewportChange('webkitfullscreenchange'));
  window.addEventListener('resize', () => logViewportChange('resize'));
  if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
    window.visualViewport.addEventListener('resize', () => logViewportChange('vv.resize'));
  }

  window.addEventListener('blur', () => silkLog(`blur | ${getViewportSnapshot()}`));
  window.addEventListener('focus', () => silkLog(`focus | ${getViewportSnapshot()}`));
  document.addEventListener('visibilitychange', () => {
    silkLog(`visibility:${document.visibilityState} | ${getViewportSnapshot()}`);
  });

  // Experimental Blink touch consumer (runs BEFORE passive diagnostic touchstart listener)
  let pendingConsumedTouch = null;

  document.addEventListener('touchstart', (e) => {
    if (!isConsumeTouchEnabled() || !isFullscreenActive()) {
      pendingConsumedTouch = null;
      return;
    }
    if (!e.touches || e.touches.length !== 1) {
      pendingConsumedTouch = null;
      return;
    }
    const target = normalizeTarget(e.target);
    if (!target || (target.closest && target.closest(CONSUME_EXCLUDE_SELECTOR))) {
      pendingConsumedTouch = null;
      return;
    }
    if (e.cancelable) {
      e.preventDefault();
    }
    pendingConsumedTouch = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      t: Date.now(),
      target
    };
  }, { capture: true, passive: false });

  document.addEventListener('touchend', (e) => {
    const pending = pendingConsumedTouch;
    pendingConsumedTouch = null;
    if (!pending) return;
    if (!e.changedTouches || e.changedTouches.length === 0) return;

    const touch = e.changedTouches[0];
    const dist = Math.hypot(touch.clientX - pending.x, touch.clientY - pending.y);
    const elapsed = Date.now() - pending.t;
    if (dist < 14 && elapsed < 500) {
      const clickTarget = (pending.target && pending.target.closest ? pending.target.closest(CLICKABLE_SELECTOR) : null)
        || (pending.target && typeof pending.target.click === 'function' ? pending.target : null);
      if (clickTarget && typeof clickTarget.click === 'function') {
        silkLog(`consume->click ${describeEl(clickTarget)} (${Math.round(touch.clientX)},${Math.round(touch.clientY)})`);
        clickTarget.click();
      }
    }
  }, { capture: true, passive: true });

  document.addEventListener('touchcancel', () => {
    pendingConsumedTouch = null;
  }, { capture: true, passive: true });

  function logInteractionEvent(kind, clientX, clientY, e) {
    if (!state.devModeEnabled) return;
    const target = normalizeTarget(e.target);
    if (target && target.closest && target.closest('#debugLogPanel, #debugLogToggleBtn')) return;
    const vv = window.visualViewport;
    const vvH = vv ? Math.round(vv.height) : 'na';
    const scrollY = typeof window.scrollY === 'number' ? Math.round(window.scrollY) : 0;
    const fsEl = describeEl(getFullscreenEl());
    const consumeMode = isConsumeTouchEnabled();
    silkLog(`${kind} x=${Math.round(clientX)} y=${Math.round(clientY)} target=${describeEl(target)} dp=${Boolean(e.defaultPrevented)} fsEl=${fsEl} vvH=${vvH} scrollY=${scrollY} consume=${consumeMode}`);
  }

  document.addEventListener('touchstart', (e) => {
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!touch) return;
    logInteractionEvent('touchstart', touch.clientX, touch.clientY, e);
  }, { capture: true, passive: true });

  document.addEventListener('pointerdown', (e) => {
    logInteractionEvent(`pointerdown:${e.pointerType || 'unk'}`, e.clientX, e.clientY, e);
  }, { capture: true, passive: true });
})();

// ============================================================================
// EXPERIMENTAL: SILK "BARRA AUTO-OCULTA" (SIN requestFullscreen)
// Rollback: switch en Opciones de desarrollador o abrir la URL con ?barmode=off
// ============================================================================
(function initSilkAutoHideBarMode() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const STORAGE_KEY = 'sp_silk_autohide_bar';
  const active = isSilkAutoHideBarMode();

  function barLog(msg) {
    if (state.devModeEnabled && typeof uiLog === 'function') {
      uiLog('SILK-BAR', msg);
    }
  }

  function syncSwitchUI() {
    const sw = document.getElementById('silkAutoHideBarSwitch');
    if (sw) {
      sw.classList.toggle('active', active);
      sw.setAttribute('aria-checked', active ? 'true' : 'false');
    }
  }
  syncSwitchUI();

  function toggleMode(e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    const next = !active;
    try {
      if (next) {
        window.localStorage.setItem(STORAGE_KEY, 'true');
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch (err) { }
    if (typeof safeStorage !== 'undefined' && safeStorage) {
      if (next) safeStorage.setItem(STORAGE_KEY, 'true');
      else if (typeof safeStorage.removeItem === 'function') safeStorage.removeItem(STORAGE_KEY);
    }
    barLog(`modo barra auto-oculta -> ${next} (recargando)`);
    if (typeof showToast === 'function') {
      showToast(next ? 'Barra auto-oculta activada · recargando' : 'Barra auto-oculta desactivada · recargando', true);
    }

    const doc = document;
    const exitFs = doc.exitFullscreen || doc.webkitExitFullscreen;
    const reload = () => {
      const url = `${window.location.pathname}?barmode=${next ? 'on' : 'off'}&r=${Date.now()}`;
      window.location.replace(url);
    };
    if (next && isFullscreenActive() && exitFs) {
      Promise.resolve(exitFs.call(doc)).catch(() => { }).then(() => setTimeout(reload, 250));
    } else {
      setTimeout(reload, 250);
    }
  }

  const row = document.getElementById('silkAutoHideBarRow');
  if (row) row.addEventListener('click', toggleMode);
  const sw = document.getElementById('silkAutoHideBarSwitch');
  if (sw) sw.addEventListener('click', toggleMode);

  if (!active) return;

  const echoViewportEl = document.getElementById('echoViewport');

  function getMaxRootScroll() {
    const se = document.scrollingElement || document.documentElement;
    if (!se) return 0;
    return Math.max(0, (se.scrollHeight || 0) - (window.innerHeight || 0));
  }

  function getRootScrollY() {
    return typeof window.scrollY === 'number' ? window.scrollY : 0;
  }

  // Intento programático: llevar el documento al fondo para que Silk oculte la barra
  let lastPinAt = 0;
  function pinRootToBottom(reason) {
    const now = Date.now();
    if (now - lastPinAt < 400) return;
    lastPinAt = now;
    if (typeof window.scrollTo !== 'function') return;
    const maxY = getMaxRootScroll();
    if (maxY <= 0) return;
    if (getRootScrollY() >= maxY - 2) return;
    const beforeH = window.innerHeight;
    window.scrollTo(0, maxY);
    setTimeout(() => {
      barLog(`pin(${reason}) scrollY=${Math.round(getRootScrollY())}/${Math.round(getMaxRootScroll())} innerH ${beforeH}->${window.innerHeight}`);
    }, 350);
  }

  // Si el toque NO está dentro de un contenedor desplazable, bloquear el arrastre
  // hacia abajo del documento raíz (que haría volver a aparecer la barra de Silk).
  function findScrollableAncestor(node, axis) {
    let el = (node && node.nodeType === 3) ? node.parentElement : node;
    while (el && el !== document.body && el !== document.documentElement) {
      if (typeof window.getComputedStyle === 'function') {
        const cs = window.getComputedStyle(el);
        const ov = axis === 'x' ? cs.overflowX : cs.overflowY;
        if (ov === 'auto' || ov === 'scroll') {
          if (axis === 'x' ? (el.scrollWidth > el.clientWidth + 1) : (el.scrollHeight > el.clientHeight + 1)) {
            return el;
          }
        }
      }
      if (el === echoViewportEl) break;
      el = el.parentElement;
    }
    return null;
  }

  let touchStartX = 0;
  let touchStartY = 0;
  let touchScrollable = null;

  document.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchScrollable = findScrollableAncestor(e.target, 'y');
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!e.touches || e.touches.length !== 1 || !e.cancelable) return;
    if (touchScrollable) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    // Dedo hacia abajo (dy > 0) => el documento subiría => Silk mostraría la barra
    if (dy > 0 && Math.abs(dy) >= Math.abs(dx)) {
      e.preventDefault();
    }
  }, { capture: true, passive: false });

  document.addEventListener('touchend', () => {
    touchScrollable = null;
    setTimeout(() => pinRootToBottom('touchend'), 60);
  }, { capture: true, passive: true });

  let lastLoggedScrollY = -1;
  window.addEventListener('scroll', () => {
    const y = Math.round(getRootScrollY());
    if (Math.abs(y - lastLoggedScrollY) >= 20) {
      lastLoggedScrollY = y;
      barLog(`root scrollY=${y}/${Math.round(getMaxRootScroll())} innerH=${window.innerHeight}`);
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    barLog(`resize innerH=${window.innerHeight} vvH=${window.visualViewport ? Math.round(window.visualViewport.height) : 'na'} scrollY=${Math.round(getRootScrollY())}`);
  });

  if (typeof scheduleFitViewport === 'function') scheduleFitViewport();
  setTimeout(() => pinRootToBottom('boot'), 300);
  window.addEventListener('load', () => setTimeout(() => pinRootToBottom('load'), 300));
  barLog(`modo activo | innerH=${window.innerHeight} maxScroll=${Math.round(getMaxRootScroll())}`);
})();
