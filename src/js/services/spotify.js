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
      // Asociar el Web Player local si no hay otro dispositivo con reproducción activa
      const hasActiveExternalPlayback = !!(spotifyAuth.activeDeviceId && spotifyAuth.activeDeviceId !== device_id && state.isPlaying);
      if (!hasActiveExternalPlayback) {
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
  if (webPlayer && typeof webPlayer.activateElement === 'function') {
    try {
      const res = webPlayer.activateElement();
      if (res && typeof res.catch === 'function') {
        res.catch(() => {});
      }
      webPlayerAudioActivated = true;
    } catch (e) {}
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

async function getTargetDeviceQuery() {
  // 1. Si ya conocemos el activeDeviceId donde está sonando la música, usarlo siempre con prioridad
  if (spotifyAuth.activeDeviceId) {
    return `?device_id=${spotifyAuth.activeDeviceId}`;
  }

  // 2. Si el Web Player del navegador está listo y no hay otro dispositivo activo, usarlo
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
        // Sin reproducción activa en otro dispositivo: preferir el Web Player local, nunca un dispositivo externo al azar (ej. TV)
        const localWebDev = (webPlayerDeviceId && res.devices.find(d => d.id === webPlayerDeviceId))
          || res.devices.find(d => d.type === 'Computer' && (d.name.includes('SpotiEcho') || d.name.includes('Silk') || d.name.includes('Echo Show')));
        if (localWebDev) {
          spotifyAuth.activeDeviceId = localWebDev.id;
          spotifyAuth.activeDeviceName = localWebDev.name;
          spotifyAuth.activeDeviceType = localWebDev.type;
          if (typeof updateActiveDeviceBadgeUI === 'function') {
            updateActiveDeviceBadgeUI(localWebDev);
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
  activateWebPlayerAudio();
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
  const devQ = await getTargetDeviceQuery();
  if (cmdSeq !== playbackActionSeq) return null;
  const playRes = await spotifyFetch(`/me/player/play${devQ}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: safeUris })
  });

  // Si Spotify rechaza la lista masiva con error 403 (Restriction Violated), reintentar inmediatamente con el URI individual de la pista
  if (playRes && playRes.error && safeUris.length > 1 && safeUris[0]) {
    console.warn('[Spotify Play Uris Error, retrying single URI]', playRes.error);
    await spotifyFetch(`/me/player/play${devQ}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [safeUris[0]] })
    });
  }

  setTimeout(pollSpotifyCurrentPlayback, 900);
  return playRes;
}

async function playSpotifyTrackUri(trackUri, upcomingSlice = []) {
  return playSpotifyUris([trackUri], upcomingSlice);
}


// ==========================================================================
// SPOTIFY AUTOPLAY / RADIO ALGORITHM (for single-track playback without queue)
// ==========================================================================
function normalizeAutoplayTrack(t) {
  if (!t || (!t.id && !t.uri)) return null;
  if (typeof normalizeApiTrack === 'function') {
    return normalizeApiTrack(t);
  }
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
    artists: Array.isArray(t.artists) ? t.artists : [],
    album: (t.album && t.album.name) ? t.album.name : (t.album || ''),
    cover,
    thumb,
    duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : (t.duration || 210)
  };
}

function recordAutoplayHistory(trackIdOrUri) {
  const cid = cleanTrackId(trackIdOrUri);
  if (!cid) return;
  if (!Array.isArray(state.autoplayHistoryIds)) state.autoplayHistoryIds = [];
  if (!state.autoplayHistoryIds.includes(cid)) {
    state.autoplayHistoryIds.push(cid);
    if (state.autoplayHistoryIds.length > 60) {
      state.autoplayHistoryIds.shift();
    }
  }
}

