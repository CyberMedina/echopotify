/* ==========================================================================
   SERVICE: Spotify Web API Client, Web Playback SDK & Device Router
   ========================================================================== */
'use strict';

// --------------------------------------------------------------------------
// 3. SPOTIFY API CLIENT WITH AUTO-REFRESH
// --------------------------------------------------------------------------
let refreshTokenPromise = null;

async function refreshSpotifyAccessToken() {
  if (!spotifyAuth.refreshToken || !spotifyAuth.clientId) return false;
  if (refreshTokenPromise) return refreshTokenPromise;

  refreshTokenPromise = (async () => {
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: spotifyAuth.refreshToken,
        client_id: spotifyAuth.clientId
      });
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });
      if (!res.ok) {
        return false;
      }
      const data = await res.json();
      if (data.access_token) {
        spotifyAuth.accessToken = data.access_token;
        safeStorage.setItem('sp_access_token', data.access_token);
        if (spotifyTokenInput) spotifyTokenInput.value = data.access_token;
      }
      if (data.refresh_token) {
        spotifyAuth.refreshToken = data.refresh_token;
        safeStorage.setItem('sp_refresh_token', data.refresh_token);
      }
      if (bridge && bridge.saveTokens) {
        bridge.saveTokens(spotifyAuth.clientId, spotifyAuth.refreshToken);
      }
      startNativeEngine();
      return true;
    } catch (e) {
      return false;
    } finally {
      refreshTokenPromise = null;
    }
  })();

  return refreshTokenPromise;
}

async function spotifyFetch(endpoint, options = {}, retried = false) {
  if (!spotifyAuth.accessToken) {
    if (!retried && spotifyAuth.refreshToken && spotifyAuth.clientId) {
      const ok = await refreshSpotifyAccessToken();
      if (!ok) return null;
    } else {
      return null;
    }
  }
  try {
    const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${spotifyAuth.accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    if (res.status === 401 && !retried) {
      const refreshed = await refreshSpotifyAccessToken();
      if (refreshed) {
        return spotifyFetch(endpoint, options, true);
      }
      return null;
    }

    if (res.status === 204 || res.status === 202) {
      return { _ok: true, _status: res.status };
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        data = null;
      }
    }
    if (!res.ok) {
      if (data && typeof data === 'object' && data.error) {
        data._status = res.status;
        return data;
      }
      return {
        error: {
          status: res.status,
          message: (data && data.message) || text || res.statusText || `HTTP ${res.status}`
        },
        _status: res.status
      };
    }
    if (!text) return { _ok: true, _status: res.status };
    return data;
  } catch (err) {
    return null;
  }
}

let webPlayer = null;
let webPlayerDeviceId = null;
let playbackActionSeq = 0;

// Eliminado el banner flotante de validación (#debugWebPlayerPill)
function showPlayerStatus() {
  const existing = document.getElementById('debugWebPlayerPill');
  if (existing) existing.remove();
}

function lockUserPlaybackIntent(type, opts = {}) {
  playbackActionSeq++;
  const now = Date.now();
  state.userIntent = {
    seq: playbackActionSeq,
    type,
    startedAt: now,
    expiresAt: now + (opts.durationMs || 3200),
    prevId: opts.prevId || '',
    prevTitle: opts.prevTitle || '',
    targetId: opts.targetId || '',
    targetTitle: opts.targetTitle || '',
    isSpecificTrack: Boolean(opts.isSpecificTrack),
    targetIsPlaying: typeof opts.targetIsPlaying === 'boolean' ? opts.targetIsPlaying : state.isPlaying,
    targetSeekSec: typeof opts.targetSeekSec === 'number' ? opts.targetSeekSec : 0
  };
  return playbackActionSeq;
}

let webPlayerReadyPromise = null;
let resolveWebPlayerReady = null;
let webPlayerTransferredOnce = false;

function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resetWebPlayerReadyPromise() {
  webPlayerReadyPromise = new Promise(resolve => {
    resolveWebPlayerReady = resolve;
  });
}

function ensureWebPlayerReadyPromise() {
  if (!webPlayerReadyPromise) {
    resetWebPlayerReadyPromise();
  }
  return webPlayerReadyPromise;
}
ensureWebPlayerReadyPromise();

async function waitForWebPlayerReady(timeoutMs = 2500) {
  if (webPlayerDeviceId) return webPlayerDeviceId;
  if (!spotifyAuth.accessToken) return null;
  if (!webPlayer && window.Spotify) {
    initWebPlayer();
  }
  const p = ensureWebPlayerReadyPromise();
  const resolved = await Promise.race([
    p,
    sleepMs(timeoutMs).then(() => null)
  ]);
  return resolved || webPlayerDeviceId || null;
}

