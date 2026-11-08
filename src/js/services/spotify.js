/* ==========================================================================
   SERVICE: Spotify Web API Client, Web Playback SDK & Device Router
   ========================================================================== */
'use strict';

// --------------------------------------------------------------------------
// 3. SPOTIFY API CLIENT WITH AUTO-REFRESH
// --------------------------------------------------------------------------
let isRefreshing = false;

async function refreshSpotifyAccessToken() {
  if (isRefreshing || !spotifyAuth.refreshToken || !spotifyAuth.clientId) return false;
  isRefreshing = true;
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
      isRefreshing = false;
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
    isRefreshing = false;
    return true;
  } catch (e) {
    isRefreshing = false;
    return false;
  }
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

    if (res.status === 204 || res.status === 202) return {};
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text);
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
    spotifyAuth.activeDeviceId = webPlayerDeviceId;
    spotifyAuth.activeDeviceName = spotifyAuth.activeDeviceName || 'SpotiEcho Web Player';
    spotifyAuth.activeDeviceType = 'Computer';
    if (typeof updateActiveDeviceBadgeUI === 'function') {
      updateActiveDeviceBadgeUI({
        id: webPlayerDeviceId,
        name: spotifyAuth.activeDeviceName,
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
      // Solo asociar como activo si no hay otro dispositivo sonando activamente
      if (!spotifyAuth.activeDeviceId) {
        spotifyAuth.activeDeviceId = device_id;
        spotifyAuth.activeDeviceName = 'SpotiEcho Web Player';
        spotifyAuth.activeDeviceType = 'Computer';
      }
      if (typeof updateActiveDeviceBadgeUI === 'function' && (!spotifyAuth.activeDeviceName || spotifyAuth.activeDeviceId === device_id)) {
        updateActiveDeviceBadgeUI({
          id: device_id,
          name: spotifyAuth.activeDeviceName || 'SpotiEcho Web Player',
          type: 'Computer',
          is_active: true
        });
      }
    });

    webPlayer.addListener('not_ready', ({ device_id }) => {
      console.warn('[Spotify Web SDK] Device ID desconectado:', device_id);
      if (webPlayerDeviceId === device_id) webPlayerDeviceId = null;
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

    webPlayer.connect();
  } catch (e) {
    console.warn('[Spotify Web SDK] No soportado en este entorno:', e);
  }
}

// Always route playback to the local librespot receiver ("Echo Show 8") when available
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

async function getTargetDeviceQuery() {
  // 1. Si ya conocemos el activeDeviceId donde está sonando la música, usarlo siempre con prioridad
  if (spotifyAuth.activeDeviceId) {
    return `?device_id=${spotifyAuth.activeDeviceId}`;
  }

  // 2. Si el Web Player del navegador está listo y no hay otro dispositivo activo, usarlo
  if (webPlayerDeviceId) {
    return `?device_id=${webPlayerDeviceId}`;
  }

  const devRes = await spotifyFetch('/me/player/devices');
  if (devRes && Array.isArray(devRes.devices) && devRes.devices.length > 0) {
    spotifyAuth.availableDevices = devRes.devices;

    const activeDev = devRes.devices.find(d => d.is_active);
    if (activeDev && activeDev.id) {
      spotifyAuth.activeDeviceId = activeDev.id;
      spotifyAuth.activeDeviceName = activeDev.name;
      spotifyAuth.activeDeviceType = activeDev.type;
      if (typeof updateActiveDeviceBadgeUI === 'function') {
        updateActiveDeviceBadgeUI(activeDev);
      }
      return `?device_id=${activeDev.id}`;
    }

    // 3. Buscar si hay algún Web Player (tipo Computer)
    const webDev = devRes.devices.find(d => d.type === 'Computer' && (d.name.includes('SpotiEcho') || d.name.includes('Silk') || d.name.includes('Echo Show')));
    if (webDev && webDev.id) {
      webPlayerDeviceId = webDev.id;
      spotifyAuth.activeDeviceId = webDev.id;
      return `?device_id=${webDev.id}`;
    }

    // 4. JAMÁS enviar a dispositivos tipo 'Speaker' (como 'Echo Show de Jhonatan') porque Alexa OS interrumpe la skill y la cierra!
    const safeDev = devRes.devices.find(d => d.type !== 'Speaker' && d.is_active)
                 || devRes.devices.find(d => d.type !== 'Speaker');
    if (safeDev && safeDev.id) {
      spotifyAuth.activeDeviceId = safeDev.id;
      return `?device_id=${safeDev.id}`;
    }
  }

  return '';
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
        spotifyAuth.activeDeviceName = active.name;
        spotifyAuth.activeDeviceType = active.type;
        if (typeof updateActiveDeviceBadgeUI === 'function') {
          updateActiveDeviceBadgeUI(active);
        }
      } else if (!spotifyAuth.activeDeviceId && res.devices.length > 0) {
        const defaultDev = res.devices.find(d => d.type === 'Computer') || res.devices[0];
        if (defaultDev) {
          spotifyAuth.activeDeviceId = defaultDev.id;
          spotifyAuth.activeDeviceName = defaultDev.name;
          spotifyAuth.activeDeviceType = defaultDev.type;
          if (typeof updateActiveDeviceBadgeUI === 'function') {
            updateActiveDeviceBadgeUI(defaultDev);
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

async function transferPlaybackToDevice(deviceId, play = true) {
  if (!spotifyAuth.accessToken || !deviceId) return false;
  try {
    const keepPlaying = (typeof play === 'boolean') ? play : (state.isPlaying || true);
    await spotifyFetch('/me/player', {
      method: 'PUT',
      body: JSON.stringify({
        device_ids: [deviceId],
        play: keepPlaying
      })
    });
    spotifyAuth.activeDeviceId = deviceId;
    setTimeout(pollSpotifyCurrentPlayback, 600);
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

async function playSpotifyContext(contextUri, offsetPosition = 0, upcomingSlice = []) {
  const cmdSeq = playbackActionSeq;
  state.singleTrackPlayback = false;
  state.contextUpcomingTracks = Array.isArray(upcomingSlice) ? upcomingSlice : [];
  if (bridge && bridge.notifyTrackLoading) {
    bridge.notifyTrackLoading('');
    state.pcmFlowing = false;
    state.currentTimeSec = 0;
  }
  const devQ = await getTargetDeviceQuery();
  if (cmdSeq !== playbackActionSeq) return null;
  const body = { context_uri: contextUri };
  if (offsetPosition && typeof offsetPosition === 'object') {
    body.offset = offsetPosition;
  } else if (typeof offsetPosition === 'number' && offsetPosition >= 0) {
    body.offset = { position: offsetPosition };
  }
  const playRes = await spotifyFetch(`/me/player/play${devQ}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
  if (playRes && playRes.error) {
    console.warn('[Spotify Play Context Error]', playRes.error);
    return playRes;
  }
  setTimeout(pollSpotifyCurrentPlayback, 900);
  return playRes;
}

async function playSpotifyUris(urisArray, upcomingSlice = []) {
  const cmdSeq = playbackActionSeq;
  state.singleTrackPlayback = Array.isArray(urisArray) && urisArray.length === 1;
  state.contextUpcomingTracks = Array.isArray(upcomingSlice) ? upcomingSlice : [];
  if (bridge && bridge.notifyTrackLoading) {
    bridge.notifyTrackLoading('');
    state.pcmFlowing = false;
    state.currentTimeSec = 0;
  }
  const devQ = await getTargetDeviceQuery();
  if (cmdSeq !== playbackActionSeq) return null;
  const playRes = await spotifyFetch(`/me/player/play${devQ}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: urisArray })
  });

  // Si Spotify rechaza la lista masiva con error 403 (Restriction Violated), reintentar inmediatamente con el URI individual de la pista
  if (playRes && playRes.error && Array.isArray(urisArray) && urisArray.length > 1 && urisArray[0]) {
    console.warn('[Spotify Play Uris Error, retrying single URI]', playRes.error);
    await spotifyFetch(`/me/player/play${devQ}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [urisArray[0]] })
    });
  }

  setTimeout(pollSpotifyCurrentPlayback, 900);
  return playRes;
}

async function playSpotifyTrackUri(trackUri, upcomingSlice = []) {
  return playSpotifyUris([trackUri], upcomingSlice);
}

