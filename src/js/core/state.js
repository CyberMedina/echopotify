/* ==========================================================================
   CORE: Application State, SafeStorage, SVG Covers & Image Cache Engine
   ========================================================================== */
'use strict';

// --------------------------------------------------------------------------
// 1. SPOTIFY CREDENTIALS & AUTO-REFRESHING OAUTH2 PKCE ENGINE
// --------------------------------------------------------------------------
// Tokens are NOT stored in the source/APK. On the Echo Show they come from the
// native SharedPreferences (provisioned once via ADB); in a desktop browser the
// user can paste them in the profile modal.
const bridge = window.AndroidBridge || null;
const DEFAULT_CLIENT_ID = 'a5170a7428304034b906e71c4995e2a4';

// Safe storage polyfill for environments that restrict or disable localStorage (e.g. Alexa WebView, iframes)
const memStore = {};
const safeStorage = {
  getItem(k) {
    try {
      return (typeof window !== 'undefined' && window.localStorage) ? window.localStorage.getItem(k) : (memStore[k] || null);
    } catch (e) {
      return memStore[k] || null;
    }
  },
  setItem(k, v) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(k, v);
    } catch (e) {
      memStore[k] = String(v);
    }
  },
  removeItem(k) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(k);
    } catch (e) {
      delete memStore[k];
    }
  }
};

const spotifyAuth = {
  clientId: (bridge && bridge.getClientId) ? bridge.getClientId() : (safeStorage.getItem('sp_client_id') || DEFAULT_CLIENT_ID),
  accessToken: safeStorage.getItem('sp_access_token') || '',
  refreshToken: (bridge && bridge.getRefreshToken) ? bridge.getRefreshToken() : (safeStorage.getItem('sp_refresh_token') || ''),
  engineDeviceName: bridge ? bridge.getEngineDeviceName() : null,
  engineDeviceId: null,
  activeDeviceId: null,
  availableDevices: [],
  lastTrackId: null,
  isLiked: false,
  shuffleState: false,
  repeatState: 'off'
};

if (spotifyAuth.clientId) safeStorage.setItem('sp_client_id', spotifyAuth.clientId);

// Live Spotify Data Containers (Zero Mocks — 100% Real Spotify API)
const liveCatalog = {
  entities: {},
  playlists: [],
  albums: [],
  artists: [],
  likedTracks: [],
  likedTrackIds: new Set(),
  likedTotal: 0,
  recentSearches: [],
  libraryFilter: 'all',
  sortAlphabetical: false
};

const state = {
  activeScreen: 'home',
  navStack: [{ screen: 'home' }],
  selectedEntityId: null,
  selectedArtistId: null,
  artistShowingAllTracks: false,
  isNowPlayingOpen: false,
  isSwipingNowPlaying: false,
  playingTrackId: null,
  playingTrackUri: null,
  playingAlbumId: null,
  playingTrackTitle: '',
  playingArtist: '',
  playingArtists: [],
  playingArtistId: null,
  playingAlbumTitle: '',
  playingCover: '',
  isPlaying: false,
  durationSec: 0,
  currentTimeSec: 0,
  activeLineIndex: -1,
  activeLyrics: [],
  hasValidLyrics: false,
  userPrefersLyrics: true,
  userForcedCentered: false,
  nowPlayingMode: 'lyrics',
  queueExpanded: false,
  singleTrackPlayback: false,
  contextUpcomingTracks: [],
  liveQueueTracks: [],
  discoveryTracks: [],
  startupPlaybackChecked: false,
  devModeEnabled: safeStorage.getItem('sp_dev_mode') === 'true'
};