function isLocalWebPlayerActive() {
  return Boolean(
    webPlayer &&
    webPlayerDeviceId &&
    (!spotifyAuth.activeDeviceId || spotifyAuth.activeDeviceId === webPlayerDeviceId)
  );
}

function handleWebPlayerStateChanged(sdkState) {
  if (!sdkState || !sdkState.track_window || !sdkState.track_window.current_track) return;
  const cur = sdkState.track_window.current_track;
  if (webPlayerDeviceId) {
    webPlayerTransferredOnce = true;
    spotifyAuth.activeDeviceId = webPlayerDeviceId;
    spotifyAuth.activeDeviceName = 'SpotiEcho Web Player';
    spotifyAuth.activeDeviceType = 'Computer';
    state.lastConfirmedApiDeviceId = webPlayerDeviceId;
    if (typeof updateActiveDeviceBadgeUI === 'function') {
      updateActiveDeviceBadgeUI({
        id: webPlayerDeviceId,
        name: 'SpotiEcho Web Player',
        type: 'Computer',
        is_active: true
      });
    }
  }
  spotifyAuth.shuffleState = Boolean(sdkState.shuffle);
  spotifyAuth.repeatState = sdkState.repeat_mode === 2 ? 'track' : (sdkState.repeat_mode === 1 ? 'context' : 'off');

  const rawSec = Math.max(0, (sdkState.position || 0) / 1000);
  const incomingIsPlaying = !sdkState.paused;
  reconcileIncomingPlaybackState(cur, rawSec, incomingIsPlaying, 'sdk');

  if (!state.startupPlaybackChecked && incomingIsPlaying && !state.isNowPlayingOpen) {
    state.startupPlaybackChecked = true;
    openNowPlaying({ instant: true });
  }
}

window.onSpotifyWebPlaybackSDKReady = () => {
  console.log('[Spotify Web SDK] SDK listo en window');
  if (!spotifyAuth.accessToken) return;
  initWebPlayer();
};

function initWebPlayer() {
  showPlayerStatus();
  if (!window.Spotify || !spotifyAuth.accessToken || webPlayer) {
    return;
  }
  ensureWebPlayerReadyPromise();
  try {
    webPlayer = new window.Spotify.Player({
      name: 'SpotiEcho Web Player',
      getOAuthToken: async cb => {
        if (spotifyAuth.refreshToken) await refreshSpotifyAccessToken();
        cb(spotifyAuth.accessToken);
      },
      volume: 0.85
    });

    webPlayer.addListener('ready', ({ device_id }) => {
      console.log('[Spotify Web SDK] Conectado exitosamente con Device ID:', device_id);
      webPlayerDeviceId = device_id;
      webPlayerTransferredOnce = false;
      if (resolveWebPlayerReady) {
        const resFn = resolveWebPlayerReady;
        resolveWebPlayerReady = null;
        resFn(device_id);
      }
      // Asociar el Web Player local salvo que otro dispositivo remoto confirmado esté reproduciendo activamente
      const isConfirmedExternalPlayback = !!(
        spotifyAuth.activeDeviceId &&
        spotifyAuth.activeDeviceId !== device_id &&
        state.lastConfirmedApiDeviceId === spotifyAuth.activeDeviceId &&
        state.isPlaying
      );
      if (!isConfirmedExternalPlayback) {
        spotifyAuth.activeDeviceId = device_id;
        spotifyAuth.activeDeviceName = 'SpotiEcho Web Player';
        spotifyAuth.activeDeviceType = 'Computer';
        if (typeof updateActiveDeviceBadgeUI === 'function') {
          updateActiveDeviceBadgeUI({
            id: device_id,
            name: 'SpotiEcho Web Player',
            type: 'Computer',
            is_active: true
          });
        }
      }
    });

    webPlayer.addListener('not_ready', ({ device_id }) => {
      console.warn('[Spotify Web SDK] Device ID desconectado:', device_id);
      if (webPlayerDeviceId === device_id) {
        webPlayerDeviceId = null;
        webPlayerTransferredOnce = false;
        resetWebPlayerReadyPromise();
      }
      if (spotifyAuth.activeDeviceId === device_id) {
        spotifyAuth.activeDeviceId = null;
        spotifyAuth.activeDeviceName = '';
        if (state.lastConfirmedApiDeviceId === device_id) {
          state.lastConfirmedApiDeviceId = null;
        }
      }
    });

    webPlayer.addListener('player_state_changed', sdkState => {
      if (!sdkState) return;
      handleWebPlayerStateChanged(sdkState);
    });

    webPlayer.addListener('initialization_error', ({ message }) => {
      console.error('[Spotify Web SDK] Error de inicialización:', message);
    });
    webPlayer.addListener('authentication_error', ({ message }) => {
      console.error('[Spotify Web SDK] Error de autenticación:', message);
    });
    webPlayer.addListener('account_error', ({ message }) => {
      console.error('[Spotify Web SDK] Error de cuenta (requiere Premium):', message);
    });

    webPlayer.addListener('playback_error', ({ message }) => {
      console.error('[Spotify Web SDK] Error de reproducción:', message);
    });
    webPlayer.addListener('autoplay_failed', () => {
      console.warn('[Spotify Web SDK] Autoplay bloqueado por el navegador; se requiere interacción del usuario.');
      webPlayerAudioActivated = false;
      if (typeof showToast === 'function') {
        showToast('Toca la pantalla o Play para activar el audio del navegador', true);
      }
    });

    webPlayer.connect();
  } catch (e) {
    console.warn('[Spotify Web SDK] No soportado en este entorno:', e);
  }
}

