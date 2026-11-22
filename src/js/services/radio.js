/* ==========================================================================
   SERVICE: EchoRadio — Spotify-Native Local Recommendation & Autoplay Engine
   100% Spotify Web API (2026-safe) + Local Graph, Session Markov, BaRT Bandit
   & MMR Diversity Re-ranking (Zero External APIs)
   ========================================================================== */
'use strict';

(function initEchoRadioModule(global) {
  const GRAPH_STORAGE_KEY = 'sp_radio_graph_v1';
  const FEEDBACK_STORAGE_KEY = 'sp_radio_feedback_v1';
  const SCENE_CACHE_KEY = 'sp_radio_scene_cache_v1';
  const COMP_CACHE_KEY = 'sp_radio_comp_cache_v1';

  const CHANNELS = ['track_compilations', 'playlist_cooc', 'collab_scene', 'session_seq', 'catalog_explore'];
  const GRAPH_TTL_MS = 24 * 60 * 60 * 1000;      // 24h incremental refresh
  const SCENE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7d artist scene cache
  const COMP_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7d track compilation co-occurrence cache
  const FEEDBACK_HALF_LIFE_DAYS = 14;
  const SESSION_GAP_MS = 20 * 60 * 1000;         // 20 min session boundary

  const MAX_INDEXED_PLAYLISTS = 24;
  const MAX_TRACKS_PER_PLAYLIST = 150;
  const MAX_GRAPH_TRACKS = 1800;
  const MAX_SCENE_ARTISTS = 80;
  const MAX_COMP_CACHED = 60;
  const MAX_RADIO_HISTORY = 100;

  const NOISE_TAG_PATTERNS = [
    /\bkaraoke\b/i,
    /\btribute\b/i,
    /\blullaby\b/i,
    /\b8d\s*audio\b/i,
    /\b8-?bit\b/i,
    /\bpiano\s+cover\b/i,
    /\bmusic\s+box\b/i,
    /\bworkout\s+remix\b/i,
    /\binstrumental\b/i,
    /\bsped[\s-]*up\b/i,
    /\bslowed\b/i,
    /\breverb\b/i,
    /\bnightcore\b/i,
    /\bmade\s+famous\s+by\b/i,
    /\bringtone\b/i,
    /\bcover\s+version\b/i
  ];

  // --------------------------------------------------------------------------
  // IN-MEMORY ENGINE STATE
  // --------------------------------------------------------------------------
  let graph = createEmptyGraph();
  let feedback = createEmptyFeedback();
  let sceneCache = {};       // { [artistId]: { updatedAt, coArtists: [{id, name, weight}], tracks: [TrackLite] } }
  let compilationCache = {}; // { [seedTrackId]: { updatedAt, items: [], compArtists: [] } }
  let isIndexingGraph = false;
  let graphLoadedFromStorage = false;

  // Active radio session state (sliding window C)
  const sessionCtx = {
    seedTrack: null,
    seedArtistIds: [],
    seedArtistName: '',
    seedYear: null,
    seedDuration: 210,
    window: [], // [{ id, artistIds, year, weight, sign }] — last 4 tracks played
    sessionPlayedIds: new Set(),
    sessionPlayedCanonical: new Set(),
    recentHistoryIds: []
  };

  function createEmptyGraph() {
    return {
      version: 1,
      userId: null,
      updatedAt: 0,
      playlists: {},        // { [plId]: { name, weight, trackIds: [], artistIds: [] } }
      trackToPlaylists: {}, // { [trackId]: [plId, ...] }
      artistToPlaylists: {},// { [artistId]: [plId, ...] }
      tracks: {},           // { [trackId]: TrackLite }
      artistTracks: {},     // { [artistId]: [trackId, ...] }
      collabEdges: {},      // { [artistId]: { [coArtistId]: number } }
      artistNames: {},      // { [artistId]: string }
      artistGenres: {},     // { [artistId]: string[] } (optional bonus if API returns genres)
      transitions: {},      // { [artistId]: { [nextArtistId]: { c: count, b: [m,a,n,l] } } }
      trackTransitions: {}, // { [trackId]: { [nextTrackId]: count } }
      topArtistScores: {},  // { [artistId]: 0..1 }
      topTrackScores: {},   // { [trackId]: 0..1 }
      savedTrackIds: {}     // { [trackId]: 1 }
    };
  }

  function createEmptyFeedback() {
    const channelStats = {};
    CHANNELS.forEach(ch => {
      channelStats[ch] = { alpha: 2.0, beta: 2.0 };
    });
    return {
      version: 1,
      updatedAt: Date.now(),
      channelStats,
      artistScores: {}, // { [artistId]: { score, ts } }
      trackScores: {},  // { [trackId]: { score, ts } }
      recentHistoryIds: []
    };
  }

  // --------------------------------------------------------------------------
  // UTILITIES & NORMALIZATION
  // --------------------------------------------------------------------------
  function isValidSpotifyId(id) {
    return typeof id === 'string' && /^[0-9A-Za-z]{22}$/.test(id);
  }

  function cleanId(idOrUri) {
    if (!idOrUri) return '';
    return String(idOrUri)
      .replace(/^spotify:(track|artist|album|playlist):/, '')
      .replace(/^art_/, '')
      .trim();
  }

  function getTimeBucket(dateObj = new Date()) {
    const hr = dateObj.getHours();
    if (hr >= 6 && hr < 12) return 0;   // morning
    if (hr >= 12 && hr < 19) return 1;  // afternoon
    if (hr >= 19 || hr < 1) return 2;   // night
    return 3;                           // late night (1-6)
  }

  function extractYear(releaseDate) {
    if (!releaseDate || typeof releaseDate !== 'string') return null;
    const m = releaseDate.match(/^(\d{4})/);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    return (y >= 1900 && y <= 2099) ? y : null;
  }

  function normalizeCanonicalTitle(title) {
    if (!title || typeof title !== 'string') return '';
    return title
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\(\s*(?:feat|ft|featuring|with|prod)\b[^)]*\)/gi, '')
      .replace(/\([^)]*(?:\b(?:remix|remaster(?:ed)?|anniversary|pudding\s*mix|mono|stereo|live|acoustic|radio\s*edit|single\s*version|single\s*mix|album\s*version|explicit|clean|deluxe|bonus|sped\s*up|slowed|reverb|version|edit)\b|\bfrom\s+["']|\b\d{4}\s*(?:remaster(?:ed)?|mix|version|edition)\b)[^)]*\)/gi, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s*-\s*(?:[^-]*\b(?:remaster(?:ed)?|anniversary|pudding\s*mix|mono|stereo|radio\s*edit|single\s*version|single\s*mix|album\s*version|live|acoustic|remix|sped\s*up|slowed|reverb|instrumental|explicit|clean|bonus|deluxe|version|edit)\b|[^-]*\bfrom\s+["']|\d{4}\b).*$/i, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanTitleForSearch(title) {
    if (!title || typeof title !== 'string') return '';
    return title
      .replace(/\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s*-\s*(?:[^-]*\b(?:remaster(?:ed)?|anniversary|pudding\s*mix|mono|stereo|radio\s*edit|single\s*version|single\s*mix|album\s*version|live|acoustic|remix|sped\s*up|slowed|reverb|instrumental|explicit|clean|bonus|deluxe|version|edit)\b|[^-]*\bfrom\s+["']|\d{4}\b).*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isNoiseAlbumName(albumName = '', primaryArtistName = '') {
    const name = String(albumName || '').trim();
    if (!name) return false;
    if (/\b(karaoke|lullaby|lullabies|tribute|8-?bit|piano|instrumental|ringtone|music\s*box|workout|backing\s*track|made\s*famous)\b/i.test(name)) {
      return true;
    }
    if (/\b(greatest\s*hits|best\s*of|the\s*essential|platinum\s*collection|complete\s*collection|anthology)\b/i.test(name)) {
      return true;
    }
    if (primaryArtistName) {
      const cleanArt = primaryArtistName.replace(/[^a-z0-9\s]/gi, '').trim().toLowerCase();
      const cleanAlb = name.replace(/[^a-z0-9\s]/gi, '').trim().toLowerCase();
      if (cleanArt && cleanAlb.includes(cleanArt) && /\b(hits|essential|collection|best|essentials)\b/.test(cleanAlb)) {
        return true;
      }
    }
    return false;
  }

  function isCleanCompilationAlbum(alb, primaryArtistName = '') {
    if (!alb || !isValidSpotifyId(alb.id)) return false;
    const isMultiArtist = alb.album_type === 'compilation'
      || (Array.isArray(alb.artists) && alb.artists.some(a => /various artists/i.test((a && a.name) || '')));
    if (!isMultiArtist) return false;
    return !isNoiseAlbumName(alb.name || '', primaryArtistName);
  }

  function isNoiseTrack(track, seedTitle = '') {
    const title = (track && (track.title || track.name)) ? String(track.title || track.name) : '';
    if (!title) return true;
    const seedLower = String(seedTitle || '').toLowerCase();
    for (let i = 0; i < NOISE_TAG_PATTERNS.length; i++) {
      const re = NOISE_TAG_PATTERNS[i];
      if (re.test(title) && !re.test(seedLower)) {
        return true;
      }
    }
    const dur = track.duration || (track.duration_ms ? Math.round(track.duration_ms / 1000) : 210);
    const seedDur = sessionCtx.seedDuration || 210;
    if (dur < 70 && seedDur >= 90) return true;
    if (dur > 540 && seedDur <= 420) return true;
    return false;
  }

  // Dual-schema extractor for Spotify playlists (supports both 2026 `.items` and legacy `.tracks`)
  function extractPlaylistEntries(plPayload) {
    if (!plPayload || typeof plPayload !== 'object') return [];
    const container = (plPayload.items && Array.isArray(plPayload.items.items))
      ? plPayload.items.items
      : (Array.isArray(plPayload.items)
        ? plPayload.items
        : (plPayload.tracks && Array.isArray(plPayload.tracks.items) ? plPayload.tracks.items : []));
    const out = [];
    for (let i = 0; i < container.length; i++) {
      const row = container[i];
      if (!row) continue;
      const tr = row.item || row.track || (row.uri && row.uri.startsWith('spotify:track:') ? row : null);
      if (!tr || tr.is_local || tr.is_playable === false) continue;
      if (!tr.uri || !tr.uri.startsWith('spotify:track:')) continue;
      out.push(tr);
    }
    return out;
  }

  function toTrackLite(raw, fallbackAlbum = null, opts = null) {
    if (!raw) return null;
    const id = cleanId(raw.id || raw.uri);
    if (!isValidSpotifyId(id)) return null;
    const uri = raw.uri || `spotify:track:${id}`;
    if (!uri.startsWith('spotify:track:')) return null;

    const title = (raw.name || raw.title || '').trim();
    if (!title) return null;

    const rawArtists = Array.isArray(raw.artists) ? raw.artists : [];
    const artists = rawArtists
      .filter(a => a && (a.name || a.id))
      .map(a => ({
        id: cleanId(a.id || a.uri),
        name: (a.name || '').trim()
      }))
      .filter(a => a.name);

    const artistStr = artists.length > 0
      ? artists.map(a => a.name).join(', ')
      : (typeof raw.artist === 'string' ? raw.artist.trim() : '');

    const albumObj = (raw.album && typeof raw.album === 'object') ? raw.album : fallbackAlbum;
    const albumName = albumObj ? (albumObj.name || albumObj.title || '') : (typeof raw.album === 'string' ? raw.album : '');
    const albumId = albumObj ? cleanId(albumObj.id || albumObj.uri) : cleanId(raw.albumId);
    const year = raw.year || extractYear(albumObj && albumObj.release_date);

    const imgs = (albumObj && Array.isArray(albumObj.images)) ? albumObj.images : [];
    let cover = raw.coverLarge || raw.cover || '';
    let thumb = raw.thumb || '';
    if (imgs.length > 0 && typeof getSpotifyImage === 'function') {
      cover = getSpotifyImage(imgs, 'large') || cover;
      thumb = getSpotifyImage(imgs, 'small') || getSpotifyImage(imgs, 'medium') || cover;
    } else if (imgs.length > 0) {
      cover = (imgs[0] && imgs[0].url) || cover;
      thumb = (imgs[imgs.length - 1] && imgs[imgs.length - 1].url) || cover;
    }
    if (!cover && typeof DEFAULT_ALBUM_COVER !== 'undefined') cover = DEFAULT_ALBUM_COVER;
    if (!thumb) thumb = cover;

    const duration = raw.duration_ms ? Math.round(raw.duration_ms / 1000) : (raw.duration || 210);
    const trackNumber = typeof raw.track_number === 'number' ? raw.track_number : (raw.trackNumber || 0);
    const albumType = (albumObj && albumObj.album_type) ? albumObj.album_type : (raw.albumType || '');
    const popularity = typeof raw.popularity === 'number' ? raw.popularity : null;
    const isrc = (raw.external_ids && raw.external_ids.isrc) ? raw.external_ids.isrc : (raw.isrc || '');
    const fromCompilation = Boolean(
      (opts && opts.fromCompilation) ||
      raw.fromCompilation ||
      (albumObj && albumObj.album_type === 'compilation')
    );

    return {
      id,
      uri,
      title,
      artist: artistStr || 'Spotify',
      artists,
      album: albumName,
      albumId,
      year,
      duration,
      cover,
      thumb,
      trackNumber,
      albumType,
      popularity,
      isrc,
      fromCompilation
    };
  }

  function getTrackArtistIds(track) {
    if (!track) return [];
    const ids = [];
    if (Array.isArray(track.artists)) {
      track.artists.forEach(a => {
        const aid = cleanId(a && (a.id || a.uri));
        if (isValidSpotifyId(aid) && !ids.includes(aid)) ids.push(aid);
      });
    }
    if (track.artistId) {
      const aid = cleanId(track.artistId);
      if (isValidSpotifyId(aid) && !ids.includes(aid)) ids.push(aid);
    }
    return ids;
  }

  function decayFactor(timestampMs) {
    if (!timestampMs) return 1.0;
    const days = Math.max(0, (Date.now() - timestampMs) / (24 * 60 * 60 * 1000));
    return Math.pow(0.5, days / FEEDBACK_HALF_LIFE_DAYS);
  }

  // Thompson Sampling via Marsaglia-Tsang Gamma sampler (pure JS, ~0.01ms)
  function sampleStandardNormal() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function sampleGamma(shape) {
    if (shape <= 0) return 0.001;
    if (shape < 1) {
      return sampleGamma(shape + 1) * Math.pow(Math.random() || 1e-6, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (let iter = 0; iter < 16; iter++) {
      const x = sampleStandardNormal();
      const v = Math.pow(1 + c * x, 3);
      if (v <= 0) continue;
      const u = Math.random();
      if (u < 1 - 0.0331 * Math.pow(x, 4)) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
    return d;
  }

  function sampleBeta(alpha, beta) {
    const a = Math.max(0.5, alpha || 2);
    const b = Math.max(0.5, beta || 2);
    const x = sampleGamma(a);
    const y = sampleGamma(b);
    return (x + y) > 0 ? (x / (x + y)) : 0.5;
  }

  // --------------------------------------------------------------------------
  // PERSISTENCE (SAFE FOR ECHO SHOW SILK BROWSER LOCALSTORAGE)
  // --------------------------------------------------------------------------
  function loadPersistedState() {
    if (graphLoadedFromStorage) return;
    graphLoadedFromStorage = true;
    try {
      const rawFb = safeStorage.getItem(FEEDBACK_STORAGE_KEY);
      if (rawFb) {
        const parsed = JSON.parse(rawFb);
        if (parsed && parsed.version === 1) {
          feedback = Object.assign(createEmptyFeedback(), parsed);
          CHANNELS.forEach(ch => {
            if (!feedback.channelStats[ch]) feedback.channelStats[ch] = { alpha: 2.0, beta: 2.0 };
          });
          if (Array.isArray(feedback.recentHistoryIds)) {
            sessionCtx.recentHistoryIds = feedback.recentHistoryIds.slice(-MAX_RADIO_HISTORY);
          }
        }
      }
    } catch (e) {}

    try {
      const rawGraph = safeStorage.getItem(GRAPH_STORAGE_KEY);
      if (rawGraph) {
        const parsed = JSON.parse(rawGraph);
        if (parsed && parsed.version === 1 && parsed.tracks) {
          graph = Object.assign(createEmptyGraph(), parsed);
        }
      }
    } catch (e) {}

    try {
      const rawScene = safeStorage.getItem(SCENE_CACHE_KEY);
      if (rawScene) {
        const parsed = JSON.parse(rawScene);
        if (parsed && typeof parsed === 'object') {
          sceneCache = parsed;
        }
      }
    } catch (e) {}

    try {
      const rawComp = safeStorage.getItem(COMP_CACHE_KEY);
      if (rawComp) {
        const parsed = JSON.parse(rawComp);
        if (parsed && typeof parsed === 'object') {
          compilationCache = parsed;
        }
      }
    } catch (e) {}
  }

  function saveFeedback() {
    try {
      feedback.updatedAt = Date.now();
      feedback.recentHistoryIds = sessionCtx.recentHistoryIds.slice(-MAX_RADIO_HISTORY);
      // Trim stale maps to stay compact
      const trimScoreMap = (map, maxEntries) => {
        const keys = Object.keys(map || {});
        if (keys.length <= maxEntries) return map;
        keys.sort((a, b) => (map[b].ts || 0) - (map[a].ts || 0));
        const next = {};
        keys.slice(0, maxEntries).forEach(k => { next[k] = map[k]; });
        return next;
      };
      feedback.artistScores = trimScoreMap(feedback.artistScores, 250);
      feedback.trackScores = trimScoreMap(feedback.trackScores, 400);
      safeStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(feedback));
    } catch (e) {}
  }

  function saveGraph() {
    try {
      // Enforce storage cap so localStorage never overflows
      const trackIds = Object.keys(graph.tracks || {});
      if (trackIds.length > MAX_GRAPH_TRACKS) {
        const keep = new Set();
        Object.keys(graph.topTrackScores || {}).forEach(id => keep.add(id));
        Object.values(graph.playlists || {}).forEach(pl => {
          (pl.trackIds || []).slice(0, 80).forEach(id => keep.add(id));
        });
        for (let i = 0; i < trackIds.length && keep.size < MAX_GRAPH_TRACKS; i++) {
          keep.add(trackIds[i]);
        }
        const trimmedTracks = {};
        keep.forEach(id => {
          if (graph.tracks[id]) trimmedTracks[id] = graph.tracks[id];
        });
        graph.tracks = trimmedTracks;
      }
      safeStorage.setItem(GRAPH_STORAGE_KEY, JSON.stringify(graph));
    } catch (e) {
      // If quota exceeded, drop bulky track details and retry with lighter graph
      try {
        const lightTracks = {};
        Object.keys(graph.tracks || {}).slice(0, 600).forEach(id => {
          lightTracks[id] = graph.tracks[id];
        });
        graph.tracks = lightTracks;
        safeStorage.setItem(GRAPH_STORAGE_KEY, JSON.stringify(graph));
      } catch (_) {}
    }
  }

  function saveSceneCache() {
    try {
      const keys = Object.keys(sceneCache);
      if (keys.length > MAX_SCENE_ARTISTS) {
        keys.sort((a, b) => (sceneCache[b].updatedAt || 0) - (sceneCache[a].updatedAt || 0));
        const trimmed = {};
        keys.slice(0, MAX_SCENE_ARTISTS).forEach(k => { trimmed[k] = sceneCache[k]; });
        sceneCache = trimmed;
      }
      safeStorage.setItem(SCENE_CACHE_KEY, JSON.stringify(sceneCache));
    } catch (e) {}
  }

  function saveCompilationCache() {
    try {
      const keys = Object.keys(compilationCache);
      if (keys.length > MAX_COMP_CACHED) {
        keys.sort((a, b) => (compilationCache[b].updatedAt || 0) - (compilationCache[a].updatedAt || 0));
        const trimmed = {};
        keys.slice(0, MAX_COMP_CACHED).forEach(k => { trimmed[k] = compilationCache[k]; });
        compilationCache = trimmed;
      }
      safeStorage.setItem(COMP_CACHE_KEY, JSON.stringify(compilationCache));
    } catch (e) {}
  }

  // --------------------------------------------------------------------------
  // MODULE A: LOCAL MUSIC GRAPH BUILDER (CO-OCCURRENCE, COLLABS, SESSIONS)
  // --------------------------------------------------------------------------
  function registerTrackInGraph(trackLite, isSaved = false) {
    if (!trackLite || !trackLite.id) return;
    const prev = graph.tracks[trackLite.id];
    if (prev) {
      const merged = Object.assign({}, prev, trackLite);
      if (!trackLite.isrc && prev.isrc) merged.isrc = prev.isrc;
      if (!trackLite.year && prev.year) merged.year = prev.year;
      if ((!trackLite.artists || trackLite.artists.length === 0) && prev.artists) merged.artists = prev.artists;
      // Preserve authentic studio/single album metadata when a compilation copy is seen later
      if (!prev.fromCompilation && trackLite.fromCompilation) {
        merged.album = prev.album;
        merged.albumId = prev.albumId;
        merged.year = prev.year;
        merged.cover = prev.cover;
        merged.thumb = prev.thumb;
        merged.albumType = prev.albumType;
        merged.fromCompilation = false;
      }
      graph.tracks[trackLite.id] = merged;
    } else {
      graph.tracks[trackLite.id] = trackLite;
    }
    if (isSaved) graph.savedTrackIds[trackLite.id] = 1;

    const aIds = getTrackArtistIds(trackLite);
    for (let i = 0; i < aIds.length; i++) {
      const aid = aIds[i];
      if (!graph.artistTracks[aid]) graph.artistTracks[aid] = [];
      if (!graph.artistTracks[aid].includes(trackLite.id)) {
        graph.artistTracks[aid].push(trackLite.id);
        if (graph.artistTracks[aid].length > 40) graph.artistTracks[aid].shift();
      }
      const aObj = (trackLite.artists || []).find(x => x.id === aid);
      if (aObj && aObj.name) graph.artistNames[aid] = aObj.name;
    }

    // Build bidirectional collaboration edges from featured artists on the same track
    if (aIds.length > 1) {
      for (let i = 0; i < aIds.length; i++) {
        for (let j = i + 1; j < aIds.length; j++) {
          addCollabEdge(aIds[i], aIds[j], 1.0);
        }
      }
    }
  }

  function addCollabEdge(a1, a2, weight = 1.0) {
    if (!isValidSpotifyId(a1) || !isValidSpotifyId(a2) || a1 === a2) return;
    if (!graph.collabEdges[a1]) graph.collabEdges[a1] = {};
    if (!graph.collabEdges[a2]) graph.collabEdges[a2] = {};
    graph.collabEdges[a1][a2] = (graph.collabEdges[a1][a2] || 0) + weight;
    graph.collabEdges[a2][a1] = (graph.collabEdges[a2][a1] || 0) + weight;
  }

  function recordSequenceTransition(prevTrack, nextTrack, playedAtDate = new Date(), weight = 1.0) {
    if (!prevTrack || !nextTrack) return;
    const prevId = cleanId(prevTrack.id || prevTrack.uri);
    const nextId = cleanId(nextTrack.id || nextTrack.uri);
    if (!isValidSpotifyId(prevId) || !isValidSpotifyId(nextId) || prevId === nextId) return;

    const bucket = getTimeBucket(playedAtDate);
    if (!graph.trackTransitions[prevId]) graph.trackTransitions[prevId] = {};
    graph.trackTransitions[prevId][nextId] = (graph.trackTransitions[prevId][nextId] || 0) + weight;

    const prevArtists = getTrackArtistIds(prevTrack);
    const nextArtists = getTrackArtistIds(nextTrack);
    if (prevArtists[0] && nextArtists[0] && prevArtists[0] !== nextArtists[0]) {
      const a1 = prevArtists[0];
      const a2 = nextArtists[0];
      if (!graph.transitions[a1]) graph.transitions[a1] = {};
      if (!graph.transitions[a1][a2]) graph.transitions[a1][a2] = { c: 0, b: [0, 0, 0, 0] };
      graph.transitions[a1][a2].c += weight;
      graph.transitions[a1][a2].b[bucket] += weight;
    }
  }

  function ingestRecentlyPlayed(recentRes) {
    if (!recentRes || !Array.isArray(recentRes.items) || recentRes.items.length === 0) return;
    // Spotify returns newest-first; reverse to chronological order
    const chronological = [...recentRes.items].reverse();
    const mapped = [];
    for (let i = 0; i < chronological.length; i++) {
      const item = chronological[i];
      if (!item || !item.track) continue;
      const lite = toTrackLite(item.track);
      if (!lite) continue;
      registerTrackInGraph(lite, false);
      const ts = item.played_at ? Date.parse(item.played_at) : 0;
      mapped.push({ track: lite, ts, date: ts ? new Date(ts) : new Date() });
    }

    for (let i = 0; i < mapped.length - 1; i++) {
      const cur = mapped[i];
      const nxt = mapped[i + 1];
      if (cur.ts && nxt.ts && (nxt.ts - cur.ts) > SESSION_GAP_MS) continue;
      recordSequenceTransition(cur.track, nxt.track, nxt.date, 1.0);
      if (i + 2 < mapped.length) {
        const nxt2 = mapped[i + 2];
        if (!cur.ts || !nxt2.ts || (nxt2.ts - cur.ts) <= SESSION_GAP_MS) {
          recordSequenceTransition(cur.track, nxt2.track, nxt2.date, 0.5);
        }
      }
    }
  }

  function indexPlaylistTracks(plId, plName, rawTracks) {
    if (!plId || !Array.isArray(rawTracks) || rawTracks.length === 0) return;
    const seenTrackIds = [];
    const seenArtistIds = new Set();

    for (let i = 0; i < rawTracks.length && seenTrackIds.length < MAX_TRACKS_PER_PLAYLIST; i++) {
      const lite = toTrackLite(rawTracks[i]);
      if (!lite) continue;
      registerTrackInGraph(lite, true);
      if (!seenTrackIds.includes(lite.id)) {
        seenTrackIds.push(lite.id);
      }
      getTrackArtistIds(lite).forEach(aid => seenArtistIds.add(aid));
    }

    if (seenTrackIds.length < 2) return;

    // Playlist specificity weight (IDF): tight mood playlists carry stronger signal than huge dumps
    const idfWeight = 1.0 / Math.log2(seenTrackIds.length + 2);
    const artistList = Array.from(seenArtistIds);

    graph.playlists[plId] = {
      name: plName || 'Playlist',
      weight: Number(idfWeight.toFixed(4)),
      trackIds: seenTrackIds,
      artistIds: artistList
    };

    seenTrackIds.forEach(tid => {
      if (!graph.trackToPlaylists[tid]) graph.trackToPlaylists[tid] = [];
      if (!graph.trackToPlaylists[tid].includes(plId)) graph.trackToPlaylists[tid].push(plId);
    });
    artistList.forEach(aid => {
      if (!graph.artistToPlaylists[aid]) graph.artistToPlaylists[aid] = [];
      if (!graph.artistToPlaylists[aid].includes(plId)) graph.artistToPlaylists[aid].push(plId);
    });
  }

  async function initGraphFromCatalog(me, recentRes) {
    loadPersistedState();
    if (!spotifyAuth || !spotifyAuth.accessToken || isIndexingGraph) return;

    const currentUserId = (me && me.id) ? me.id : graph.userId;
    if (currentUserId && graph.userId && graph.userId !== currentUserId) {
      graph = createEmptyGraph();
    }
    if (currentUserId) graph.userId = currentUserId;

    // Immediately ingest already-loaded in-memory catalog data (0 HTTP calls)
    if (typeof liveCatalog !== 'undefined') {
      (liveCatalog.likedTracks || []).forEach(t => {
        const lite = toTrackLite(t);
        if (lite) registerTrackInGraph(lite, true);
      });
      (liveCatalog.albums || []).forEach(al => {
        if (al && Array.isArray(al.tracks)) {
          al.tracks.forEach(t => {
            const lite = toTrackLite(t, al);
            if (lite) registerTrackInGraph(lite, true);
          });
        }
      });
    }

    ingestRecentlyPlayed(recentRes);

    const needsFullRefresh = !graph.updatedAt || (Date.now() - graph.updatedAt) > GRAPH_TTL_MS || Object.keys(graph.playlists).length === 0;
    if (!needsFullRefresh) {
      saveGraph();
      return;
    }

    isIndexingGraph = true;
    try {
      // 1. Multi-horizon user affinity (/me/top/artists & /me/top/tracks across short/medium/long term)
      const [artS, artM, artL, trS, trM, trL] = await Promise.all([
        spotifyFetch('/me/top/artists?time_range=short_term&limit=30').catch(() => null),
        spotifyFetch('/me/top/artists?time_range=medium_term&limit=30').catch(() => null),
        spotifyFetch('/me/top/artists?time_range=long_term&limit=30').catch(() => null),
        spotifyFetch('/me/top/tracks?time_range=short_term&limit=30').catch(() => null),
        spotifyFetch('/me/top/tracks?time_range=medium_term&limit=30').catch(() => null),
        spotifyFetch('/me/top/tracks?time_range=long_term&limit=30').catch(() => null)
      ]);

      const nextTopArtists = {};
      const applyArtistHorizon = (res, horizonWeight) => {
        if (!res || !Array.isArray(res.items)) return;
        const n = res.items.length || 1;
        res.items.forEach((ar, idx) => {
          if (!ar || !isValidSpotifyId(ar.id)) return;
          const rankScore = 1 - (idx / n);
          nextTopArtists[ar.id] = (nextTopArtists[ar.id] || 0) + horizonWeight * rankScore;
          if (ar.name) graph.artistNames[ar.id] = ar.name;
          if (Array.isArray(ar.genres) && ar.genres.length > 0) {
            graph.artistGenres[ar.id] = ar.genres.slice(0, 6);
          }
        });
      };
      applyArtistHorizon(artS, 0.50);
      applyArtistHorizon(artM, 0.32);
      applyArtistHorizon(artL, 0.18);
      if (Object.keys(nextTopArtists).length > 0) {
        graph.topArtistScores = nextTopArtists;
      }

      const nextTopTracks = {};
      const applyTrackHorizon = (res, horizonWeight) => {
        if (!res || !Array.isArray(res.items)) return;
        const n = res.items.length || 1;
        res.items.forEach((tr, idx) => {
          const lite = toTrackLite(tr);
          if (!lite) return;
          registerTrackInGraph(lite, false);
          const rankScore = 1 - (idx / n);
          nextTopTracks[lite.id] = (nextTopTracks[lite.id] || 0) + horizonWeight * rankScore;
        });
      };
      applyTrackHorizon(trS, 0.50);
      applyTrackHorizon(trM, 0.32);
      applyTrackHorizon(trL, 0.18);
      if (Object.keys(nextTopTracks).length > 0) {
        graph.topTrackScores = nextTopTracks;
      }

      // 2. Index user's OWN or COLLABORATIVE playlists for APC Co-occurrence Graph (2026 Dev Mode compliant!)
      const playlists = (typeof liveCatalog !== 'undefined' && Array.isArray(liveCatalog.playlists))
        ? liveCatalog.playlists
        : [];

      const ownPlaylists = playlists.filter(p => {
        if (!p || !isValidSpotifyId(p.spotifyId)) return false;
        // Skip Spotify editorial/algorithmic 37i9dQZF1... playlists (404/403 in Dev Mode)
        if (p.spotifyId.startsWith('37i9dQZF1')) return false;
        if (p.collaborative) return true;
        if (currentUserId && p.ownerId) return p.ownerId === currentUserId;
        const ownerName = (p.artist || '').toLowerCase();
        if (ownerName === 'spotify') return false;
        return true;
      }).slice(0, MAX_INDEXED_PLAYLISTS);

      // Reset playlist maps cleanly before re-indexing
      graph.playlists = {};
      graph.trackToPlaylists = {};
      graph.artistToPlaylists = {};

      // Polite sequential batches of 2 playlists to avoid 429 rate limits on startup
      for (let i = 0; i < ownPlaylists.length; i += 2) {
        const batch = ownPlaylists.slice(i, i + 2);
        await Promise.all(batch.map(async (pl) => {
          try {
            // Try 2026 `/items` first if needed, or `/playlists/{id}` (which returns items or tracks)
            let plRes = await spotifyFetch(`/playlists/${pl.spotifyId}/items?limit=100`).catch(() => null);
            let entries = extractPlaylistEntries(plRes);
            if (entries.length === 0) {
              plRes = await spotifyFetch(`/playlists/${pl.spotifyId}`).catch(() => null);
              entries = extractPlaylistEntries(plRes);
            }
            if (entries.length > 0) {
              indexPlaylistTracks(pl.spotifyId, pl.title, entries);
            }
          } catch (_) {}
        }));
        // Yield briefly between batches so UI & playback stay at 60fps
        await new Promise(r => setTimeout(r, 120));
      }

      graph.updatedAt = Date.now();
      saveGraph();
      if (typeof uiLog === 'function') {
        uiLog('RADIO', `Grafo indexado: ${Object.keys(graph.playlists).length} playlists, ${Object.keys(graph.tracks).length} tracks, ${Object.keys(graph.collabEdges).length} artistas`);
      }
    } finally {
      isIndexingGraph = false;
    }
  }

  // --------------------------------------------------------------------------
  // LIVE ARTIST SCENE RESOLVER (appears_on + albums/singles, 2026 limit<=10)
  // --------------------------------------------------------------------------
  async function getArtistSceneData(artistId, artistName = '') {
    if (!isValidSpotifyId(artistId)) return null;
    const cached = sceneCache[artistId];
    if (cached && cached.updatedAt && (Date.now() - cached.updatedAt) < SCENE_TTL_MS) {
      return cached;
    }

    const coArtistMap = {}; // { [id]: { id, name, weight } }
    const collectedTracks = [];
    const seenTrackIds = new Set();

    const addCoArtist = (id, name, weight) => {
      if (!isValidSpotifyId(id) || id === artistId) return;
      if (!coArtistMap[id]) coArtistMap[id] = { id, name: name || graph.artistNames[id] || '', weight: 0 };
      coArtistMap[id].weight += weight;
      if (name && !coArtistMap[id].name) coArtistMap[id].name = name;
      if (name) graph.artistNames[id] = name;
      addCollabEdge(artistId, id, weight * 0.5);
    };

    // 1. Fetch albums, singles & appears_on (strictly limit=10 for Feb 2026 Spotify compliance!)
    const [ownAlbRes, appearsRes] = await Promise.all([
      spotifyFetch(`/artists/${artistId}/albums?include_groups=single,album&limit=10`).catch(() => null),
      spotifyFetch(`/artists/${artistId}/albums?include_groups=appears_on&limit=10`).catch(() => null)
    ]);

    const ownAlbums = (ownAlbRes && Array.isArray(ownAlbRes.items)) ? ownAlbRes.items : [];
    const appearsAlbums = (appearsRes && Array.isArray(appearsRes.items)) ? appearsRes.items : [];

    // Extract collaborators directly from album-level artists (0 extra HTTP calls!)
    appearsAlbums.forEach(alb => {
      if (!alb || !Array.isArray(alb.artists)) return;
      const isCompilation = alb.album_type === 'compilation' || alb.artists.some(a => a && /various artists/i.test(a.name || ''));
      alb.artists.forEach(a => {
        if (a && isValidSpotifyId(a.id) && a.id !== artistId && !/various artists/i.test(a.name || '')) {
          addCoArtist(a.id, a.name, isCompilation ? 0.6 : 2.0);
        }
      });
    });

    ownAlbums.forEach(alb => {
      if (!alb || !Array.isArray(alb.artists)) return;
      alb.artists.forEach(a => {
        if (a && isValidSpotifyId(a.id) && a.id !== artistId) {
          addCoArtist(a.id, a.name, 2.5);
        }
      });
    });

    // 2. Pick up to 3 high-value albums (prioritizing recent singles + 1 full album + 1 appears_on album / clean compilation)
    const albumsToInspect = [];
    const singles = ownAlbums.filter(a => a && a.album_type === 'single');
    const fullAlbums = ownAlbums.filter(a => a && a.album_type === 'album');
    const nonVariousAppears = appearsAlbums.filter(a =>
      a && a.id && Array.isArray(a.artists) && !a.artists.some(ar => /various artists/i.test((ar && ar.name) || ''))
    );
    const variousAppears = appearsAlbums.filter(a =>
      a && a.id && Array.isArray(a.artists)
      && a.artists.some(ar => /various artists/i.test((ar && ar.name) || ''))
      && isCleanCompilationAlbum(a, artistName)
    );

    if (singles[0]) albumsToInspect.push({ alb: singles[0], maxTracks: 4, isAppears: false, isComp: false });
    if (fullAlbums[0]) albumsToInspect.push({ alb: fullAlbums[0], maxTracks: 6, isAppears: false, isComp: false });
    else if (singles[1]) albumsToInspect.push({ alb: singles[1], maxTracks: 4, isAppears: false, isComp: false });
    if (nonVariousAppears[0]) {
      albumsToInspect.push({ alb: nonVariousAppears[0], maxTracks: 6, isAppears: true, isComp: nonVariousAppears[0].album_type === 'compilation' });
    } else if (variousAppears[0]) {
      albumsToInspect.push({ alb: variousAppears[0], maxTracks: 8, isAppears: true, isComp: true });
    }

    const trackResults = await Promise.all(
      albumsToInspect.map(entry =>
        spotifyFetch(`/albums/${entry.alb.id}/tracks?limit=15`).catch(() => null)
      )
    );

    trackResults.forEach((trRes, idx) => {
      const entry = albumsToInspect[idx];
      if (!trRes || !Array.isArray(trRes.items)) return;
      const items = trRes.items;
      // Prioritize lead tracks (1..3) and tracks with featured artists
      const prioritized = [...items].sort((a, b) => {
        const aFeat = (Array.isArray(a.artists) && a.artists.length > 1) ? 1 : 0;
        const bFeat = (Array.isArray(b.artists) && b.artists.length > 1) ? 1 : 0;
        const aLead = (a.track_number || 99) <= 4 ? 1 : 0;
        const bLead = (b.track_number || 99) <= 4 ? 1 : 0;
        return (bFeat + bLead) - (aFeat + aLead);
      });

      let added = 0;
      for (let k = 0; k < prioritized.length; k++) {
        const rawT = prioritized[k];
        const lite = toTrackLite(rawT, entry.alb, { fromCompilation: entry.isComp });
        if (!lite) continue;
        // Register ALL featured collaborators on every inspected track
        const tArtists = getTrackArtistIds(lite);
        const involvesSeedArtist = tArtists.includes(artistId);
        if (involvesSeedArtist || entry.isAppears) {
          tArtists.forEach(aid => {
            if (aid !== artistId) {
              const aObj = (lite.artists || []).find(x => x.id === aid);
              addCoArtist(aid, aObj ? aObj.name : '', involvesSeedArtist ? 1.8 : 0.9);
            }
          });
        }
        if (added < entry.maxTracks && !seenTrackIds.has(lite.id)) {
          seenTrackIds.add(lite.id);
          collectedTracks.push(lite);
          added++;
        }
      }
    });

    const coArtists = Object.values(coArtistMap)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 14);

    const entry = {
      updatedAt: Date.now(),
      artistName: artistName || graph.artistNames[artistId] || '',
      coArtists,
      tracks: collectedTracks
    };
    sceneCache[artistId] = entry;
    saveSceneCache();
    return entry;
  }

  // --------------------------------------------------------------------------
  // CHANNEL 0: TRACK-LEVEL COMPILATION CO-OCCURRENCE (100% NATIVE SPOTIFY API)
  // Captures curated thematic/mood/seasonal co-occurrence (e.g. Christmas, 80s,
  // Workout, Ballads) for solo/classic tracks that aren't in user playlists.
  // --------------------------------------------------------------------------
  const THEME_STOP_WORDS = new Set([
    'this', 'that', 'with', 'from', 'your', 'mine', 'have', 'been', 'will', 'what',
    'when', 'they', 'them', 'were', 'just', 'like', 'know', 'song', 'feat', 'last',
    'first', 'only', 'more', 'love', 'dont', 'cant', 'wont', 'into', 'over', 'para',
    'como', 'pero', 'todo', 'nada', 'algo', 'aqui', 'cuando', 'porque', 'solo'
  ]);

  const CURATED_THEME_KEYWORDS = [
    'christmas', 'navidad', 'holiday', 'xmas', 'winter', 'summer', 'verano',
    'party', 'fiesta', 'chill', 'sad', 'romance', 'acoustic', 'rock', '80s',
    '90s', '2000s', 'reggaeton', 'latin', 'latino', 'workout', 'retro', 'classics'
  ];

  function extractMeaningfulTokens(text) {
    if (!text) return [];
    return String(text)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(tok => tok.length >= 4 && !THEME_STOP_WORDS.has(tok));
  }

  function normArtistKey(name) {
    return String(name || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function trackBelongsToSeedArtist(rawTrack, seedArtistIds, primaryArtistName) {
    if (!rawTrack || !Array.isArray(rawTrack.artists) || rawTrack.artists.length === 0) return false;
    const idSet = new Set(seedArtistIds || []);
    const seedNormName = normArtistKey(primaryArtistName);
    return rawTrack.artists.some(a => {
      if (!a) return false;
      const aid = cleanId(a.id || a.uri);
      if (aid && idSet.has(aid)) return true;
      if (seedNormName && a.name && normArtistKey(a.name) === seedNormName) return true;
      return false;
    });
  }

  async function retrieveTrackCompilations(seedLite) {
    if (!seedLite || !seedLite.id) return { items: [], compArtists: [] };
    const cached = compilationCache[seedLite.id];
    if (cached && cached.updatedAt && (Date.now() - cached.updatedAt) < COMP_TTL_MS) {
      return { items: cached.items || [], compArtists: cached.compArtists || [] };
    }

    const seedArtistIds = getTrackArtistIds(seedLite);
    const primaryArtistId = seedArtistIds[0] || '';
    const primaryArtistName = (seedLite.artists && seedLite.artists[0] && seedLite.artists[0].name)
      || (seedLite.artist ? seedLite.artist.split(',')[0].trim() : '');
    const cleanSeedTitle = cleanTitleForSearch(seedLite.title) || seedLite.title;
    const seedCanonTitle = normalizeCanonicalTitle(seedLite.title);
    const seedTokens = new Set(extractMeaningfulTokens(cleanSeedTitle));

    const searchUrls = [];
    if (seedLite.isrc) {
      searchUrls.push({
        url: `/search?q=${encodeURIComponent('isrc:' + seedLite.isrc)}&type=track&limit=10`,
        viaIsrc: true
      });
    }
    if (cleanSeedTitle) {
      const qStr = primaryArtistName
        ? `track:"${cleanSeedTitle}" artist:"${primaryArtistName}"`
        : `track:"${cleanSeedTitle}"`;
      searchUrls.push({
        url: `/search?q=${encodeURIComponent(qStr)}&type=track&limit=10`,
        viaIsrc: false
      });
    }

    if (searchUrls.length === 0) return { items: [], compArtists: [] };

    const searchResults = await Promise.all(
      searchUrls.map(s =>
        spotifyFetch(s.url)
          .then(res => ({ res, viaIsrc: s.viaIsrc }))
          .catch(() => ({ res: null, viaIsrc: s.viaIsrc }))
      )
    );

    const candidateAlbums = new Map(); // albId -> { alb, viaIsrc, score }
    const addCandidateAlbum = (alb, viaIsrc) => {
      if (!isCleanCompilationAlbum(alb, primaryArtistName)) return;
      const prev = candidateAlbums.get(alb.id);
      if (prev) {
        if (viaIsrc) prev.viaIsrc = true;
        return;
      }
      const total = alb.total_tracks || 20;
      let albScore = 0;
      if (total >= 12 && total <= 70) albScore += 2.0;
      else if (total >= 8 && total <= 100) albScore += 1.0;
      else if (total > 120 || total < 6) albScore -= 1.0;

      const albLower = String(alb.name || '').toLowerCase();
      const albTokens = extractMeaningfulTokens(albLower);
      albTokens.forEach(tok => {
        if (seedTokens.has(tok)) albScore += 2.5;
      });
      if (CURATED_THEME_KEYWORDS.some(kw => albLower.includes(kw))) {
        albScore += 0.8;
      }
      if (viaIsrc) albScore += 0.8;

      candidateAlbums.set(alb.id, { alb, viaIsrc, score: albScore });
    };

    searchResults.forEach(({ res, viaIsrc }) => {
      const items = (res && res.tracks && Array.isArray(res.tracks.items)) ? res.tracks.items : [];
      items.forEach(raw => {
        if (!raw || !raw.album) return;
        if (!trackBelongsToSeedArtist(raw, seedArtistIds, primaryArtistName)) return;
        // Also ensure title matches base seed title if found via text search
        if (!viaIsrc && seedCanonTitle && normalizeCanonicalTitle(raw.name) !== seedCanonTitle) return;
        addCandidateAlbum(raw.album, viaIsrc);
      });
    });

    // If search returned fewer than 2 compilations, check appears_on on the primary artist
    if (candidateAlbums.size < 2 && isValidSpotifyId(primaryArtistId)) {
      const appRes = await spotifyFetch(`/artists/${primaryArtistId}/albums?include_groups=appears_on&limit=10`).catch(() => null);
      const appItems = (appRes && Array.isArray(appRes.items)) ? appRes.items : [];
      appItems.forEach(alb => {
        addCandidateAlbum(alb, false);
      });
    }

    if (candidateAlbums.size === 0) {
      return { items: [], compArtists: [] };
    }

    const topComps = Array.from(candidateAlbums.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    const compTrackResponses = await Promise.all(
      topComps.map(entry =>
        spotifyFetch(`/albums/${entry.alb.id}/tracks?limit=50`)
          .then(res => ({ alb: entry.alb, res }))
          .catch(() => ({ alb: entry.alb, res: null }))
      )
    );

    // Prefer already-known original studio versions from graph.tracks when canonical keys match
    const knownOriginalByCanon = {};
    Object.values(graph.tracks || {}).forEach(gt => {
      if (!gt || !gt.title) return;
      const cTitle = normalizeCanonicalTitle(gt.title);
      if (!cTitle) return;
      const pAid = getTrackArtistIds(gt)[0] || normArtistKey((gt.artist || '').split(',')[0]);
      const cKey = `${cTitle}|${pAid}`;
      const existing = knownOriginalByCanon[cKey];
      if (!existing || (existing.fromCompilation && !gt.fromCompilation)) {
        knownOriginalByCanon[cKey] = gt;
      }
    });

    const groups = new Map(); // canonKey -> { compCount, idfSum, proxSum, bestTrack, compName }
    const compArtistWeights = {}; // artistKey -> { id, name, weight }

    compTrackResponses.forEach(({ alb, res }) => {
      const rawItems = (res && Array.isArray(res.items)) ? res.items : [];
      if (rawItems.length === 0) return;

      const compSize = rawItems.length || alb.total_tracks || 30;
      const compIdf = 1.0 / Math.log2(compSize + 2);

      // Locate seed track inside this compilation for positional proximity bonus
      let seedIdx = -1;
      for (let i = 0; i < rawItems.length; i++) {
        const r = rawItems[i];
        if (!r) continue;
        if (cleanId(r.id) === seedLite.id || (seedCanonTitle && normalizeCanonicalTitle(r.name) === seedCanonTitle)) {
          if (trackBelongsToSeedArtist(r, seedArtistIds, primaryArtistName)) {
            seedIdx = i;
            break;
          }
        }
      }

      const seenInThisComp = new Set();
      for (let idx = 0; idx < rawItems.length; idx++) {
        const raw = rawItems[idx];
        const lite = toTrackLite(raw, alb, { fromCompilation: true });
        if (!lite) continue;

        const cTitle = normalizeCanonicalTitle(lite.title);
        if (!cTitle || (seedCanonTitle && cTitle === seedCanonTitle)) continue; // Reject covers/mixes of seed song!
        if (isNoiseTrack(lite, seedLite.title)) continue;

        const aIds = getTrackArtistIds(lite);
        const pAid = aIds[0] || normArtistKey((lite.artist || '').split(',')[0]);
        if (!pAid) continue;

        const cKey = `${cTitle}|${pAid}`;
        if (seenInThisComp.has(cKey)) continue;
        seenInThisComp.add(cKey);

        const prox = (seedIdx >= 0) ? (0.15 * Math.exp(-Math.abs(idx - seedIdx) / 10)) : 0;
        const preferredTrack = knownOriginalByCanon[cKey] || lite;
        registerTrackInGraph(lite, false);

        const g = groups.get(cKey);
        if (!g) {
          groups.set(cKey, {
            compCount: 1,
            idfSum: compIdf,
            proxSum: prox,
            bestTrack: preferredTrack,
            compName: alb.name || ''
          });
        } else {
          g.compCount += 1;
          g.idfSum += compIdf;
          g.proxSum += prox;
          if (g.bestTrack.fromCompilation && !preferredTrack.fromCompilation) {
            g.bestTrack = preferredTrack;
          }
        }

        // Accumulate co-occurring artists excluding seed artist
        const isSeedArtist = (seedArtistIds.length > 0 && aIds.some(id => seedArtistIds.includes(id)))
          || (primaryArtistName && normArtistKey((lite.artist || '').split(',')[0]) === normArtistKey(primaryArtistName));
        if (!isSeedArtist && isValidSpotifyId(aIds[0])) {
          const pName = (lite.artists && lite.artists[0] && lite.artists[0].name) || lite.artist.split(',')[0].trim();
          if (!compArtistWeights[aIds[0]]) {
            compArtistWeights[aIds[0]] = { id: aIds[0], name: pName, weight: 0, fromCompilation: true };
          }
          compArtistWeights[aIds[0]].weight += compIdf;
        }
      }
    });

    const rawEntries = [];
    let maxRawSim = 0.001;
    groups.forEach(g => {
      const consensusMult = g.compCount >= 3 ? 1.55 : (g.compCount === 2 ? 1.25 : 0.72);
      const rawSim = (g.idfSum + g.proxSum) * consensusMult;
      if (rawSim > maxRawSim) maxRawSim = rawSim;
      rawEntries.push({
        track: g.bestTrack,
        rawSim,
        compCount: g.compCount,
        compName: g.compName
      });
    });

    const items = rawEntries
      .map(e => ({
        track: e.track,
        compSim: Math.min(1, e.rawSim / maxRawSim),
        channel: 'track_compilations',
        reason: `Similar a ${seedLite.title}`
      }))
      .sort((a, b) => b.compSim - a.compSim)
      .slice(0, 50);

    const compArtists = Object.values(compArtistWeights)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);

    if (items.length > 0) {
      compilationCache[seedLite.id] = {
        updatedAt: Date.now(),
        items,
        compArtists
      };
      saveCompilationCache();
    }

    return { items, compArtists };
  }

  // --------------------------------------------------------------------------
  // MODULE B: 4-CHANNEL RETRIEVAL ENGINE
  // --------------------------------------------------------------------------
  function retrievePlaylistCooccurrence(contextAnchors) {
    const candidates = new Map(); // trackId -> { track, playlistSim, reason }
    const seedPlaylists = new Map(); // plId -> relevanceWeight
    let totalSeedPlWeight = 0;

    contextAnchors.forEach(anchor => {
      if (!anchor || anchor.effectiveWeight <= 0) return;
      const w = anchor.effectiveWeight;
      // Direct track match in user's playlists (strongest mood match!)
      const directPls = graph.trackToPlaylists[anchor.id] || [];
      directPls.forEach(plId => {
        const pl = graph.playlists[plId];
        if (!pl) return;
        const contrib = w * pl.weight * 1.5;
        seedPlaylists.set(plId, (seedPlaylists.get(plId) || 0) + contrib);
        totalSeedPlWeight += contrib;
      });
      // Artist match in user's playlists
      (anchor.artistIds || []).forEach(aid => {
        const artPls = graph.artistToPlaylists[aid] || [];
        artPls.forEach(plId => {
          const pl = graph.playlists[plId];
          if (!pl) return;
          const contrib = w * pl.weight * 0.85;
          seedPlaylists.set(plId, (seedPlaylists.get(plId) || 0) + contrib);
          totalSeedPlWeight += contrib;
        });
      });
    });

    if (seedPlaylists.size === 0) return [];

    // Hop 1: Tracks inside matching playlists
    const hop1Artists = new Set();
    seedPlaylists.forEach((relW, plId) => {
      const pl = graph.playlists[plId];
      if (!pl) return;
      (pl.artistIds || []).forEach(aid => hop1Artists.add(aid));
      (pl.trackIds || []).forEach(tid => {
        const tr = graph.tracks[tid];
        if (!tr) return;
        const prev = candidates.get(tid);
        const trackTotalW = (graph.trackToPlaylists[tid] || []).reduce((acc, pid) => acc + ((graph.playlists[pid] && graph.playlists[pid].weight) || 0.2), 0);
        const sim = relW / Math.sqrt(Math.max(0.05, totalSeedPlWeight * Math.max(0.1, trackTotalW)));
        if (!prev) {
          candidates.set(tid, {
            track: tr,
            playlistSim: sim,
            channel: 'playlist_cooc',
            reason: `En tu playlist ${pl.name}`
          });
        } else {
          prev.playlistSim += sim;
        }
      });
    });

    // Hop 2: Sister playlists sharing artist overlap with Hop-1 playlists (attenuated 0.45)
    if (hop1Artists.size > 0) {
      const sisterScores = [];
      Object.keys(graph.playlists).forEach(plId => {
        if (seedPlaylists.has(plId)) return;
        const pl = graph.playlists[plId];
        if (!pl || !Array.isArray(pl.artistIds) || pl.artistIds.length === 0) return;
        let overlap = 0;
        for (let i = 0; i < pl.artistIds.length; i++) {
          if (hop1Artists.has(pl.artistIds[i])) overlap++;
        }
        if (overlap >= 2) {
          const jaccard = overlap / Math.sqrt(hop1Artists.size * pl.artistIds.length);
          sisterScores.push({ plId, pl, score: jaccard * pl.weight * 0.45 });
        }
      });
      sisterScores.sort((a, b) => b.score - a.score);
      sisterScores.slice(0, 3).forEach(({ pl, score }) => {
        (pl.trackIds || []).slice(0, 35).forEach(tid => {
          const tr = graph.tracks[tid];
          if (!tr) return;
          const prev = candidates.get(tid);
          if (!prev) {
            candidates.set(tid, {
              track: tr,
              playlistSim: score,
              channel: 'playlist_cooc',
              reason: `Afinidad con ${pl.name}`
            });
          } else {
            prev.playlistSim += score;
          }
        });
      });
    }

    // Normalize playlistSim to [0, 1]
    const list = Array.from(candidates.values());
    let maxSim = 0.001;
    list.forEach(c => { if (c.playlistSim > maxSim) maxSim = c.playlistSim; });
    list.forEach(c => { c.playlistSim = Math.min(1, c.playlistSim / maxSim); });
    list.sort((a, b) => b.playlistSim - a.playlistSim);
    return list.slice(0, 45);
  }

  async function retrieveCollabScene(seedLite, contextAnchors) {
    const candidates = new Map();
    const primaryArtists = getTrackArtistIds(seedLite);
    const allAnchorArtists = new Set(primaryArtists);
    contextAnchors.forEach(a => {
      if (a && a.effectiveWeight > 0) {
        (a.artistIds || []).forEach(id => allAnchorArtists.add(id));
      }
    });

    // Gather neighbor collaborators from local collabEdges
    const neighborWeights = {}; // { [artistId]: weight }
    allAnchorArtists.forEach(aid => {
      const edges = graph.collabEdges[aid];
      if (!edges) return;
      Object.keys(edges).forEach(coId => {
        if (!allAnchorArtists.has(coId)) {
          neighborWeights[coId] = (neighborWeights[coId] || 0) + edges[coId];
        }
      });
    });

    // Live Spotify `appears_on` + discography enrichment for seed artist (1st hop)
    const primaryArtistId = primaryArtists[0];
    const primaryArtistName = (seedLite.artists && seedLite.artists[0] && seedLite.artists[0].name)
      || (seedLite.artist ? seedLite.artist.split(',')[0].trim() : '');

    let seedScene = null;
    if (isValidSpotifyId(primaryArtistId)) {
      seedScene = await getArtistSceneData(primaryArtistId, primaryArtistName);
      if (seedScene) {
        (seedScene.coArtists || []).forEach(ca => {
          if (!allAnchorArtists.has(ca.id)) {
            neighborWeights[ca.id] = (neighborWeights[ca.id] || 0) + ca.weight * 1.4;
          }
        });
        // Add non-seed tracks from seed artist's own singles/albums at restrained similarity
        // so own-artist album tracks never outrank genuine multi-artist Song Radio matches
        (seedScene.tracks || []).forEach(tr => {
          if (tr.id === seedLite.id) return;
          const isOtherArtistLead = getTrackArtistIds(tr)[0] !== primaryArtistId;
          candidates.set(tr.id, {
            track: tr,
            sceneSim: isOtherArtistLead ? 0.92 : 0.42,
            channel: 'collab_scene',
            reason: isOtherArtistLead
              ? `Colaboración con ${primaryArtistName || 'este artista'}`
              : `Más de ${primaryArtistName || 'este artista'}`
          });
        });
      }
    }

    // Add extra featured artists directly from the seed track itself
    primaryArtists.slice(1, 3).forEach(featId => {
      neighborWeights[featId] = (neighborWeights[featId] || 0) + 3.0;
    });

    // Sort top neighbor artists & expand up to 2 neighbor artists live (within HTTP budget!)
    const rankedNeighbors = Object.keys(neighborWeights)
      .map(id => ({ id, name: graph.artistNames[id] || '', weight: neighborWeights[id] }))
      .sort((a, b) => b.weight - a.weight);

    const topNeighbors = rankedNeighbors.slice(0, 8);
    const maxNeighborW = topNeighbors[0] ? topNeighbors[0].weight : 1;

    // First pull any tracks of top neighbors already in our local graph (0 HTTP calls)
    topNeighbors.forEach(nb => {
      const localTids = graph.artistTracks[nb.id] || [];
      const normW = Math.min(1, nb.weight / Math.max(1, maxNeighborW));
      localTids.forEach(tid => {
        const tr = graph.tracks[tid];
        if (!tr) return;
        const prev = candidates.get(tid);
        const sim = 0.55 + 0.40 * normW;
        if (!prev || sim > prev.sceneSim) {
          candidates.set(tid, {
            track: tr,
            sceneSim: sim,
            channel: 'collab_scene',
            reason: `Escena de ${primaryArtistName || nb.name || 'tu sesión'}`
          });
        }
      });
    });

    // Live fetch for up to 2 top neighbor artists (gets fresh discovery tracks not in user's library!)
    const neighborsToFetch = topNeighbors.slice(0, 2);
    if (neighborsToFetch.length > 0) {
      const nbScenes = await Promise.all(
        neighborsToFetch.map(nb => getArtistSceneData(nb.id, nb.name).catch(() => null))
      );
      nbScenes.forEach((sc, idx) => {
        if (!sc || !Array.isArray(sc.tracks)) return;
        const nb = neighborsToFetch[idx];
        const normW = Math.min(1, nb.weight / Math.max(1, maxNeighborW));
        sc.tracks.forEach(tr => {
          const prev = candidates.get(tr.id);
          const sim = 0.60 + 0.35 * normW;
          if (!prev || sim > prev.sceneSim) {
            candidates.set(tr.id, {
              track: tr,
              sceneSim: sim,
              channel: 'collab_scene',
              reason: `Escena de ${primaryArtistName || nb.name || 'este artista'}`
            });
          }
        });
      });
    }

    const list = Array.from(candidates.values());
    list.sort((a, b) => b.sceneSim - a.sceneSim);
    return {
      items: list.slice(0, 40),
      neighbors: topNeighbors
    };
  }

  function retrieveSessionSequential(contextAnchors) {
    const candidates = new Map();
    const bucket = getTimeBucket();

    contextAnchors.forEach(anchor => {
      if (!anchor || anchor.effectiveWeight <= 0) return;
      const w = anchor.effectiveWeight;

      // Direct track -> next track transitions
      const nextTracks = graph.trackTransitions[anchor.id];
      if (nextTracks) {
        Object.keys(nextTracks).forEach(tid => {
          const tr = graph.tracks[tid];
          if (!tr) return;
          const score = w * Math.min(1, nextTracks[tid] / 3);
          const prev = candidates.get(tid);
          if (!prev || score > prev.seqSim) {
            candidates.set(tid, {
              track: tr,
              seqSim: score,
              channel: 'session_seq',
              reason: 'Sueles escuchar después'
            });
          }
        });
      }

      // Artist -> next artist transitions with time-of-day affinity
      (anchor.artistIds || []).forEach(aid => {
        const nextArts = graph.transitions[aid];
        if (!nextArts) return;
        Object.keys(nextArts).forEach(nextAid => {
          const stat = nextArts[nextAid];
          if (!stat || !stat.c) return;
          const timeBoost = (Array.isArray(stat.b) && stat.b[bucket] > 0) ? 1.35 : 1.0;
          const artScore = w * Math.min(1, (stat.c * timeBoost) / 4);
          const tids = graph.artistTracks[nextAid] || [];
          tids.slice(0, 8).forEach(tid => {
            const tr = graph.tracks[tid];
            if (!tr) return;
            const prev = candidates.get(tid);
            if (!prev || artScore > prev.seqSim) {
              candidates.set(tid, {
                track: tr,
                seqSim: artScore,
                channel: 'session_seq',
                reason: timeBoost > 1 ? 'Ideal para esta hora' : 'Flujo de tus sesiones'
              });
            }
          });
        });
      });
    });

    const list = Array.from(candidates.values());
    list.sort((a, b) => b.seqSim - a.seqSim);
    return list.slice(0, 22);
  }

  async function retrieveCatalogExplore(seedLite, neighborArtists, hasStrongPool = false) {
    const candidates = new Map();
    const queries = [];
    const seedYear = seedLite.year;
    const yearFilter = (seedYear && seedYear >= 1960)
      ? ` year:${Math.max(1950, seedYear - 4)}-${Math.min(2030, seedYear + 4)}`
      : '';

    // 1. Pick up to 2 neighbor artists (omit restrictive yearFilter for cross-era compilation neighbors)
    const namedNeighbors = (neighborArtists || []).filter(nb => nb && nb.name);
    if (namedNeighbors[0]) {
      const nbYear = namedNeighbors[0].fromCompilation ? '' : yearFilter;
      queries.push({
        q: `artist:"${namedNeighbors[0].name}"${nbYear}`,
        reason: `Descubrimiento • ${namedNeighbors[0].name}`
      });
    }
    if (namedNeighbors[1]) {
      queries.push({
        q: `artist:"${namedNeighbors[1].name}"`,
        reason: `Descubrimiento • ${namedNeighbors[1].name}`
      });
    }

    // 2. If genres are available on this Client ID (optional bonus), add 1 genre+era discovery query
    const seedArtistId = getTrackArtistIds(seedLite)[0];
    const knownGenres = (seedArtistId && Array.isArray(graph.artistGenres[seedArtistId]))
      ? graph.artistGenres[seedArtistId]
      : [];
    if (knownGenres[0] && queries.length < 3) {
      queries.push({
        q: `genre:"${knownGenres[0]}"${yearFilter}`,
        reason: `Explorar • ${knownGenres[0]}`
      });
    }

    // 3. Cold-start fallback ONLY if we don't already have strong compilation/playlist matches
    const primaryName = (seedLite.artists && seedLite.artists[0] && seedLite.artists[0].name)
      || (seedLite.artist ? seedLite.artist.split(',')[0].trim() : '');
    if (queries.length === 0 && !hasStrongPool && primaryName) {
      queries.push({
        q: `artist:"${primaryName}"`,
        reason: `Más de ${primaryName}`
      });
    }

    if (queries.length === 0) return [];

    // Strictly limit=10 (Spotify Feb 2026 compliance!)
    const results = await Promise.all(
      queries.slice(0, 2).map(item => {
        const offset = Math.floor(Math.random() * 2) * 5;
        return spotifyFetch(`/search?q=${encodeURIComponent(item.q)}&type=track&limit=10&offset=${offset}`)
          .then(res => ({ res, reason: item.reason }))
          .catch(() => ({ res: null, reason: item.reason }));
      })
    );

    results.forEach(({ res, reason }) => {
      const items = (res && res.tracks && Array.isArray(res.tracks.items)) ? res.tracks.items : [];
      items.forEach((raw, idx) => {
        const lite = toTrackLite(raw);
        if (!lite) return;
        registerTrackInGraph(lite, false);
        const rankScore = 0.85 - (idx * 0.04);
        if (!candidates.has(lite.id)) {
          candidates.set(lite.id, {
            track: lite,
            exploreSim: Math.max(0.35, rankScore),
            channel: 'catalog_explore',
            reason
          });
        }
      });
    });

    return Array.from(candidates.values()).slice(0, 24);
  }

  // --------------------------------------------------------------------------
  // MODULE C & D: CONTEXT WINDOW, MULTI-SIGNAL SCORING & BART BANDIT
  // --------------------------------------------------------------------------
  function buildContextAnchors(seedLite) {
    const anchors = [];
    const baseSeed = sessionCtx.seedTrack || seedLite;
    if (baseSeed) {
      anchors.push({
        id: baseSeed.id,
        artistIds: getTrackArtistIds(baseSeed),
        year: baseSeed.year,
        effectiveWeight: sessionCtx.window.length > 0 ? 0.45 : 1.0
      });
    }

    // Sliding window over last 4 played tracks (decays e^(-0.5*k), modulated by satisfaction sign)
    const win = sessionCtx.window.slice(-4).reverse(); // newest first
    let posTotal = 0;
    const rawEntries = win.map((entry, idx) => {
      const decay = Math.exp(-0.5 * idx);
      const w = decay * (entry.sign || 1.0);
      if (w > 0) posTotal += w;
      return {
        id: entry.id,
        artistIds: entry.artistIds || [],
        year: entry.year,
        rawW: w
      };
    });

    rawEntries.forEach(e => {
      const normW = e.rawW > 0
        ? (0.55 * (e.rawW / Math.max(0.001, posTotal)))
        : (0.25 * e.rawW); // negative weight for skipped tracks
      anchors.push({
        id: e.id,
        artistIds: e.artistIds,
        year: e.year,
        effectiveWeight: normW
      });
    });

    return anchors;
  }

  function getArtistFeedbackScore(artistId) {
    const rec = feedback.artistScores && feedback.artistScores[artistId];
    if (!rec) return 0;
    return rec.score * decayFactor(rec.ts);
  }

  function getTrackFeedbackScore(trackId) {
    const rec = feedback.trackScores && feedback.trackScores[trackId];
    if (!rec) return 0;
    return rec.score * decayFactor(rec.ts);
  }

  function computeEraSimilarity(trackYear, refYear, fromCompilation = false) {
    if (fromCompilation) return 0.65; // Compilation release dates reflect reissue year, not recording era
    if (!trackYear || !refYear) return 0.55; // neutral when release_date unavailable
    const diff = trackYear - refYear;
    return Math.exp(-(diff * diff) / (2 * 6 * 6)); // sigma = 6 years
  }

  function computeUserAffinity(track) {
    const tid = track.id;
    const aIds = getTrackArtistIds(track);
    let score = 0;
    if (graph.topTrackScores[tid]) {
      score = Math.max(score, graph.topTrackScores[tid]);
    }
    aIds.forEach(aid => {
      if (graph.topArtistScores[aid]) {
        score = Math.max(score, graph.topArtistScores[aid] * 0.9);
      }
      // Fold positive persistent feedback gently into user affinity
      const fb = getArtistFeedbackScore(aid);
      if (fb > 0) {
        score = Math.min(1, score + Math.min(0.35, fb * 0.12));
      }
    });
    return Math.min(1, Math.max(0, score));
  }

  function computeFeedbackPenalty(track, contextAnchors) {
    let pen = 0;
    const tfb = getTrackFeedbackScore(track.id);
    if (tfb < 0) pen += Math.min(0.65, Math.abs(tfb) * 0.35);

    const aIds = getTrackArtistIds(track);
    aIds.forEach(aid => {
      const afb = getArtistFeedbackScore(aid);
      if (afb < 0) pen += Math.min(0.55, Math.abs(afb) * 0.25);
    });

    // Mid-session negative steering: if user just skipped this artist in the active window
    contextAnchors.forEach(anc => {
      if (anc.effectiveWeight < 0) {
        const sharesSkippedArtist = aIds.some(aid => (anc.artistIds || []).includes(aid));
        if (sharesSkippedArtist) {
          pen += Math.min(0.5, Math.abs(anc.effectiveWeight) * 1.4);
        }
      }
    });

    return Math.min(0.95, pen);
  }

  function isTrackFamiliar(trackId) {
    if (!trackId) return false;
    if (graph.savedTrackIds && graph.savedTrackIds[trackId]) return true;
    if (graph.trackToPlaylists && graph.trackToPlaylists[trackId] && graph.trackToPlaylists[trackId].length > 0) return true;
    if (typeof liveCatalog !== 'undefined' && liveCatalog.likedTrackIds && liveCatalog.likedTrackIds.has(trackId)) return true;
    return false;
  }

  function scoreMergedCandidates(mergedMap, contextAnchors, refYear) {
    // Draw one Thompson Sample per channel for this generation round (BaRT)
    const channelBandit = {};
    CHANNELS.forEach(ch => {
      const st = (feedback.channelStats && feedback.channelStats[ch]) || { alpha: 2, beta: 2 };
      channelBandit[ch] = sampleBeta(st.alpha, st.beta);
    });

    // Check which retrieval signals actually have non-zero coverage so we renormalize cleanly on Cold Start
    const list = Array.from(mergedMap.values());
    const hasCompSignal = list.some(c => c.compSim > 0);
    const hasPlaylistSignal = list.some(c => c.playlistSim > 0);
    const hasSceneSignal = list.some(c => c.sceneSim > 0);
    const hasSeqSignal = list.some(c => c.seqSim > 0);

    const rawWeights = {
      comp: hasCompSignal ? 0.36 : 0,
      playlist: hasPlaylistSignal ? 0.24 : 0,
      scene: hasSceneSignal ? 0.16 : 0,
      seq: hasSeqSignal ? 0.08 : 0,
      era: 0.06,
      user: 0.05,
      bandit: 0.05
    };
    const wSum = rawWeights.comp + rawWeights.playlist + rawWeights.scene + rawWeights.seq + rawWeights.era + rawWeights.user + rawWeights.bandit || 1;
    const W = {
      comp: rawWeights.comp / wSum,
      playlist: rawWeights.playlist / wSum,
      scene: rawWeights.scene / wSum,
      seq: rawWeights.seq / wSum,
      era: rawWeights.era / wSum,
      user: rawWeights.user / wSum,
      bandit: rawWeights.bandit / wSum
    };

    const seedArtistId = sessionCtx.seedArtistIds[0] || '';
    const seedGenres = (seedArtistId && Array.isArray(graph.artistGenres[seedArtistId]))
      ? new Set(graph.artistGenres[seedArtistId])
      : null;

    list.forEach(cand => {
      const tr = cand.track;
      const eraSim = computeEraSimilarity(tr.year, refYear, tr.fromCompilation);
      const userAff = computeUserAffinity(tr);
      const banditVal = channelBandit[cand.primaryChannel] || 0.5;
      const fbPen = computeFeedbackPenalty(tr, contextAnchors);

      // Combine scene + controlled exploration cleanly
      const effectiveScene = Math.max(cand.sceneSim || 0, (cand.exploreSim || 0) * 0.82);

      // Lead-track & single heuristic bonus (compensates for Spotify removing /top-tracks)
      let qualityBonus = 0;
      if (tr.albumType === 'single') qualityBonus += 0.04;
      if (tr.trackNumber > 0 && tr.trackNumber <= 3) qualityBonus += 0.03;
      if (typeof tr.popularity === 'number' && tr.popularity > 0) {
        // Gentle sweet-spot around popularity 45-85 (avoids both obscure noise and hyper-repetitive top-10 only)
        qualityBonus += (tr.popularity / 100) * 0.05;
      }

      // Optional genre overlap bonus (if API still returns genres for this Client ID)
      if (seedGenres && seedGenres.size > 0) {
        const candAid = getTrackArtistIds(tr)[0];
        const cGenres = (candAid && graph.artistGenres[candAid]) || [];
        if (cGenres.some(g => seedGenres.has(g))) {
          qualityBonus += 0.06;
        }
      }

      // Multi-channel consensus bonus (Spotify loves items retrieved by >=2 independent channels!)
      const channelCount = cand.channels ? cand.channels.size : 1;
      const consensusBonus = channelCount >= 2 ? (0.07 * (channelCount - 1)) : 0;

      const finalScore =
        W.comp * (cand.compSim || 0) +
        W.playlist * (cand.playlistSim || 0) +
        W.scene * effectiveScene +
        W.seq * (cand.seqSim || 0) +
        W.era * eraSim +
        W.user * userAff +
        W.bandit * banditVal +
        qualityBonus +
        consensusBonus -
        fbPen;

      cand.score = finalScore;
      cand.isFamiliar = isTrackFamiliar(tr.id);
    });

    list.sort((a, b) => b.score - a.score);
    return list;
  }

  // --------------------------------------------------------------------------
  // MODULE E: MMR DIVERSITY RE-RANKER & FAMILIARITY CALIBRATION
  // --------------------------------------------------------------------------
  function selectWithMMRDiversity(scoredCandidates, limit = 12, seedTitle = '') {
    const selected = [];
    const remaining = scoredCandidates.filter(c => {
      if (!c || !c.track || !c.track.id) return false;
      const tid = c.track.id;
      if (sessionCtx.sessionPlayedIds.has(tid)) return false;
      if (sessionCtx.recentHistoryIds.includes(tid)) return false;
      const canon = normalizeCanonicalTitle(c.track.title);
      if (canon && sessionCtx.sessionPlayedCanonical.has(canon)) return false;
      if (isNoiseTrack(c.track, seedTitle)) return false;
      return true;
    });

    const chosenCanonTitles = new Set();
    const artistCounts = {};
    const artistLastPos = {};
    const albumLastPos = {};

    const seedPrimaryAid = sessionCtx.seedArtistIds[0] || '';
    const seedPrimaryNorm = normArtistKey(sessionCtx.seedArtistName);
    const isSeedPrimaryTrack = (tr) => {
      if (!tr) return false;
      const aIds = getTrackArtistIds(tr);
      if (seedPrimaryAid && aIds.includes(seedPrimaryAid)) return true;
      if (seedPrimaryNorm && normArtistKey((tr.artist || '').split(',')[0]) === seedPrimaryNorm) return true;
      return false;
    };

    const TARGET_FAMILIAR_RATIO = 0.55; // Balanced Spotify mix: ~55% familiar / ~45% discovery
    let familiarPicked = 0;

    for (let slot = 0; slot < limit && remaining.length > 0; slot++) {
      const prevSelected = selected[selected.length - 1] || null;
      const prevArtists = prevSelected ? new Set(getTrackArtistIds(prevSelected.track)) : null;
      const prevAlbumId = prevSelected ? prevSelected.track.albumId : null;
      const nonSeedRemainingCount = remaining.reduce((acc, c) => acc + (isSeedPrimaryTrack(c.track) ? 0 : 1), 0);

      // Determine desired calibration bucket for slots >= 2 (slots 0-1 are safe high-affinity bridges)
      let preferDiscovery = false;
      if (slot >= 2) {
        const currentFamRatio = familiarPicked / slot;
        preferDiscovery = currentFamRatio > TARGET_FAMILIAR_RATIO;
      }

      const pickBest = (strictConstraints) => {
        let bestIdx = -1;
        let bestMMR = -Infinity;

        for (let i = 0; i < remaining.length; i++) {
          const cand = remaining[i];
          const tr = cand.track;
          const canon = normalizeCanonicalTitle(tr.title);
          if (canon && chosenCanonTitles.has(canon)) continue;

          const aIds = getTrackArtistIds(tr);
          const primaryAid = aIds[0] || tr.artist.toLowerCase();
          const isSeedArt = isSeedPrimaryTrack(tr);

          if (strictConstraints) {
            // Seed artist caps: never in slots 0-1 (unless <4 non-seed candidates exist) & max 1 per 12-track block
            if (isSeedArt) {
              if ((artistCounts[primaryAid] || 0) >= 1) continue;
              if (slot < 2 && nonSeedRemainingCount >= 4) continue;
            }
            // Artist separation >= 3 slots & max 2 tracks per artist in a 12-track window
            if ((artistCounts[primaryAid] || 0) >= 2) continue;
            if (typeof artistLastPos[primaryAid] === 'number' && (slot - artistLastPos[primaryAid]) < 3) continue;
            // Album separation >= 6 slots (only for genuine studio albums, never multi-artist compilations)
            if (!tr.fromCompilation && tr.albumId && typeof albumLastPos[tr.albumId] === 'number' && (slot - albumLastPos[tr.albumId]) < 6) continue;
          } else {
            // Relaxed fallback: still enforce seed-artist max-1 cap while other artists exist and avoid back-to-back repeats
            if (isSeedArt && (artistCounts[primaryAid] || 0) >= 1 && nonSeedRemainingCount > 0) continue;
            if (typeof artistLastPos[primaryAid] === 'number' && (slot - artistLastPos[primaryAid]) < 1) continue;
          }

          // MMR redundancy penalty against immediately previous track
          let redundancy = 0;
          if (prevArtists) {
            const shared = aIds.filter(id => prevArtists.has(id)).length;
            if (shared > 0) redundancy += 0.22;
          }
          if (!tr.fromCompilation && prevSelected && !prevSelected.track.fromCompilation && prevAlbumId && tr.albumId && tr.albumId === prevAlbumId) {
            redundancy += 0.25;
          }

          // Calibration nudge (gentle so we never pick a bad track just to hit ratio)
          let calibNudge = 0;
          if (slot >= 2) {
            if (preferDiscovery && !cand.isFamiliar) calibNudge = 0.08;
            else if (!preferDiscovery && cand.isFamiliar) calibNudge = 0.05;
          }

          const mmrScore = cand.score + calibNudge - redundancy;
          if (mmrScore > bestMMR) {
            bestMMR = mmrScore;
            bestIdx = i;
          }
        }
        return bestIdx;
      };

      let chosenIdx = pickBest(true);
      if (chosenIdx < 0) chosenIdx = pickBest(false);
      if (chosenIdx < 0) break;

      const picked = remaining.splice(chosenIdx, 1)[0];
      const tr = picked.track;
      const canon = normalizeCanonicalTitle(tr.title);
      if (canon) chosenCanonTitles.add(canon);

      const primaryAid = getTrackArtistIds(tr)[0] || tr.artist.toLowerCase();
      artistCounts[primaryAid] = (artistCounts[primaryAid] || 0) + 1;
      artistLastPos[primaryAid] = slot;
      if (!tr.fromCompilation && tr.albumId) albumLastPos[tr.albumId] = slot;
      if (picked.isFamiliar) familiarPicked++;

      selected.push(picked);
    }

    return selected.map(item => Object.assign({}, item.track, {
      radioChannel: item.primaryChannel,
      radioReason: item.reason || '',
      radioScore: Number((item.score || 0).toFixed(3)),
      isDiscovery: !item.isFamiliar
    }));
  }

  // --------------------------------------------------------------------------
  // PUBLIC RADIO ORCHESTRATOR
  // --------------------------------------------------------------------------
  function resetSession(seedTrack) {
    loadPersistedState();
    const lite = toTrackLite(seedTrack);
    sessionCtx.seedTrack = lite;
    sessionCtx.seedArtistIds = lite ? getTrackArtistIds(lite) : [];
    sessionCtx.seedArtistName = lite
      ? ((lite.artists && lite.artists[0] && lite.artists[0].name) || lite.artist.split(',')[0].trim())
      : (seedTrack && seedTrack.artist ? String(seedTrack.artist).split(',')[0].trim() : '');
    sessionCtx.seedYear = lite ? lite.year : null;
    sessionCtx.seedDuration = lite ? lite.duration : 210;
    sessionCtx.window = [];
    sessionCtx.sessionPlayedIds = new Set();
    sessionCtx.sessionPlayedCanonical = new Set();

    if (lite) {
      sessionCtx.sessionPlayedIds.add(lite.id);
      const c = normalizeCanonicalTitle(lite.title);
      if (c) sessionCtx.sessionPlayedCanonical.add(c);
      markHistoryId(lite.id);
    }
  }

  function markHistoryId(trackIdOrUri) {
    const cid = cleanId(trackIdOrUri);
    if (!cid) return;
    sessionCtx.sessionPlayedIds.add(cid);
    const idx = sessionCtx.recentHistoryIds.indexOf(cid);
    if (idx >= 0) sessionCtx.recentHistoryIds.splice(idx, 1);
    sessionCtx.recentHistoryIds.push(cid);
    if (sessionCtx.recentHistoryIds.length > MAX_RADIO_HISTORY) {
      sessionCtx.recentHistoryIds.shift();
    }
  }

  async function enrichSeedTrack(seedTrack) {
    let lite = toTrackLite(seedTrack);
    const seedId = cleanId(seedTrack && (seedTrack.id || seedTrack.uri));
    const needsMeta = !lite || getTrackArtistIds(lite).length === 0 || !lite.year || !lite.isrc;

    if (needsMeta && isValidSpotifyId(seedId) && spotifyAuth && spotifyAuth.accessToken) {
      const cached = graph.tracks[seedId];
      if (cached && getTrackArtistIds(cached).length > 0 && cached.year && cached.isrc) {
        lite = Object.assign({}, lite || {}, cached);
      } else {
        const meta = await spotifyFetch(`/tracks/${seedId}`).catch(() => null);
        if (meta && meta.id) {
          const enriched = toTrackLite(meta);
          if (enriched) {
            lite = lite ? Object.assign({}, lite, enriched) : enriched;
            if (!lite.cover && seedTrack && seedTrack.cover) lite.cover = seedTrack.cover;
            if (!lite.thumb && seedTrack && seedTrack.thumb) lite.thumb = seedTrack.thumb;
            registerTrackInGraph(lite, false);
          }
        }
      }
    }
    return lite;
  }

  async function generateRadioTracks(seedTrack, limit = 12) {
    loadPersistedState();
    if (!spotifyAuth || !spotifyAuth.accessToken || !seedTrack) return [];

    const seedLite = await enrichSeedTrack(seedTrack);
    if (!seedLite) return [];

    // Ensure session has fully enriched seed anchor (fixes incomplete metadata when started from Search)
    if (!sessionCtx.seedTrack) {
      resetSession(seedLite);
    } else {
      if (sessionCtx.seedTrack.id === seedLite.id) {
        sessionCtx.seedTrack = seedLite;
        sessionCtx.seedArtistIds = getTrackArtistIds(seedLite);
        sessionCtx.seedArtistName = ((seedLite.artists && seedLite.artists[0] && seedLite.artists[0].name)
          || seedLite.artist.split(',')[0].trim()
          || sessionCtx.seedArtistName);
        sessionCtx.seedYear = seedLite.year || sessionCtx.seedYear;
        sessionCtx.seedDuration = seedLite.duration || sessionCtx.seedDuration;
      }
      sessionCtx.sessionPlayedIds.add(seedLite.id);
      const canon = normalizeCanonicalTitle(seedLite.title);
      if (canon) sessionCtx.sessionPlayedCanonical.add(canon);
    }

    // Also exclude tracks already queued in UI
    if (typeof state !== 'undefined' && Array.isArray(state.liveQueueTracks)) {
      state.liveQueueTracks.forEach(t => {
        if (!t) return;
        const cid = cleanId(t.id || t.uri);
        if (cid) sessionCtx.sessionPlayedIds.add(cid);
        const c = normalizeCanonicalTitle(t.title || t.name);
        if (c) sessionCtx.sessionPlayedCanonical.add(c);
      });
    }

    const contextAnchors = buildContextAnchors(seedLite);

    // Stage 1: Multi-channel Retrieval (Local channels synchronously; Compilations + Collab Scene in parallel)
    const playlistItems = retrievePlaylistCooccurrence(contextAnchors);
    const seqItems = retrieveSessionSequential(contextAnchors);
    const [compRes, sceneRes] = await Promise.all([
      retrieveTrackCompilations(seedLite),
      retrieveCollabScene(seedLite, contextAnchors)
    ]);
    const compItems = (compRes && compRes.items) ? compRes.items : [];
    const compArtists = (compRes && compRes.compArtists) ? compRes.compArtists : [];
    const sceneItems = (sceneRes && sceneRes.items) ? sceneRes.items : [];
    const collabNeighbors = (sceneRes && sceneRes.neighbors) ? sceneRes.neighbors : [];

    // Merge neighbor artists (preferring compilation co-occurring artists when collab graph is sparse)
    const combinedNeighbors = [];
    const seenNb = new Set();
    const pushNbList = (arr) => {
      (arr || []).forEach(nb => {
        if (!nb || !nb.id || seenNb.has(nb.id)) return;
        seenNb.add(nb.id);
        combinedNeighbors.push(nb);
      });
    };
    if (collabNeighbors.length < 2) {
      pushNbList(compArtists);
      pushNbList(collabNeighbors);
    } else {
      pushNbList(collabNeighbors);
      pushNbList(compArtists);
    }

    // Run controlled catalog exploration (skip generic artist fallback if pool is already strong)
    const hasStrongPool = (compItems.length + playlistItems.length) >= 8;
    const exploreItems = await retrieveCatalogExplore(seedLite, combinedNeighbors, hasStrongPool);

    // Merge all candidates into unified pool (preserving multi-channel consensus)
    const merged = new Map();
    const mergeItem = (item, fieldName) => {
      if (!item || !item.track || !item.track.id) return;
      const tid = item.track.id;
      const existing = merged.get(tid);
      if (!existing) {
        const chSet = new Set([item.channel]);
        merged.set(tid, {
          track: item.track,
          compSim: fieldName === 'compSim' ? item.compSim : 0,
          playlistSim: fieldName === 'playlistSim' ? item.playlistSim : 0,
          sceneSim: fieldName === 'sceneSim' ? item.sceneSim : 0,
          seqSim: fieldName === 'seqSim' ? item.seqSim : 0,
          exploreSim: fieldName === 'exploreSim' ? item.exploreSim : 0,
          channels: chSet,
          primaryChannel: item.channel,
          primaryStrength: item[fieldName] || 0,
          reason: item.reason || ''
        });
      } else {
        existing[fieldName] = Math.max(existing[fieldName] || 0, item[fieldName] || 0);
        existing.channels.add(item.channel);
        if ((item[fieldName] || 0) > existing.primaryStrength) {
          existing.primaryStrength = item[fieldName] || 0;
          existing.primaryChannel = item.channel;
          if (item.reason) existing.reason = item.reason;
        }
      }
    };

    compItems.forEach(it => mergeItem(it, 'compSim'));
    playlistItems.forEach(it => mergeItem(it, 'playlistSim'));
    sceneItems.forEach(it => mergeItem(it, 'sceneSim'));
    seqItems.forEach(it => mergeItem(it, 'seqSim'));
    exploreItems.forEach(it => mergeItem(it, 'exploreSim'));

    if (merged.size === 0) return [];

    // Stage 2: Score with Sliding Context + BaRT Thompson Sampling
    const refYear = seedLite.year || sessionCtx.seedYear;
    const scored = scoreMergedCandidates(merged, contextAnchors, refYear);

    // Stage 3: MMR Diversity & Familiarity Calibration Re-ranking
    const finalTracks = selectWithMMRDiversity(scored, limit, seedLite.title);

    if (typeof uiLog === 'function') {
      uiLog('RADIO', `Generadas ${finalTracks.length} pistas (pool=${merged.size}, comp=${compItems.length}, pl=${playlistItems.length}, scene=${sceneItems.length}, seq=${seqItems.length}, exp=${exploreItems.length})`);
    }
    return finalTracks;
  }

  // --------------------------------------------------------------------------
  // ONLINE FEEDBACK (30-SECOND RULE, SKIPS, COMPLETIONS, LIKES, LIVE RE-RANK)
  // --------------------------------------------------------------------------
  function applyReward(trackObj, reward, eventLabel) {
    loadPersistedState();
    if (!trackObj) return;
    const tid = cleanId(trackObj.id || trackObj.uri);
    const aIds = getTrackArtistIds(trackObj);
    const now = Date.now();

    if (isValidSpotifyId(tid)) {
      const prevT = feedback.trackScores[tid];
      const baseT = prevT ? prevT.score * decayFactor(prevT.ts) : 0;
      feedback.trackScores[tid] = {
        score: Math.max(-3, Math.min(3, baseT + reward)),
        ts: now
      };
    }

    aIds.forEach(aid => {
      const prevA = feedback.artistScores[aid];
      const baseA = prevA ? prevA.score * decayFactor(prevA.ts) : 0;
      feedback.artistScores[aid] = {
        score: Math.max(-4, Math.min(4, baseA + reward * 0.7)),
        ts: now
      };
    });

    // Update BaRT Beta(alpha, beta) for the channel that produced this track
    const ch = trackObj.radioChannel;
    if (ch && feedback.channelStats[ch]) {
      if (reward > 0) {
        feedback.channelStats[ch].alpha = Math.min(40, feedback.channelStats[ch].alpha + Math.min(1.5, reward));
      } else if (reward < 0) {
        feedback.channelStats[ch].beta = Math.min(40, feedback.channelStats[ch].beta + Math.min(1.2, Math.abs(reward)));
      }
    }

    // Push into sliding session window C
    if (isValidSpotifyId(tid)) {
      const existingIdx = sessionCtx.window.findIndex(w => w.id === tid);
      const sign = reward >= 0 ? Math.min(1.5, 0.7 + reward * 0.5) : Math.max(-1.0, reward);
      const entry = {
        id: tid,
        artistIds: aIds,
        year: trackObj.year || (graph.tracks[tid] && graph.tracks[tid].year) || null,
        sign
      };
      if (existingIdx >= 0) {
        sessionCtx.window[existingIdx] = entry;
      } else {
        sessionCtx.window.push(entry);
        if (sessionCtx.window.length > 6) sessionCtx.window.shift();
      }
    }

    saveFeedback();
    if (typeof uiLog === 'function') {
      uiLog('RADIO', `Feedback (${eventLabel}): r=${reward.toFixed(1)} | ${trackObj.title || tid}`);
    }
  }

  function recordPlaybackOutcome(trackObj, playedSec, durationSec, eventType = 'change') {
    if (!trackObj) return 0;
    const dur = Math.max(30, durationSec || trackObj.duration || 210);
    const played = Math.max(0, playedSec || 0);
    const ratio = played / dur;

    let reward = 0;
    let label = eventType;

    if (eventType === 'skip') {
      if (played < 10) {
        reward = -1.0;
        label = 'fast_skip_<10s';
      } else if (played < 30) {
        reward = -0.4;
        label = 'early_skip_<30s';
      } else if (ratio >= 0.80) {
        reward = 0.8;
        label = 'near_complete';
      } else {
        reward = 0.3;
        label = 'valid_stream_>=30s';
      }
    } else if (eventType === 'replay') {
      if (ratio >= 0.40) {
        reward = 1.2;
        label = 'replay';
      }
    } else {
      // Natural track transition
      if (ratio >= 0.80) {
        reward = 0.8;
        label = 'completed';
      } else if (played >= 30) {
        reward = 0.3;
        label = 'valid_stream';
      }
    }

    if (reward !== 0) {
      applyReward(trackObj, reward, label);
    }
    return reward;
  }

  function recordLikeFeedback(trackId, trackInfo, isLiked) {
    const cid = cleanId(trackId);
    if (!isValidSpotifyId(cid)) return;
    const base = graph.tracks[cid] || trackInfo || { id: cid };
    applyReward(Object.assign({ id: cid }, base), isLiked ? 1.5 : -0.5, isLiked ? 'like' : 'unlike');
    if (isLiked) {
      graph.savedTrackIds[cid] = 1;
    } else {
      delete graph.savedTrackIds[cid];
    }
  }

  function recordLiveTransition(prevTrack, nextTrack) {
    if (!prevTrack || !nextTrack) return;
    recordSequenceTransition(prevTrack, nextTrack, new Date(), 0.75);
  }

  // Immediate mid-session steering when user fast-skips (<10s) in an active Radio queue
  function reRankQueueAfterSkip(skippedTrack, remainingTracks) {
    if (!Array.isArray(remainingTracks) || remainingTracks.length <= 1) return remainingTracks;
    const skippedArtists = new Set(getTrackArtistIds(skippedTrack));
    const skippedChannel = skippedTrack && skippedTrack.radioChannel;

    const rescored = remainingTracks.map((tr, idx) => {
      let adj = (typeof tr.radioScore === 'number' ? tr.radioScore : (0.7 - idx * 0.02));
      const aIds = getTrackArtistIds(tr);
      if (aIds.some(aid => skippedArtists.has(aid))) {
        adj -= 0.55;
      }
      if (skippedChannel && tr.radioChannel === skippedChannel) {
        adj -= 0.12;
      }
      // Re-apply updated artist feedback penalty
      aIds.forEach(aid => {
        const afb = getArtistFeedbackScore(aid);
        if (afb < 0) adj -= Math.min(0.4, Math.abs(afb) * 0.2);
      });
      return { tr, adj };
    });

    rescored.sort((a, b) => b.adj - a.adj);
    // Keep artist separation >= 2 after quick re-sort
    const out = [];
    const pool = rescored.map(x => x.tr);
    let lastAid = '';
    while (pool.length > 0) {
      let pickIdx = pool.findIndex(t => (getTrackArtistIds(t)[0] || t.artist) !== lastAid);
      if (pickIdx < 0) pickIdx = 0;
      const next = pool.splice(pickIdx, 1)[0];
      lastAid = getTrackArtistIds(next)[0] || next.artist;
      out.push(next);
    }
    return out;
  }

  function getSessionSubtitle() {
    const artist = sessionCtx.seedArtistName
      || (typeof state !== 'undefined' && state.playingArtist ? state.playingArtist.split(',')[0].trim() : '');
    const nextTrack = (typeof state !== 'undefined' && Array.isArray(state.liveQueueTracks) && state.liveQueueTracks[0])
      ? state.liveQueueTracks[0]
      : null;
    if (nextTrack && nextTrack.radioReason) {
      return `Radio • ${nextTrack.radioReason}`;
    }
    return artist
      ? `Radio • Basado en ${artist} • Autoplay`
      : 'Radio • Autoplay personalizado';
  }

  function clearOnLogout() {
    graph = createEmptyGraph();
    feedback = createEmptyFeedback();
    sceneCache = {};
    compilationCache = {};
    sessionCtx.seedTrack = null;
    sessionCtx.window = [];
    sessionCtx.sessionPlayedIds.clear();
    sessionCtx.sessionPlayedCanonical.clear();
    sessionCtx.recentHistoryIds = [];
    safeStorage.removeItem(GRAPH_STORAGE_KEY);
    safeStorage.removeItem(FEEDBACK_STORAGE_KEY);
    safeStorage.removeItem(SCENE_CACHE_KEY);
    safeStorage.removeItem(COMP_CACHE_KEY);
  }

  // Eagerly hydrate cached graph & feedback on load
  loadPersistedState();

  global.EchoRadio = {
    initGraphFromCatalog,
    resetSession,
    markHistoryId,
    generateRadioTracks,
    recordPlaybackOutcome,
    recordLikeFeedback,
    recordLiveTransition,
    reRankQueueAfterSkip,
    getSessionSubtitle,
    clearOnLogout,
    // Diagnostics helper for dev console inspection
    getDebugStats() {
      return {
        playlists: Object.keys(graph.playlists || {}).length,
        tracks: Object.keys(graph.tracks || {}).length,
        collabArtists: Object.keys(graph.collabEdges || {}).length,
        transitions: Object.keys(graph.transitions || {}).length,
        topArtists: Object.keys(graph.topArtistScores || {}).length,
        sceneCached: Object.keys(sceneCache || {}).length,
        compilationCached: Object.keys(compilationCache || {}).length,
        channelBandit: feedback.channelStats,
        sessionWindow: sessionCtx.window
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