// Official Spotify Liked Songs Vector Heart Cover (Purple/Blue Radiant Gradient + White Heart)
const LIKED_SONGS_COVER = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
    <defs>
      <linearGradient id="likedGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#450af5" />
        <stop offset="55%" stop-color="#644bf3" />
        <stop offset="100%" stop-color="#8e8ee5" />
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="44" fill="url(#likedGrad)" />
    <g transform="translate(166, 172) scale(7.5)">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#ffffff" />
    </g>
  </svg>`
);

// Official Spotify Default Music Note Vector Cover (Charcoal Gradient + Spotify Note Icon)
const DEFAULT_SPOTIFY_COVER = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512">
    <defs>
      <linearGradient id="spDefaultGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#2a2a2a" />
        <stop offset="100%" stop-color="#181818" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" fill="url(#spDefaultGrad)" />
    <g transform="translate(16, 16) scale(1.3333)">
      <path d="M6 3h15v15.167a3.5 3.5 0 1 1-3.5-3.5H19V5H8v13.167a3.5 3.5 0 1 1-3.5-3.5H6V3zm0 13.667H4.5a1.5 1.5 0 1 0 1.5 1.5v-1.5zm13 0h-1.5a1.5 1.5 0 1 0 1.5 1.5v-1.5z" fill="#888888" />
    </g>
  </svg>`
);
const DEFAULT_PLAYLIST_COVER = DEFAULT_SPOTIFY_COVER;
const DEFAULT_ALBUM_COVER = DEFAULT_SPOTIFY_COVER;

// Normaliza identificadores de tracks eliminando prefijos de URI de Spotify
function cleanTrackId(id) {
  if (!id) return '';
  return String(id).replace(/^spotify:track:/, '').trim();
}

// Convierte cualquier URL de portada de Spotify (64x64 o 300x300) a su versión canónica HD 640x640
function ensureHighResSpotifyCover(url) {
  if (!url || typeof url !== 'string') return '';
  return url.replace(/ab67616d0000(4851|1e02)/g, 'ab67616d0000b273');
}

// Resolution-optimized image picker for Spotify Echo Show 8
// - 'small': 64x64px (thumbnails / list rows / queue / artist tracks / search chips)
// - 'medium': 300x300px (Home grid 5-col, Library 6-col, Artist albums — fast & crisp)
// - 'large': 640x640px (Now Playing full-screen / Album & Artist hero only)
function getSpotifyImage(images, size = 'medium') {
  if (!images || !Array.isArray(images) || images.length === 0) return '';
  if (size === 'small') {
    const smallCandidate = images.find(img => img && ((img.width && img.width <= 120) || img.size === 'SMALL')) || images[images.length - 1] || images[0];
    return (smallCandidate && smallCandidate.url) ? smallCandidate.url : '';
  }
  if (size === 'medium') {
    const medCandidate = images.find(img => img && ((img.width && img.width >= 160 && img.width <= 360) || img.size === 'UNKNOWN')) || images[1] || images[0];
    return (medCandidate && medCandidate.url) ? medCandidate.url : '';
  }
  // 'large': el Web Playback SDK ordena images distinto a la API REST (en el SDK images[0] suele ser 64x64 o 300x300 y images[2] es 640x640 LARGE)
  let bestLarge = images.find(img => img && ((img.width && img.width >= 500) || img.size === 'LARGE'));
  if (!bestLarge) {
    bestLarge = images.reduce((best, cur) => {
      if (!cur || !cur.url) return best;
      if (!best) return cur;
      return ((cur.width || 0) > (best.width || 0)) ? cur : best;
    }, null) || images[0];
  }
  const rawUrl = (bestLarge && bestLarge.url) ? bestLarge.url : '';
  return ensureHighResSpotifyCover(rawUrl);
}

// ==========================================================================
// ZERO-PRINT GPU IMAGE DECODER & BACKGROUND PRE-WARMER ENGINE
// Prevents progressive top-to-bottom JPEG scanline "printing" on all screens
// ==========================================================================
const decodedImageUrls = new Set();
const inFlightDecodes = new Map();

function decodeImageInBackground(url) {
  if (!url || typeof url !== 'string' || url.startsWith('data:')) {
    return Promise.resolve(true);
  }
  if (decodedImageUrls.has(url)) {
    return Promise.resolve(true);
  }
  if (inFlightDecodes.has(url)) {
    return inFlightDecodes.get(url);
  }
  const p = new Promise(resolve => {
    const img = new Image();
    if (!url.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.decoding = 'async';
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      inFlightDecodes.delete(url);
      if (ok) decodedImageUrls.add(url);
      resolve(ok);
    };
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(() => done(true)).catch(() => done(true));
      } else {
        done(true);
      }
    };
    img.onerror = () => done(false);
    img.src = url;
    if (img.complete && img.naturalWidth > 0) {
      done(true);
    } else if (typeof img.decode === 'function') {
      img.decode().then(() => done(true)).catch(() => {});
    }
  });
  inFlightDecodes.set(url, p);
  return p;
}