// Always route playback to the local librespot receiver ("Echo Show 8") when available
let webPlayerAudioActivated = false;
function activateWebPlayerAudio() {
  if (!webPlayer || typeof webPlayer.activateElement !== 'function') return false;
  try {
    const res = webPlayer.activateElement();
    if (res && typeof res.then === 'function') {
      res.then(() => {
        webPlayerAudioActivated = true;
      }).catch(err => {
        webPlayerAudioActivated = false;
        console.warn('[Spotify Web SDK] activateElement rechazado:', err);
      });
    } else {
      webPlayerAudioActivated = true;
    }
    return true;
  } catch (e) {
    webPlayerAudioActivated = false;
    return false;
  }
}

if (typeof document !== 'undefined') {
  const onUserGesture = () => {
    if (!webPlayerAudioActivated) {
      activateWebPlayerAudio();
    }
  };
  document.addEventListener('pointerdown', onUserGesture, { capture: true, passive: true });
  document.addEventListener('keydown', onUserGesture, { capture: true, passive: true });
}

async function findEngineDeviceId() {
  if (!spotifyAuth.engineDeviceName) return null;
  const devRes = await spotifyFetch('/me/player/devices');
  if (devRes && Array.isArray(devRes.devices)) {
    spotifyAuth.availableDevices = devRes.devices;
    const echo = devRes.devices.find(d => d.name === spotifyAuth.engineDeviceName);
    if (echo && echo.id) {
      spotifyAuth.engineDeviceId = echo.id;
      return echo.id;
    }
  }
  return null;
}

async function resolvePlaybackDeviceId() {
  // 1. Si ya conocemos el activeDeviceId, respetarlo
  if (spotifyAuth.activeDeviceId) {
    return spotifyAuth.activeDeviceId;
  }

  // 2. Si el Web Player del navegador está listo, usarlo
  if (webPlayerDeviceId) {
    spotifyAuth.activeDeviceId = webPlayerDeviceId;
    spotifyAuth.activeDeviceName = 'SpotiEcho Web Player';
    spotifyAuth.activeDeviceType = 'Computer';
    if (typeof updateActiveDeviceBadgeUI === 'function') {
      updateActiveDeviceBadgeUI({
        id: webPlayerDeviceId,
        name: 'SpotiEcho Web Player',
        type: 'Computer',
        is_active: true
      });
    }
    return webPlayerDeviceId;
  }

  // 3. Esperar brevemente a que el Web Playback SDK local termine de registrarse antes de consultar la API
  const readyDevId = await waitForWebPlayerReady(2500);
  if (readyDevId) {
    spotifyAuth.activeDeviceId = readyDevId;
    spotifyAuth.activeDeviceName = 'SpotiEcho Web Player';
    spotifyAuth.activeDeviceType = 'Computer';
    if (typeof updateActiveDeviceBadgeUI === 'function') {
      updateActiveDeviceBadgeUI({
        id: readyDevId,
        name: 'SpotiEcho Web Player',
        type: 'Computer',
        is_active: true
      });
    }
    return readyDevId;
  }

  const devRes = await spotifyFetch('/me/player/devices');
  if (devRes && Array.isArray(devRes.devices) && devRes.devices.length > 0) {
    spotifyAuth.availableDevices = devRes.devices;

    const activeDev = devRes.devices.find(d => d.is_active && d.type !== 'Speaker')
      || devRes.devices.find(d => d.is_active);
    if (activeDev && activeDev.id) {
      spotifyAuth.activeDeviceId = activeDev.id;
      spotifyAuth.activeDeviceName = activeDev.name;
      spotifyAuth.activeDeviceType = activeDev.type;
      if (typeof updateActiveDeviceBadgeUI === 'function') {
        updateActiveDeviceBadgeUI(activeDev);
      }
      return activeDev.id;
    }

    // 4. JAMÁS enviar a dispositivos tipo 'Speaker' (como 'Echo Show de Jhonatan') ni adoptar sesiones fantasma de SpotiEcho en webPlayerDeviceId
    const safeDev = devRes.devices.find(d => d.type !== 'Speaker' && !(d.name || '').includes('SpotiEcho'))
      || devRes.devices.find(d => d.type !== 'Speaker');
    if (safeDev && safeDev.id) {
      spotifyAuth.activeDeviceId = safeDev.id;
      spotifyAuth.activeDeviceName = safeDev.name || '';
      spotifyAuth.activeDeviceType = safeDev.type || '';
      if (typeof updateActiveDeviceBadgeUI === 'function') {
        updateActiveDeviceBadgeUI(safeDev);
      }
      return safeDev.id;
    }
  }

  return '';
}