async function fetchSpotifyAutoplayTracks(seedTrack, limit = 10) {
  if (!spotifyAuth.accessToken || !seedTrack) return [];

  const seedId = cleanTrackId(seedTrack.id || seedTrack.uri);
  let artistId = seedTrack.artistId || (Array.isArray(seedTrack.artists) && seedTrack.artists[0] && seedTrack.artists[0].id) || state.playingArtistId || null;
  let artistName = seedTrack.artist || (Array.isArray(seedTrack.artists) && seedTrack.artists[0] && seedTrack.artists[0].name) || '';
  const seedTitle = seedTrack.name || seedTrack.title || '';

  const seenIds = new Set(Array.isArray(state.autoplayHistoryIds) ? state.autoplayHistoryIds : []);
  const seenTitles = new Set();
  if (seedId) seenIds.add(seedId);
  if (seedTitle) seenTitles.add(seedTitle.toLowerCase());
  (state.liveQueueTracks || []).forEach(t => {
    if (t && t.id) seenIds.add(cleanTrackId(t.id));
    if (t && t.title) seenTitles.add(t.title.toLowerCase());
  });

  const collected = [];
  const pushTrack = (raw) => {
    const norm = normalizeAutoplayTrack(raw);
    if (!norm || !norm.uri || !norm.uri.startsWith('spotify:track:')) return false;
    const cid = cleanTrackId(norm.id || norm.uri);
    const titleKey = (norm.title || '').toLowerCase();
    if ((cid && seenIds.has(cid)) || (titleKey && seenTitles.has(titleKey))) return false;
    if (cid) seenIds.add(cid);
    if (titleKey) seenTitles.add(titleKey);
    collected.push(norm);
    return true;
  };

  // 0. Enrich seed metadata (all featured artists)
  let seedArtistsList = Array.isArray(seedTrack.artists) ? seedTrack.artists : [];
  if (seedId && /^[0-9A-Za-z]{22}$/.test(seedId) && (seedArtistsList.length === 0 || !artistId)) {
    const trackMeta = await spotifyFetch(`/tracks/${seedId}`).catch(() => null);
    if (trackMeta && Array.isArray(trackMeta.artists) && trackMeta.artists.length > 0) {
      seedArtistsList = trackMeta.artists;
      artistId = trackMeta.artists[0].id || artistId;
      if (!artistName) artistName = trackMeta.artists.map(a => a.name).join(', ');
    }
  }
  const extraArtistIds = seedArtistsList.map(a => a && a.id).filter(id => id && /^[0-9A-Za-z]{22}$/.test(id)).slice(0, 3);
  if (artistId && /^[0-9A-Za-z]{22}$/.test(artistId) && !extraArtistIds.includes(artistId)) {
    extraArtistIds.unshift(artistId);
  }

  // 1. Primary: Official Spotify Recommendations API
  if (seedId && /^[0-9A-Za-z]{22}$/.test(seedId)) {
    const recParams = new URLSearchParams({
      seed_tracks: seedId,
      limit: String(Math.min(25, limit + 5)),
      market: 'from_token'
    });
    if (artistId && /^[0-9A-Za-z]{22}$/.test(artistId)) {
      recParams.set('seed_artists', artistId);
    }
    const recRes = await spotifyFetch(`/recommendations?${recParams.toString()}`);
    if (recRes && Array.isArray(recRes.tracks) && recRes.tracks.length > 0) {
      recRes.tracks.forEach(pushTrack);
    }
  }

  // 2. Fallback: Related Artists + Multi-Artist Top Tracks + Genre/Artist Radio Search
  if (collected.length < limit) {
    const pool = [];
    const primaryArtists = extraArtistIds.slice(0, 3);
    const [relRes, artRes, ...topResults] = await Promise.all([
      (artistId && /^[0-9A-Za-z]{22}$/.test(artistId)) ? spotifyFetch(`/artists/${artistId}/related-artists`).catch(() => null) : Promise.resolve(null),
      (artistId && /^[0-9A-Za-z]{22}$/.test(artistId)) ? spotifyFetch(`/artists/${artistId}`).catch(() => null) : Promise.resolve(null),
      ...primaryArtists.map(aid => spotifyFetch(`/artists/${aid}/top-tracks?market=from_token`).catch(() => null))
    ]);

    const relatedArtists = (relRes && Array.isArray(relRes.artists)) ? relRes.artists.slice(0, 4) : [];
    if (relatedArtists.length > 0) {
      const relTopResults = await Promise.all(
        relatedArtists.map(ra => spotifyFetch(`/artists/${ra.id}/top-tracks?market=from_token`).catch(() => null))
      );
      for (let round = 0; round < 3; round++) {
        relTopResults.forEach(r => {
          if (r && Array.isArray(r.tracks) && r.tracks[round]) {
            pool.push(r.tracks[round]);
          }
        });
      }
    }

    // Interleave top tracks from all featured artists on the seed track
    for (let round = 0; round < 4; round++) {
      topResults.forEach(r => {
        if (r && Array.isArray(r.tracks) && r.tracks[round]) {
          pool.push(r.tracks[round]);
        }
      });
    }

    // Apply collected pool before deciding if we need search expansion
    pool.sort(() => Math.random() - 0.5).forEach(pushTrack);

    // Search expansion by genre & artist names (works reliably on all Spotify apps + supports infinite offset)
    if (collected.length < limit) {
      const genres = (artRes && Array.isArray(artRes.genres)) ? artRes.genres : [];
      const artistNames = artistName
        ? artistName.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const searchQueries = [];
      if (genres[0]) searchQueries.push(genres[0]);
      if (genres[1]) searchQueries.push(genres[1]);
      if (artistNames[0]) searchQueries.push(artistNames[0]);
      if (artistNames[1]) searchQueries.push(artistNames[1]);
      if (searchQueries.length === 0 && seedTitle) searchQueries.push(seedTitle.replace(/\(.*\)|\[.*\]/g, '').trim());

      const searchResults = await Promise.all(
        searchQueries.slice(0, 3).map((q, idx) => {
          const offset = Math.floor(Math.random() * 3) * 10 + (idx * 5);
          return spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=20&offset=${offset}&market=from_token`).catch(() => null);
        })
      );

      const searchPool = [];
      searchResults.forEach(sr => {
        if (sr && sr.tracks && Array.isArray(sr.tracks.items)) {
          searchPool.push(...sr.tracks.items);
        }
      });
      searchPool.sort(() => Math.random() - 0.5).forEach(pushTrack);
    }
  }

  // 3. Last-resort fallback: Liked tracks
  if (collected.length < limit && typeof liveCatalog !== 'undefined' && Array.isArray(liveCatalog.likedTracks) && liveCatalog.likedTracks.length > 0) {
    const shuffledLiked = [...liveCatalog.likedTracks].sort(() => Math.random() - 0.5);
    shuffledLiked.forEach(pushTrack);
  }

  return collected.slice(0, limit);
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
  if (!seedTrack || !seedTrack.uri) return null;
  const cleanId = cleanTrackId(seedTrack.id || seedTrack.uri);
  const cmdSeq = lockUserPlaybackIntent('track_switch', {
    targetId: cleanId || seedTrack.uri,
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
  recordAutoplayHistory(cleanId || seedTrack.uri);

  if (bridge && bridge.notifyTrackLoading) {
    bridge.notifyTrackLoading('');
    state.pcmFlowing = false;
    state.currentTimeSec = 0;
  }

  const devQ = await getTargetDeviceQuery();
  if (cmdSeq !== playbackActionSeq) return null;

  // Start playback immediately AND fetch algorithm recommendations in parallel
  const playPromise = spotifyFetch(`/me/player/play${devQ}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [seedTrack.uri] })
  });
  const autoplayPromise = fetchSpotifyAutoplayTracks(seedTrack, 15);

  const [playRes, autoplayTracks] = await Promise.all([playPromise, autoplayPromise]);
  if (cmdSeq !== playbackActionSeq) return playRes;

  state.autoplayLoading = false;
  state.queueLoading = false;

  if (playRes && playRes.error) {
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
  if (currentQueue.length >= 8) return;

  const session = Array.isArray(state.autoplaySessionTracks) ? state.autoplaySessionTracks : [];
  const seed = session[session.length - 1] || currentQueue[currentQueue.length - 1] || {
    id: state.playingTrackId,
    uri: state.playingTrackUri,
    name: state.playingTrackTitle,
    artist: state.playingArtist,
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
      }
    }
  } finally {
    state.autoplayLoading = false;
  }
}