function renderOptImg(src, alt = '', className = '', extraAttrs = '') {
  const safeSrc = src || DEFAULT_ALBUM_COVER;
  const safeAlt = String(alt || '').replace(/"/g, '&quot;');
  const isAlreadyDecoded = safeSrc.startsWith('data:') || decodedImageUrls.has(safeSrc);
  const stateCls = isAlreadyDecoded ? 'img-cached' : '';
  const corsAttr = safeSrc.startsWith('data:') ? '' : 'crossorigin="anonymous"';
  return `<img src="${safeSrc}" alt="${safeAlt}" class="${className} ${stateCls}" ${corsAttr} data-opt-img="1" decoding="async" ${extraAttrs} />`;
}

function hydrateImages(container = document) {
  if (!container || !container.querySelectorAll) return;
  const imgs = container.querySelectorAll('img[data-opt-img]:not(.img-ready):not(.img-cached)');
  imgs.forEach(img => {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:') || decodedImageUrls.has(src) || (img.complete && img.naturalWidth > 0)) {
      if (src && !src.startsWith('data:')) decodedImageUrls.add(src);
      img.classList.add('img-cached');
      return;
    }
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      if (img.src) decodedImageUrls.add(img.src);
      img.classList.add('img-ready');
    };
    if (typeof img.decode === 'function') {
      img.decode().then(reveal).catch(() => {
        if (img.complete && img.naturalWidth > 0) reveal();
      });
    }
    img.addEventListener('load', () => {
      if (typeof img.decode === 'function') {
        img.decode().then(reveal).catch(reveal);
      } else {
        reveal();
      }
    }, { once: true });
    img.addEventListener('error', () => {
      if (img.src !== DEFAULT_ALBUM_COVER) {
        img.src = DEFAULT_ALBUM_COVER;
      }
      reveal();
    }, { once: true });
  });
}

// Atomically swaps Hero / Player covers without ever showing half-printed JPEG scanlines.
// Displays an already-cached preview (small/medium) in 0ms while decoding the high-res 640x640 image offscreen.
function swapHeroImageAtomically(imgEl, targetUrl, previewUrl = '') {
  if (!imgEl || !targetUrl) return;
  imgEl.dataset.targetSrc = targetUrl;

  if (targetUrl.startsWith('data:') || decodedImageUrls.has(targetUrl)) {
    if (imgEl.getAttribute('src') !== targetUrl) {
      imgEl.src = targetUrl;
    }
    imgEl.style.opacity = '1';
    return;
  }

  // If a lower-res preview (e.g. 300x300 card cover or 64x64 thumb) is already in GPU cache, show it immediately!
  if (previewUrl && previewUrl !== targetUrl && (previewUrl.startsWith('data:') || decodedImageUrls.has(previewUrl))) {
    if (imgEl.getAttribute('src') !== previewUrl) {
      imgEl.src = previewUrl;
    }
    imgEl.style.opacity = '1';
  } else {
    imgEl.style.transition = 'opacity 0.2s ease';
    imgEl.style.opacity = '0';
  }

  decodeImageInBackground(targetUrl).then(() => {
    if (imgEl.dataset.targetSrc === targetUrl) {
      imgEl.src = targetUrl;
      imgEl.style.opacity = '1';
    }
  });
}

// Non-blocking background pre-warmer for offscreen views (Library, Search, Queue)
const prewarmQueue = [];
let isPrewarming = false;

function processPrewarmQueue() {
  if (prewarmQueue.length === 0) {
    isPrewarming = false;
    return;
  }
  isPrewarming = true;
  const batch = prewarmQueue.splice(0, 4);
  Promise.all(batch.map(u => decodeImageInBackground(u))).finally(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(processPrewarmQueue, { timeout: 400 });
    } else {
      setTimeout(processPrewarmQueue, 45);
    }
  });
}