async function getTargetDeviceQuery() {
  const devId = await resolvePlaybackDeviceId();
  return devId ? `?device_id=${devId}` : '';
}

async function fetchAvailableDevices() {
  if (!spotifyAuth.accessToken) return [];
  try {
    const res = await spotifyFetch('/me/player/devices');
    if (res && Array.isArray(res.devices)) {
      spotifyAuth.availableDevices = res.devices;
      const active = res.devices.find(d => d.is_active);
      if (active) {
        spotifyAuth.activeDeviceId = active.id;
        spotifyAuth.activeDeviceName = (active.id === webPlayerDeviceId) ? 'SpotiEcho Web Player' : active.name;
        spotifyAuth.activeDeviceType = active.type;
        if (typeof updateActiveDeviceBadgeUI === 'function') {
          updateActiveDeviceBadgeUI({
            ...active,
            name: spotifyAuth.activeDeviceName
          });
        }
      } else if (!spotifyAuth.activeDeviceId && webPlayerDeviceId) {
        const localWebDev = res.devices.find(d => d.id === webPlayerDeviceId);
        if (localWebDev) {
          spotifyAuth.activeDeviceId = localWebDev.id;
          spotifyAuth.activeDeviceName = 'SpotiEcho Web Player';
          spotifyAuth.activeDeviceType = localWebDev.type;
          if (typeof updateActiveDeviceBadgeUI === 'function') {
            updateActiveDeviceBadgeUI({
              ...localWebDev,
              name: 'SpotiEcho Web Player'
            });
          }
        }
      }
      return res.devices;
    }
  } catch (err) {
    console.warn('[Spotify Devices] Error fetching devices:', err);
  }
  return spotifyAuth.availableDevices || [];
}

async function transferPlaybackToDevice(deviceId, play = true, options = {}) {
  activateWebPlayerAudio();
  if (!spotifyAuth.accessToken || !deviceId) return false;
  try {
    const keepPlaying = (typeof play === 'boolean') ? play : Boolean(state.isPlaying);
    const res = await spotifyFetch('/me/player', {
      method: 'PUT',
      body: JSON.stringify({
        device_ids: [deviceId],
        play: keepPlaying
      })
    });
    if (!res || res.error) {
      console.warn('[Spotify Devices] Transfer failed:', res && res.error ? res.error : 'no response');
      return false;
    }
    spotifyAuth.activeDeviceId = deviceId;
    state.lastConfirmedApiDeviceId = deviceId;
    if (deviceId === webPlayerDeviceId) {
      webPlayerTransferredOnce = true;
      spotifyAuth.activeDeviceName = 'SpotiEcho Web Player';
      spotifyAuth.activeDeviceType = 'Computer';
    } else if (Array.isArray(spotifyAuth.availableDevices)) {
      const matched = spotifyAuth.availableDevices.find(d => d.id === deviceId);
      if (matched) {
        spotifyAuth.activeDeviceName = matched.name;
        spotifyAuth.activeDeviceType = matched.type;
      }
    }
    if (!options.silent) {
      setTimeout(pollSpotifyCurrentPlayback, 600);
    }
    return true;
  } catch (err) {
    console.warn('[Spotify Devices] Error transferring playback:', err);
    return false;
  }
}

// Start the native librespot engine with a fresh token (only used on first login;
// afterwards librespot reuses its own cached credentials)
function startNativeEngine() {
  if (bridge && bridge.startEngine && spotifyAuth.accessToken) {
    bridge.startEngine(spotifyAuth.accessToken);
    // Device takes a few seconds to register with Spotify
    setTimeout(findEngineDeviceId, 4000);
    setTimeout(findEngineDeviceId, 10000);
  }
}

