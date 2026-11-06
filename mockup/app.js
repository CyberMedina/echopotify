/* ==========================================================================
   Spotify Echo Show 8 (1st Gen) — Apple Music Edition
   Full Production Controller: Live Spotify Premium API + LRCLIB Synced Lyrics
   ========================================================================== */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // 1. SPOTIFY CREDENTIALS & AUTO-REFRESHING OAUTH2 PKCE ENGINE
  // --------------------------------------------------------------------------
  // Tokens are NOT stored in the source/APK. On the Echo Show they come from the
  // native SharedPreferences (provisioned once via ADB); in a desktop browser the
  // user can paste them in the profile modal.
  const bridge = window.AndroidBridge || null;
  const DEFAULT_CLIENT_ID = 'a5170a7428304034b906e71c4995e2a4';

  const spotifyAuth = {
    clientId: (bridge && bridge.getClientId) ? bridge.getClientId() : (localStorage.getItem('sp_client_id') || DEFAULT_CLIENT_ID),
    accessToken: localStorage.getItem('sp_access_token') || '',
    refreshToken: (bridge && bridge.getRefreshToken) ? bridge.getRefreshToken() : (localStorage.getItem('sp_refresh_token') || ''),
    engineDeviceName: bridge ? bridge.getEngineDeviceName() : null,
    engineDeviceId: null,
    activeDeviceId: null,
    availableDevices: [],
    lastTrackId: null,
    isLiked: false,
    shuffleState: false,
    repeatState: 'off'
  };

  if (spotifyAuth.clientId) localStorage.setItem('sp_client_id', spotifyAuth.clientId);

  // Fallback Demo Catalog (used before network finishes or if offline)
  const ALBUMS = {
    deeper_well: {
      id: 'deeper_well',
      title: 'Deeper Well',
      artist: 'Kacey Musgraves',
      meta: 'Folk / Country • 2024',
      cover: 'assets/deeper_well.jpg',
      ambientLight: { sky: '#b5c8a8', warm: '#e5ddcb', cream: '#ece5d5', accent: '#c8d6bc' },
      ambientDark: { c1: '#3b581b', c2: '#24380f', c3: '#5b3a18', c4: '#1d2e0b' },
      tracks: [
        { num: 1, title: 'Cardinal', duration: 190, popular: false },
        { num: 2, title: 'Deeper Well', duration: 232, popular: true },
        { num: 3, title: 'Too Good to Be True', duration: 162, popular: false },
        { num: 4, title: 'Moving Out', duration: 197, popular: false },
        { num: 5, title: 'Giver / Taker', duration: 191, popular: false },
        { num: 6, title: 'Sway', duration: 205, popular: false },
        { num: 7, title: 'Dinner with Friends', duration: 214, popular: false }
      ],
      lyrics: [
        { start: 0, end: 12, text: "My Saturn has returned" },
        { start: 12, end: 23, text: "When I turned twenty-seven, everything started to change" },
        { start: 23, end: 29, text: "Took a long time, but I learned" },
        { start: 29, end: 35, text: "There's two kinds of people" },
        { start: 35, end: 43, text: "One is a giver, and one's always trying to take" },
        { start: 43, end: 49, text: "All they can take" },
        { start: 49, end: 56, text: "So I'm saying goodbye" },
        { start: 56, end: 64, text: "To the people that I feel are real good" },
        { start: 64, end: 72, text: "At wasting my time" },
        { start: 72, end: 82, text: "No regrets, baby, I just think that maybe" },
        { start: 82, end: 95, text: "You go your way and I'll go mine" }
      ]
    },
    lahai: {
      id: 'lahai',
      title: 'Lahai',
      artist: 'Sampha',
      meta: 'Electronic • 2023',
      cover: 'assets/lahai.jpg',
      ambientLight: { sky: '#9db7c8', warm: '#e8decb', cream: '#efe6d8', accent: '#c5d1d8' },
      ambientDark: { c1: '#284b63', c2: '#1b3244', c3: '#634b30', c4: '#12222e' },
      tracks: [
        { num: 1, title: "Stereo Colour Cloud (Shaman's Dream)", duration: 178, popular: false },
        { num: 2, title: 'Spirit 2.0', duration: 289, popular: true },
        { num: 3, title: 'Dancing Circles', duration: 232, popular: false },
        { num: 4, title: 'Suspended', duration: 185, popular: false },
        { num: 5, title: 'Satellite Business', duration: 222, popular: false },
        { num: 6, title: 'Evidence', duration: 246, popular: false },
        { num: 7, title: 'In Two Minds', duration: 254, popular: false }
      ],
      lyrics: [
        { start: 0, end: 6, text: "Breaking through the stereo cloud" },
        { start: 6, end: 12, text: "Signal floating where the tide is high" },
        { start: 12, end: 18, text: "Hold my spirit in the morning light," },
        { start: 18, end: 25, text: "Satellite business in an open sky" }
      ]
    },
    bb_uvst2: {
      id: 'bb_uvst2',
      title: 'Un Verano Sin Ti',
      artist: 'Bad Bunny',
      meta: 'Reggaeton / Urbano • 2022',
      cover: 'assets/album_bb_uvst2.jpg',
      tracks: [
        { num: 1, title: 'Moscow Mule', duration: 245, popular: true },
        { num: 2, title: 'Después de la Playa', duration: 230, popular: false },
        { num: 3, title: 'Me Porto Bonito', duration: 178, popular: true },
        { num: 4, title: 'Tití Me Preguntó', duration: 243, popular: true },
        { num: 5, title: 'Un Ratito', duration: 176, popular: false },
        { num: 6, title: 'Yo No Soy Celoso', duration: 230, popular: false },
        { num: 7, title: 'Tarot', duration: 218, popular: false },
        { num: 8, title: 'Neverita', duration: 222, popular: false },
        { num: 9, title: 'La Corriente', duration: 198, popular: false },
        { num: 10, title: 'Efecto', duration: 213, popular: true }
      ]
    },
    bb_yhlqmdlg: {
      id: 'bb_yhlqmdlg',
      title: 'YHLQMDLG',
      artist: 'Bad Bunny',
      meta: 'Trap latino • 2020',
      cover: 'assets/album_bb_yhlqmdlg.jpg',
      tracks: [
        { num: 1, title: 'Si Veo a Tu Mamá', duration: 170, popular: true },
        { num: 2, title: 'La Difícil', duration: 163, popular: false },
        { num: 3, title: 'Pero Ya No', duration: 160, popular: false },
        { num: 4, title: 'La Santa', duration: 206, popular: true },
        { num: 5, title: 'Yo Perreo Sola', duration: 172, popular: true },
        { num: 6, title: 'Bichiyal', duration: 196, popular: false },
        { num: 7, title: 'Safaera', duration: 295, popular: true }
      ]
    },
    bb_eutdm: {
      id: 'bb_eutdm',
      title: 'El Último Tour Del Mundo',
      artist: 'Bad Bunny',
      meta: 'Alternativo / Trap • 2020',
      cover: 'assets/album_bb_eutdm.jpg',
      tracks: [
        { num: 1, title: 'El Mundo es Mío', duration: 165, popular: false },
        { num: 2, title: 'Te Mudaste', duration: 130, popular: true },
        { num: 3, title: 'Hoy Cobré', duration: 162, popular: false },
        { num: 4, title: 'Maldita Pobreza', duration: 213, popular: false },
        { num: 5, title: 'La Noche de Anoche', duration: 203, popular: true },
        { num: 6, title: 'Dákiti', duration: 205, popular: true }
      ]
    },
    bb_uvst1: {
      id: 'bb_uvst1',
      title: 'nadie sabe lo que va a pasar mañana',
      artist: 'Bad Bunny',
      meta: 'Trap latino • 2023',
      cover: 'assets/album_bb_uvst1.jpg',
      tracks: [
        { num: 1, title: 'DtMF', duration: 232, popular: true },
        { num: 2, title: 'BAILE INoLVIDABLE', duration: 253, popular: true },
        { num: 3, title: 'EoO', duration: 228, popular: true },
        { num: 4, title: 'NUEVAYoL', duration: 264, popular: true }
      ]
    }
  };

  // Demo Fallback Artists
  const DEMO_ARTISTS = {
    bad_bunny: {
      id: 'bad_bunny',
      spotifyId: '4q3ewBCX7sLwd24euqV69X',
      uri: 'spotify:artist:4q3ewBCX7sLwd24euqV69X',
      title: 'Bad Bunny',
      name: 'Bad Bunny',
      type: 'artist',
      verified: true,
      listeners: '64.9 M oyentes mensuales',
      listenersFull: '64,923,412',
      followers: 'Más de 90.5 M seguidores en Spotify',
      cover: 'assets/avatar_badbunny.jpg',
      bio: 'Bad Bunny (Benito Antonio Martínez Ocasio) es un cantante, rapero y compositor puertorriqueño de renombre internacional. Es uno de los artistas latinos más escuchados de la historia en Spotify y pionero global del reggaetón y trap latino contemporáneos.',
      genres: ['Reggaeton', 'Trap latino', 'Urbano latino', 'Latin pop'],
      tracks: [
        { num: 1, title: 'DtMF', artist: 'Bad Bunny', album: 'nadie sabe lo que va a pasar mañana', cover: 'assets/album_bb_uvst1.jpg', duration: 232, explicit: true, uri: 'spotify:track:4q3ewBCX7sLwd24euqV69X_1' },
        { num: 2, title: 'BAILE INoLVIDABLE', artist: 'Bad Bunny', album: 'nadie sabe lo que va a pasar mañana', cover: 'assets/album_bb_uvst1.jpg', duration: 253, explicit: true, uri: 'spotify:track:4q3ewBCX7sLwd24euqV69X_2' },
        { num: 3, title: 'EoO', artist: 'Bad Bunny', album: 'nadie sabe lo que va a pasar mañana', cover: 'assets/album_bb_uvst1.jpg', duration: 228, explicit: true, uri: 'spotify:track:4q3ewBCX7sLwd24euqV69X_3' },
        { num: 4, title: 'NUEVAYoL', artist: 'Bad Bunny', album: 'nadie sabe lo que va a pasar mañana', cover: 'assets/album_bb_uvst1.jpg', duration: 264, explicit: true, uri: 'spotify:track:4q3ewBCX7sLwd24euqV69X_4' },
        { num: 5, title: 'Titi Me Preguntó', artist: 'Bad Bunny', album: 'Un Verano Sin Ti', cover: 'assets/album_bb_uvst2.jpg', duration: 243, explicit: false, uri: 'spotify:track:4q3ewBCX7sLwd24euqV69X_5' },
        { num: 6, title: 'Me Porto Bonito', artist: 'Bad Bunny, Chencho Corleone', album: 'Un Verano Sin Ti', cover: 'assets/album_bb_uvst2.jpg', duration: 178, explicit: true, uri: 'spotify:track:4q3ewBCX7sLwd24euqV69X_6' },
        { num: 7, title: 'Ojitos Lindos', artist: 'Bad Bunny, Bomba Estéreo', album: 'Un Verano Sin Ti', cover: 'assets/album_bb_uvst2.jpg', duration: 258, explicit: false, uri: 'spotify:track:4q3ewBCX7sLwd24euqV69X_7' },
        { num: 8, title: 'DÁKITI', artist: 'Bad Bunny, Jhayco', album: 'El Último Tour Del Mundo', cover: 'assets/album_bb_eutdm.jpg', duration: 205, explicit: true, uri: 'spotify:track:4q3ewBCX7sLwd24euqV69X_8' },
        { num: 9, title: 'Safaera', artist: 'Bad Bunny, Jowell & Randy, Ñengo Flow', album: 'YHLQMDLG', cover: 'assets/album_bb_yhlqmdlg.jpg', duration: 295, explicit: true, uri: 'spotify:track:4q3ewBCX7sLwd24euqV69X_9' },
        { num: 10, title: 'Yo Perreo Sola', artist: 'Bad Bunny', album: 'YHLQMDLG', cover: 'assets/album_bb_yhlqmdlg.jpg', duration: 172, explicit: false, uri: 'spotify:track:4q3ewBCX7sLwd24euqV69X_10' }
      ],
      albums: [
        { id: 'bb_uvst1', title: 'nadie sabe lo que va a pasar', year: '2023', cover: 'assets/album_bb_uvst1.jpg', uri: 'spotify:album:bb1' },
        { id: 'bb_uvst2', title: 'Un Verano Sin Ti', year: '2022', cover: 'assets/album_bb_uvst2.jpg', uri: 'spotify:album:bb2' },
        { id: 'bb_yhlqmdlg', title: 'YHLQMDLG', year: '2020', cover: 'assets/album_bb_yhlqmdlg.jpg', uri: 'spotify:album:bb3' },
        { id: 'bb_eutdm', title: 'El Último Tour Del Mundo', year: '2020', cover: 'assets/album_bb_eutdm.jpg', uri: 'spotify:album:bb4' }
      ]
    }
  };

  // Live Spotify Data Containers
  const liveCatalog = {
    entities: {
      bad_bunny: DEMO_ARTISTS.bad_bunny,
      art_bad_bunny: DEMO_ARTISTS.bad_bunny
    }, // id -> { id, type, uri, title, artist, meta, cover, tracks: [...] }
    playlists: [],
    albums: [],
    artists: [
      DEMO_ARTISTS.bad_bunny
    ],
    likedTracks: [],
    likedTrackIds: new Set(),
    likedTotal: 614,
    recentSearches: [
      { label: 'Bad Bunny', avatar: 'assets/avatar_badbunny.jpg', square: false, entityId: 'bad_bunny' },
      { label: 'Frank Ocean', avatar: 'assets/avatar_frank.jpg', square: false, query: 'Frank Ocean' },
      { label: 'SZA', avatar: 'assets/avatar_sza.jpg', square: false, query: 'SZA' },
      { label: 'Tyler, The Creator', avatar: 'assets/avatar_tyler.jpg', square: false, query: 'Tyler, The Creator' },
      { label: 'Sampha', avatar: 'assets/avatar_sampha.jpg', square: false, query: 'Sampha' },
      { label: 'Kendrick Lamar', avatar: 'assets/avatar_kendrick.jpg', square: false, query: 'Kendrick Lamar' },
      { label: 'blond', avatar: 'assets/blonde.jpg', square: true, query: 'Blonde Frank Ocean' }
    ],
    libraryFilter: 'all',
    sortAlphabetical: false
  };

  const state = {
    activeScreen: 'home',
    previousScreen: 'home',
    selectedEntityId: 'lahai',
    selectedArtistId: 'bad_bunny',
    artistShowingAllTracks: false,
    playingTrackId: null,
    playingTrackUri: null,
    playingAlbumId: null,
    playingTrackTitle: '',
    playingArtist: '',
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
    discoveryTracks: []
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

  // Resolution-optimized image picker for Spotify Echo Show 8
  // - 'small': 64x64px (thumbnails / list rows)
  // - 'medium': 300x300px (Home grid 5-col, Library 6-col, Search chips — fast & crisp)
  // - 'large': 640x640px (Now Playing full-screen / Album hero only)
  function getSpotifyImage(images, size = 'medium') {
    if (!images || !Array.isArray(images) || images.length === 0) return '';
    if (size === 'small') return (images[2] || images[1] || images[0]).url;
    if (size === 'medium') return (images[1] || images[0]).url;
    return images[0].url;
  }

  // Persistent Instant-Load Cache for Home & Last Track (Stale-While-Revalidate)
  const HOME_CACHE_KEY = 'sp_home_cache_v5';

  function renderUserProfile(profile) {
    if (!profile || !profile.avatar) return;
    document.querySelectorAll('.profile-btn').forEach(btn => {
      if (btn.dataset.renderedAvatar === profile.avatar) return;
      btn.dataset.renderedAvatar = profile.avatar;
      btn.innerHTML = `<img src="${profile.avatar}" alt="${profile.name || 'User'}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" decoding="async" />`;
    });
  }

  function saveHomeCache(data) {
    try {
      localStorage.setItem(HOME_CACHE_KEY, JSON.stringify({
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
      const raw = localStorage.getItem(HOME_CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // 2. DOM REFERENCES
  // --------------------------------------------------------------------------
  const root = document.documentElement;

  function applyNeutralLikedTheme() {
    document.body.classList.remove('album-dark-active', 'album-light-active');
    const isDark = document.body.classList.contains('theme-dark');
    if (isDark) {
      root.style.setProperty('--album-fg-primary', '#ffffff');
      root.style.setProperty('--album-fg-secondary', 'rgba(255, 255, 255, 0.72)');
      root.style.setProperty('--album-fg-muted', 'rgba(255, 255, 255, 0.48)');
      root.style.setProperty('--album-hairline', 'rgba(255, 255, 255, 0.10)');
      root.style.setProperty('--album-play-bg', '#1db954');
      root.style.setProperty('--album-play-fg', '#ffffff');
      root.style.setProperty('--album-circle-bg', 'rgba(255, 255, 255, 0.14)');
      root.style.setProperty('--album-circle-fg', '#ffffff');
      root.style.setProperty('--album-row-hover', 'rgba(255, 255, 255, 0.08)');
      root.style.setProperty('--album-row-active', 'rgba(255, 255, 255, 0.15)');
      root.style.setProperty('--album-cover-shadow', 'rgba(69, 10, 245, 0.35)');
    } else {
      root.style.setProperty('--album-fg-primary', '#111214');
      root.style.setProperty('--album-fg-secondary', 'rgba(17, 18, 20, 0.70)');
      root.style.setProperty('--album-fg-muted', 'rgba(17, 18, 20, 0.50)');
      root.style.setProperty('--album-hairline', 'rgba(17, 18, 20, 0.10)');
      root.style.setProperty('--album-play-bg', '#1db954');
      root.style.setProperty('--album-play-fg', '#ffffff');
      root.style.setProperty('--album-circle-bg', 'rgba(17, 18, 20, 0.08)');
      root.style.setProperty('--album-circle-fg', '#111214');
      root.style.setProperty('--album-row-hover', 'rgba(17, 18, 20, 0.05)');
      root.style.setProperty('--album-row-active', 'rgba(17, 18, 20, 0.10)');
      root.style.setProperty('--album-cover-shadow', 'rgba(69, 10, 245, 0.22)');
    }
  }
  const echoViewport = document.getElementById('echoViewport');
  const nowPlayingOverlay = document.getElementById('nowPlayingOverlay');
  const miniPlayer = document.getElementById('miniPlayer');
  const miniPlayerThumb = document.getElementById('miniPlayerThumb');
  const miniPlayerTitle = document.getElementById('miniPlayerTitle');
  const miniPlayerArtist = document.getElementById('miniPlayerArtist');
  const miniPlayPauseBtn = document.getElementById('miniPlayPauseBtn');
  const miniNextBtn = document.getElementById('miniNextBtn');
  const miniLikeBtn = document.getElementById('miniLikeBtn');

  const npCoverArt = document.getElementById('npCoverArt');
  const npTrackTitle = document.getElementById('npTrackTitle');
  const npTrackArtist = document.getElementById('npTrackArtist');
  const npScrubberTrack = document.getElementById('npScrubberTrack');
  const npScrubberFill = document.getElementById('npScrubberFill');
  const npScrubberThumb = document.getElementById('npScrubberThumb');
  const npTimeElapsed = document.getElementById('npTimeElapsed');
  const npTimeRemaining = document.getElementById('npTimeRemaining');
  const npPlayPauseBtn = document.getElementById('npPlayPauseBtn');
  const npPlayPauseSvg = document.getElementById('npPlayPauseSvg');
  const npPrevBtn = document.getElementById('npPrevBtn');
  const npNextBtn = document.getElementById('npNextBtn');
  const npCloseBtn = document.getElementById('npCloseBtn');
  const npFavBtn = document.getElementById('npFavBtn');
  const lyricsScrollTrack = document.getElementById('lyricsScrollTrack');
  const npRightLyrics = document.getElementById('npRightLyrics');
  const npRightQueue = document.getElementById('npRightQueue');
  const npToggleLyricsBtn = document.getElementById('npToggleLyricsBtn');
  const npToggleQueueBtn = document.getElementById('npToggleQueueBtn');
  const npLyricsBubbleBtn = document.getElementById('npLyricsBubbleBtn') || npToggleLyricsBtn;
  const npQueueHeading = document.getElementById('npQueueHeading');
  const npQueueSubheading = document.getElementById('npQueueSubheading');
  const npQueueSeeAllBtn = document.getElementById('npQueueSeeAllBtn');
  const npQueueSeeAllLabel = document.getElementById('npQueueSeeAllLabel');
  const npQueueCurrentCard = document.getElementById('npQueueCurrentCard');
  const npQueueCurrentThumb = document.getElementById('npQueueCurrentThumb');
  const npQueueCurrentTitle = document.getElementById('npQueueCurrentTitle');
  const npQueueCurrentArtist = document.getElementById('npQueueCurrentArtist');
  const npQueueEq = document.getElementById('npQueueEq');
  const npQueueListContainer = document.getElementById('npQueueListContainer');

  const spotifyModal = document.getElementById('spotifyModal');
  const spotifyClientIdInput = document.getElementById('spotifyClientIdInput');
  const spotifyTokenInput = document.getElementById('spotifyTokenInput');
  const spotifyStatusDot = document.getElementById('spotifyStatusDot');
  const spotifyStatusText = document.getElementById('spotifyStatusText');

  // --------------------------------------------------------------------------
  // SPOTIFY OAUTH 2.0 PKCE ENGINE (SECURE BROWSER LOGIN FOR GITHUB PAGES / SILK)
  // --------------------------------------------------------------------------
  const PKCE_VERIFIER_KEY = 'sp_pkce_code_verifier';

  function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return values.reduce((acc, x) => acc + possible[x % possible.length], '');
  }

  async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest('SHA-256', data);
  }

  function base64encode(input) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(input)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async function startSpotifyPKCELogin() {
    const clientId = spotifyAuth.clientId || DEFAULT_CLIENT_ID;
    const redirectUri = window.location.origin + window.location.pathname;

    const codeVerifier = generateRandomString(64);
    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64encode(hashed);

    localStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);

    const scopes = [
      'streaming',
      'user-read-email',
      'user-read-private',
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'user-read-recently-played',
      'user-top-read',
      'user-library-read',
      'user-library-modify',
      'playlist-read-private',
      'playlist-read-collaborative'
    ].join(' ');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: scopes,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      redirect_uri: redirectUri
    });

    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  async function checkPKCEAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');

    if (error) {
      console.error('[PKCE Auth Error]', error);
      alert('Error de autenticación con Spotify: ' + error);
      window.history.replaceState({}, document.title, window.location.pathname);
      return false;
    }

    if (!code) return false;

    const codeVerifier = localStorage.getItem(PKCE_VERIFIER_KEY);
    if (!codeVerifier) {
      console.warn('[PKCE] No code verifier found in localStorage');
      window.history.replaceState({}, document.title, window.location.pathname);
      return false;
    }

    const clientId = spotifyAuth.clientId || DEFAULT_CLIENT_ID;
    const redirectUri = window.location.origin + window.location.pathname;

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier
        })
      });

      localStorage.removeItem(PKCE_VERIFIER_KEY);
      window.history.replaceState({}, document.title, window.location.pathname);

      if (!response.ok) {
        console.error('[PKCE Token Exchange Failed]', response.status);
        return false;
      }

      const data = await response.json();
      if (data.access_token) {
        spotifyAuth.accessToken = data.access_token;
        localStorage.setItem('sp_access_token', data.access_token);
      }
      if (data.refresh_token) {
        spotifyAuth.refreshToken = data.refresh_token;
        localStorage.setItem('sp_refresh_token', data.refresh_token);
      }
      console.log('[PKCE] Autenticación completada con éxito!');
      return true;
    } catch (e) {
      console.error('[PKCE Token Exchange Exception]', e);
      window.history.replaceState({}, document.title, window.location.pathname);
      return false;
    }
  }

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
        localStorage.setItem('sp_access_token', data.access_token);
        spotifyTokenInput.value = data.access_token;
      }
      if (data.refresh_token) {
        spotifyAuth.refreshToken = data.refresh_token;
        localStorage.setItem('sp_refresh_token', data.refresh_token);
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

  window.onSpotifyWebPlaybackSDKReady = () => {
    console.log('[Spotify Web SDK] SDK listo, inicializando reproductor web...');
    if (!spotifyAuth.accessToken) return;
    initWebPlayer();
  };

  function initWebPlayer() {
    if (!window.Spotify || !spotifyAuth.accessToken || webPlayer) return;
    try {
      webPlayer = new window.Spotify.Player({
        name: 'Echo Show 8 (Silk Browser)',
        getOAuthToken: async cb => {
          if (spotifyAuth.refreshToken) await refreshSpotifyAccessToken();
          cb(spotifyAuth.accessToken);
        },
        volume: 0.85
      });

      webPlayer.addListener('ready', ({ device_id }) => {
        console.log('[Spotify Web SDK] Conectado exitosamente con Device ID:', device_id);
        webPlayerDeviceId = device_id;
        spotifyAuth.activeDeviceId = device_id;
        // Transferir reproducción automáticamente al navegador
        fetch('https://api.spotify.com/v1/me/player', {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${spotifyAuth.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ device_ids: [device_id], play: false })
        }).catch(e => console.warn('No se pudo transferir a webPlayer:', e));
      });

      webPlayer.addListener('not_ready', ({ device_id }) => {
        console.warn('[Spotify Web SDK] Device ID desconectado:', device_id);
        if (webPlayerDeviceId === device_id) webPlayerDeviceId = null;
      });

      webPlayer.addListener('player_state_changed', state => {
        if (!state) return;
        // Sincronizar estado cuando el Web Player cambie de track
        pollSpotifyCurrentPlayback();
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
    if (webPlayerDeviceId) {
      return `?device_id=${webPlayerDeviceId}`;
    }
    if (spotifyAuth.engineDeviceName) {
      const id = spotifyAuth.engineDeviceId || await findEngineDeviceId();
      if (id) return `?device_id=${id}`;
    }
    if (spotifyAuth.activeDeviceId) return `?device_id=${spotifyAuth.activeDeviceId}`;

    const devRes = await spotifyFetch('/me/player/devices');
    if (devRes && Array.isArray(devRes.devices) && devRes.devices.length > 0) {
      spotifyAuth.availableDevices = devRes.devices;
      const active = devRes.devices.find(d => d.is_active) || devRes.devices[0];
      if (active && active.id) {
        spotifyAuth.activeDeviceId = active.id;
        return `?device_id=${active.id}`;
      }
    }
    return '';
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
    state.singleTrackPlayback = false;
    state.contextUpcomingTracks = Array.isArray(upcomingSlice) ? upcomingSlice : [];
    if (bridge && bridge.notifyTrackLoading) {
      bridge.notifyTrackLoading('');
      state.pcmFlowing = false;
      state.currentTimeSec = 0;
    }
    const devQ = await getTargetDeviceQuery();
    const body = { context_uri: contextUri };
    if (offsetPosition > 0) {
      body.offset = { position: offsetPosition };
    }
    const playRes = await spotifyFetch(`/me/player/play${devQ}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
    setTimeout(pollSpotifyCurrentPlayback, 600);
    return playRes;
  }

  async function playSpotifyUris(urisArray, upcomingSlice = []) {
    state.singleTrackPlayback = Array.isArray(urisArray) && urisArray.length === 1;
    state.contextUpcomingTracks = Array.isArray(upcomingSlice) ? upcomingSlice : [];
    if (bridge && bridge.notifyTrackLoading) {
      bridge.notifyTrackLoading('');
      state.pcmFlowing = false;
      state.currentTimeSec = 0;
    }
    const devQ = await getTargetDeviceQuery();
    await spotifyFetch(`/me/player/play${devQ}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: urisArray })
    });
    setTimeout(pollSpotifyCurrentPlayback, 600);
  }

  // --------------------------------------------------------------------------
  // 4. DYNAMIC 16x16 CANVAS COLOR EXTRACTOR (LIGHT & APPLE MUSIC DARK PALETTE)
  // --------------------------------------------------------------------------
  function extractDynamicPaletteFromCover(imgUrl, applyToLightBg = false) {
    if (!imgUrl) return;
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = function () {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 16, 16);
        const d = ctx.getImageData(0, 0, 16, 16).data;

        function sampleArea(x0, y0, w, h) {
          let r = 0, g = 0, b = 0, count = 0;
          for (let y = y0; y < y0 + h; y++) {
            for (let x = x0; x < x0 + w; x++) {
              const i = (y * 16 + x) * 4;
              r += d[i];
              g += d[i + 1];
              b += d[i + 2];
              count++;
            }
          }
          return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
        }

        // Extract genuine 4-quadrant photo tint directly from the album artwork
        const q1 = sampleArea(1, 1, 6, 6);
        const q2 = sampleArea(8, 1, 6, 6);
        const q3 = sampleArea(1, 8, 6, 6);
        const q4 = sampleArea(8, 8, 6, 6);

        // Boost saturation & maintain luminous depth for Apple Music Liquid Lava Blobs
        function toLavaColor(rgb, scale, sat = 1.85) {
          const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
          let r = (avg + (rgb[0] - avg) * sat) * scale;
          let g = (avg + (rgb[1] - avg) * sat) * scale;
          let b = (avg + (rgb[2] - avg) * sat) * scale;
          // Prevent blobs from turning pitch-black so lava movement is always visible
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum < 34 && scale > 0.35) {
            const lift = 34 - lum;
            r += lift * 0.8;
            g += lift * 0.8;
            b += lift * 0.8;
          }
          r = Math.min(245, Math.max(14, Math.round(r)));
          g = Math.min(245, Math.max(14, Math.round(g)));
          b = Math.min(245, Math.max(14, Math.round(b)));
          return `rgb(${r}, ${g}, ${b})`;
        }

        // Authentic photo tint extraction with distinct luminous depths for fluid lava
        root.style.setProperty('--np-c1', toLavaColor(q1, 0.78, 1.95));
        root.style.setProperty('--np-c2', toLavaColor(q2, 0.56, 1.80));
        root.style.setProperty('--np-c3', toLavaColor(q3, 0.72, 1.90));
        root.style.setProperty('--np-c4', toLavaColor(q4, 0.30, 1.65));

        if (applyToLightBg) {
          // Check if current entity is liked_songs: keep neutral theme, do not tint
          if (state.selectedEntityId === 'liked_songs' || (liveCatalog.entities[state.selectedEntityId] && liveCatalog.entities[state.selectedEntityId].type === 'liked')) {
            applyNeutralLikedTheme();
            return;
          }

          // Apple Music Full-Bleed Album Immersion (exact match to SOS / GUTS / TLOP / Lust for Life)
          const quads = [q1, q2, q3, q4];
          quads.sort((a, b) => {
            const satA = Math.max(a[0], a[1], a[2]) - Math.min(a[0], a[1], a[2]);
            const satB = Math.max(b[0], b[1], b[2]) - Math.min(b[0], b[1], b[2]);
            return satB - satA;
          });
          const dom = quads[0];
          const sec = quads[1] || quads[0];
          const avgLum = (
            (0.299 * q1[0] + 0.587 * q1[1] + 0.114 * q1[2]) +
            (0.299 * q2[0] + 0.587 * q2[1] + 0.114 * q2[2]) +
            (0.299 * q3[0] + 0.587 * q3[1] + 0.114 * q3[2]) +
            (0.299 * q4[0] + 0.587 * q4[1] + 0.114 * q4[2])
          ) / 4;

          function saturateAndScale(rgb, satBoost, lumScale, minVal = 6, maxVal = 248) {
            const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
            const r = Math.min(maxVal, Math.max(minVal, Math.round((mean + (rgb[0] - mean) * satBoost) * lumScale)));
            const g = Math.min(maxVal, Math.max(minVal, Math.round((mean + (rgb[1] - mean) * satBoost) * lumScale)));
            const b = Math.min(maxVal, Math.max(minVal, Math.round((mean + (rgb[2] - mean) * satBoost) * lumScale)));
            return [r, g, b];
          }

          const isDarkTheme = document.body.classList.contains('theme-dark');

          if (isDarkTheme) {
            // Dark Mode Album Immersion: Dynamic rich deep saturated tint extracted from cover
            const topRgb = saturateAndScale(dom, 1.55, 0.42, 14, 120);
            const midRgb = saturateAndScale(dom, 1.40, 0.24, 10, 72);
            const botRgb = saturateAndScale(sec, 1.25, 0.13, 6, 38);

            root.style.setProperty('--album-bg-top', `rgb(${topRgb[0]}, ${topRgb[1]}, ${topRgb[2]})`);
            root.style.setProperty('--album-bg-mid', `rgb(${midRgb[0]}, ${midRgb[1]}, ${midRgb[2]})`);
            root.style.setProperty('--album-bg-bottom', `rgb(${botRgb[0]}, ${botRgb[1]}, ${botRgb[2]})`);

            root.style.setProperty('--album-fg-primary', '#ffffff');
            root.style.setProperty('--album-fg-secondary', 'rgba(255, 255, 255, 0.72)');
            root.style.setProperty('--album-fg-muted', 'rgba(255, 255, 255, 0.52)');
            root.style.setProperty('--album-hairline', 'rgba(255, 255, 255, 0.11)');
            root.style.setProperty('--album-play-bg', '#ffffff');
            root.style.setProperty('--album-play-fg', `rgb(${midRgb[0]}, ${midRgb[1]}, ${midRgb[2]})`);
            root.style.setProperty('--album-circle-bg', 'rgba(255, 255, 255, 0.16)');
            root.style.setProperty('--album-circle-fg', '#ffffff');
            root.style.setProperty('--album-row-hover', 'rgba(255, 255, 255, 0.09)');
            root.style.setProperty('--album-row-active', 'rgba(255, 255, 255, 0.16)');
            root.style.setProperty('--album-cover-shadow', 'rgba(0, 0, 0, 0.52)');

            if (state.activeScreen === 'album') {
              document.body.classList.add('album-dark-active');
              document.body.classList.remove('album-light-active');
            }
          } else {
            // Light Mode Immersion: Determine if cover is Dark/Deep vs Vivid/Light
            const isLightAlbum = avgLum >= 148;
            state.albumIsLight = isLightAlbum;

            if (!isLightAlbum) {
              const topRgb = saturateAndScale(dom, 1.55, 0.52, 10, 140);
              const midRgb = saturateAndScale(dom, 1.65, 0.38, 8, 110);
              const botRgb = saturateAndScale(sec, 1.50, 0.26, 6, 85);

              root.style.setProperty('--album-bg-top', `rgb(${topRgb[0]}, ${topRgb[1]}, ${topRgb[2]})`);
              root.style.setProperty('--album-bg-mid', `rgb(${midRgb[0]}, ${midRgb[1]}, ${midRgb[2]})`);
              root.style.setProperty('--album-bg-bottom', `rgb(${botRgb[0]}, ${botRgb[1]}, ${botRgb[2]})`);

              root.style.setProperty('--album-fg-primary', '#ffffff');
              root.style.setProperty('--album-fg-secondary', 'rgba(255, 255, 255, 0.72)');
              root.style.setProperty('--album-fg-muted', 'rgba(255, 255, 255, 0.52)');
              root.style.setProperty('--album-hairline', 'rgba(255, 255, 255, 0.11)');
              root.style.setProperty('--album-play-bg', '#ffffff');
              root.style.setProperty('--album-play-fg', `rgb(${midRgb[0]}, ${midRgb[1]}, ${midRgb[2]})`);
              root.style.setProperty('--album-circle-bg', 'rgba(255, 255, 255, 0.16)');
              root.style.setProperty('--album-circle-fg', '#ffffff');
              root.style.setProperty('--album-row-hover', 'rgba(255, 255, 255, 0.09)');
              root.style.setProperty('--album-row-active', 'rgba(255, 255, 255, 0.16)');
              root.style.setProperty('--album-cover-shadow', 'rgba(0, 0, 0, 0.48)');
            } else {
              const topRgb = saturateAndScale(dom, 1.35, 0.98, 60, 245);
              const midRgb = saturateAndScale(dom, 1.40, 0.92, 50, 238);
              const botRgb = saturateAndScale(sec, 1.30, 0.85, 45, 230);

              root.style.setProperty('--album-bg-top', `rgb(${topRgb[0]}, ${topRgb[1]}, ${topRgb[2]})`);
              root.style.setProperty('--album-bg-mid', `rgb(${midRgb[0]}, ${midRgb[1]}, ${midRgb[2]})`);
              root.style.setProperty('--album-bg-bottom', `rgb(${botRgb[0]}, ${botRgb[1]}, ${botRgb[2]})`);

              root.style.setProperty('--album-fg-primary', '#111214');
              root.style.setProperty('--album-fg-secondary', 'rgba(17, 18, 20, 0.70)');
              root.style.setProperty('--album-fg-muted', 'rgba(17, 18, 20, 0.52)');
              root.style.setProperty('--album-hairline', 'rgba(17, 18, 20, 0.10)');
              root.style.setProperty('--album-play-bg', '#111214');
              root.style.setProperty('--album-play-fg', `rgb(${topRgb[0]}, ${topRgb[1]}, ${topRgb[2]})`);
              root.style.setProperty('--album-circle-bg', 'rgba(17, 18, 20, 0.10)');
              root.style.setProperty('--album-circle-fg', '#111214');
              root.style.setProperty('--album-row-hover', 'rgba(17, 18, 20, 0.06)');
              root.style.setProperty('--album-row-active', 'rgba(17, 18, 20, 0.11)');
              root.style.setProperty('--album-cover-shadow', 'rgba(0, 0, 0, 0.24)');
            }

            if (state.activeScreen === 'album') {
              document.body.classList.toggle('album-dark-active', !isLightAlbum);
              document.body.classList.toggle('album-light-active', isLightAlbum);
            }
          }
        }
      } catch (e) { }
    };
    img.src = imgUrl;
  }

  // --------------------------------------------------------------------------
  // 5. LRCLIB SYNCED LYRICS ENGINE (APPLE MUSIC WORD-BY-WORD KARAOKE)
  // --------------------------------------------------------------------------
  function parseLrcToWordSync(lrcString, totalDuration) {
    const lines = lrcString.split('\n');
    const parsed = [];
    const timeRegex = /\[(\d+):(\d+(?:\.\d+)?)\](.*)/;

    lines.forEach(raw => {
      const m = raw.match(timeRegex);
      if (m) {
        const mins = parseInt(m[1], 10);
        const secs = parseFloat(m[2]);
        let text = m[3].trim();
        // Strip dual-language translation tags (e.g. "Original line ^ English translation")
        if (text.includes('^')) {
          text = text.split('^')[0].trim();
        }
        if (text) {
          parsed.push({ start: mins * 60 + secs, text });
        }
      }
    });

    if (parsed.length === 0) return null;

    for (let i = 0; i < parsed.length; i++) {
      const nextStart = i < parsed.length - 1 ? parsed[i + 1].start : (totalDuration || parsed[i].start + 6);
      // Cap active word illumination duration to a natural singing phrase length (max 6.5s)
      parsed[i].end = Math.min(nextStart, parsed[i].start + 6.5);
      parsed[i].lineEnd = nextStart;
    }
    return parsed;
  }

  function parsePlainLyricsToFallbackSync(plainString, totalDuration) {
    const lines = plainString.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const step = Math.max(3.5, (totalDuration || 180) / (lines.length + 1));
    return lines.map((text, idx) => ({
      start: idx * step,
      end: (idx + 0.85) * step,
      lineEnd: (idx + 1) * step,
      text
    }));
  }

  let lyricFetchSeq = 0;
  let activeLyricTrackKey = '';
  const lyricsMemoryCache = new Map();

  // Diagnostics: forwarded to logcat (tag EchoJS) via WebChromeClient.onConsoleMessage
  function lyrLog(msg) {
    try { console.log(`[LYR ${Date.now() % 100000}] ${msg}`); } catch (e) { }
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 6500) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, credentials: 'omit', signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (err) {
      clearTimeout(timeout);
      return null;
    }
  }

  // Same as fetchWithTimeout but logs status, elapsed ms and failure reason
  async function timedLyricsFetch(tag, fetchId, url, timeoutMs) {
    const t0 = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const res = await fetch(url, { credentials: 'omit', signal: controller.signal });
      clearTimeout(timeout);
      lyrLog(`#${fetchId} ${tag} HTTP ${res.status} in ${Date.now() - t0}ms`);
      return res;
    } catch (err) {
      clearTimeout(timeout);
      lyrLog(`#${fetchId} ${tag} FAIL ${timedOut ? 'TIMEOUT(' + timeoutMs + 'ms)' : (err && err.name) + ': ' + (err && err.message)} after ${Date.now() - t0}ms`);
      return null;
    }
  }

  function cleanTrackId(id) {
    if (!id) return '';
    return String(id).replace(/^spotify:track:/, '').trim();
  }

  async function fetchSyncedLyricsForTrack(trackName, artistName, albumName, durationSec) {
    if (!trackName) return;
    const cleanTrack = (trackName || '').replace(/\s*\(.*?\)\s*/g, '').replace(/\s*-\s*.*$/, '').trim() || trackName;
    const cleanArtist = (artistName || '').replace(/\s*,\s*.*$/, '').trim() || artistName;
    const cacheKey = `${cleanArtist.toLowerCase()}::${cleanTrack.toLowerCase()}`;

    // If lyrics are already loaded and displayed for this exact song, never wipe or re-fetch!
    // (Compare against the key the loaded lyrics belong to; playingTrackTitle is already updated by the caller.)
    if (state.hasValidLyrics && state.activeLyrics && state.activeLyrics.length > 0 && state.loadedLyricsKey === cacheKey) {
      lyrLog(`skip "${cacheKey}": already loaded`);
      return;
    }

    // If an async fetch is already in flight for this exact track, let it finish instead of duplicate fetches!
    if (state.lyricsLoading && activeLyricTrackKey === cacheKey) {
      lyrLog(`skip "${cacheKey}": fetch already in flight`);
      return;
    }

    const fetchId = ++lyricFetchSeq;
    const tStart = Date.now();
    lyrLog(`#${fetchId} START "${cacheKey}" dur=${durationSec}s`);
    activeLyricTrackKey = cacheKey;
    state.lyricsLoading = true;

    // Check instant in-memory cache (0ms)
    if (lyricsMemoryCache.has(cacheKey)) {
      const cached = lyricsMemoryCache.get(cacheKey);
      if (cached && cached.length > 0) {
        lyrLog(`#${fetchId} memory cache hit (${cached.length} lines)`);
        state.lyricsLoading = false;
        state.hasValidLyrics = true;
        state.loadedLyricsKey = cacheKey;
        state.activeLyrics = cached;
        state.activeLineIndex = -1;
        buildLyricsDOM(cached);
        updateNowPlayingRightPanelMode();
        updateScrubberAndLyricsUI(true);
        return;
      }
    }

    state.hasValidLyrics = false;
    state.loadedLyricsKey = '';
    state.activeLyrics = [];
    state.lyricDOMCache = [];
    state.activeLineIndex = -1;
    updateNowPlayingRightPanelMode();

    let rawSyncedLrc = null;

    // STEP 1: Direct lookup via /api/get (returns exact syncedLyrics)
    try {
      const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTrack)}&artist_name=${encodeURIComponent(cleanArtist)}`;
      let res = await timedLyricsFetch('get', fetchId, getUrl, 5000);
      if (fetchId !== lyricFetchSeq) { lyrLog(`#${fetchId} stale after get, dropped`); return; }

      // One retry on timeout / network error / 5xx (not on 404 = genuinely missing)
      if (!res || res.status >= 500) {
        await new Promise(r => setTimeout(r, 700));
        if (fetchId !== lyricFetchSeq) return;
        res = await timedLyricsFetch('get-retry', fetchId, getUrl, 6500);
      }

      if (fetchId !== lyricFetchSeq) { lyrLog(`#${fetchId} stale after get-retry, dropped`); return; }
      if (res && res.ok) {
        try {
          const data = await res.json();
          if (data && !data.instrumental && data.syncedLyrics) {
            rawSyncedLrc = data.syncedLyrics;
          } else {
            lyrLog(`#${fetchId} get: no syncedLyrics (instrumental=${data && data.instrumental})`);
          }
        } catch (jsonErr) {
          lyrLog(`#${fetchId} get: body is not JSON (${jsonErr && jsonErr.message})`);
        }
      }
    } catch (e) { }

    // STEP 2: Fallback search if direct get didn't find it or had naming discrepancy
    if (!rawSyncedLrc && fetchId === lyricFetchSeq) {
      try {
        const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTrack)}&artist_name=${encodeURIComponent(cleanArtist)}`;
        const res = await timedLyricsFetch('search', fetchId, searchUrl, 7500);
        if (fetchId !== lyricFetchSeq) { lyrLog(`#${fetchId} stale after search, dropped`); return; }
        if (res && res.ok) {
          try {
            const list = await res.json();
            if (Array.isArray(list) && list.length > 0) {
              const syncedCandidates = list.filter(item => !item.instrumental && item.syncedLyrics);
              lyrLog(`#${fetchId} search: ${list.length} results, ${syncedCandidates.length} synced`);
              if (syncedCandidates.length > 0) {
                syncedCandidates.sort((a, b) => Math.abs((a.duration || durationSec) - durationSec) - Math.abs((b.duration || durationSec) - durationSec));
                rawSyncedLrc = syncedCandidates[0].syncedLyrics;
              }
            } else {
              lyrLog(`#${fetchId} search: 0 results`);
            }
          } catch (jsonErr) {
            lyrLog(`#${fetchId} search: body is not JSON (${jsonErr && jsonErr.message})`);
          }
        }
      } catch (e) { }
    }

    // Ensure this is still the active fetch and track hasn't changed
    if (fetchId !== lyricFetchSeq || state.playingTrackTitle !== trackName) {
      lyrLog(`#${fetchId} stale at end (now playing "${state.playingTrackTitle}"), dropped`);
      return;
    }

    state.lyricsLoading = false;

    // ONLY parse and illuminate genuine timestamped lyrics [mm:ss.xx]
    // Never use fake linear synchronization for plain text lyrics!
    if (rawSyncedLrc) {
      const parsed = parseLrcToWordSync(rawSyncedLrc, durationSec);
      if (parsed && parsed.length > 0) {
        lyrLog(`#${fetchId} OK ${parsed.length} lines, total ${Date.now() - tStart}ms`);
        lyricsMemoryCache.set(cacheKey, parsed);
        state.hasValidLyrics = true;
        state.loadedLyricsKey = cacheKey;
        state.activeLyrics = parsed;
        state.activeLineIndex = -1;
        buildLyricsDOM(parsed);
        updateNowPlayingRightPanelMode();
        updateScrubberAndLyricsUI(true);
        return;
      }
    }

    // Truly no synced lyrics found
    lyrLog(`#${fetchId} NO LYRICS shown, total ${Date.now() - tStart}ms`);
    state.hasValidLyrics = false;
    state.activeLyrics = [];
    state.lyricDOMCache = [];
    state.activeLineIndex = -1;
    if (lyricsScrollTrack) lyricsScrollTrack.innerHTML = '';
    updateNowPlayingRightPanelMode();
  }

  // --------------------------------------------------------------------------
  // 6. LOAD MEDINA JHONATAN'S REAL SPOTIFY DATA INTO ALL 5 SCREENS
  // --------------------------------------------------------------------------
  function updateGreeting() {
    const hr = new Date().getHours();
    const titleEl = document.querySelector('#view-home .page-title');
    if (!titleEl) return;
    if (hr < 12) titleEl.textContent = 'Good morning';
    else if (hr < 19) titleEl.textContent = 'Good afternoon';
    else titleEl.textContent = 'Good evening';
  }

  async function loadAllRealSpotifyData() {
    updateGreeting();
    if (!spotifyAuth.accessToken) return;

    // Fetch all endpoints in parallel for <400ms startup
    const [me, likedRes, plsRes, albRes, artRes, topTracksRes, recentRes] = await Promise.all([
      spotifyFetch('/me'),
      spotifyFetch('/me/tracks?limit=50'),
      spotifyFetch('/me/playlists?limit=50'),
      spotifyFetch('/me/albums?limit=24'),
      spotifyFetch('/me/top/artists?limit=18'),
      spotifyFetch('/me/top/tracks?limit=25'),
      spotifyFetch('/me/player/recently-played?limit=30')
    ]);

    // 1. User Profile
    let currentUserProfile = null;
    if (me && me.display_name) {
      spotifyStatusDot.classList.add('connected');
      spotifyStatusText.textContent = `Conectado: ${me.display_name} (${me.product || 'Premium'})`;
      const avatarUrl = (me.images && me.images.length > 0) ? me.images[0].url : null;
      currentUserProfile = { name: me.display_name, avatar: avatarUrl };
      renderUserProfile(currentUserProfile);
    }

    // 2. Liked Songs (/me/tracks)
    if (likedRes && typeof likedRes.total === 'number') {
      liveCatalog.likedTotal = likedRes.total;
      const tracks = (likedRes.items || []).filter(i => i && i.track).map((i, idx) => ({
        num: idx + 1,
        id: i.track.id,
        uri: i.track.uri,
        title: i.track.name,
        artist: i.track.artists.map(a => a.name).join(', '),
        album: i.track.album ? i.track.album.name : '',
        cover: (i.track.album && i.track.album.images && i.track.album.images.length > 0) ? getSpotifyImage(i.track.album.images, 'medium') : DEFAULT_ALBUM_COVER,
        duration: Math.round((i.track.duration_ms || 200000) / 1000),
        popular: idx < 3
      }));
      liveCatalog.likedTracks = tracks;
      liveCatalog.likedTrackIds = new Set(tracks.map(t => t.id).filter(Boolean));

      liveCatalog.entities['liked_songs'] = {
        id: 'liked_songs',
        type: 'liked',
        uri: null,
        title: 'Liked Songs',
        artist: me ? me.display_name : 'Tu Biblioteca',
        meta: `Playlist • ${likedRes.total.toLocaleString()} songs`,
        cover: LIKED_SONGS_COVER,
        tracks: tracks,
        tracksTotal: likedRes.total,
        tracksNextOffset: tracks.length,
        hasMoreTracks: tracks.length < likedRes.total
      };
    }

    // 3. User Playlists (/me/playlists) with Auto-Pagination for ALL playlists
    function mapSpotifyPlaylists(items) {
      return items.filter(Boolean).map(p => {
        const entityId = `pl_${p.id}`;
        const cover = (p.images && p.images.length > 0) ? getSpotifyImage(p.images, 'medium') : DEFAULT_PLAYLIST_COVER;
        const total = p.tracks ? p.tracks.total : 0;
        liveCatalog.entities[entityId] = {
          id: entityId,
          spotifyId: p.id,
          type: 'playlist',
          uri: p.uri,
          title: p.name,
          artist: (p.owner && p.owner.display_name) ? p.owner.display_name : 'Spotify',
          meta: `Playlist • ${total} songs`,
          cover: cover,
          tracks: null // Loaded on demand when opened
        };
        return liveCatalog.entities[entityId];
      });
    }

    if (plsRes && Array.isArray(plsRes.items)) {
      liveCatalog.playlists = mapSpotifyPlaylists(plsRes.items);

      // If user has more than 50 playlists, paginate in background to fetch ALL of them
      if (plsRes.total && plsRes.total > plsRes.items.length) {
        (async () => {
          let offset = plsRes.items.length;
          while (offset < plsRes.total && offset < 300) {
            const nextRes = await spotifyFetch(`/me/playlists?limit=50&offset=${offset}`);
            if (nextRes && Array.isArray(nextRes.items) && nextRes.items.length > 0) {
              const more = mapSpotifyPlaylists(nextRes.items);
              liveCatalog.playlists = liveCatalog.playlists.concat(more);
              offset += nextRes.items.length;
              renderLibrary(liveCatalog.libraryFilter);
            } else {
              break;
            }
          }
        })();
      }
    }

    // 4. Saved Albums (/me/albums)
    if (albRes && Array.isArray(albRes.items)) {
      liveCatalog.albums = albRes.items.filter(i => i && i.album).map(i => {
        const a = i.album;
        const entityId = `alb_${a.id}`;
        const cover = (a.images && a.images.length > 0) ? getSpotifyImage(a.images, 'medium') : DEFAULT_ALBUM_COVER;
        const year = a.release_date ? a.release_date.slice(0, 4) : '';
        const artistName = a.artists ? a.artists.map(x => x.name).join(', ') : '';
        const tracks = (a.tracks && a.tracks.items) ? a.tracks.items.map((t, idx) => ({
          num: idx + 1,
          id: t.id,
          uri: t.uri,
          title: t.name,
          artist: artistName,
          album: a.name,
          cover: cover,
          duration: Math.round((t.duration_ms || 200000) / 1000),
          popular: idx === 0
        })) : null;

        liveCatalog.entities[entityId] = {
          id: entityId,
          spotifyId: a.id,
          type: 'album',
          uri: a.uri,
          title: a.name,
          artist: artistName,
          meta: `Album • ${year}`,
          cover: cover,
          tracks: tracks
        };
        return liveCatalog.entities[entityId];
      });
    }

    // 5. Top Artists (/me/top/artists)
    if (artRes && Array.isArray(artRes.items)) {
      liveCatalog.artists = artRes.items.filter(Boolean).map(ar => {
        const entityId = `art_${ar.id}`;
        const cover = (ar.images && ar.images.length > 0) ? getSpotifyImage(ar.images, 'medium') : 'assets/avatar_sampha.jpg';
        const genre = (ar.genres && ar.genres[0]) ? ar.genres[0] : 'Artist';
        liveCatalog.entities[entityId] = {
          id: entityId,
          spotifyId: ar.id,
          type: 'artist',
          uri: ar.uri,
          title: ar.name,
          artist: 'Artista de Spotify',
          meta: `${genre}`,
          cover: cover,
          tracks: null
        };
        return liveCatalog.entities[entityId];
      });

      // Populate Search Recent Chips with the user's real Top Artists
      if (liveCatalog.artists.length > 0) {
        liveCatalog.recentSearches = liveCatalog.artists.slice(0, 6).map(ar => ({
          label: ar.title,
          avatar: ar.cover,
          square: false,
          entityId: ar.id
        }));
      }
    }

    // 6. Home Screen Sections: "Jump back in", "Made for you" & "Recently played"
    const jumpCards = [];
    const seenJumpAlbums = new Set();

    if (topTracksRes && Array.isArray(topTracksRes.items)) {
      topTracksRes.items.forEach(t => {
        if (!t || !t.album || seenJumpAlbums.has(t.album.id) || jumpCards.length >= 8) return;
        seenJumpAlbums.add(t.album.id);
        const entityId = `alb_${t.album.id}`;
        const cover = (t.album.images && t.album.images.length > 0) ? getSpotifyImage(t.album.images, 'medium') : DEFAULT_ALBUM_COVER;
        const artistName = t.artists ? t.artists.map(a => a.name).join(', ') : '';
        if (!liveCatalog.entities[entityId]) {
          liveCatalog.entities[entityId] = {
            id: entityId,
            spotifyId: t.album.id,
            type: 'album',
            uri: t.album.uri,
            title: t.album.name,
            artist: artistName,
            meta: `Album • ${(t.album.release_date || '').slice(0, 4)}`,
            cover: cover,
            tracks: null
          };
        }
        jumpCards.push({
          entityId: entityId,
          title: t.album.name,
          subtitle: artistName,
          cover: cover
        });
      });
    }

    // Supplement jumpCards up to 8 from saved albums if top tracks had fewer
    if (jumpCards.length < 8 && Array.isArray(liveCatalog.albums)) {
      liveCatalog.albums.forEach(al => {
        if (!al || !al.spotifyId || seenJumpAlbums.has(al.spotifyId) || jumpCards.length >= 8) return;
        seenJumpAlbums.add(al.spotifyId);
        jumpCards.push({
          entityId: al.id,
          title: al.title,
          subtitle: al.artist,
          cover: al.cover
        });
      });
    }

    // Dynamic "Made for you" Banners: Prioritize Algorithmic playlists (Daily Mix, Discover, Repeat, Mix)
    const madeForYouBanners = [];
    const mfuKeywords = ['daily mix', 'discover weekly', 'release radar', 'on repeat', 'repeat rewind', 'mix', 'radio'];
    const algorithmic = liveCatalog.playlists.filter(p => {
      const name = (p.title || '').toLowerCase();
      const owner = (p.artist || '').toLowerCase();
      return owner.includes('spotify') || mfuKeywords.some(kw => name.includes(kw));
    });

    const bannerCandidates = algorithmic.length >= 2 ? algorithmic : liveCatalog.playlists.concat(liveCatalog.albums);
    if (bannerCandidates[0]) {
      madeForYouBanners.push({
        entityId: bannerCandidates[0].id,
        title: bannerCandidates[0].title,
        subtitle: bannerCandidates[0].meta || 'Made for you',
        cover: bannerCandidates[0].cover,
        tag: 'Made for you'
      });
    }
    if (bannerCandidates[1]) {
      madeForYouBanners.push({
        entityId: bannerCandidates[1].id,
        title: bannerCandidates[1].title,
        subtitle: bannerCandidates[1].meta || 'Made for you',
        cover: bannerCandidates[1].cover,
        tag: 'Made for you'
      });
    }

    const recentCards = [];
    const seenRecentTracks = new Set();
    if (recentRes && Array.isArray(recentRes.items)) {
      recentRes.items.forEach(item => {
        const t = item && item.track;
        if (!t || !t.id || seenRecentTracks.has(t.id) || recentCards.length >= 8) return;
        seenRecentTracks.add(t.id);
        const cover = (t.album && t.album.images && t.album.images.length > 0) ? getSpotifyImage(t.album.images, 'medium') : DEFAULT_ALBUM_COVER;
        const artistName = t.artists ? t.artists.map(a => a.name).join(', ') : '';

        recentCards.push({
          trackId: t.id,
          uri: t.uri,
          title: t.name,
          subtitle: artistName,
          albumName: t.album ? t.album.name : '',
          cover: cover,
          durationMs: t.duration_ms
        });
      });

      // If fewer than 8 tracks, fill remaining slots with user's top tracks
      if (recentCards.length < 8 && topTracksRes && Array.isArray(topTracksRes.items)) {
        topTracksRes.items.forEach(t => {
          if (!t || !t.id || seenRecentTracks.has(t.id) || recentCards.length >= 8) return;
          seenRecentTracks.add(t.id);
          const cover = (t.album && t.album.images && t.album.images.length > 0) ? getSpotifyImage(t.album.images, 'medium') : DEFAULT_ALBUM_COVER;
          const artistName = t.artists ? t.artists.map(a => a.name).join(', ') : '';
          recentCards.push({
            trackId: t.id,
            uri: t.uri,
            title: t.name,
            subtitle: artistName,
            albumName: t.album ? t.album.name : '',
            cover: cover,
            durationMs: t.duration_ms
          });
        });
      }

      // If nothing is currently playing yet, initialize Mini-Player & Now Playing with the user's most recent track!
      if (!state.playingTrackId && recentRes.items[0] && recentRes.items[0].track) {
        const lastTrack = recentRes.items[0].track;
        applyTrackToUI(lastTrack, 0, false);
      }
    }

    // Top Artists Cards (up to 8 circular bubbles)
    const topArtistsCards = (liveCatalog.artists || []).slice(0, 8).map(ar => ({
      entityId: ar.id,
      name: ar.title,
      meta: (ar.meta && ar.meta !== 'Artist') ? ar.meta : 'Artist',
      cover: ar.cover
    }));

    // Saved Albums Cards (up to 8 full albums)
    const savedAlbumsCards = (liveCatalog.albums || []).slice(0, 8).map(al => ({
      entityId: al.id,
      title: al.title,
      subtitle: al.artist,
      cover: al.cover
    }));

    // Save persistent home cache for instant startup
    const homeEntitiesCache = {};
    jumpCards.concat(recentCards).concat(topArtistsCards).concat(savedAlbumsCards).forEach(c => {
      if (liveCatalog.entities[c.entityId]) {
        homeEntitiesCache[c.entityId] = liveCatalog.entities[c.entityId];
      }
    });
    madeForYouBanners.forEach(b => {
      if (liveCatalog.entities[b.entityId]) {
        homeEntitiesCache[b.entityId] = liveCatalog.entities[b.entityId];
      }
    });

    const lastTrackCandidate = (recentRes && recentRes.items && recentRes.items[0] && recentRes.items[0].track)
      ? recentRes.items[0].track
      : null;

    saveHomeCache({
      jumpCards: jumpCards,
      recentCards: recentCards,
      banners: madeForYouBanners,
      topArtists: topArtistsCards,
      savedAlbums: savedAlbumsCards,
      lastTrack: lastTrackCandidate,
      entities: homeEntitiesCache,
      userProfile: currentUserProfile
    });

    renderHome(jumpCards, recentCards, madeForYouBanners, topArtistsCards, savedAlbumsCards);
    renderSearch(recentCards);
    renderLibrary(liveCatalog.libraryFilter);
  }

  // --------------------------------------------------------------------------
  // 7. RENDER FUNCTIONS & SKELETON LOADERS FOR ALL 5 VIEWS
  // --------------------------------------------------------------------------
  function buildSkeletonCardsHTML(count = 5, showMeta = true) {
    return Array.from({ length: count }).map(() => `
      <div class="skeleton-card">
        <div class="skeleton-cover skeleton-shimmer"></div>
        ${showMeta ? '<div class="skeleton-line-title skeleton-shimmer"></div><div class="skeleton-line-sub skeleton-shimmer"></div>' : ''}
      </div>
    `).join('');
  }

  function buildSkeletonArtistsHTML(count = 5) {
    return Array.from({ length: count }).map(() => `
      <div class="skeleton-artist-card">
        <div class="skeleton-artist-avatar skeleton-shimmer"></div>
        <div class="skeleton-line-title skeleton-shimmer" style="width: 70%; margin: 0 auto 6px auto;"></div>
        <div class="skeleton-line-sub skeleton-shimmer" style="width: 45%; margin: 0 auto;"></div>
      </div>
    `).join('');
  }

  function buildSkeletonChipsHTML(count = 5) {
    return Array.from({ length: count }).map(() => `
      <div class="skeleton-chip skeleton-shimmer"></div>
    `).join('');
  }

  function buildSkeletonTracksHTML(count = 7) {
    const widths = ['62%', '48%', '74%', '55%', '68%', '44%', '59%'];
    return Array.from({ length: count }).map((_, idx) => `
      <div class="skeleton-track-row">
        <div class="skeleton-track-num skeleton-shimmer"></div>
        <div class="skeleton-track-bar skeleton-shimmer" style="width:${widths[idx % widths.length]}"></div>
        <div></div>
      </div>
    `).join('');
  }

  function buildSkeletonBannersHTML() {
    return `
      <div class="feature-banner skeleton-banner skeleton-shimmer"></div>
      <div class="feature-banner skeleton-banner skeleton-shimmer"></div>
    `;
  }

  function updateHomeGreeting() {
    const el = document.getElementById('homeGreeting');
    if (!el) return;
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      el.textContent = 'Good morning';
    } else if (hour >= 12 && hour < 19) {
      el.textContent = 'Good afternoon';
    } else {
      el.textContent = 'Good evening';
    }
  }

  function renderHomeMadeForYou(banners) {
    const grid = document.getElementById('homeMadeForYouGrid');
    if (!grid) return;
    if (!banners || banners.length === 0) {
      grid.innerHTML = '';
      delete grid.dataset.sig;
      return;
    }
    const sig = banners.slice(0, 2).map(b => `${b.entityId}:${b.cover}:${b.title}`).join('|');
    if (grid.dataset.sig === sig) return; // Identical: preserve DOM & avoid image reload flicker
    grid.dataset.sig = sig;

    const styles = [
      { cls: 'discover-weekly' },
      { cls: 'release-radar' }
    ];

    grid.innerHTML = banners.slice(0, 2).map((b, idx) => {
      const st = styles[idx % styles.length];
      return `
        <div class="feature-banner ${st.cls}" data-open-entity="${b.entityId}">
          <div class="banner-ambient-glow" style="background-image: url('${b.cover}');"></div>
          <div class="banner-left">
            <div class="banner-artwork-wrap">
              <img src="${b.cover}" alt="${b.title}" class="banner-artwork" loading="lazy" decoding="async" />
            </div>
            <div class="banner-meta">
              <span class="banner-tag">${b.tag || 'Made for you'}</span>
              <div class="banner-title">${b.title}</div>
              <div class="banner-subtitle">${b.subtitle || ''}</div>
            </div>
          </div>
          <button class="banner-play-btn" title="Play">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="7 5 19 12 7 19 7 5"></polygon>
            </svg>
          </button>
        </div>
      `;
    }).join('');
  }

  function renderInitialSkeletons() {
    updateHomeGreeting();
    const jumpGrid = document.getElementById('homeJumpBackGrid');
    if (jumpGrid) jumpGrid.innerHTML = buildSkeletonCardsHTML(5, true);

    const mfuGrid = document.getElementById('homeMadeForYouGrid');
    if (mfuGrid) mfuGrid.innerHTML = buildSkeletonBannersHTML();

    const artistsGrid = document.getElementById('homeTopArtistsGrid');
    if (artistsGrid) artistsGrid.innerHTML = buildSkeletonArtistsHTML(5);

    const recentGrid = document.getElementById('homeRecentlyPlayedGrid');
    if (recentGrid) recentGrid.innerHTML = buildSkeletonCardsHTML(5, false);

    const savedGrid = document.getElementById('homeSavedAlbumsGrid');
    if (savedGrid) savedGrid.innerHTML = buildSkeletonCardsHTML(5, true);

    const searchesRow = document.getElementById('recentSearchesRow');
    if (searchesRow) searchesRow.innerHTML = buildSkeletonChipsHTML(5);

    const searchRecent = document.getElementById('searchRecentlyPlayedGrid');
    if (searchRecent) searchRecent.innerHTML = buildSkeletonCardsHTML(5, false);

    const libGrid = document.getElementById('libraryGrid6');
    if (libGrid) libGrid.innerHTML = buildSkeletonCardsHTML(12, true);
  }

  function renderHome(jumpCards, recentCards, banners, topArtists, savedAlbums) {
    updateHomeGreeting();

    const jumpList = (jumpCards && jumpCards.length > 0) ? jumpCards : [];
    const jumpGrid = document.getElementById('homeJumpBackGrid');
    if (jumpGrid) {
      if (jumpList.length > 0) {
        const sig = jumpList.slice(0, 8).map(i => `${i.entityId}:${i.cover}:${i.title}`).join('|');
        if (jumpGrid.dataset.sig !== sig) {
          jumpGrid.dataset.sig = sig;
          jumpGrid.innerHTML = jumpList.slice(0, 8).map(item => `
            <div class="media-card" data-open-entity="${item.entityId}">
              <div class="media-card-cover-wrap">
                <img src="${item.cover}" alt="${item.title}" class="media-card-cover" loading="lazy" decoding="async" />
              </div>
              <div class="media-card-title">${item.title}</div>
              <div class="media-card-subtitle">${item.subtitle}</div>
            </div>
          `).join('');
        }
      } else {
        delete jumpGrid.dataset.sig;
        jumpGrid.innerHTML = buildSkeletonCardsHTML(5, true);
      }
    }

    if (banners && banners.length > 0) {
      renderHomeMadeForYou(banners);
    } else {
      const mfuGrid = document.getElementById('homeMadeForYouGrid');
      if (mfuGrid && !mfuGrid.children.length) {
        delete mfuGrid.dataset.sig;
        mfuGrid.innerHTML = buildSkeletonBannersHTML();
      }
    }

    // Render Favorite Artists (Circular bubbles)
    const artistsGrid = document.getElementById('homeTopArtistsGrid');
    const artistsList = (topArtists && topArtists.length > 0) ? topArtists : [];
    if (artistsGrid) {
      if (artistsList.length > 0) {
        const sig = artistsList.slice(0, 8).map(a => `${a.entityId}:${a.cover}:${a.name}`).join('|');
        if (artistsGrid.dataset.sig !== sig) {
          artistsGrid.dataset.sig = sig;
          artistsGrid.innerHTML = artistsList.slice(0, 8).map(item => `
            <div class="artist-card" data-open-entity="${item.entityId}">
              <div class="artist-card-avatar-wrap">
                <img src="${item.cover}" alt="${item.name}" class="artist-card-avatar" loading="lazy" decoding="async" />
              </div>
              <div class="artist-card-name">${item.name}</div>
              <div class="artist-card-meta">${item.meta || 'Artist'}</div>
            </div>
          `).join('');
        }
      } else {
        delete artistsGrid.dataset.sig;
        artistsGrid.innerHTML = buildSkeletonArtistsHTML(5);
      }
    }

    // Build balanced recent list of up to 8 tracks:
    let finalRecent = (recentCards && recentCards.length > 0) ? [...recentCards] : [];

    const recentGrid = document.getElementById('homeRecentlyPlayedGrid');
    if (recentGrid) {
      if (finalRecent.length > 0) {
        const sig = finalRecent.slice(0, 8).map(item => `${item.uri || item.trackId || item.entityId}:${item.cover}:${item.title}`).join('|');
        if (recentGrid.dataset.sig !== sig) {
          recentGrid.dataset.sig = sig;
          recentGrid.innerHTML = finalRecent.slice(0, 8).map(item => {
            const actionAttr = item.uri
              ? `data-play-direct-uri="${item.uri}" data-title="${(item.title || '').replace(/"/g, '&quot;')}" data-artist="${(item.subtitle || '').replace(/"/g, '&quot;')}" data-cover="${item.cover}"`
              : `data-open-entity="${item.entityId}"`;
            return `
              <div class="media-card" ${actionAttr}>
                <div class="media-card-cover-wrap">
                  <img src="${item.cover}" alt="${item.title || 'Track'}" class="media-card-cover" loading="lazy" decoding="async" />
                </div>
                <div class="media-card-title">${item.title}</div>
                <div class="media-card-subtitle">${item.subtitle || ''}</div>
              </div>
            `;
          }).join('');
        }
      } else {
        delete recentGrid.dataset.sig;
        recentGrid.innerHTML = buildSkeletonCardsHTML(5, false);
      }
    }

    // Render Saved Albums (Library)
    const savedAlbumsGrid = document.getElementById('homeSavedAlbumsGrid');
    const savedList = (savedAlbums && savedAlbums.length > 0) ? savedAlbums : [];
    if (savedAlbumsGrid) {
      if (savedList.length > 0) {
        const sig = savedList.slice(0, 8).map(al => `${al.entityId}:${al.cover}:${al.title}`).join('|');
        if (savedAlbumsGrid.dataset.sig !== sig) {
          savedAlbumsGrid.dataset.sig = sig;
          savedAlbumsGrid.innerHTML = savedList.slice(0, 8).map(item => `
            <div class="media-card" data-open-entity="${item.entityId}">
              <div class="media-card-cover-wrap">
                <img src="${item.cover}" alt="${item.title}" class="media-card-cover" loading="lazy" decoding="async" />
              </div>
              <div class="media-card-title">${item.title}</div>
              <div class="media-card-subtitle">${item.subtitle || ''}</div>
            </div>
          `).join('');
        }
      } else {
        delete savedAlbumsGrid.dataset.sig;
        savedAlbumsGrid.innerHTML = buildSkeletonCardsHTML(5, true);
      }
    }
  }

  function renderSearch(recentCards) {
    const chipsRow = document.getElementById('recentSearchesRow');
    chipsRow.innerHTML = liveCatalog.recentSearches.map(chip => `
      <div class="recent-chip" ${chip.entityId ? `data-open-entity="${chip.entityId}"` : `data-search-query="${chip.query || chip.label}"`}>
        <img src="${chip.avatar}" alt="${chip.label}" class="chip-avatar ${chip.square ? 'square' : ''}" />
        <span class="chip-label">${chip.label}</span>
      </div>
    `).join('');

    const searchRecentGrid = document.getElementById('searchRecentlyPlayedGrid');
    let finalSearchRecent = [];
    if (recentCards && recentCards.length > 0) {
      finalSearchRecent = [...recentCards];
    }
    if (finalSearchRecent.length < 5) {
      const fallbackList = liveCatalog.playlists.length > 0 ? liveCatalog.playlists : (liveCatalog.demoCatalog || []);
      for (const item of fallbackList) {
        if (finalSearchRecent.length >= 5) break;
        const eId = item.entityId || item.id;
        if (!finalSearchRecent.some(r => (r.entityId || r.id) === eId)) {
          finalSearchRecent.push({
            entityId: eId,
            title: item.title,
            subtitle: item.subtitle || item.meta || '',
            cover: item.cover
          });
        }
      }
    }

    if (finalSearchRecent.length > 0) {
      searchRecentGrid.innerHTML = finalSearchRecent.slice(0, 5).map(item => {
        const actionAttr = item.uri
          ? `data-play-direct-uri="${item.uri}" data-title="${(item.title || '').replace(/"/g, '&quot;')}" data-artist="${(item.subtitle || '').replace(/"/g, '&quot;')}" data-cover="${item.cover}"`
          : `data-open-entity="${item.entityId || item.id}"`;
        return `
          <div class="media-card" ${actionAttr}>
            <div class="media-card-cover-wrap">
              <img src="${item.cover}" alt="${item.title || ''}" class="media-card-cover" loading="lazy" decoding="async" />
            </div>
            <div class="media-card-title">${item.title}</div>
            <div class="media-card-subtitle">${item.subtitle || ''}</div>
          </div>
        `;
      }).join('');
    }
  }

  function renderLibrary(filter = 'all') {
    liveCatalog.libraryFilter = filter;
    const grid = document.getElementById('libraryGrid6');

    let items = [];
    // Always include Liked Songs card on Playlists and Liked tabs
    if (filter === 'all' || filter === 'liked') {
      items.push({
        id: 'liked_songs',
        title: 'Liked Songs',
        sub: `Playlist • ${liveCatalog.likedTotal.toLocaleString()} songs`,
        likedCard: true
      });
    }

    // DJ Livi AI pinned card right next to Liked Songs
    if (filter === 'all') {
      items.push({
        id: 'dj_livi',
        playUri: 'spotify:playlist:37i9dQZF1EYkqdzj48dyYq',
        title: 'DJ Livi',
        sub: 'Tu DJ personal con IA',
        cover: 'https://lexicon-assets.spotifycdn.com/DJ-Beta-CoverArt-300.jpg',
        djCard: true
      });
    }

    if (filter === 'all') {
      liveCatalog.playlists.forEach((p, idx) => {
        items.push({
          id: p.id,
          title: p.title,
          sub: p.meta,
          cover: p.cover,
          pinned: idx === 0
        });
      });
      // Also append Saved Albums if user has fewer than 11 playlists
      if (items.length < 12) {
        liveCatalog.albums.forEach(a => {
          items.push({
            id: a.id,
            title: a.title,
            sub: `${a.artist} • ${a.meta}`,
            cover: a.cover
          });
        });
      }
    } else if (filter === 'albums') {
      liveCatalog.albums.forEach(a => {
        items.push({
          id: a.id,
          title: a.title,
          sub: a.artist,
          cover: a.cover
        });
      });
    } else if (filter === 'artists') {
      liveCatalog.artists.forEach(ar => {
        items.push({
          id: ar.id,
          title: ar.title,
          sub: ar.meta,
          cover: ar.cover
        });
      });
    } else if (filter === 'liked') {
      liveCatalog.likedTracks.forEach(t => {
        items.push({
          playUri: t.uri,
          trackObj: t,
          title: t.title,
          sub: t.artist,
          cover: t.cover
        });
      });
    }

    if (liveCatalog.sortAlphabetical && items.length > 1) {
      const pinned = items.filter(i => i.likedCard || i.djCard);
      const regular = items.filter(i => !i.likedCard && !i.djCard);
      regular.sort((a, b) => a.title.localeCompare(b.title));
      items = pinned.concat(regular);
    }

    grid.innerHTML = items.map(item => {
      let coverContent = '';
      if (item.likedCard) {
        coverContent = `<div class="liked-songs-art">
             <svg width="54" height="54" viewBox="0 0 24 24" fill="#ffffff">
               <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
             </svg>
           </div>`;
      } else if (item.djCard) {
        coverContent = `<img src="https://lexicon-assets.spotifycdn.com/DJ-Beta-CoverArt-300.jpg" alt="DJ Livi" class="media-card-cover" loading="lazy" decoding="async" />`;
      } else {
        coverContent = `<img src="${item.cover}" alt="${item.title}" class="media-card-cover" loading="lazy" decoding="async" />`;
      }

      const pinHtml = item.pinned
        ? `<span class="pin-badge">📌</span>`
        : (item.djCard ? `<span class="dj-ai-badge">AI</span>` : '');

      const actionAttr = item.playUri
        ? `data-play-direct-uri="${item.playUri}" data-title="${item.title.replace(/"/g, '&quot;')}" data-artist="${item.sub.replace(/"/g, '&quot;')}" data-cover="${item.cover || ''}"`
        : `data-open-entity="${item.id}"`;

      return `
        <div class="media-card" ${actionAttr}>
          <div class="media-card-cover-wrap" style="border-radius:16px;">
            ${coverContent}
          </div>
          <div class="media-card-title">${item.title}${pinHtml}</div>
          <div class="media-card-subtitle">${item.sub}</div>
        </div>
      `;
    }).join('');
  }

  // Open and Populate Album / Playlist / Artist / Liked Songs Detail View
  function switchArtistTab(tabName) {
    document.querySelectorAll('.artist-tab').forEach(tab => {
      tab.classList.toggle('active', tab.getAttribute('data-artist-tab') === tabName);
    });
    const tabInicio = document.getElementById('artistTabInicio');
    const tabInfo = document.getElementById('artistTabInfo');
    if (tabInicio) tabInicio.classList.toggle('active', tabName === 'inicio');
    if (tabInfo) tabInfo.classList.toggle('active', tabName === 'informacion');
  }

  function updateArtistSeeMoreButton(expanded) {
    const textEl = document.getElementById('artistMoreTracksBtnText');
    const iconEl = document.getElementById('artistMoreTracksBtnIcon');
    if (textEl) textEl.textContent = expanded ? 'Ver menos' : 'Ver más';
    if (iconEl) iconEl.style.transform = expanded ? 'rotate(-90deg)' : 'rotate(0deg)';
  }

  function buildArtistSkeletonTracksHTML(count = 5) {
    const widths = ['68%', '52%', '76%', '58%', '64%'];
    return Array.from({ length: count }).map((_, idx) => `
      <div class="artist-skeleton-track-row">
        <div class="artist-skeleton-num skeleton-shimmer"></div>
        <div class="artist-skeleton-thumb skeleton-shimmer"></div>
        <div class="artist-skeleton-info">
          <div class="artist-skeleton-bar skeleton-shimmer" style="width: ${widths[idx % widths.length]};"></div>
        </div>
        <div class="artist-skeleton-duration skeleton-shimmer"></div>
      </div>
    `).join('');
  }

  function buildArtistSkeletonAlbumsHTML(count = 5) {
    return Array.from({ length: count }).map(() => `
      <div class="artist-skeleton-album-card">
        <div class="artist-skeleton-album-cover skeleton-shimmer"></div>
        <div class="artist-skeleton-album-title skeleton-shimmer"></div>
        <div class="artist-skeleton-album-sub skeleton-shimmer"></div>
      </div>
    `).join('');
  }

  // --------------------------------------------------------------------------
  // TOAST FEEDBACK NOTIFICATION & SPOTIFY LIKE / SAVE ACTIONS
  // --------------------------------------------------------------------------
  let toastTimer = null;
  function showToast(message, isLiked = true) {
    const toast = document.getElementById('spotifyToast');
    const toastText = document.getElementById('spotifyToastText');
    if (!toast || !toastText) return;
    toastText.textContent = message;
    toast.classList.toggle('unliked', !isLiked);
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2400);
  }

  function updateLikeButtonsUI(isLiked) {
    const npFavBtn = document.getElementById('npFavBtn');
    if (npFavBtn) {
      npFavBtn.classList.toggle('active', isLiked);
      const svg = npFavBtn.querySelector('svg');
      if (svg) {
        svg.setAttribute('fill', isLiked ? '#1ed760' : 'none');
        svg.setAttribute('stroke', isLiked ? '#1ed760' : 'currentColor');
      }
    }
    const miniLikeBtn = document.getElementById('miniLikeBtn');
    if (miniLikeBtn) {
      miniLikeBtn.classList.toggle('liked', isLiked);
      const svg = miniLikeBtn.querySelector('svg');
      if (svg) {
        svg.setAttribute('fill', isLiked ? '#1ed760' : 'none');
        svg.setAttribute('stroke', isLiked ? '#1ed760' : 'currentColor');
      }
    }
  }

  async function toggleLikeTrack(trackId, trackInfo = null) {
    if (!trackId) return;
    const isCurrentlyLiked = liveCatalog.likedTrackIds.has(trackId);
    const nextLiked = !isCurrentlyLiked;

    if (nextLiked) {
      liveCatalog.likedTrackIds.add(trackId);
      liveCatalog.likedTotal++;
      if (trackInfo) {
        liveCatalog.likedTracks.unshift({
          num: 1,
          id: trackId,
          uri: trackInfo.uri || `spotify:track:${trackId}`,
          title: trackInfo.title || trackInfo.name || 'Canción',
          artist: trackInfo.artist || '',
          album: trackInfo.album || 'Liked Songs',
          cover: trackInfo.cover || '',
          duration: trackInfo.duration || 210,
          popular: false
        });
      }
      showToast('Guardado en Tus me gusta', true);
    } else {
      liveCatalog.likedTrackIds.delete(trackId);
      liveCatalog.likedTotal = Math.max(0, liveCatalog.likedTotal - 1);
      liveCatalog.likedTracks = liveCatalog.likedTracks.filter(t => t.id !== trackId);
      showToast('Eliminado de Tus me gusta', false);
    }

    // Always re-index all track numbers in likedTracks so they are sequentially 1, 2, 3...
    liveCatalog.likedTracks.forEach((t, i) => { t.num = i + 1; });
    if (liveCatalog.entities['liked_songs']) {
      liveCatalog.entities['liked_songs'].tracks = liveCatalog.likedTracks;
      liveCatalog.entities['liked_songs'].tracksTotal = liveCatalog.likedTracks.length;
      liveCatalog.entities['liked_songs'].meta = `Playlist • ${liveCatalog.likedTotal.toLocaleString()} songs`;
    }

    // Update all matching track heart icons across all lists on screen
    document.querySelectorAll(`[data-track-id="${trackId}"]`).forEach(btn => {
      btn.classList.toggle('liked', nextLiked);
      btn.setAttribute('title', nextLiked ? 'Eliminar de Tus me gusta' : 'Guardar en Tus me gusta');
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.setAttribute('fill', nextLiked ? '#1ed760' : 'none');
        svg.setAttribute('stroke', nextLiked ? '#1ed760' : 'currentColor');
      }
    });

    // If currently playing track matches, update both Now Playing and Mini-Player hearts
    if (state.playingTrackId === trackId) {
      spotifyAuth.isLiked = nextLiked;
      updateLikeButtonsUI(nextLiked);
    }

    // Sync to Spotify Web API
    if (spotifyAuth.accessToken) {
      try {
        await spotifyFetch(`/me/tracks?ids=${trackId}`, {
          method: nextLiked ? 'PUT' : 'DELETE'
        });
      } catch (e) {
        console.warn('[toggleLikeTrack error]', e);
      }
    }

    // If currently viewing Liked Songs in Library or in Album/Detail view, refresh
    if (state.activeScreen === 'library' && liveCatalog.libraryFilter === 'liked') {
      renderLibrary('liked');
    } else if (state.activeScreen === 'album' && (state.selectedEntityId === 'liked_songs' || (liveCatalog.entities[state.selectedEntityId] && liveCatalog.entities[state.selectedEntityId].type === 'liked'))) {
      openEntityDetail(state.selectedEntityId || 'liked_songs');
    }
  }

  function renderArtistTracks(tracks) {
    const tracklistEl = document.getElementById('artistTracklist');
    if (!tracklistEl) return;
    const list = tracks || [];
    const visibleTracks = list.slice(0, 10);

    tracklistEl.innerHTML = visibleTracks.map((track, idx) => {
      const isPlaying = (state.playingTrackId && track.id === state.playingTrackId) ||
        (state.playingTrackTitle && track.title && state.playingTrackTitle.toLowerCase() === track.title.toLowerCase());
      const isLiked = track.id ? liveCatalog.likedTrackIds.has(track.id) : false;
      const durationStr = formatTime(track.duration || 210);
      return `
        <div class="artist-track-item ${isPlaying ? 'playing' : ''}" data-artist-track-index="${idx}">
          <span class="artist-track-num">${idx + 1}</span>
          <img src="${track.cover || 'assets/album_bb_uvst1.jpg'}" alt="" class="artist-track-thumb" loading="lazy" />
          <div class="artist-track-info">
            <span class="artist-track-title">${track.title}</span>
            ${track.explicit ? '<span class="explicit-badge">E</span>' : ''}
          </div>
          <span class="artist-track-duration">${durationStr}</span>
          <button class="artist-track-like-btn ${isLiked ? 'liked' : ''}" data-track-id="${track.id || ''}" data-track-title="${track.title.replace(/"/g, '&quot;')}" title="${isLiked ? 'Eliminar de Tus me gusta' : 'Guardar en Tus me gusta'}">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="${isLiked ? '#1ed760' : 'none'}" stroke="${isLiked ? '#1ed760' : 'currentColor'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          </button>
          <button class="artist-track-more-btn" title="Opciones">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.9"></circle>
              <circle cx="12" cy="12" r="1.9"></circle>
              <circle cx="12" cy="19" r="1.9"></circle>
            </svg>
          </button>
        </div>
      `;
    }).join('');

    const seeMoreBtn = document.getElementById('artistMoreTracksBtn');
    if (seeMoreBtn) {
      seeMoreBtn.style.display = 'none';
    }
  }

  function renderArtistAlbums(albums) {
    const railEl = document.getElementById('artistAlbumsRail');
    if (!railEl) return;
    const list = albums || [];

    railEl.innerHTML = list.map(album => {
      return `
        <div class="artist-album-card" data-open-entity="${album.id}">
          <div class="artist-album-cover-wrap">
            <img src="${album.cover}" alt="${album.title}" class="artist-album-cover" loading="lazy" />
          </div>
          <div class="artist-album-title" title="${album.title}">${album.title}</div>
          <div class="artist-album-year">${album.year || ''}</div>
        </div>
      `;
    }).join('');
  }

  async function openArtistDetail(entityId) {
    state.selectedArtistId = entityId;
    let artist = liveCatalog.entities[entityId] || (DEMO_ARTISTS[entityId] ? { ...DEMO_ARTISTS[entityId] } : null) || {
      id: entityId,
      title: 'Artista',
      name: 'Artista',
      cover: '',
      tracks: null,
      albums: null
    };

    const spotifyId = artist.spotifyId || (typeof entityId === 'string' && entityId.startsWith('art_') ? entityId.replace('art_', '') : null);

    // Update Header UI
    const avatarEl = document.getElementById('artistHeroAvatar');
    if (avatarEl) {
      if (artist.cover) {
        avatarEl.src = artist.cover;
        avatarEl.style.opacity = '1';
      } else {
        avatarEl.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="210" height="210"/>';
        avatarEl.style.opacity = '0.3';
      }
    }

    const titleEl = document.getElementById('artistHeroTitle');
    if (titleEl) titleEl.textContent = artist.name || artist.title || 'Artista';

    const listenersEl = document.getElementById('artistHeroListeners');
    if (listenersEl) listenersEl.textContent = artist.listeners || 'Oyentes mensuales en Spotify';

    // Dynamic tint extraction from photo if available
    if (artist.cover && !artist.cover.startsWith('data:image')) {
      extractDynamicPaletteFromCover(artist.cover, true);
    }

    // Default tab: Inicio
    switchArtistTab('inicio');
    state.artistShowingAllTracks = false;
    updateArtistSeeMoreButton(false);

    // Switch view to artist
    switchScreen('artist');

    // Populate Information Tab
    const monthNumEl = document.getElementById('artistInfoMonthlyNum');
    if (monthNumEl) monthNumEl.textContent = artist.listenersFull || artist.listeners || '—';

    const followersEl = document.getElementById('artistInfoFollowers');
    if (followersEl) followersEl.textContent = artist.followers || 'Artista verificado en Spotify';

    const bioEl = document.getElementById('artistBioText');
    if (bioEl) {
      bioEl.textContent = artist.bio || `${artist.name || artist.title} en Spotify. Información y estadísticas en vivo.`;
    }

    const genresWrap = document.getElementById('artistGenresWrap');
    if (genresWrap) {
      const genres = (artist.genres && artist.genres.length > 0) ? artist.genres : [];
      genresWrap.innerHTML = genres.map(g => `<span class="artist-genre-pill">${g}</span>`).join('');
    }

    const tracklistEl = document.getElementById('artistTracklist');
    const railEl = document.getElementById('artistAlbumsRail');

    // Show skeletons or existing real cached data (NEVER load mocks!)
    if (artist.tracks && artist.tracks.length > 0) {
      renderArtistTracks(artist.tracks);
    } else {
      if (tracklistEl) tracklistEl.innerHTML = buildArtistSkeletonTracksHTML(5);
      const seeMoreBtn = document.getElementById('artistMoreTracksBtn');
      if (seeMoreBtn) seeMoreBtn.style.display = 'none';
    }

    if (artist.albums && artist.albums.length > 0) {
      renderArtistAlbums(artist.albums);
    } else {
      if (railEl) railEl.innerHTML = buildArtistSkeletonAlbumsHTML(5);
    }

    // If Spotify is authenticated, fetch live top-tracks, albums and metadata
    if (spotifyId && spotifyAuth.accessToken) {
      try {
        const [profileRes, topRes, albumsRes] = await Promise.all([
          spotifyFetch(`/artists/${spotifyId}`),
          spotifyFetch(`/artists/${spotifyId}/top-tracks?market=from_token`),
          spotifyFetch(`/artists/${spotifyId}/albums?include_groups=album,single&limit=20&market=from_token`)
        ]);

        if (profileRes) {
          if (profileRes.name) {
            artist.name = profileRes.name;
            artist.title = profileRes.name;
            if (titleEl) titleEl.textContent = profileRes.name;
          }
          if (profileRes.images && profileRes.images.length > 0) {
            const freshCover = getSpotifyImage(profileRes.images, 'large');
            if (freshCover) {
              artist.cover = freshCover;
              if (avatarEl) {
                avatarEl.src = freshCover;
                avatarEl.style.opacity = '1';
              }
              extractDynamicPaletteFromCover(freshCover, true);
            }
          }
          if (profileRes.followers && typeof profileRes.followers.total === 'number') {
            const total = profileRes.followers.total;
            const millions = (total / 1000000).toFixed(1);
            artist.listeners = `${millions} M oyentes mensuales`;
            artist.listenersFull = total.toLocaleString();
            artist.followers = `Más de ${millions} M seguidores en Spotify`;
            if (listenersEl) listenersEl.textContent = artist.listeners;
            if (monthNumEl) monthNumEl.textContent = artist.listenersFull;
            if (followersEl) followersEl.textContent = artist.followers;
          }
          if (profileRes.genres && profileRes.genres.length > 0) {
            artist.genres = profileRes.genres;
            if (genresWrap) {
              genresWrap.innerHTML = artist.genres.map(g => `<span class="artist-genre-pill">${g}</span>`).join('');
            }
          }
          if (bioEl && !artist.bio) {
            bioEl.textContent = `${artist.name || artist.title} cuenta con ${artist.listeners || 'millones de oyentes'} en Spotify.`;
          }
        }

        if (topRes && Array.isArray(topRes.tracks)) {
          artist.tracks = topRes.tracks.map((t, idx) => ({
            num: idx + 1,
            id: t.id,
            uri: t.uri,
            title: t.name,
            artist: t.artists ? t.artists.map(a => a.name).join(', ') : (artist.name || artist.title),
            album: t.album ? t.album.name : '',
            cover: (t.album && t.album.images && t.album.images[0]) ? t.album.images[0].url : (artist.cover || ''),
            duration: Math.round((t.duration_ms || 200000) / 1000),
            explicit: !!t.explicit
          }));
          renderArtistTracks(artist.tracks);
        }

        if (albumsRes && Array.isArray(albumsRes.items)) {
          const seenNames = new Set();
          const cleanAlbums = [];
          for (const alb of albumsRes.items) {
            const cleanName = alb.name.toLowerCase().trim();
            if (!seenNames.has(cleanName)) {
              seenNames.add(cleanName);
              const albEntityId = `alb_${alb.id}`;
              const albCover = (alb.images && alb.images[0]) ? alb.images[0].url : DEFAULT_ALBUM_COVER;
              const year = alb.release_date ? alb.release_date.split('-')[0] : '';

              liveCatalog.entities[albEntityId] = {
                id: albEntityId,
                spotifyId: alb.id,
                type: 'album',
                uri: alb.uri,
                title: alb.name,
                artist: artist.name || artist.title,
                meta: `${alb.album_type === 'single' ? 'Sencillo' : 'Álbum'} • ${year}`,
                cover: albCover,
                tracks: null
              };

              cleanAlbums.push({
                id: albEntityId,
                title: alb.name,
                year: year,
                cover: albCover,
                uri: alb.uri
              });
            }
          }
          artist.albums = cleanAlbums;
          renderArtistAlbums(cleanAlbums);
        }
      } catch (err) {
        console.warn('[openArtistDetail error]', err);
      }
    }
  }

  async function openEntityDetail(entityId) {
    state.selectedEntityId = entityId;
    let entity = liveCatalog.entities[entityId] || ALBUMS[entityId] || DEMO_ARTISTS[entityId] || ALBUMS.lahai;

    if (entity && (entity.type === 'artist' || (typeof entityId === 'string' && (entityId.startsWith('art_') || entityId === 'bad_bunny')))) {
      return openArtistDetail(entityId);
    }

    if (entityId === 'liked_songs' || entity.type === 'liked') {
      entity.cover = LIKED_SONGS_COVER;
      if (Array.isArray(liveCatalog.likedTracks)) {
        entity.tracks = liveCatalog.likedTracks;
        entity.tracks.forEach((t, i) => { t.num = i + 1; });
      }
    } else if (entity.cover === DEFAULT_PLAYLIST_COVER && entity.tracks && entity.tracks.length > 0) {
      const firstWithCover = entity.tracks.find(t => t.cover && t.cover !== DEFAULT_ALBUM_COVER && t.cover !== DEFAULT_PLAYLIST_COVER);
      if (firstWithCover) {
        entity.cover = firstWithCover.cover;
      }
    }

    document.getElementById('albumDetailCover').src = entity.cover;
    document.getElementById('albumDetailTitle').textContent = entity.title;
    document.getElementById('albumDetailArtist').textContent = entity.artist;
    document.getElementById('albumDetailMeta').textContent = entity.meta || '';

    if (entityId === 'liked_songs' || entity.type === 'liked') {
      applyNeutralLikedTheme();
    } else {
      extractDynamicPaletteFromCover(entity.cover, true);
    }
    switchScreen('album');

    const tracklistEl = document.getElementById('albumTracklistContainer');

    // Fetch tracks on demand if not yet loaded
    if (!entity.tracks && entity.spotifyId) {
      tracklistEl.innerHTML = buildSkeletonTracksHTML(7);

      if (entity.type === 'playlist') {
        const plData = await spotifyFetch(`/playlists/${entity.spotifyId}`);
        if (plData) {
          if (plData.images && plData.images.length > 0 && (!entity.cover || entity.cover === DEFAULT_PLAYLIST_COVER)) {
            const freshCover = getSpotifyImage(plData.images, 'large');
            if (freshCover) {
              entity.cover = freshCover;
              const detailCover = document.getElementById('albumDetailCover');
              if (detailCover) detailCover.src = freshCover;
              extractDynamicPaletteFromCover(freshCover, true);
              document.querySelectorAll(`[data-open-entity="${entity.id}"] img, [data-entity-id="${entity.id}"] img`).forEach(img => {
                img.src = freshCover;
              });
            }
          }

          if (plData.tracks && Array.isArray(plData.tracks.items)) {
            entity.tracksTotal = (typeof plData.tracks.total === 'number') ? plData.tracks.total : plData.tracks.items.length;
            entity.tracksNextOffset = plData.tracks.items.length;
            entity.hasMoreTracks = entity.tracksNextOffset < entity.tracksTotal;
            entity.tracks = plData.tracks.items
              .filter(i => i && i.track)
              .map((i, idx) => ({
                num: idx + 1,
                id: i.track.id,
                uri: i.track.uri,
                title: i.track.name,
                artist: i.track.artists ? i.track.artists.map(a => a.name).join(', ') : entity.artist,
                album: i.track.album ? i.track.album.name : entity.title,
                cover: (i.track.album && i.track.album.images && i.track.album.images[0]) ? i.track.album.images[0].url : entity.cover,
                duration: Math.round((i.track.duration_ms || 200000) / 1000),
                popular: idx < 2
              }));

            // Auto-cover: if playlist still has default cover, adopt the first track's cover
            if ((!entity.cover || entity.cover === DEFAULT_PLAYLIST_COVER) && entity.tracks.length > 0) {
              const firstWithCover = entity.tracks.find(t => t.cover && t.cover !== DEFAULT_ALBUM_COVER && t.cover !== DEFAULT_PLAYLIST_COVER);
              if (firstWithCover) {
                entity.cover = firstWithCover.cover;
                const detailCover = document.getElementById('albumDetailCover');
                if (detailCover) detailCover.src = entity.cover;
                extractDynamicPaletteFromCover(entity.cover, true);
                document.querySelectorAll(`[data-open-entity="${entity.id}"] img, [data-entity-id="${entity.id}"] img`).forEach(img => {
                  img.src = entity.cover;
                });
              }
            }
          }
        }
      } else if (entity.type === 'album') {
        const albData = await spotifyFetch(`/albums/${entity.spotifyId}`);
        if (albData && albData.tracks && Array.isArray(albData.tracks.items)) {
          entity.tracks = albData.tracks.items.map((t, idx) => ({
            num: idx + 1,
            id: t.id,
            uri: t.uri,
            title: t.name,
            artist: t.artists ? t.artists.map(a => a.name).join(', ') : entity.artist,
            album: entity.title,
            cover: entity.cover,
            duration: Math.round((t.duration_ms || 200000) / 1000),
            popular: idx === 0
          }));
        }
      } else if (entity.type === 'artist') {
        const topData = await spotifyFetch(`/artists/${entity.spotifyId}/top-tracks?market=from_token`);
        if (topData && Array.isArray(topData.tracks)) {
          entity.tracks = topData.tracks.map((t, idx) => ({
            num: idx + 1,
            id: t.id,
            uri: t.uri,
            title: t.name,
            artist: entity.title,
            album: t.album ? t.album.name : '',
            cover: (t.album && t.album.images && t.album.images[0]) ? t.album.images[0].url : entity.cover,
            duration: Math.round((t.duration_ms || 200000) / 1000),
            popular: idx < 3
          }));
        }
      }
    } else if (entity.tracks && (entity.type === 'playlist' || entity.type === 'liked')) {
      if (typeof entity.tracksTotal === 'number') {
        entity.tracksNextOffset = entity.tracks.length;
        entity.hasMoreTracks = entity.tracksNextOffset < entity.tracksTotal;
      }
    }

    const tracks = entity.tracks || [];
    tracklistEl.innerHTML = tracks.map((track, idx) => {
      const isPlayingTrack = (state.playingTrackId && track.id === state.playingTrackId) ||
        (state.playingTrackTitle === track.title);
      const isLiked = track.id ? liveCatalog.likedTrackIds.has(track.id) : false;
      const showDot = track.popular || isPlayingTrack;
      return `
        <div class="track-row ${isPlayingTrack ? 'playing' : ''}"
             data-entity-id="${entity.id}"
             data-track-index="${idx}"
             data-track-id="${track.id || ''}"
             data-track-uri="${track.uri || ''}"
             data-track-title="${track.title.replace(/"/g, '&quot;')}"
             data-track-artist="${(track.artist || entity.artist).replace(/"/g, '&quot;')}"
             data-track-album="${(track.album || entity.title).replace(/"/g, '&quot;')}"
             data-track-cover="${track.cover || entity.cover}"
             data-track-duration="${track.duration || 210}">
          <div class="track-num-cell">
            ${showDot ? '<span class="track-playing-dot"></span>' : ''}
            <span>${(typeof track.num === 'number' && !isNaN(track.num)) ? track.num : (idx + 1)}</span>
          </div>
          <div class="track-name">${track.title}</div>
          <button class="track-row-like-btn ${isLiked ? 'liked' : ''}" data-track-id="${track.id || ''}" data-track-title="${track.title.replace(/"/g, '&quot;')}" data-track-artist="${(track.artist || entity.artist || '').replace(/"/g, '&quot;')}" data-track-cover="${track.cover || entity.cover || ''}" title="${isLiked ? 'Eliminar de Tus me gusta' : 'Guardar en Tus me gusta'}">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="${isLiked ? '#1ed760' : 'none'}" stroke="${isLiked ? '#1ed760' : 'currentColor'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          </button>
          <button class="track-more-btn" title="More options">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.8"></circle>
              <circle cx="12" cy="12" r="1.8"></circle>
              <circle cx="12" cy="19" r="1.8"></circle>
            </svg>
          </button>
        </div>
      `;
    }).join('');
  }

  // Progressive Scroll / Infinite Pagination for Playlists and Liked Songs (> 50 Tracks)
  async function loadMorePlaylistTracks(entity) {
    if (!entity || entity.isLoadingMoreTracks || !entity.hasMoreTracks) return;
    entity.isLoadingMoreTracks = true;

    const tracklistEl = document.getElementById('albumTracklistContainer');
    const loaderId = `tracklistLoader_${Date.now()}`;
    const loaderEl = document.createElement('div');
    loaderEl.id = loaderId;
    loaderEl.className = 'tracklist-loading-indicator';
    loaderEl.innerHTML = `
      <div style="display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,0.2);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:12px;"></div>
      <span style="font-size:14px;font-weight:500;color:var(--album-fg-secondary);">Cargando más canciones...</span>
    `;
    loaderEl.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:22px 0;width:100%;';
    tracklistEl.appendChild(loaderEl);

    try {
      let nextItems = [];
      const offset = entity.tracksNextOffset || entity.tracks.length;
      if (entity.type === 'playlist' && entity.spotifyId) {
        const res = await spotifyFetch(`/playlists/${entity.spotifyId}/tracks?offset=${offset}&limit=50`);
        if (res && Array.isArray(res.items)) {
          nextItems = res.items;
          if (typeof res.total === 'number') entity.tracksTotal = res.total;
        }
      } else if (entity.type === 'liked' || entity.id === 'liked_songs') {
        const res = await spotifyFetch(`/me/tracks?offset=${offset}&limit=50`);
        if (res && Array.isArray(res.items)) {
          nextItems = res.items;
          if (typeof res.total === 'number') entity.tracksTotal = res.total;
        }
      }

      const startIndex = entity.tracks.length;
      const newMappedTracks = nextItems
        .filter(i => i && i.track)
        .map((i, idx) => ({
          num: startIndex + idx + 1,
          id: i.track.id,
          uri: i.track.uri,
          title: i.track.name,
          artist: i.track.artists ? i.track.artists.map(a => a.name).join(', ') : entity.artist,
          album: i.track.album ? i.track.album.name : entity.title,
          cover: (i.track.album && i.track.album.images && i.track.album.images[0]) ? i.track.album.images[0].url : entity.cover,
          duration: Math.round((i.track.duration_ms || 200000) / 1000),
          popular: false
        }));

      const currentLoader = document.getElementById(loaderId);
      if (currentLoader) currentLoader.remove();

      if (newMappedTracks.length > 0) {
        entity.tracks.push(...newMappedTracks);
        entity.tracksNextOffset = entity.tracks.length;
        entity.hasMoreTracks = entity.tracksNextOffset < entity.tracksTotal;

        const newRowsHtml = newMappedTracks.map((track, idx) => {
          const globalIdx = startIndex + idx;
          const isPlayingTrack = (state.playingTrackId && track.id === state.playingTrackId) ||
            (state.playingTrackTitle === track.title);
          const isLiked = track.id ? liveCatalog.likedTrackIds.has(track.id) : false;
          return `
            <div class="track-row ${isPlayingTrack ? 'playing' : ''}"
                 data-entity-id="${entity.id}"
                 data-track-index="${globalIdx}"
                 data-track-id="${track.id || ''}"
                 data-track-uri="${track.uri || ''}"
                 data-track-title="${track.title.replace(/"/g, '&quot;')}"
                 data-track-artist="${(track.artist || entity.artist).replace(/"/g, '&quot;')}"
                 data-track-album="${(track.album || entity.title).replace(/"/g, '&quot;')}"
                 data-track-cover="${track.cover || entity.cover}"
                 data-track-duration="${track.duration || 210}">
              <div class="track-num-cell">
                ${isPlayingTrack ? '<span class="track-playing-dot"></span>' : ''}
                <span>${(typeof track.num === 'number' && !isNaN(track.num)) ? track.num : (globalIdx + 1)}</span>
              </div>
              <div class="track-name">${track.title}</div>
              <button class="track-row-like-btn ${isLiked ? 'liked' : ''}" data-track-id="${track.id || ''}" data-track-title="${track.title.replace(/"/g, '&quot;')}" data-track-artist="${(track.artist || entity.artist || '').replace(/"/g, '&quot;')}" data-track-cover="${track.cover || entity.cover || ''}" title="${isLiked ? 'Eliminar de Tus me gusta' : 'Guardar en Tus me gusta'}">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="${isLiked ? '#1ed760' : 'none'}" stroke="${isLiked ? '#1ed760' : 'currentColor'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
              </button>
              <button class="track-more-btn" title="More options">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="1.8"></circle>
                  <circle cx="12" cy="12" r="1.8"></circle>
                  <circle cx="12" cy="19" r="1.8"></circle>
                </svg>
              </button>
            </div>
          `;
        }).join('');

        tracklistEl.insertAdjacentHTML('beforeend', newRowsHtml);
      } else {
        entity.hasMoreTracks = false;
      }
    } catch (err) {
      console.error('Error loading more playlist tracks:', err);
      const currentLoader = document.getElementById(loaderId);
      if (currentLoader) currentLoader.remove();
    } finally {
      entity.isLoadingMoreTracks = false;
    }
  }

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

  function applyTrackToUI(trackObj, progressSec = 0, isPlaying = false) {
    const artistName = trackObj.artists ? trackObj.artists.map(a => a.name).join(', ') : (trackObj.artist || 'Spotify');
    const albumName = trackObj.album ? (trackObj.album.name || trackObj.album) : '';
    const coverUrl = (trackObj.album && trackObj.album.images && trackObj.album.images[0])
      ? trackObj.album.images[0].url
      : (trackObj.cover || state.playingCover);
    const durationSec = trackObj.duration_ms ? Math.round(trackObj.duration_ms / 1000) : (trackObj.duration || 220);

    const nextTitle = trackObj.name || trackObj.title || '';
    const nextId = cleanTrackId(trackObj.id || trackObj.uri || nextTitle);
    const isFirstTrack = !state.playingTrackId && Boolean(nextId || nextTitle);
    const trackChanged = isFirstTrack || (state.playingTrackId !== nextId) || (state.playingTrackTitle !== nextTitle);

    state.playingTrackId = nextId;
    state.playingTrackUri = trackObj.uri || (nextId ? `spotify:track:${nextId}` : null);
    state.playingTrackTitle = nextTitle;
    state.playingArtist = artistName;
    state.playingArtistId = (trackObj.artists && trackObj.artists[0] && trackObj.artists[0].id) ? trackObj.artists[0].id : state.playingArtistId;
    state.playingAlbumTitle = albumName;
    state.playingCover = coverUrl;
    state.durationSec = durationSec;

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

    // Guarded DOM mutations: never touch .src or .textContent on 2.5s polls unless changed
    if (state.lastRenderedCover !== coverUrl) {
      state.lastRenderedCover = coverUrl;
      miniPlayerThumb.src = coverUrl;
      npCoverArt.src = coverUrl;
      if (npQueueCurrentThumb) npQueueCurrentThumb.src = coverUrl;
    }
    if (state.lastRenderedTitle !== state.playingTrackTitle) {
      state.lastRenderedTitle = state.playingTrackTitle;
      miniPlayerTitle.textContent = state.playingTrackTitle;
      npTrackTitle.textContent = state.playingTrackTitle;
      if (npQueueCurrentTitle) npQueueCurrentTitle.textContent = state.playingTrackTitle;
    }
    if (state.lastRenderedArtistLine !== artistName) {
      state.lastRenderedArtistLine = artistName;
      miniPlayerArtist.textContent = artistName;
      npTrackArtist.textContent = artistName;
      if (npQueueCurrentArtist) npQueueCurrentArtist.textContent = artistName;
    }

    updatePlayPauseIcons();

    if (trackChanged) {
      lyrLog(`trackChanged -> "${nextTitle}" id=${nextId} progress=${progressSec.toFixed(1)}s`);
      extractDynamicPaletteFromCover(coverUrl, false);
      fetchSyncedLyricsForTrack(
        state.playingTrackTitle,
        trackObj.artists ? trackObj.artists[0].name : artistName,
        albumName,
        durationSec
      );
      fetchAndRenderQueueForCurrentTrack(trackObj);
      if (trackObj.id) {
        const isLocallyLiked = liveCatalog.likedTrackIds.has(trackObj.id);
        spotifyAuth.isLiked = isLocallyLiked;
        updateLikeButtonsUI(isLocallyLiked);
        spotifyFetch(`/me/tracks/contains?ids=${trackObj.id}`).then(res => {
          if (Array.isArray(res)) {
            spotifyAuth.isLiked = !!res[0];
            if (spotifyAuth.isLiked) {
              liveCatalog.likedTrackIds.add(trackObj.id);
            } else {
              liveCatalog.likedTrackIds.delete(trackObj.id);
            }
            updateLikeButtonsUI(spotifyAuth.isLiked);
          }
        }).catch(e => console.warn('[tracks/contains error]', e));
      } else {
        updateLikeButtonsUI(false);
      }
      updateScrubberAndLyricsUI(true);
    } else if (!state.isPlaying) {
      updateScrubberAndLyricsUI(false);
    }
  }

  async function pollSpotifyCurrentPlayback() {
    if (!spotifyAuth.accessToken) return;
    const pb = await spotifyFetch('/me/player');
    if (pb && pb.item) {
      if (pb.device && pb.device.id) {
        spotifyAuth.activeDeviceId = pb.device.id;
      }
      spotifyAuth.shuffleState = !!pb.shuffle_state;
      spotifyAuth.repeatState = pb.repeat_state || 'off';
      const rawSec = (pb.progress_ms || 0) / 1000;
      applyTrackToUI(pb.item, rawSec, !!pb.is_playing);
    }
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

  function cacheLyricLineOffsets() {
    const cache = state.lyricDOMCache;
    if (!cache || cache.length === 0) return;
    for (let i = 0; i < cache.length; i++) {
      cache[i].targetOffset = Math.max(0, cache[i].el.offsetTop - 210);
    }
  }

  function buildLyricsDOM(lyricsArray) {
    lyricsScrollTrack.innerHTML = lyricsArray.map((line, lineIdx) => {
      const words = line.text.trim().split(/\s+/);
      const lineDuration = Math.max(0.85, (line.end || line.start + 4) - line.start);

      // Weight each word's singing duration by syllable/character length + phrase-ending sustain
      const weights = words.map((w, idx) => {
        const cleanLen = Math.max(2, w.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ]/g, '').length);
        const isLastWord = idx === words.length - 1;
        const hasPausePunct = /[,.;:!?\u2026~-]$/.test(w);
        const hasRepeatedVowel = /([aeiouáéíóú])\1/i.test(w);
        let mult = 1.0;
        if (isLastWord) mult *= 1.65;      // Singers naturally hold the final word of a line
        if (hasPausePunct) mult *= 1.35;   // Held before a comma/breath
        if (hasRepeatedVowel) mult *= 1.4; // Stretched vowel
        return cleanLen * mult;
      });

      const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
      let cursorSec = line.start;

      const wordsHtml = words.map((w, wIdx) => {
        const dur = (weights[wIdx] / totalWeight) * lineDuration;
        const wStart = cursorSec;
        const wEnd = cursorSec + dur;
        cursorSec = wEnd;
        const isLast = wIdx === words.length - 1;
        const isHeld = dur >= 0.50 || isLast;
        return `<span class="lyric-word pending" data-wstart="${wStart.toFixed(3)}" data-wend="${wEnd.toFixed(3)}" data-held="${isHeld ? '1' : '0'}" data-last="${isLast ? '1' : '0'}">${w}${!isLast ? ' ' : ''}</span>`;
      }).join('');

      const initialCls = getLyricLineClass(lineIdx, 0);
      return `<div class="${initialCls}" data-line-idx="${lineIdx}" data-start="${line.start}" data-end="${line.end}">${wordsHtml}</div>`;
    }).join('');

    // Pre-cache all DOM references & timing floats so the 60fps loop does zero DOM queries or layout reads
    const lineEls = Array.from(lyricsScrollTrack.querySelectorAll('.lyric-line'));
    state.lyricDOMCache = lineEls.map((lineEl, idx) => {
      const lineData = lyricsArray[idx] || {};
      const wordEls = Array.from(lineEl.querySelectorAll('.lyric-word'));
      const initialCls = getLyricLineClass(idx, 0);
      return {
        el: lineEl,
        lastClass: initialCls,
        targetOffset: Math.max(0, lineEl.offsetTop - 210),
        start: lineData.start || 0,
        end: lineData.end || ((lineData.start || 0) + 4),
        lineEnd: lineData.lineEnd || lineData.end || ((lineData.start || 0) + 5),
        words: wordEls.map(wEl => ({
          el: wEl,
          wStart: parseFloat(wEl.getAttribute('data-wstart')) || 0,
          wEnd: parseFloat(wEl.getAttribute('data-wend')) || 0.4,
          isHeld: wEl.getAttribute('data-held') === '1',
          isLast: wEl.getAttribute('data-last') === '1',
          state: 'pending'
        }))
      };
    });
    requestAnimationFrame(cacheLyricLineOffsets);
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const mins = Math.floor(s / 60);
    const rem = s % 60;
    return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
  }

  // Hardware PCM clock already accounts for AudioTrack + AudioFlinger buffer latency
  const LYRIC_SYNC_LEAD_SEC = 0.0;

  function updateScrubberAndLyricsUI(forceScroll = false) {
    if (!forceScroll && !state.isNowPlayingOpen) return;

    const ratio = Math.min(1, Math.max(0, state.currentTimeSec / Math.max(1, state.durationSec)));
    if (forceScroll || Math.abs(ratio - state.lastScrubberRatio) >= 0.0008) {
      state.lastScrubberRatio = ratio;
      npScrubberFill.style.transform = `scaleX(${ratio.toFixed(4)})`;
    }

    // Only update time text DOM once per integer second (never 60x/sec)
    const curIntSec = Math.floor(state.currentTimeSec);
    if (forceScroll || curIntSec !== state.lastRenderedSec) {
      state.lastRenderedSec = curIntSec;
      npTimeElapsed.textContent = formatTime(curIntSec);
      const remaining = Math.max(0, state.durationSec - curIntSec);
      npTimeRemaining.textContent = `-${formatTime(remaining)}`;
    }

    const cache = state.lyricDOMCache;
    if (!cache || cache.length === 0) return;

    const lyricTime = state.currentTimeSec + LYRIC_SYNC_LEAD_SEC;
    let newActiveIdx = 0;
    for (let i = 0; i < cache.length; i++) {
      if (lyricTime >= cache[i].start && lyricTime < cache[i].lineEnd) {
        newActiveIdx = i;
        break;
      } else if (lyricTime >= cache[i].lineEnd) {
        newActiveIdx = i;
      }
    }

    const lineChanged = forceScroll || newActiveIdx !== state.activeLineIndex;

    if (lineChanged) {
      if (state.activeLineIndex >= 0 && cache[state.activeLineIndex]) {
        const oldWords = cache[state.activeLineIndex].words;
        for (let w = 0; w < oldWords.length; w++) {
          if (oldWords[w].state !== 'pending') {
            oldWords[w].state = 'pending';
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

    const activeLine = cache[newActiveIdx];
    if (activeLine) {
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
        } else {
          if (wObj.state !== 'pending') {
            wObj.state = 'pending';
            wObj.el.className = 'lyric-word pending';
          }
        }
      }
    }

    if (lineChanged) {
      state.activeLineIndex = newActiveIdx;
      if (activeLine) {
        const targetOffset = typeof activeLine.targetOffset === 'number'
          ? activeLine.targetOffset
          : Math.max(0, activeLine.el.offsetTop - 210);
        lyricsScrollTrack.style.transform = `translate3d(0, -${targetOffset}px, 0)`;
      }
    }
  }

  function updatePlayPauseIcons() {
    if (npQueueEq) npQueueEq.classList.toggle('playing', !!state.isPlaying);
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
    const cover = (t.album && Array.isArray(t.album.images) && t.album.images[0])
      ? t.album.images[0].url
      : (t.cover || DEFAULT_ALBUM_COVER);
    const duration = t.duration_ms ? Math.round(t.duration_ms / 1000) : (t.duration || 210);
    return {
      id: t.id || t.uri || title,
      uri: t.uri || '',
      title,
      artist,
      album,
      cover,
      duration
    };
  }

  const LYRICS_ICON_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-9 11H7V9h4v4zm6 0h-4V9h4v4z"/></svg>`;
  const QUEUE_ICON_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><circle cx="4" cy="6" r="1.5" fill="currentColor"></circle><circle cx="4" cy="12" r="1.5" fill="currentColor"></circle><circle cx="4" cy="18" r="1.5" fill="currentColor"></circle></svg>`;
  const CENTERED_ICON_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"></rect><circle cx="12" cy="12" r="3.5"></circle></svg>`;
  const EXPAND_PANEL_ICON_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"></rect><line x1="15" y1="3" x2="15" y2="21"></line></svg>`;

  function buildQueueRowHTML(track, idx, sourceType = 'queue') {
    const safeTitle = (track.title || '').replace(/"/g, '&quot;');
    const safeArtist = (track.artist || '').replace(/"/g, '&quot;');
    const safeAlbum = (track.album || '').replace(/"/g, '&quot;');
    const coverUrl = track.cover || DEFAULT_ALBUM_COVER;
    const durSec = track.duration || 210;
    const durFormatted = formatTime(durSec);
    return `
      <div class="np-queue-row"
           data-queue-source="${sourceType}"
           data-queue-idx="${idx}"
           data-track-id="${track.id || ''}"
           data-track-uri="${track.uri || ''}"
           data-track-title="${safeTitle}"
           data-track-artist="${safeArtist}"
           data-track-album="${safeAlbum}"
           data-track-cover="${coverUrl}"
           data-track-duration="${durSec}">
        <span class="np-queue-index">${idx + 1}</span>
        <img src="${coverUrl}" alt="${safeTitle}" class="np-queue-thumb" loading="lazy" />
        <div class="np-queue-meta">
          <div class="np-queue-title">${track.title}</div>
          <div class="np-queue-artist">${track.artist}</div>
        </div>
        <div class="np-queue-duration">${durFormatted}</div>
      </div>
    `;
  }

  function renderQueuePanelUI() {
    if (!npQueueListContainer) return;

    // Do not duplicate the current track card in the right column, as Now Playing
    // is already permanently featured in large format on the left column
    if (npQueueCurrentCard) {
      npQueueCurrentCard.style.display = 'none';
    }

    const queue = state.liveQueueTracks || [];
    const discovery = state.discoveryTracks || [];

    // Priority 1: Pending tracks exist in queue
    if (queue.length > 0) {
      if (npQueueHeading) npQueueHeading.textContent = 'A continuación';
      if (npQueueSubheading) {
        npQueueSubheading.textContent = `Siguiente en la lista • ${queue.length} canción${queue.length === 1 ? '' : 'es'}`;
        npQueueSubheading.style.display = 'block';
      }
      if (npQueueSeeAllBtn) npQueueSeeAllBtn.style.display = 'none';
      npQueueListContainer.innerHTML = queue.slice(0, 25).map((t, i) => buildQueueRowHTML(t, i, 'queue')).join('');
      return;
    }

    // Priority 2: Musical Discovery when no pending queue exists and API returned recommendations
    if (discovery.length > 0) {
      if (npQueueHeading) npQueueHeading.textContent = 'Descubrimiento musical';
      if (npQueueSubheading) {
        npQueueSubheading.textContent = state.playingArtist
          ? `Sugerencias basadas en ${state.playingArtist}`
          : 'Para seguir escuchando según esta canción';
        npQueueSubheading.style.display = 'block';
      }
      if (npQueueSeeAllBtn) npQueueSeeAllBtn.style.display = 'none';

      npQueueListContainer.innerHTML = discovery.slice(0, 8).map((t, i) => buildQueueRowHTML(t, i, 'discovery')).join('');
      return;
    }

    // Priority 3: Fallback empty state only when neither queue nor discovery tracks are available
    if (npQueueHeading) npQueueHeading.textContent = 'A continuación';
    if (npQueueSubheading) npQueueSubheading.style.display = 'none';
    if (npQueueSeeAllBtn) npQueueSeeAllBtn.style.display = 'none';

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
          <div class="np-queue-empty-title">Cola de reproducción vacía</div>
          <div class="np-queue-empty-sub">Agrega canciones o elige una lista para continuar</div>
        </div>
      </div>
    `;
  }

  async function fetchAndRenderQueueForCurrentTrack(trackObj) {
    // If tracks are available from local context:
    if (Array.isArray(state.contextUpcomingTracks) && state.contextUpcomingTracks.length > 0) {
      const currentIdx = state.contextUpcomingTracks.findIndex(t => (t.id && t.id === state.playingTrackId) || (t.title && t.title === state.playingTrackTitle));
      const sliceStart = currentIdx >= 0 ? currentIdx + 1 : 0;
      state.liveQueueTracks = state.contextUpcomingTracks
        .slice(sliceStart)
        .map(normalizeApiTrack)
        .filter(t => t && t.title !== state.playingTrackTitle);
    } else {
      state.liveQueueTracks = [];
    }
    state.discoveryTracks = [];

    renderQueuePanelUI();

    if (!spotifyAuth.accessToken) return;

    // Priority 1: Check real Spotify Player Queue (/me/player/queue)
    const qRes = await spotifyFetch('/me/player/queue');
    if (qRes && Array.isArray(qRes.queue) && qRes.queue.length > 0) {
      const seen = new Set();
      const apiQueue = [];
      for (let i = 0; i < qRes.queue.length; i++) {
        const norm = normalizeApiTrack(qRes.queue[i]);
        if (!norm) continue;
        // Skip duplicate of currently playing track
        if (i === 0 && (norm.id === state.playingTrackId || norm.title === state.playingTrackTitle)) continue;
        const key = norm.id || `${norm.title}|${norm.artist}`;
        if (seen.has(key)) continue;
        seen.add(key);
        apiQueue.push(norm);
        if (apiQueue.length >= 25) break;
      }
      if (apiQueue.length > 0) {
        state.liveQueueTracks = apiQueue;
        renderQueuePanelUI();
        return;
      }
    }

    if (state.liveQueueTracks.length > 0) {
      renderQueuePanelUI();
      return;
    }

    // Priority 2: Queue is empty -> Query API for musical discovery alternatives
    const discovered = [];
    const seenDisc = new Set([state.playingTrackId, state.playingTrackTitle]);

    if (state.playingTrackId && /^[a-zA-Z0-9]{22}$/.test(state.playingTrackId)) {
      const recRes = await spotifyFetch(`/recommendations?seed_tracks=${state.playingTrackId}&limit=6`);
      if (recRes && Array.isArray(recRes.tracks)) {
        recRes.tracks.forEach(t => {
          const norm = normalizeApiTrack(t);
          if (norm && !seenDisc.has(norm.id) && !seenDisc.has(norm.title)) {
            seenDisc.add(norm.id);
            seenDisc.add(norm.title);
            discovered.push(norm);
          }
        });
      }
    }

    if (discovered.length === 0 && state.playingArtistId) {
      const artTop = await spotifyFetch(`/artists/${state.playingArtistId}/top-tracks?market=from_token`);
      if (artTop && Array.isArray(artTop.tracks)) {
        artTop.tracks.forEach(t => {
          const norm = normalizeApiTrack(t);
          if (norm && !seenDisc.has(norm.id) && !seenDisc.has(norm.title)) {
            seenDisc.add(norm.id);
            seenDisc.add(norm.title);
            discovered.push(norm);
          }
        });
      }
    }

    if (discovered.length === 0 && Array.isArray(liveCatalog.likedTracks) && liveCatalog.likedTracks.length > 0) {
      liveCatalog.likedTracks.slice(0, 6).forEach(t => {
        const norm = normalizeApiTrack(t);
        if (norm && !seenDisc.has(norm.id) && !seenDisc.has(norm.title)) {
          seenDisc.add(norm.id);
          seenDisc.add(norm.title);
          discovered.push(norm);
        }
      });
    }

    state.discoveryTracks = discovered.slice(0, 8);
    renderQueuePanelUI();
    updateNowPlayingRightPanelMode();
  }

  function updateNowPlayingRightPanelMode() {
    const npMainGrid = document.querySelector('.np-main-grid');
    const hasLyrics = Boolean(state.hasValidLyrics || state.lyricsLoading);
    const hasQueue = Boolean(Array.isArray(state.liveQueueTracks) && state.liveQueueTracks.length > 0);

    let mode = state.nowPlayingMode || 'lyrics';

    // 1. Validation & Auto-detection:
    if (state.userForcedCentered) {
      mode = 'centered';
    } else if (!hasLyrics && !hasQueue) {
      // Song has no queue AND no lyrics -> automatically center!
      mode = 'centered';
    } else if (mode === 'lyrics') {
      if (!hasLyrics && hasQueue) {
        mode = 'queue';
      } else if (!hasLyrics && !hasQueue) {
        mode = 'centered';
      }
    } else if (mode === 'queue') {
      if (!hasQueue && hasLyrics) {
        mode = 'lyrics';
      } else if (!hasQueue && !hasLyrics) {
        mode = 'centered';
      }
    } else if (mode !== 'centered') {
      mode = hasLyrics ? 'lyrics' : (hasQueue ? 'queue' : 'centered');
    }

    state.nowPlayingMode = mode;
    const isCentered = (mode === 'centered');
    const showLyrics = (mode === 'lyrics');
    const showQueue = (mode === 'queue');

    // 2. 60fps GPU Hardware-Accelerated Centered Mode (slide & scale)
    if (npMainGrid) {
      npMainGrid.classList.toggle('centered-layout', isCentered);
    }

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
    if (showLyrics) {
      if (state.hasValidLyrics) {
        requestAnimationFrame(() => {
          cacheLyricLineOffsets();
          updateScrubberAndLyricsUI(true);
        });
      } else if (state.lyricsLoading) {
        if (lyricsScrollTrack) {
          lyricsScrollTrack.innerHTML = `
            <div class="lyric-line distance-1" style="opacity: 0.65; font-size: 22px; margin-top: 140px; text-align: left;">
              Buscando letra...
            </div>
          `;
        }
      }
    } else if (showQueue) {
      renderQueuePanelUI();
    }
  }

  // --------------------------------------------------------------------------
  // 10. UI NAVIGATION & EVENT HANDLERS
  // --------------------------------------------------------------------------
  function switchScreen(screenName) {
    if (screenName !== state.activeScreen) {
      state.previousScreen = state.activeScreen;
      state.activeScreen = screenName;
    }

    document.querySelectorAll('.screen-view').forEach(sec => {
      sec.classList.toggle('active', sec.id === `view-${screenName}`);
    });

    document.querySelectorAll('.dock-tab').forEach(tab => {
      const navTarget = tab.getAttribute('data-nav');
      tab.classList.toggle('active', navTarget === screenName);
    });

    if (screenName === 'album') {
      document.body.classList.remove('artist-view-active');
      if (state.selectedEntityId === 'liked_songs' || (liveCatalog.entities[state.selectedEntityId] && liveCatalog.entities[state.selectedEntityId].type === 'liked')) {
        applyNeutralLikedTheme();
      } else {
        const isDark = document.body.classList.contains('theme-dark');
        if (isDark) {
          document.body.classList.add('album-dark-active');
          document.body.classList.remove('album-light-active');
        } else {
          document.body.classList.toggle('album-dark-active', !state.albumIsLight);
          document.body.classList.toggle('album-light-active', !!state.albumIsLight);
        }
      }
    } else if (screenName === 'artist') {
      document.body.classList.add('artist-view-active');
      document.body.classList.remove('album-dark-active', 'album-light-active');
    } else {
      document.body.classList.remove('album-dark-active', 'album-light-active', 'artist-view-active');
    }
  }

  function openNowPlaying() {
    state.isNowPlayingOpen = true;
    clearTimeout(npFullyOpenTimer);
    nowPlayingOverlay.style.transform = '';
    nowPlayingOverlay.classList.add('open');
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

  document.addEventListener('click', async (e) => {
    // 1. Open Entity Card (Album, Playlist, Artist, Liked Songs)
    const entityTrigger = e.target.closest('[data-open-entity]');
    if (entityTrigger) {
      const entityId = entityTrigger.getAttribute('data-open-entity');
      openEntityDetail(entityId);
      return;
    }

    // Legacy fallback attribute
    const albumTrigger = e.target.closest('[data-open-album]');
    if (albumTrigger) {
      openEntityDetail(albumTrigger.getAttribute('data-open-album'));
      return;
    }

    // 2. Direct Track / Context URI Play (from Search, Liked tab, or DJ Livi)
    const directPlay = e.target.closest('[data-play-direct-uri]');
    if (directPlay) {
      const uri = directPlay.getAttribute('data-play-direct-uri');
      const title = directPlay.getAttribute('data-title') || 'Track';
      const artist = directPlay.getAttribute('data-artist') || '';
      const cover = directPlay.getAttribute('data-cover') || state.playingCover;
      state.singleTrackPlayback = !uri.startsWith('spotify:playlist:') && !uri.startsWith('spotify:album:');
      state.contextUpcomingTracks = [];
      applyTrackToUI({ id: uri, uri, name: title, artist, cover, duration_ms: 210000 }, 0, true);
      openNowPlaying();
      if (uri) {
        if (uri.startsWith('spotify:playlist:') || uri.startsWith('spotify:album:')) {
          playSpotifyContext(uri).then(res => {
            if (res && res.error) {
              console.warn('[Spotify Playback Error]', res.error);
              if (uri.includes('37i9dQZF1EYkqdzj48dyYq')) {
                alert('Nota: Spotify restringe el AI DJ exclusivamente a su app oficial de iOS/Android; la API de Spotify no permite iniciar la voz del DJ en clientes externos.');
              }
            }
          });
        } else {
          playSpotifyUris([uri], []).then(res => {
            if (res && res.error) {
              console.warn('[Spotify Playback Error]', res.error);
            }
          });
        }
      }
      return;
    }

    // 3. Search Query Chip Click
    const queryChip = e.target.closest('[data-search-query]');
    if (queryChip) {
      const q = queryChip.getAttribute('data-search-query');
      const input = document.getElementById('searchInput');
      input.value = q;
      input.dispatchEvent(new Event('input'));
      return;
    }

    // 4. Navigation Links / Dock Tabs
    const navTrigger = e.target.closest('[data-nav]');
    if (navTrigger) {
      switchScreen(navTrigger.getAttribute('data-nav'));
      return;
    }

    // 5A. Click Like on Track Row inside Album/Playlist Detail View
    const trackLikeBtn = e.target.closest('.track-row-like-btn');
    if (trackLikeBtn) {
      e.stopPropagation();
      const trackId = trackLikeBtn.getAttribute('data-track-id');
      const trackTitle = trackLikeBtn.getAttribute('data-track-title') || '';
      const trackArtist = trackLikeBtn.getAttribute('data-track-artist') || '';
      const trackCover = trackLikeBtn.getAttribute('data-track-cover') || '';
      toggleLikeTrack(trackId, { title: trackTitle, artist: trackArtist, cover: trackCover });
      return;
    }
    if (e.target.closest('.track-more-btn')) return;

    // 5B. Play Track Row inside Album/Playlist Detail View
    const trackRow = e.target.closest('.track-row');
    if (trackRow) {
      const entityId = trackRow.getAttribute('data-entity-id');
      const idx = parseInt(trackRow.getAttribute('data-track-index'), 10) || 0;
      const trackUri = trackRow.getAttribute('data-track-uri');
      const title = trackRow.getAttribute('data-track-title');
      const artist = trackRow.getAttribute('data-track-artist');
      const album = trackRow.getAttribute('data-track-album');
      const cover = trackRow.getAttribute('data-track-cover');
      const duration = parseInt(trackRow.getAttribute('data-track-duration'), 10) || 210;

      const entity = liveCatalog.entities[entityId] || ALBUMS[entityId];
      const upcomingSlice = (entity && Array.isArray(entity.tracks)) ? entity.tracks.slice(idx + 1) : [];
      state.singleTrackPlayback = false;
      state.contextUpcomingTracks = upcomingSlice;
      applyTrackToUI({ id: trackUri || title, uri: trackUri, name: title, artist, album, cover, duration }, 0, true);
      openNowPlaying();

      if (entity && entity.uri && (entity.type === 'album' || entity.type === 'playlist')) {
        playSpotifyContext(entity.uri, idx, upcomingSlice);
      } else if (entity && Array.isArray(entity.tracks)) {
        const uris = entity.tracks.slice(idx).map(t => t.uri).filter(Boolean);
        if (uris.length > 0) playSpotifyUris(uris, upcomingSlice);
      } else if (trackUri) {
        playSpotifyUris([trackUri], []);
      }
      return;
    }

    // 5B. Click Track inside Queue ("A continuación") or API Discovery List
    const queueRow = e.target.closest('.np-queue-row');
    if (queueRow) {
      const qSource = queueRow.getAttribute('data-queue-source') || 'queue';
      const qIdx = parseInt(queueRow.getAttribute('data-queue-idx'), 10) || 0;
      const trackId = queueRow.getAttribute('data-track-id');
      const trackUri = queueRow.getAttribute('data-track-uri');
      const title = queueRow.getAttribute('data-track-title');
      const artist = queueRow.getAttribute('data-track-artist');
      const album = queueRow.getAttribute('data-track-album');
      const cover = queueRow.getAttribute('data-track-cover');
      const duration = parseInt(queueRow.getAttribute('data-track-duration'), 10) || 210;

      if (qSource === 'queue' && state.liveQueueTracks.length > qIdx) {
        const remaining = state.liveQueueTracks.slice(qIdx + 1);
        state.singleTrackPlayback = false;
        state.contextUpcomingTracks = remaining;
        applyTrackToUI({ id: trackId || trackUri || title, uri: trackUri, name: title, artist, album, cover, duration }, 0, true);
        const uris = [trackUri, ...remaining.map(t => t.uri)].filter(Boolean);
        if (uris.length > 0) playSpotifyUris(uris, remaining);
      } else {
        state.singleTrackPlayback = true;
        state.contextUpcomingTracks = [];
        applyTrackToUI({ id: trackId || trackUri || title, uri: trackUri, name: title, artist, album, cover, duration }, 0, true);
        if (trackUri) playSpotifyUris([trackUri], []);
      }
      return;
    }

    // 6. Click Lyric Line -> Seek Spotify & Local Timer
    const lyricLine = e.target.closest('.lyric-line');
    if (lyricLine) {
      const startSec = parseFloat(lyricLine.getAttribute('data-start')) || 0;
      const seekMs = Math.round(startSec * 1000);
      state.currentTimeSec = startSec;
      if (bridge && bridge.notifyTrackSeeked) {
        bridge.notifyTrackSeeked(seekMs);
      }
      updateScrubberAndLyricsUI(true);
      if (spotifyAuth.accessToken) {
        spotifyFetch(`/me/player/seek?position_ms=${seekMs}`, { method: 'PUT' });
      }
    }
  });

  // Back Button in Album View
  document.getElementById('albumBackBtn').addEventListener('click', () => {
    const backTarget = state.previousScreen && state.previousScreen !== 'album' ? state.previousScreen : 'home';
    switchScreen(backTarget);
  });

  // Progressive Scroll / Infinite Pagination trigger on Album View
  const viewAlbumEl = document.getElementById('view-album');
  if (viewAlbumEl) {
    viewAlbumEl.addEventListener('scroll', () => {
      if (state.activeScreen !== 'album') return;
      const scrollRemaining = viewAlbumEl.scrollHeight - viewAlbumEl.scrollTop - viewAlbumEl.clientHeight;
      if (scrollRemaining < 500) {
        const currentEntity = liveCatalog.entities[state.selectedEntityId];
        if (currentEntity && currentEntity.hasMoreTracks && !currentEntity.isLoadingMoreTracks) {
          loadMorePlaylistTracks(currentEntity);
        }
      }
    });
  }

  // Album "Play" Pill Button
  document.getElementById('albumPlayAllBtn').addEventListener('click', () => {
    const entity = liveCatalog.entities[state.selectedEntityId] || ALBUMS[state.selectedEntityId] || ALBUMS.deeper_well;
    const upcomingSlice = (entity && Array.isArray(entity.tracks)) ? entity.tracks.slice(1) : [];
    state.singleTrackPlayback = false;
    state.contextUpcomingTracks = upcomingSlice;
    if (entity.tracks && entity.tracks[0]) {
      const t = entity.tracks[0];
      applyTrackToUI({ id: t.id || t.title, uri: t.uri, name: t.title, artist: t.artist || entity.artist, album: entity.title, cover: t.cover || entity.cover, duration: t.duration }, 0, true);
    }
    openNowPlaying();
    if (entity.uri && (entity.type === 'album' || entity.type === 'playlist')) {
      playSpotifyContext(entity.uri, 0, upcomingSlice);
    } else if (entity.tracks) {
      const uris = entity.tracks.map(t => t.uri).filter(Boolean);
      if (uris.length > 0) playSpotifyUris(uris, upcomingSlice);
    }
  });

  // Artist View Navigation & Buttons
  const artistBackBtn = document.getElementById('artistBackBtn');
  if (artistBackBtn) {
    artistBackBtn.addEventListener('click', () => {
      const backTarget = state.previousScreen && state.previousScreen !== 'artist' ? state.previousScreen : 'home';
      switchScreen(backTarget);
    });
  }

  // Artist Tabs: Inicio & Información
  document.querySelectorAll('.artist-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      switchArtistTab(btn.getAttribute('data-artist-tab'));
    });
  });

  // Ver más / Ver menos tracks toggle
  const artistMoreTracksBtn = document.getElementById('artistMoreTracksBtn');
  if (artistMoreTracksBtn) {
    artistMoreTracksBtn.addEventListener('click', () => {
      state.artistShowingAllTracks = !state.artistShowingAllTracks;
      updateArtistSeeMoreButton(state.artistShowingAllTracks);
      const artist = liveCatalog.entities[state.selectedArtistId] || (DEMO_ARTISTS[state.selectedArtistId] ? { ...DEMO_ARTISTS[state.selectedArtistId] } : null);
      if (artist && artist.tracks) {
        renderArtistTracks(artist.tracks);
      }
    });
  }

  // Play button on Artist Header
  const artistPlayBtn = document.getElementById('artistPlayBtn');
  if (artistPlayBtn) {
    artistPlayBtn.addEventListener('click', () => {
      const artist = liveCatalog.entities[state.selectedArtistId] || (DEMO_ARTISTS[state.selectedArtistId] ? { ...DEMO_ARTISTS[state.selectedArtistId] } : null);
      const tracks = (artist && artist.tracks) ? artist.tracks : [];
      if (!tracks || tracks.length === 0) return;
      const first = tracks[0];
      state.singleTrackPlayback = false;
      state.contextUpcomingTracks = tracks.slice(1).map(t => ({
        id: t.id || t.uri,
        uri: t.uri,
        name: t.title,
        artist: t.artist || artist.name || artist.title,
        album: t.album || 'Top Tracks',
        cover: t.cover || artist.cover,
        duration: t.duration || 210
      }));
      applyTrackToUI({
        id: first.id || first.uri,
        uri: first.uri,
        name: first.title,
        artist: first.artist || artist.name || artist.title,
        album: first.album || 'Top Tracks',
        cover: first.cover || artist.cover,
        duration: first.duration || 210
      }, 0, true);
      openNowPlaying();
      if (artist.uri && artist.spotifyId) {
        playSpotifyContext(artist.uri);
      } else if (first.uri) {
        playSpotifyTrackUri(first.uri);
      }
    });
  }

  // Shuffle button on Artist Header
  const artistShuffleBtn = document.getElementById('artistShuffleBtn');
  if (artistShuffleBtn) {
    artistShuffleBtn.addEventListener('click', () => {
      const artist = liveCatalog.entities[state.selectedArtistId] || (DEMO_ARTISTS[state.selectedArtistId] ? { ...DEMO_ARTISTS[state.selectedArtistId] } : null);
      const tracks = (artist && artist.tracks) ? artist.tracks : [];
      if (!tracks || tracks.length === 0) return;
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      const first = shuffled[0];
      state.singleTrackPlayback = false;
      state.contextUpcomingTracks = shuffled.slice(1).map(t => ({
        id: t.id || t.uri,
        uri: t.uri,
        name: t.title,
        artist: t.artist || artist.name || artist.title,
        album: t.album || 'Top Tracks',
        cover: t.cover || artist.cover,
        duration: t.duration || 210
      }));
      applyTrackToUI({
        id: first.id || first.uri,
        uri: first.uri,
        name: first.title,
        artist: first.artist || artist.name || artist.title,
        album: first.album || 'Top Tracks',
        cover: first.cover || artist.cover,
        duration: first.duration || 210
      }, 0, true);
      openNowPlaying();
      if (artist.uri && artist.spotifyId) {
        playSpotifyContext(artist.uri);
      } else if (first.uri) {
        playSpotifyTrackUri(first.uri);
      }
    });
  }

  // Follow button toggle
  const artistFollowBtn = document.getElementById('artistFollowBtn');
  if (artistFollowBtn) {
    artistFollowBtn.addEventListener('click', () => {
      artistFollowBtn.classList.toggle('following');
      if (artistFollowBtn.classList.contains('following')) {
        artistFollowBtn.innerHTML = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#1ed760" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      } else {
        artistFollowBtn.innerHTML = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
      }
    });
  }

  // Click on Populares track
  const artistTracklistEl = document.getElementById('artistTracklist');
  if (artistTracklistEl) {
    artistTracklistEl.addEventListener('click', (e) => {
      const likeBtn = e.target.closest('.artist-track-like-btn');
      if (likeBtn) {
        e.stopPropagation();
        const trackId = likeBtn.getAttribute('data-track-id');
        const trackTitle = likeBtn.getAttribute('data-track-title') || '';
        const artist = liveCatalog.entities[state.selectedArtistId] || (DEMO_ARTISTS[state.selectedArtistId] ? { ...DEMO_ARTISTS[state.selectedArtistId] } : null);
        toggleLikeTrack(trackId, { title: trackTitle, artist: artist ? (artist.name || artist.title) : '' });
        return;
      }
      if (e.target.closest('.artist-track-more-btn')) return;

      const item = e.target.closest('.artist-track-item');
      if (!item) return;
      if (e.target.closest('.artist-track-more-btn')) return;

      const idx = parseInt(item.getAttribute('data-artist-track-index'), 10) || 0;
      const artist = liveCatalog.entities[state.selectedArtistId] || (DEMO_ARTISTS[state.selectedArtistId] ? { ...DEMO_ARTISTS[state.selectedArtistId] } : null);
      const tracks = (artist && artist.tracks) ? artist.tracks : [];
      const track = tracks[idx];
      if (!track) return;

      document.querySelectorAll('.artist-track-item').forEach((el, i) => {
        el.classList.toggle('playing', i === idx);
      });

      const upcoming = tracks.slice(idx + 1).map(t => ({
        id: t.id || t.uri,
        uri: t.uri,
        name: t.title,
        artist: t.artist || artist.name || artist.title,
        album: t.album || 'Top Tracks',
        cover: t.cover || artist.cover,
        duration: t.duration || 210
      }));

      state.singleTrackPlayback = false;
      state.contextUpcomingTracks = upcoming;
      applyTrackToUI({
        id: track.id || track.uri,
        uri: track.uri,
        name: track.title,
        artist: track.artist || artist.name || artist.title,
        album: track.album || 'Top Tracks',
        cover: track.cover || artist.cover,
        duration: track.duration || 210
      }, 0, true);

      openNowPlaying();

      if (track.uri) {
        if (artist.uri && artist.spotifyId) {
          playSpotifyContext(artist.uri, idx, upcoming);
        } else {
          playSpotifyUris([track.uri], upcoming);
        }
      }
    });
  }

  // Dedicated Lyrics Button Click Handler (Apple Music style)
  if (npToggleLyricsBtn) {
    npToggleLyricsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const hasLyrics = Boolean(state.hasValidLyrics || state.lyricsLoading);
      if (!hasLyrics) return;

      if (state.nowPlayingMode === 'lyrics') {
        state.nowPlayingMode = 'centered';
        state.userForcedCentered = true;
      } else {
        state.nowPlayingMode = 'lyrics';
        state.userForcedCentered = false;
      }
      updateNowPlayingRightPanelMode();
    });
  }

  // Dedicated Queue Button Click Handler (Apple Music style)
  if (npToggleQueueBtn) {
    npToggleQueueBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.nowPlayingMode === 'queue') {
        state.nowPlayingMode = 'centered';
        state.userForcedCentered = true;
      } else {
        state.nowPlayingMode = 'queue';
        state.userForcedCentered = false;
        if (spotifyAuth.accessToken) fetchAndRenderQueueForCurrentTrack();
      }
      updateNowPlayingRightPanelMode();
    });
  }

  // Tap Cover Art -> Smoothly toggle between Centered Immersive Mode and Split View
  if (npCoverArt) {
    npCoverArt.addEventListener('click', (e) => {
      e.stopPropagation();
      const hasLyrics = Boolean(state.hasValidLyrics || state.lyricsLoading);
      const hasQueue = Boolean(Array.isArray(state.liveQueueTracks) && state.liveQueueTracks.length > 0);

      if (state.nowPlayingMode === 'centered') {
        state.userForcedCentered = false;
        if (hasLyrics) state.nowPlayingMode = 'lyrics';
        else if (hasQueue) state.nowPlayingMode = 'queue';
      } else {
        state.nowPlayingMode = 'centered';
        state.userForcedCentered = true;
      }
      updateNowPlayingRightPanelMode();
    });
  }

  // Expose helper so hardware/UI or console can also toggle directly
  window.toggleLyricsQueueView = function () {
    if (state.nowPlayingMode === 'centered') {
      state.nowPlayingMode = state.hasValidLyrics ? 'lyrics' : 'queue';
    } else {
      state.nowPlayingMode = 'centered';
    }
    updateNowPlayingRightPanelMode();
  };

  // Immediate event from native Librespot playback engine on track change
  window.onNativeTrackChanged = function (trackId) {
    lyrLog(`native track_changed id=${trackId}`);
    pollSpotifyCurrentPlayback();
  };

  window.onNativePlaybackStateChanged = function (isPlaying) {
    state.isPlaying = !!isPlaying;
    updatePlayPauseIcons();
  };

  // "Ver cola ›" Expand / Collapse Queue Button
  if (npQueueSeeAllBtn) {
    npQueueSeeAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.queueExpanded = !state.queueExpanded;
      renderQueuePanelUI();
    });
  }

  // Album Shuffle Button
  document.getElementById('albumShuffleBtn').addEventListener('click', async () => {
    await spotifyFetch('/me/player/shuffle?state=true', { method: 'PUT' });
    document.getElementById('albumPlayAllBtn').click();
  });

  // Mini-Player Click -> Opens Apple Music Now Playing Overlay
  miniPlayer.addEventListener('click', (e) => {
    if (e.target.closest('.mini-ctrl-btn')) return;
    openNowPlaying();
  });

  async function togglePlayPause() {
    state.isPlaying = !state.isPlaying;
    updatePlayPauseIcons();
    if (spotifyAuth.accessToken) {
      const devQ = await getTargetDeviceQuery();
      if (state.isPlaying) {
        await spotifyFetch(`/me/player/play${devQ}`, { method: 'PUT' });
      } else {
        await spotifyFetch(`/me/player/pause${devQ}`, { method: 'PUT' });
      }
    }
  }

  async function skipNextTrack() {
    if (bridge && bridge.notifyTrackLoading) {
      bridge.notifyTrackLoading('');
      state.pcmFlowing = false;
      state.currentTimeSec = 0;
    }
    if (spotifyAuth.accessToken) {
      const devQ = await getTargetDeviceQuery();
      await spotifyFetch(`/me/player/next${devQ}`, { method: 'POST' });
      setTimeout(pollSpotifyCurrentPlayback, 500);
    }
  }

  async function skipPrevTrack() {
    if (spotifyAuth.accessToken && state.currentTimeSec < 4) {
      if (bridge && bridge.notifyTrackLoading) {
        bridge.notifyTrackLoading('');
        state.pcmFlowing = false;
        state.currentTimeSec = 0;
      }
      const devQ = await getTargetDeviceQuery();
      await spotifyFetch(`/me/player/previous${devQ}`, { method: 'POST' });
      setTimeout(pollSpotifyCurrentPlayback, 500);
    } else {
      state.currentTimeSec = 0;
      if (bridge && bridge.notifyTrackSeeked) {
        bridge.notifyTrackSeeked(0);
      }
      updateScrubberAndLyricsUI(true);
      if (spotifyAuth.accessToken) {
        spotifyFetch('/me/player/seek?position_ms=0', { method: 'PUT' });
      }
    }
  }

  miniPlayPauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlayPause();
  });

  miniNextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    skipNextTrack();
  });

  if (miniLikeBtn) {
    miniLikeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!state.playingTrackId) return;
      toggleLikeTrack(state.playingTrackId, {
        title: state.playingTrackTitle,
        artist: state.playingTrackArtist,
        cover: state.playingCover
      });
    });
  }

  npCloseBtn.addEventListener('click', closeNowPlaying);
  npPlayPauseBtn.addEventListener('click', togglePlayPause);
  npNextBtn.addEventListener('click', skipNextTrack);
  npPrevBtn.addEventListener('click', skipPrevTrack);

  // Favorite Heart Button (Save / Remove from Liked Songs)
  if (npFavBtn) {
    npFavBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!state.playingTrackId) return;
      toggleLikeTrack(state.playingTrackId, {
        title: state.playingTrackTitle,
        artist: state.playingTrackArtist,
        cover: state.playingCover
      });
    });
  }

  // Scrubber Seek
  npScrubberTrack.addEventListener('click', (e) => {
    const rect = npScrubberTrack.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    state.currentTimeSec = ratio * state.durationSec;
    const seekMs = Math.round(state.currentTimeSec * 1000);
    if (bridge && bridge.notifyTrackSeeked) {
      bridge.notifyTrackSeeked(seekMs);
    }
    updateScrubberAndLyricsUI(true);
    if (spotifyAuth.accessToken) {
      spotifyFetch(`/me/player/seek?position_ms=${seekMs}`, { method: 'PUT' });
    }
  });

  // Volume Bar (Hardware Echo Show Volume + Spotify Connect Volume)
  const npVolumeTrack = document.getElementById('npVolumeTrack');
  npVolumeTrack.addEventListener('click', (e) => {
    const rect = npVolumeTrack.getBoundingClientRect();
    const pct = Math.round(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * 100);
    document.getElementById('npVolumeFill').style.width = `${pct}%`;
    document.getElementById('npVolumeThumb').style.left = `${pct}%`;
    if (window.AndroidBridge && window.AndroidBridge.setDeviceVolume) {
      window.AndroidBridge.setDeviceVolume(pct);
    }
    if (spotifyAuth.accessToken) {
      spotifyFetch(`/me/player/volume?volume_percent=${pct}`, { method: 'PUT' });
    }
  });

  // Library Filter Tabs & Sort Pill
  document.querySelectorAll('#librarySegmented .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#librarySegmented .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderLibrary(btn.getAttribute('data-filter'));
    });
  });

  const libSortPill = document.querySelector('.lib-sort-pill');
  if (libSortPill) {
    libSortPill.addEventListener('click', () => {
      liveCatalog.sortAlphabetical = !liveCatalog.sortAlphabetical;
      libSortPill.innerHTML = `${liveCatalog.sortAlphabetical ? 'Alphabetical A–Z' : 'Recently added'} <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
      renderLibrary(liveCatalog.libraryFilter);
    });
  }

  // Search Category Cards (Playlists, Albums, Artists, Made for you)
  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => {
      if (card.classList.contains('cat-playlists')) {
        switchScreen('library');
        document.querySelector('#librarySegmented [data-filter="all"]').click();
      } else if (card.classList.contains('cat-albums')) {
        switchScreen('library');
        document.querySelector('#librarySegmented [data-filter="albums"]').click();
      } else if (card.classList.contains('cat-artists')) {
        switchScreen('library');
        document.querySelector('#librarySegmented [data-filter="artists"]').click();
      } else if (card.classList.contains('cat-madeforyou')) {
        switchScreen('library');
        document.querySelector('#librarySegmented [data-filter="liked"]').click();
      }
    });
  });

  // Live Spotify Catalog Search Input
  let searchDebounce = null;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearTimeout(searchDebounce);
    if (!q) {
      renderSearch();
      return;
    }

    searchDebounce = setTimeout(async () => {
      document.getElementById('recentSearchesRow').innerHTML = buildSkeletonChipsHTML(5);
      document.getElementById('searchRecentlyPlayedGrid').innerHTML = buildSkeletonCardsHTML(5, true);
      const res = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track,album,artist&limit=6`);
      if (!res) return;

      const chipsRow = document.getElementById('recentSearchesRow');
      if (res.tracks && Array.isArray(res.tracks.items)) {
        chipsRow.innerHTML = res.tracks.items.map(t => {
          const img = (t.album && t.album.images && t.album.images.length > 0) ? getSpotifyImage(t.album.images, 'small') : DEFAULT_ALBUM_COVER;
          const artist = t.artists.map(a => a.name).join(', ');
          return `
            <div class="recent-chip" data-play-direct-uri="${t.uri}" data-title="${t.name.replace(/"/g, '&quot;')}" data-artist="${artist.replace(/"/g, '&quot;')}" data-cover="${img}">
              <img src="${img}" class="chip-avatar square" />
              <span class="chip-label">${t.name} — ${t.artists[0].name}</span>
            </div>
          `;
        }).join('');
      }

      if (res.albums && Array.isArray(res.albums.items)) {
        const searchGrid = document.getElementById('searchRecentlyPlayedGrid');
        searchGrid.innerHTML = res.albums.items.slice(0, 5).map(a => {
          const entityId = `alb_${a.id}`;
          const cover = (a.images && a.images.length > 0) ? getSpotifyImage(a.images, 'medium') : DEFAULT_ALBUM_COVER;
          const artistName = a.artists ? a.artists.map(x => x.name).join(', ') : '';
          if (!liveCatalog.entities[entityId]) {
            liveCatalog.entities[entityId] = {
              id: entityId,
              spotifyId: a.id,
              type: 'album',
              uri: a.uri,
              title: a.name,
              artist: artistName,
              meta: `Album • ${(a.release_date || '').slice(0, 4)}`,
              cover: cover,
              tracks: null
            };
          }
          return `
            <div class="media-card" data-open-entity="${entityId}">
              <div class="media-card-cover-wrap">
                <img src="${cover}" alt="${a.name}" class="media-card-cover" />
              </div>
              <div class="media-card-title">${a.name}</div>
              <div class="media-card-subtitle">${artistName}</div>
            </div>
          `;
        }).join('');
      }
    }, 320);
  });

  // Clear Recent Searches
  document.getElementById('clearRecentBtn').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    renderSearch();
  });

  // Profile Modal Controls
  document.querySelectorAll('.profile-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      spotifyModal.classList.add('open');
    });
  });

  document.getElementById('closeSpotifyModalBtn').addEventListener('click', () => {
    spotifyModal.classList.remove('open');
  });

  // --------------------------------------------------------------------------
  // THEME CONTROLLER (Auto Day/Night, Light, Dark)
  // --------------------------------------------------------------------------
  const THEME_STORAGE_KEY = 'echo_theme_mode';
  let currentThemeMode = localStorage.getItem(THEME_STORAGE_KEY) || 'auto';
  let autoThemeTimer = null;

  function isNightTime() {
    const hour = new Date().getHours();
    // Night is from 19:00 (7 PM) to 06:59 (7 AM)
    return hour >= 19 || hour < 7;
  }

  function applyTheme(mode, updateUI = true) {
    currentThemeMode = mode;
    localStorage.setItem(THEME_STORAGE_KEY, mode);

    let isDark = false;
    if (mode === 'dark') {
      isDark = true;
    } else if (mode === 'light') {
      isDark = false;
    } else {
      // 'auto' mode: check time of day or system preference
      const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      isDark = isNightTime() || sysDark;
    }

    if (isDark) {
      document.body.classList.add('theme-dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.body.classList.remove('theme-dark');
      document.documentElement.setAttribute('data-theme', 'light');
    }

    if (state.activeScreen === 'album') {
      if (state.selectedEntityId === 'liked_songs' || (liveCatalog.entities[state.selectedEntityId] && liveCatalog.entities[state.selectedEntityId].type === 'liked')) {
        applyNeutralLikedTheme();
      } else {
        const currentEntity = liveCatalog.entities[state.selectedEntityId] || ALBUMS[state.selectedEntityId];
        if (currentEntity && currentEntity.cover) {
          extractDynamicPaletteFromCover(currentEntity.cover, true);
        }
      }
    }

    if (updateUI) {
      document.querySelectorAll('#themeSegmented .theme-seg-btn').forEach(btn => {
        const val = btn.getAttribute('data-theme-val');
        if (val === mode) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    if (autoThemeTimer) clearInterval(autoThemeTimer);
    if (mode === 'auto') {
      autoThemeTimer = setInterval(() => {
        if (currentThemeMode === 'auto') {
          const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          const shouldBeDark = isNightTime() || sysDark;
          const currentlyDark = document.body.classList.contains('theme-dark');
          if (shouldBeDark !== currentlyDark) {
            applyTheme('auto', false);
          }
        }
      }, 60000);
    }
  }

  const themeSegmented = document.getElementById('themeSegmented');
  if (themeSegmented) {
    themeSegmented.querySelectorAll('.theme-seg-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mode = btn.getAttribute('data-theme-val');
        if (mode) {
          applyTheme(mode, true);
        }
      });
    });
  }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentThemeMode === 'auto') {
        applyTheme('auto', false);
      }
    });
  }

  // Initialize theme on load
  applyTheme(currentThemeMode, true);

  document.getElementById('transferPlaybackHereBtn').addEventListener('click', async () => {
    const devRes = await spotifyFetch('/me/player/devices');
    if (devRes && Array.isArray(devRes.devices) && devRes.devices.length > 0) {
      const echoId = await findEngineDeviceId();
      const target = echoId || devRes.devices[0].id;
      spotifyAuth.activeDeviceId = target;
      await spotifyFetch('/me/player', {
        method: 'PUT',
        body: JSON.stringify({ device_ids: [target], play: true })
      });
      spotifyStatusText.textContent = `Reproduciendo en: ${echoId ? 'Echo Show 8 (Nativo)' : devRes.devices[0].name}`;
    }
  });

  // Responsive Viewport Scaling (1:1 zero-transform fast path on 1280x800 Echo Show 8)
  function fitViewport() {
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const scale = Math.min(vw / 1280, vh / 800);
    if (Math.abs(scale - 1) < 0.008) {
      echoViewport.style.transform = 'none';
      echoViewport.style.width = '1280px';
      echoViewport.style.height = '800px';
    } else {
      echoViewport.style.transform = `scale(${scale})`;
      echoViewport.style.width = `${Math.round(vw / scale)}px`;
      echoViewport.style.height = `${Math.round(vh / scale)}px`;
    }
  }
  window.addEventListener('resize', fitViewport);
  // cards-scroll-row horizontal mouse wheel scrolling for PC browser testing
  document.addEventListener('wheel', (e) => {
    const row = e.target.closest('.cards-scroll-row');
    if (row && e.deltaY !== 0 && !e.deltaX) {
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  fitViewport();

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

  if (cachedHome && cachedHome.jumpCards && cachedHome.jumpCards.length > 0) {
    // 0ms Instant Cache Render: Populate entity map so clicking immediately plays/opens
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
  } else if (hasAuth) {
    // First cold launch without cache: show clean neutral skeletons while network loads
    renderInitialSkeletons();
  } else {
    renderInitialSkeletons();
  }

  // Initialize fresh OAuth token, start native librespot engine, and load user data
  (async function initSpotifyEcho() {
    // 1. Revisar si venimos de regreso de una autenticación PKCE con ?code=...
    const justAuthed = await checkPKCEAuthCallback();

    if (spotifyAuth.refreshToken && spotifyAuth.clientId) {
      await refreshSpotifyAccessToken();
    } else if (spotifyAuth.accessToken) {
      startNativeEngine();
    }

    initWebPlayer();
    await loadAllRealSpotifyData();
    await pollSpotifyCurrentPlayback();
  })();

  // Poll Spotify live player state every 2.5s and auto-refresh token every 40 mins
  setInterval(pollSpotifyCurrentPlayback, 2500);
  setInterval(refreshSpotifyAccessToken, 40 * 60 * 1000);

  let lastTick = performance.now();
  let lastHwPoll = 0;

  function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;

    if (bridge && bridge.getPlaybackClockJson) {
      const pollInterval = state.isNowPlayingOpen ? 280 : 600;
      if (now - lastHwPoll >= pollInterval) {
        lastHwPoll = now;
        syncClockWithHardware(false);
      }
      if (state.isPlaying && state.pcmFlowing) {
        state.currentTimeSec += dt * (state.clockRate || 1.0);
        if (state.isNowPlayingOpen) {
          updateScrubberAndLyricsUI(false);
        }
      }
    } else if (state.isPlaying) {
      state.currentTimeSec += dt * (state.clockRate || 1.0);
      if (state.currentTimeSec >= state.durationSec) {
        state.currentTimeSec = 0;
      }
      if (state.isNowPlayingOpen) {
        updateScrubberAndLyricsUI(false);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // --------------------------------------------------------------------------
  // FULLSCREEN CONTROLLER FOR SILK BROWSER (ECHO SHOW 8)
  // --------------------------------------------------------------------------
  function toggleFullscreen() {
    const doc = document;
    const docEl = doc.documentElement;
    const requestFs = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
    const exitFs = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;

    const isFs = doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;

    if (!isFs) {
      if (requestFs) {
        requestFs.call(docEl).catch(err => console.warn('Error fullscreen:', err));
      }
    } else {
      if (exitFs) {
        exitFs.call(doc);
      }
    }
  }

  const fsBtn = document.getElementById('fullscreenBtn');
  if (fsBtn) {
    fsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFullscreen();
    });
  }

  const fsModalBtn = document.getElementById('fullscreenModalBtn');
  if (fsModalBtn) {
    fsModalBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFullscreen();
    });
  }

  // Botón oficial de Login con Spotify PKCE
  const oauthBtn = document.getElementById('spotifyOAuthLoginBtn');
  if (oauthBtn) {
    oauthBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startSpotifyPKCELogin();
    });
  }

  // Doble toque en cualquier espacio libre del fondo para entrar/salir de pantalla completa
  let lastTouchTime = 0;
  document.addEventListener('touchend', (e) => {
    // Solo si no fue sobre un botón interactivo, input o barra de progreso
    if (e.target.closest('button, input, .track-row, .media-card, #npScrubberTrack')) return;
    const now = Date.now();
    if (now - lastTouchTime < 350) {
      toggleFullscreen();
      lastTouchTime = 0;
    } else {
      lastTouchTime = now;
    }
  });

})();