function prewarmImageUrls(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return;
  urls.forEach(u => {
    if (u && typeof u === 'string' && !u.startsWith('data:') && !decodedImageUrls.has(u) && !prewarmQueue.includes(u)) {
      prewarmQueue.push(u);
    }
  });
  if (!isPrewarming && prewarmQueue.length > 0) {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(processPrewarmQueue, { timeout: 300 });
    } else {
      setTimeout(processPrewarmQueue, 50);
    }
  }
}

// Persistent Instant-Load Cache for Home & Last Track (Stale-While-Revalidate)
const HOME_CACHE_KEY = 'sp_home_cache_v7';
const LEGACY_HOME_CACHE_KEY = 'sp_home_cache_v6';

function renderUserProfile(profile) {
  if (!profile) return;
  if (profile.avatar) {
    document.querySelectorAll('.profile-btn').forEach(btn => {
      if (btn.dataset.renderedAvatar === profile.avatar) return;
      btn.dataset.renderedAvatar = profile.avatar;
      btn.innerHTML = renderOptImg(profile.avatar, profile.name || 'User', '', 'style="width:100%;height:100%;border-radius:50%;object-fit:cover;"');
      hydrateImages(btn);
    });
    const modalAvatar = document.getElementById('modalUserAvatar');
    if (modalAvatar) swapHeroImageAtomically(modalAvatar, profile.avatar);
  }
  const modalName = document.getElementById('modalUserName');
  if (modalName && profile.name) {
    modalName.textContent = profile.name;
  }
  const modalProduct = document.getElementById('modalUserProduct');
  if (modalProduct) {
    const plan = profile.product ? (profile.product.charAt(0).toUpperCase() + profile.product.slice(1)) : 'Premium';
    modalProduct.textContent = `Spotify ${plan} • Conectado`;
  }
}

function saveHomeCache(data) {
  try {
    safeStorage.setItem(HOME_CACHE_KEY, JSON.stringify({
      jumpCards: data.jumpCards || [],
      recentCards: data.recentCards || [],
      banners: data.banners || [],
      topArtists: data.topArtists || [],
      savedAlbums: data.savedAlbums || [],
      lastTrack: data.lastTrack || null,
      entities: data.entities || {},
      userProfile: data.userProfile || null,
      savedAt: Date.now()
    }));
  } catch (e) {
    console.warn('[Cache] Could not save home cache', e);
  }
}

function loadHomeCache() {
  try {
    const raw = safeStorage.getItem(HOME_CACHE_KEY) || safeStorage.getItem(LEGACY_HOME_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// --------------------------------------------------------------------------
// ON-SCREEN DIAGNOSTIC LOGGER FOR ECHO SHOW (SILK BROWSER)
// --------------------------------------------------------------------------
const uiLogEntries = [];
window._echoLogs = uiLogEntries;
window._echoLogsPaused = false;
const bootTimeMs = performance.now();
let uiLogRenderTimer = null;

function uiLog(tag, msg) {
  if (!state.devModeEnabled || window._echoLogsPaused) return;
  const elapsed = ((performance.now() - bootTimeMs) / 1000).toFixed(2);
  const entry = { time: `${elapsed}s`, tag, msg };
  uiLogEntries.push(entry);
  if (uiLogEntries.length > 60) uiLogEntries.shift();

  const panelEl = document.getElementById('debugLogPanel');
  if (panelEl && panelEl.classList.contains('open') && !uiLogRenderTimer) {
    uiLogRenderTimer = setTimeout(() => {
      uiLogRenderTimer = null;
      renderDebugLogEntries();
    }, 120);
  }
}

function renderDebugLogEntries() {
  const bodyEl = document.getElementById('debugLogBody');
  if (!bodyEl) return;
  bodyEl.innerHTML = uiLogEntries.map(e => {
    let color = '#94a3b8';
    if (e.tag === 'TINT') color = '#38bdf8';
    else if (e.tag === 'NAV') color = '#4ade80';
    else if (e.tag === 'TOUCH') color = '#facc15';
    else if (e.tag === 'ERR') color = '#f87171';
    else if (e.tag === 'FS') color = '#c084fc';
    return `<div class="dbg-row"><span class="dbg-ts">${e.time}</span> <span class="dbg-tag" style="color:${color}">[${e.tag}]</span> <span class="dbg-msg">${e.msg}</span></div>`;
  }).join('');
  bodyEl.scrollTop = bodyEl.scrollHeight;
}