async function executeSpotifyPlay(playBody, cmdSeq, opts = {}) {
  let targetDeviceId = await resolvePlaybackDeviceId();
  if (cmdSeq !== playbackActionSeq) return null;

  const buildDevQuery = id => (id ? `?device_id=${id}` : '');

  // En el primer play contra el Web Player local, transferirlo silenciosamente para activarlo en Spotify Connect
  if (targetDeviceId && targetDeviceId === webPlayerDeviceId && !webPlayerTransferredOnce) {
    const preTransferred = await transferPlaybackToDevice(targetDeviceId, false, { silent: true });
    if (cmdSeq !== playbackActionSeq) return null;
    if (preTransferred) {
      await sleepMs(220);
      if (cmdSeq !== playbackActionSeq) return null;
    }
  }

  let playRes = await spotifyFetch(`/me/player/play${buildDevQuery(targetDeviceId)}`, {
    method: 'PUT',
    body: JSON.stringify(playBody)
  });
  if (cmdSeq !== playbackActionSeq) return null;

  if (!playRes || playRes.error) {
    const errStatus = (playRes && (playRes._status || (playRes.error && playRes.error.status))) || 0;
    const isBulkUri403 = errStatus === 403 && Array.isArray(playBody.uris) && playBody.uris.length > 1;

    if (!isBulkUri403 && (errStatus === 404 || errStatus === 403 || errStatus === 502 || errStatus === 503 || !playRes)) {
      let recoverId = targetDeviceId;
      if (errStatus === 404 && recoverId !== webPlayerDeviceId) {
        const localId = webPlayerDeviceId || await waitForWebPlayerReady(2500);
        if (cmdSeq !== playbackActionSeq) return null;
        if (localId) recoverId = localId;
      }

      if (recoverId) {
        const okTransfer = await transferPlaybackToDevice(recoverId, false, { silent: true });
        if (cmdSeq !== playbackActionSeq) return null;
        if (okTransfer) {
          targetDeviceId = recoverId;
          await sleepMs(250);
          if (cmdSeq !== playbackActionSeq) return null;
          playRes = await spotifyFetch(`/me/player/play${buildDevQuery(targetDeviceId)}`, {
            method: 'PUT',
            body: JSON.stringify(playBody)
          });
          if (cmdSeq !== playbackActionSeq) return null;
        } else if (errStatus === 404 && spotifyAuth.activeDeviceId === recoverId) {
          spotifyAuth.activeDeviceId = null;
        }
      }
    }
  }

  if (!playRes || playRes.error) {
    const errStatus = (playRes && (playRes._status || (playRes.error && playRes.error.status))) || 0;
    const isBulkUri403 = errStatus === 403 && Array.isArray(playBody.uris) && playBody.uris.length > 1;
    if (!isBulkUri403 && !opts.suppressErrorUI) {
      state.isPlaying = false;
      if (typeof updatePlayPauseIcons === 'function') updatePlayPauseIcons();
      if (typeof showToast === 'function') {
        showToast('No se pudo iniciar la reproducción en este dispositivo');
      }
    }
    return playRes || { error: { status: 0, message: 'No response' } };
  }

  // Watchdog local: verificar 650ms después si el Web Playback SDK recibió la pista y está sonando
  if (targetDeviceId && targetDeviceId === webPlayerDeviceId && webPlayer) {
    setTimeout(async () => {
      try {
        if (cmdSeq !== playbackActionSeq || !state.isPlaying || !isLocalWebPlayerActive()) return;
        if (!webPlayer || typeof webPlayer.getCurrentState !== 'function') return;
        const sdkState = await webPlayer.getCurrentState();
        if (cmdSeq !== playbackActionSeq || !state.isPlaying) return;

        if (sdkState && sdkState.track_window && sdkState.track_window.current_track) {
          if (sdkState.paused) {
            activateWebPlayerAudio();
            if (typeof webPlayer.resume === 'function') {
              await webPlayer.resume().catch(() => {});
            }
          }
          return;
        }

        // Spotify respondió 204 pero el SDK sigue vacío: re-transferir y reintentar una vez
        const retransferred = await transferPlaybackToDevice(targetDeviceId, false, { silent: true });
        if (!retransferred || cmdSeq !== playbackActionSeq || !state.isPlaying) return;
        await sleepMs(220);
        if (cmdSeq !== playbackActionSeq || !state.isPlaying) return;

        const retryRes = await spotifyFetch(`/me/player/play${buildDevQuery(targetDeviceId)}`, {
          method: 'PUT',
          body: JSON.stringify(playBody)
        });
        if (cmdSeq !== playbackActionSeq) return;
        if (!retryRes || retryRes.error) {
          state.isPlaying = false;
          if (typeof updatePlayPauseIcons === 'function') updatePlayPauseIcons();
          if (typeof showToast === 'function') {
            showToast('No se pudo activar el audio en SpotiEcho Web Player');
          }
        }
      } catch (err) {
        console.warn('[Spotify Watchdog Error]', err);
      }
    }, 650);
  }

  if (playRes && typeof playRes === 'object') {
    playRes._deviceId = targetDeviceId;
  }
  return playRes;
}

async function playSpotifyContext(contextUri, offsetPosition = 0, upcomingSlice = [], opts = {}) {
  activateWebPlayerAudio();
  const cmdSeq = playbackActionSeq;
  state.singleTrackPlayback = false;
  state.isAutoplayQueue = false;
  state.autoplayLoading = false;
  state.contextUpcomingTracks = Array.isArray(upcomingSlice) ? upcomingSlice : [];
  if (bridge && bridge.notifyTrackLoading) {
    bridge.notifyTrackLoading('');
    state.pcmFlowing = false;
    state.currentTimeSec = 0;
  }
  const body = { context_uri: contextUri };
  if (offsetPosition && typeof offsetPosition === 'object') {
    body.offset = offsetPosition;
  } else if (typeof offsetPosition === 'number' && offsetPosition >= 0) {
    body.offset = { position: offsetPosition };
  }
  const playRes = await executeSpotifyPlay(body, cmdSeq, opts);
  if (cmdSeq !== playbackActionSeq || !playRes) return null;
  if (playRes.error) {
    console.warn('[Spotify Play Context Error]', playRes.error);
    return playRes;
  }
  setTimeout(pollSpotifyCurrentPlayback, 900);
  return playRes;
}

async function playSpotifyUris(urisArray, upcomingSlice = [], opts = {}) {
  activateWebPlayerAudio();
  const cmdSeq = playbackActionSeq;
  const cleanUris = Array.isArray(urisArray)
    ? urisArray.filter(u => typeof u === 'string' && u.length > 0 && !u.startsWith('spotify:local:'))
    : [];
  if (cleanUris.length === 0) return null;

  // Limitar a 80 URIs por llamada a /me/player/play (el máximo de la API de Spotify es 100)
  const safeUris = cleanUris.slice(0, 80);

  state.singleTrackPlayback = safeUris.length === 1;
  if (!state.isAutoplayQueue || (Array.isArray(urisArray) && urisArray.length > 1 && (!upcomingSlice || upcomingSlice.length === 0))) {
    state.isAutoplayQueue = false;
    state.autoplayLoading = false;
  }
  state.contextUpcomingTracks = Array.isArray(upcomingSlice) ? upcomingSlice : [];
  if (bridge && bridge.notifyTrackLoading) {
    bridge.notifyTrackLoading('');
    state.pcmFlowing = false;
    state.currentTimeSec = 0;
  }
  let playRes = await executeSpotifyPlay(
    { uris: safeUris },
    cmdSeq,
    safeUris.length > 1 ? { ...opts, suppressErrorUI: true } : opts
  );
  if (cmdSeq !== playbackActionSeq || !playRes) return null;

  // Si Spotify rechaza la lista masiva (p. ej. 403 Restriction Violated), reintentar inmediatamente con el URI individual de la pista
  if (playRes.error && safeUris.length > 1 && safeUris[0]) {
    console.warn('[Spotify Play Uris Error, retrying single URI]', playRes.error);
    playRes = await executeSpotifyPlay({ uris: [safeUris[0]] }, cmdSeq, opts);
    if (cmdSeq !== playbackActionSeq || !playRes) return null;
  }

  if (!playRes.error) {
    setTimeout(pollSpotifyCurrentPlayback, 900);
  }
  return playRes;
}

async function playSpotifyTrackUri(trackUri, upcomingSlice = [], opts = {}) {
  return playSpotifyUris([trackUri], upcomingSlice, opts);
}


// ==========================================================================
// SPOTIFY AUTOPLAY / RADIO ALGORITHM (delegates to Spotify-Native EchoRadio)
// ==========================================================================
function normalizeAutoplayTrack(t) {
  if (!t || (!t.id && !t.uri)) return null;
  const base = (typeof normalizeApiTrack === 'function')
    ? normalizeApiTrack(t)
    : (() => {
        const imgs = (t.album && Array.isArray(t.album.images)) ? t.album.images : [];
        const cover = imgs[0] ? imgs[0].url : (t.cover || DEFAULT_ALBUM_COVER);
        const thumb = imgs[imgs.length - 1] ? imgs[imgs.length - 1].url : (t.thumb || cover);
        const artistStr = Array.isArray(t.artists)
          ? t.artists.map(a => a.name).join(', ')
          : (t.artist || 'Artista');
        return {
          id: cleanTrackId(t.id || t.uri),
          uri: t.uri || (t.id ? `spotify:track:${t.id}` : ''),
          title: t.name || t.title || 'Track',
          artist: artistStr,
          album: (t.album && t.album.name) ? t.album.name : (t.album || ''),
          cover,
          thumb,
          duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : (t.duration || 210)
        };
      })();
  if (!base) return null;
  // Preserve rich graph & BaRT metadata for EchoRadio scoring/feedback
  base.artists = Array.isArray(t.artists) ? t.artists : (base.artists || []);
  if (t.albumId) base.albumId = t.albumId;
  else if (t.album && t.album.id) base.albumId = t.album.id;
  if (t.year) base.year = t.year;
  if (t.radioChannel) base.radioChannel = t.radioChannel;
  if (t.radioReason) base.radioReason = t.radioReason;
  if (typeof t.radioScore === 'number') base.radioScore = t.radioScore;
  if (typeof t.isDiscovery === 'boolean') base.isDiscovery = t.isDiscovery;
  return base;
}

function recordAutoplayHistory(trackIdOrUri) {
  const cid = cleanTrackId(trackIdOrUri);
  if (!cid) return;
  if (!Array.isArray(state.autoplayHistoryIds)) state.autoplayHistoryIds = [];
  if (!state.autoplayHistoryIds.includes(cid)) {
    state.autoplayHistoryIds.push(cid);
    if (state.autoplayHistoryIds.length > 100) {
      state.autoplayHistoryIds.shift();
    }
  }
  if (typeof EchoRadio !== 'undefined' && typeof EchoRadio.markHistoryId === 'function') {
    EchoRadio.markHistoryId(cid);
  }
}

async function fetchSpotifyAutoplayTracks(seedTrack, limit = 12) {
  if (!spotifyAuth.accessToken || !seedTrack) return [];
  if (typeof EchoRadio !== 'undefined' && typeof EchoRadio.generateRadioTracks === 'function') {
    const generated = await EchoRadio.generateRadioTracks(seedTrack, limit);
    if (Array.isArray(generated) && generated.length > 0) {
      return generated.map(normalizeAutoplayTrack).filter(Boolean);
    }
  }
  return [];
}

async function enqueueTracksOnSpotify(tracks, devQ, cmdSeq, maxToQueue = 5) {
  if (!Array.isArray(tracks) || tracks.length === 0) return false;
  const qParam = devQ ? `&${devQ.replace(/^\?/, '')}` : '';
  let queuedCount = 0;
  for (const t of tracks.slice(0, maxToQueue)) {
    if (cmdSeq !== playbackActionSeq) return false;
    if (!t || !t.uri) continue;
    const res = await spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(t.uri)}${qParam}`, {
      method: 'POST'
    });
    if (res && res.error) {
      console.warn('[Autoplay Queue Error]', res.error);
      break;
    }
    queuedCount++;
  }
  return queuedCount > 0;
}

async function playSingleTrackWithAutoplay(seedTrack) {
  activateWebPlayerAudio();
  if (!seedTrack || !seedTrack.uri) return null;
  const cleanId = cleanTrackId(seedTrack.id || seedTrack.uri);
  const targetId = cleanId || seedTrack.uri;
  const hasMatchingIntent = state.userIntent &&
    state.userIntent.type === 'track_switch' &&
    Date.now() < state.userIntent.until &&
    (!targetId || state.userIntent.targetId === targetId);
  const cmdSeq = hasMatchingIntent
    ? playbackActionSeq
    : lockUserPlaybackIntent('track_switch', {
        targetId,
        targetTitle: seedTrack.name || seedTrack.title || 'Track',
        targetIsPlaying: true
      });

  const seedNorm = normalizeAutoplayTrack({
    id: cleanId || seedTrack.uri,
    uri: seedTrack.uri,
    name: seedTrack.name || seedTrack.title || 'Track',
    artist: seedTrack.artist || '',
    artists: seedTrack.artists,
    album: seedTrack.album || '',
    cover: seedTrack.cover || DEFAULT_ALBUM_COVER,
    thumb: seedTrack.thumb || seedTrack.cover || DEFAULT_ALBUM_COVER,
    duration: seedTrack.duration || 210
  });

  state.singleTrackPlayback = false;
  state.isAutoplayQueue = true;
  state.autoplayLoading = true;
  state.autoplaySeedTrackId = cleanId || seedTrack.uri;
  state.autoplaySessionTracks = seedNorm ? [seedNorm] : [];
  state.autoplaySessionIndex = 0;
  state.contextUpcomingTracks = [];
  state.liveQueueTracks = [];
  state.queueLoading = true;
  if (typeof EchoRadio !== 'undefined' && typeof EchoRadio.resetSession === 'function') {
    EchoRadio.resetSession(seedNorm || seedTrack);
  }
  recordAutoplayHistory(cleanId || seedTrack.uri);

  if (bridge && bridge.notifyTrackLoading) {
    bridge.notifyTrackLoading('');
    state.pcmFlowing = false;
    state.currentTimeSec = 0;
  }

  // Start playback immediately AND generate Spotify-native Radio queue (12 tracks) in parallel
  const playPromise = executeSpotifyPlay({ uris: [seedTrack.uri] }, cmdSeq);
  const autoplayPromise = fetchSpotifyAutoplayTracks(seedNorm || seedTrack, 12);

  const [playRes, autoplayTracks] = await Promise.all([playPromise, autoplayPromise]);
  if (cmdSeq !== playbackActionSeq) return playRes;

  const resolvedDevId = (playRes && playRes._deviceId) || spotifyAuth.activeDeviceId || webPlayerDeviceId || '';
  const devQ = resolvedDevId ? `?device_id=${resolvedDevId}` : '';

  state.autoplayLoading = false;
  state.queueLoading = false;

  if (!playRes || playRes.error) {
    console.warn('[Spotify Play Single+Autoplay Error]', playRes.error);
    state.isAutoplayQueue = false;
    state.autoplaySessionTracks = [];
    state.autoplaySessionIndex = -1;
    return playRes;
  }

  if (Array.isArray(autoplayTracks) && autoplayTracks.length > 0) {
    state.autoplaySessionTracks = seedNorm ? [seedNorm, ...autoplayTracks] : [...autoplayTracks];
    state.autoplaySessionIndex = 0;
    const upcoming = state.autoplaySessionTracks.slice(1);
    state.contextUpcomingTracks = upcoming;
    state.liveQueueTracks = upcoming;
    if (typeof renderQueuePanelUI === 'function') renderQueuePanelUI();
    if (typeof updateNowPlayingRightPanelMode === 'function') updateNowPlayingRightPanelMode();

    // Prewarm covers of first 3 upcoming tracks
    if (typeof prewarmImageUrls === 'function') {
      const nextThree = upcoming.slice(0, 3);
      prewarmImageUrls(nextThree.map(t => t.cover));
      prewarmImageUrls(nextThree.map(t => t.thumb || t.cover));
    }

    // Queue next 5 tracks on Spotify's real player queue so Track 0 -> Track 1 transitions naturally
    enqueueTracksOnSpotify(upcoming, devQ, cmdSeq, 5);
  } else {
    if (typeof renderQueuePanelUI === 'function') renderQueuePanelUI();
    if (typeof updateNowPlayingRightPanelMode === 'function') updateNowPlayingRightPanelMode();
  }

  setTimeout(pollSpotifyCurrentPlayback, 900);
  return playRes;
}

async function replenishAutoplayQueue() {
  if (!state.isAutoplayQueue || state.autoplayLoading || !spotifyAuth.accessToken) return;
  const currentQueue = state.liveQueueTracks || [];
  if (currentQueue.length >= 5) return;

  const session = Array.isArray(state.autoplaySessionTracks) ? state.autoplaySessionTracks : [];
  const activeIdx = Math.max(0, state.autoplaySessionIndex || 0);
  const seed = session[activeIdx] || session[session.length - 1] || currentQueue[currentQueue.length - 1] || {
    id: state.playingTrackId,
    uri: state.playingTrackUri,
    name: state.playingTrackTitle,
    artist: state.playingArtist,
    artists: state.playingArtists,
    artistId: state.playingArtistId
  };
  if (!seed || (!seed.id && !seed.uri)) return;

  state.autoplayLoading = true;
  const cmdSeq = playbackActionSeq;
  try {
    const moreTracks = await fetchSpotifyAutoplayTracks(seed, 10);
    if (cmdSeq !== playbackActionSeq || !state.isAutoplayQueue) return;
    if (Array.isArray(moreTracks) && moreTracks.length > 0) {
      const existingIds = new Set(
        (state.autoplaySessionTracks || []).map(t => cleanTrackId(t.id || t.uri))
      );
      const fresh = moreTracks.filter(t => {
        const cid = cleanTrackId(t.id || t.uri);
        return cid && !existingIds.has(cid);
      });
      if (fresh.length > 0) {
        state.autoplaySessionTracks = [...(state.autoplaySessionTracks || []), ...fresh];
        const idx = Math.max(0, state.autoplaySessionIndex || 0);
        state.liveQueueTracks = state.autoplaySessionTracks.slice(idx + 1);
        state.contextUpcomingTracks = state.liveQueueTracks;
        if (typeof renderQueuePanelUI === 'function') renderQueuePanelUI();
        // Keep Spotify's hardware queue topped up for uninterrupted playback
        const devQ = await getTargetDeviceQuery();
        if (cmdSeq === playbackActionSeq && state.isAutoplayQueue) {
          enqueueTracksOnSpotify(fresh, devQ, cmdSeq, 4);
        }
      }
    }
  } finally {
    state.autoplayLoading = false;
  }
}
