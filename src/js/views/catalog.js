/* ==========================================================================
   VIEW: Live Spotify Data Orchestrator, Skeletons & Catalog Renderers (Home, Search, Library)
   ========================================================================== */
'use strict';

// --------------------------------------------------------------------------
// 6. LOAD MEDINA JHONATAN'S REAL SPOTIFY DATA INTO ALL 5 SCREENS
// --------------------------------------------------------------------------
function updateGreeting() {
  if (typeof HomeFeed !== 'undefined' && typeof HomeFeed.composeHomeModel === 'function') {
    const model = HomeFeed.composeHomeModel();
    const titleEl = document.getElementById('homeGreeting');
    const subEl = document.getElementById('homeSubtitle');
    if (titleEl && model && model.header) titleEl.textContent = model.header.title;
    if (subEl && model && model.header) subEl.textContent = model.header.subtitle;
    return;
  }
  const hr = new Date().getHours();
  const titleEl = document.querySelector('#view-home .page-title');
  if (!titleEl) return;
  if (hr >= 5 && hr < 12) titleEl.textContent = 'Buenos días';
  else if (hr >= 12 && hr < 19) titleEl.textContent = 'Buenas tardes';
  else titleEl.textContent = 'Buenas noches';
}


async function loadAllRealSpotifyData() {
  updateGreeting();
  if (!spotifyAuth.accessToken) {
    switchScreen('login');
    return;
  }

  // Fetch all endpoints in parallel (including short/long term horizons for dynamic Home!)
  const [
    me,
    likedRes,
    plsRes,
    albRes,
    artMedRes,
    topTracksMedRes,
    recentRes,
    artShortRes,
    topTracksShortRes,
    artLongRes,
    topTracksLongRes
  ] = await Promise.all([
    spotifyFetch('/me'),
    spotifyFetch('/me/tracks?limit=50'),
    spotifyFetch('/me/playlists?limit=50'),
    spotifyFetch('/me/albums?limit=32'),
    spotifyFetch('/me/top/artists?time_range=medium_term&limit=18'),
    spotifyFetch('/me/top/tracks?time_range=medium_term&limit=25'),
    spotifyFetch('/me/player/recently-played?limit=40'),
    spotifyFetch('/me/top/artists?time_range=short_term&limit=16').catch(() => null),
    spotifyFetch('/me/top/tracks?time_range=short_term&limit=25').catch(() => null),
    spotifyFetch('/me/top/artists?time_range=long_term&limit=16').catch(() => null),
    spotifyFetch('/me/top/tracks?time_range=long_term&limit=25').catch(() => null)
  ]);
  const artRes = artMedRes;
  const topTracksRes = topTracksMedRes;

  // 1. User Profile
  let currentUserProfile = null;
  if (me && me.display_name) {
    if (spotifyStatusDot) spotifyStatusDot.classList.add('connected');
    if (spotifyStatusText) spotifyStatusText.textContent = `Conectado: ${me.display_name} (${me.product || 'Premium'})`;
    const avatarUrl = (me.images && me.images.length > 0) ? getSpotifyImage(me.images, 'small') : null;
    currentUserProfile = { name: me.display_name, avatar: avatarUrl, product: me.product };
    renderUserProfile(currentUserProfile);
  }

  // 2. Liked Songs (/me/tracks)
  if (likedRes && typeof likedRes.total === 'number') {
    liveCatalog.likedTotal = likedRes.total;
    const tracks = (likedRes.items || []).filter(i => i && i.track && !i.track.is_local && i.track.is_playable !== false && i.track.uri && !i.track.uri.startsWith('spotify:local:')).map((i, idx) => {
      const imgs = (i.track.album && i.track.album.images) ? i.track.album.images : [];
      return {
        num: idx + 1,
        id: i.track.id,
        uri: i.track.uri,
        title: i.track.name,
        artist: i.track.artists.map(a => a.name).join(', '),
        album: i.track.album ? i.track.album.name : '',
        thumb: imgs.length > 0 ? getSpotifyImage(imgs, 'small') : DEFAULT_ALBUM_COVER,
        cover: imgs.length > 0 ? getSpotifyImage(imgs, 'medium') : DEFAULT_ALBUM_COVER,
        coverLarge: imgs.length > 0 ? getSpotifyImage(imgs, 'large') : DEFAULT_ALBUM_COVER,
        duration: Math.round((i.track.duration_ms || 200000) / 1000),
        popular: idx < 3
      };
    });
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
      coverLarge: LIKED_SONGS_COVER,
      tracks: tracks,
      tracksTotal: likedRes.total,
      tracksNextOffset: (likedRes.items || []).length,
      hasMoreTracks: (likedRes.items || []).length < likedRes.total
    };

    if (state.activeContextType === 'liked' && state.playingTrackId && (!Array.isArray(state.liveQueueTracks) || state.liveQueueTracks.length === 0)) {
      const curCid = cleanTrackId(state.playingTrackId || state.playingTrackUri);
      const curIdx = tracks.findIndex(t => curCid && cleanTrackId(t.id || t.uri) === curCid);
      if (curIdx >= 0) {
        const upcoming = tracks.slice(curIdx + 1);
        const prev = tracks.slice(0, curIdx);
        state.isLocalContextQueue = true;
        state.activeContextName = 'Tus me gusta';
        state.contextUpcomingTracks = upcoming;
        state.liveQueueTracks = (typeof normalizeApiTrack === 'function')
          ? upcoming.map(normalizeApiTrack).filter(Boolean)
          : upcoming;
        state.playbackHistory = ((typeof normalizeApiTrack === 'function')
          ? prev.map(normalizeApiTrack).filter(Boolean)
          : prev).slice(-50);
        if (state.nowPlayingMode === 'queue' && typeof renderQueuePanelUI === 'function') {
          renderQueuePanelUI();
        }
      }
    }

    // Pre-cargar en segundo plano hasta 250 canciones de "Tus me gusta" para no quedar cortos al reproducir desde el medio
    if ((likedRes.items || []).length < likedRes.total) {
      (async function preloadLikedTracksInBackground() {
        const entity = liveCatalog.entities['liked_songs'];
        if (!entity || entity._preloadingLiked) return;
        entity._preloadingLiked = true;
        try {
          let rawOffset = (likedRes.items || []).length;
          const maxPreload = 250;
          const seenUris = new Set(entity.tracks.map(t => t.uri).filter(Boolean));
          while (entity.hasMoreTracks && entity.tracks.length < maxPreload && rawOffset < entity.tracksTotal) {
            if (entity.isLoadingMore) break;
            const res = await spotifyFetch(`/me/tracks?offset=${rawOffset}&limit=50`);
            if (!res || !Array.isArray(res.items) || res.items.length === 0) break;
            rawOffset += res.items.length;
            const mapped = res.items
              .filter(i => i && i.track && !i.track.is_local && i.track.is_playable !== false && i.track.uri && !i.track.uri.startsWith('spotify:local:'))
              .filter(i => !seenUris.has(i.track.uri))
              .map(i => {
                seenUris.add(i.track.uri);
                const imgs = (i.track.album && Array.isArray(i.track.album.images)) ? i.track.album.images : [];
                return {
                  num: entity.tracks.length + 1,
                  id: i.track.id,
                  uri: i.track.uri,
                  title: i.track.name,
                  artist: i.track.artists ? i.track.artists.map(a => a.name).join(', ') : '',
                  album: i.track.album ? i.track.album.name : '',
                  thumb: imgs.length > 0 ? getSpotifyImage(imgs, 'small') : DEFAULT_ALBUM_COVER,
                  cover: imgs.length > 0 ? getSpotifyImage(imgs, 'medium') : DEFAULT_ALBUM_COVER,
                  coverLarge: imgs.length > 0 ? getSpotifyImage(imgs, 'large') : DEFAULT_ALBUM_COVER,
                  duration: Math.round((i.track.duration_ms || 200000) / 1000),
                  popular: false
                };
              });
            if (mapped.length > 0) {
              mapped.forEach((t, idx) => { t.num = entity.tracks.length + idx + 1; });
              entity.tracks.push(...mapped);
              liveCatalog.likedTracks = entity.tracks;
              mapped.forEach(t => { if (t.id) liveCatalog.likedTrackIds.add(t.id); });
            }
            entity.tracksNextOffset = rawOffset;
            entity.hasMoreTracks = rawOffset < entity.tracksTotal;
          }
        } catch (e) {
          console.warn('[Liked Songs Preload]', e);
        } finally {
          entity._preloadingLiked = false;
        }
      })();
    }
  }

  // 3. User Playlists (/me/playlists) with Auto-Pagination for ALL playlists
  function mapSpotifyPlaylists(items) {
    return items.filter(Boolean).map(p => {
      const entityId = `pl_${p.id}`;
      const cover = (p.images && p.images.length > 0) ? getSpotifyImage(p.images, 'medium') : DEFAULT_PLAYLIST_COVER;
      const coverLarge = (p.images && p.images.length > 0) ? getSpotifyImage(p.images, 'large') : cover;
      const total = p.tracks ? p.tracks.total : (p.items ? p.items.total : 0);
      liveCatalog.entities[entityId] = {
        id: entityId,
        spotifyId: p.id,
        type: 'playlist',
        uri: p.uri,
        title: p.name,
        artist: (p.owner && p.owner.display_name) ? p.owner.display_name : 'Spotify',
        ownerId: (p.owner && p.owner.id) ? p.owner.id : '',
        collaborative: Boolean(p.collaborative),
        meta: `Playlist • ${total} songs`,
        cover: cover,
        coverLarge: coverLarge,
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
      const thumb = (a.images && a.images.length > 0) ? getSpotifyImage(a.images, 'small') : DEFAULT_ALBUM_COVER;
      const cover = (a.images && a.images.length > 0) ? getSpotifyImage(a.images, 'medium') : DEFAULT_ALBUM_COVER;
      const coverLarge = (a.images && a.images.length > 0) ? getSpotifyImage(a.images, 'large') : cover;
      const year = a.release_date ? a.release_date.slice(0, 4) : '';
      const artistName = a.artists ? a.artists.map(x => x.name).join(', ') : '';
      const tracks = (a.tracks && a.tracks.items) ? a.tracks.items.map((t, idx) => ({
        num: idx + 1,
        id: t.id,
        uri: t.uri,
        title: t.name,
        artist: artistName,
        album: a.name,
        thumb: thumb,
        cover: cover,
        coverLarge: coverLarge,
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
        thumb: thumb,
        cover: cover,
        coverLarge: coverLarge,
        tracks: tracks
      };
      return liveCatalog.entities[entityId];
    });
  }

  // 5. Top Artists (/me/top/artists)
  if (artRes && Array.isArray(artRes.items)) {
    liveCatalog.artists = artRes.items.filter(Boolean).map(ar => {
      const entityId = `art_${ar.id}`;
      const thumb = (ar.images && ar.images.length > 0) ? getSpotifyImage(ar.images, 'small') : DEFAULT_SPOTIFY_COVER;
      const cover = (ar.images && ar.images.length > 0) ? getSpotifyImage(ar.images, 'medium') : DEFAULT_SPOTIFY_COVER;
      const coverLarge = (ar.images && ar.images.length > 0) ? getSpotifyImage(ar.images, 'large') : cover;
      const genre = (ar.genres && ar.genres[0]) ? ar.genres[0] : 'Artist';
      liveCatalog.entities[entityId] = {
        id: entityId,
        spotifyId: ar.id,
        type: 'artist',
        uri: ar.uri,
        title: ar.name,
        artist: 'Artista de Spotify',
        meta: `${genre}`,
        thumb: thumb,
        cover: cover,
        coverLarge: coverLarge,
        tracks: null
      };
      return liveCatalog.entities[entityId];
    });

    // Populate Search Recent Chips with the user's real Top Artists (using 64x64 small avatar for 38px chips)
    if (liveCatalog.artists.length > 0) {
      liveCatalog.recentSearches = liveCatalog.artists.slice(0, 6).map(ar => ({
        label: ar.title,
        avatar: ar.thumb || ar.cover,
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
      const thumb = (t.album.images && t.album.images.length > 0) ? getSpotifyImage(t.album.images, 'small') : DEFAULT_ALBUM_COVER;
      const cover = (t.album.images && t.album.images.length > 0) ? getSpotifyImage(t.album.images, 'medium') : DEFAULT_ALBUM_COVER;
      const coverLarge = (t.album.images && t.album.images.length > 0) ? getSpotifyImage(t.album.images, 'large') : cover;
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
          thumb: thumb,
          cover: cover,
          coverLarge: coverLarge,
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
      const imgs = (t.album && t.album.images) ? t.album.images : [];
      const thumb = imgs.length > 0 ? getSpotifyImage(imgs, 'small') : DEFAULT_ALBUM_COVER;
      const cover = imgs.length > 0 ? getSpotifyImage(imgs, 'medium') : DEFAULT_ALBUM_COVER;
      const coverLarge = imgs.length > 0 ? getSpotifyImage(imgs, 'large') : cover;
      const artistName = t.artists ? t.artists.map(a => a.name).join(', ') : '';

      recentCards.push({
        trackId: t.id,
        uri: t.uri,
        title: t.name,
        subtitle: artistName,
        albumName: t.album ? t.album.name : '',
        thumb: thumb,
        cover: cover,
        coverLarge: coverLarge,
        durationMs: t.duration_ms
      });
    });

    // If fewer than 8 tracks, fill remaining slots with user's top tracks
    if (recentCards.length < 8 && topTracksRes && Array.isArray(topTracksRes.items)) {
      topTracksRes.items.forEach(t => {
        if (!t || !t.id || seenRecentTracks.has(t.id) || recentCards.length >= 8) return;
        seenRecentTracks.add(t.id);
        const imgs = (t.album && t.album.images) ? t.album.images : [];
        const thumb = imgs.length > 0 ? getSpotifyImage(imgs, 'small') : DEFAULT_ALBUM_COVER;
        const cover = imgs.length > 0 ? getSpotifyImage(imgs, 'medium') : DEFAULT_ALBUM_COVER;
        const coverLarge = imgs.length > 0 ? getSpotifyImage(imgs, 'large') : cover;
        const artistName = t.artists ? t.artists.map(a => a.name).join(', ') : '';
        recentCards.push({
          trackId: t.id,
          uri: t.uri,
          title: t.name,
          subtitle: artistName,
          albumName: t.album ? t.album.name : '',
          thumb: thumb,
          cover: cover,
          coverLarge: coverLarge,
          durationMs: t.duration_ms
        });
      });
    }

    // If nothing is currently playing yet, initialize Mini-Player & Now Playing with the user's most recent track!
    if (!state.playingTrackId && recentRes.items[0] && recentRes.items[0].track) {
      const lastTrack = recentRes.items[0].track;
      applyTrackToUI(lastTrack, 0, false, 'cache');
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

  // Feed all multi-horizon data into HomeFeed dynamic composer
  let dynamicHomeModel = null;
  if (typeof HomeFeed !== 'undefined' && typeof HomeFeed.ingestCatalogData === 'function') {
    HomeFeed.ingestCatalogData({
      userName: me && me.display_name ? me.display_name : '',
      shortTracksRes: topTracksShortRes,
      mediumTracksRes: topTracksMedRes,
      longTracksRes: topTracksLongRes,
      shortArtistsRes: artShortRes,
      mediumArtistsRes: artMedRes,
      longArtistsRes: artLongRes,
      recentRes
    });
    // Wait for secondary shelves (Novedades + Porque escuchaste) so Home transitions ONCE from skeletons -> complete feed without popping!
    if (typeof HomeFeed.preloadSecondaryShelves === 'function') {
      const hasCachedV9 = Boolean(typeof loadHomeCache === 'function' && loadHomeCache());
      await HomeFeed.preloadSecondaryShelves(hasCachedV9 ? 1200 : 2600);
    }
    dynamicHomeModel = HomeFeed.composeHomeModel();
  }

  // Save persistent home cache for instant 0ms startup
  const homeEntitiesCache = {};
  const collectEntityIds = [];
  if (dynamicHomeModel) {
    (dynamicHomeModel.quickAccess || []).forEach(c => collectEntityIds.push(c.entityId));
    (dynamicHomeModel.mixes || []).forEach(c => collectEntityIds.push(c.entityId));
    (dynamicHomeModel.newReleases || []).forEach(c => collectEntityIds.push(c.entityId));
    (dynamicHomeModel.artists || []).forEach(c => collectEntityIds.push(c.entityId));
    (dynamicHomeModel.rediscoverAlbums || []).forEach(c => collectEntityIds.push(c.entityId));
    if (dynamicHomeModel.becauseShelf && Array.isArray(dynamicHomeModel.becauseShelf.items)) {
      dynamicHomeModel.becauseShelf.items.forEach(c => collectEntityIds.push(c.entityId));
    }
  } else {
    jumpCards.concat(topArtistsCards).concat(savedAlbumsCards).forEach(c => collectEntityIds.push(c.entityId));
    madeForYouBanners.forEach(b => collectEntityIds.push(b.entityId));
  }
  collectEntityIds.forEach(eid => {
    if (eid && liveCatalog.entities[eid]) {
      homeEntitiesCache[eid] = liveCatalog.entities[eid];
    }
  });

  const lastTrackCandidate = (recentRes && recentRes.items && recentRes.items[0] && recentRes.items[0].track)
    ? recentRes.items[0].track
    : null;

  saveHomeCache({
    model: dynamicHomeModel,
    jumpCards: jumpCards,
    recentCards: recentCards,
    banners: madeForYouBanners,
    topArtists: topArtistsCards,
    savedAlbums: savedAlbumsCards,
    lastTrack: lastTrackCandidate,
    entities: homeEntitiesCache,
    userProfile: currentUserProfile
  });

  if (dynamicHomeModel) {
    renderHomeFromModel(dynamicHomeModel);
  } else {
    renderHome(jumpCards, recentCards, madeForYouBanners, topArtistsCards, savedAlbumsCards);
  }
  renderSearch(recentCards);
  renderLibrary(liveCatalog.libraryFilter);

  // Pre-warm Library, Search & Top Artists thumbnails in background idle time so tab switching is 0ms
  const urlsToPrewarm = [];
  liveCatalog.recentSearches.forEach(s => { if (s && s.avatar) urlsToPrewarm.push(s.avatar); });
  liveCatalog.playlists.slice(0, 18).forEach(p => { if (p && p.cover) urlsToPrewarm.push(p.cover); });
  liveCatalog.albums.slice(0, 12).forEach(a => { if (a && a.cover) urlsToPrewarm.push(a.cover); });
  liveCatalog.artists.slice(0, 12).forEach(ar => { if (ar && ar.cover) urlsToPrewarm.push(ar.cover); });
  prewarmImageUrls(urlsToPrewarm);

  // Build Spotify-Native Local Recommendation Graph in background (zero startup impact)
  if (typeof EchoRadio !== 'undefined' && typeof EchoRadio.initGraphFromCatalog === 'function') {
    setTimeout(() => {
      EchoRadio.initGraphFromCatalog(me, recentRes).catch(e => console.warn('[EchoRadio Graph Init]', e));
    }, 900);
  }
}

// --------------------------------------------------------------------------
// 7. RENDER FUNCTIONS & SKELETON LOADERS FOR ALL 5 VIEWS
// --------------------------------------------------------------------------
function buildSkeletonCardsHTML(count = 4, showMeta = true) {
  return Array.from({ length: count }).map(() => `
    <div class="skeleton-card">
      <div class="skeleton-cover skeleton-shimmer"></div>
      ${showMeta ? '<div class="skeleton-line-title skeleton-shimmer"></div><div class="skeleton-line-sub skeleton-shimmer"></div>' : ''}
    </div>
  `).join('');
}

function buildSkeletonArtistsHTML(count = 4) {
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

function buildSkeletonQuickAccessHTML(count = 6) {
  return Array.from({ length: count }).map(() => `
    <div class="skeleton-quick-tile">
      <div class="skeleton-quick-cover skeleton-shimmer"></div>
      <div class="skeleton-quick-meta">
        <div class="skeleton-line-title skeleton-shimmer" style="width: 74%; margin-bottom: 0;"></div>
        <div class="skeleton-line-sub skeleton-shimmer" style="width: 48%;"></div>
      </div>
      <div class="skeleton-quick-btn skeleton-shimmer"></div>
    </div>
  `).join('');
}

function buildSkeletonMixesHTML(count = 3) {
  return Array.from({ length: count }).map(() => `
    <div class="skeleton-mix-card">
      <div class="skeleton-mix-art skeleton-shimmer"></div>
      <div class="skeleton-mix-meta">
        <div class="skeleton-line-sub skeleton-shimmer" style="width: 38%;"></div>
        <div class="skeleton-line-title skeleton-shimmer" style="width: 78%; margin-bottom: 0;"></div>
        <div class="skeleton-line-sub skeleton-shimmer" style="width: 58%;"></div>
      </div>
      <div class="skeleton-mix-btn skeleton-shimmer"></div>
    </div>
  `).join('');
}

function buildSkeletonQuickPicksHTML(count = 8) {
  const widths = ['68%', '56%', '74%', '62%', '70%', '52%', '66%', '60%'];
  return Array.from({ length: count }).map((_, idx) => `
    <div class="skeleton-pick-row">
      <div class="skeleton-pick-thumb skeleton-shimmer"></div>
      <div class="skeleton-pick-meta">
        <div class="skeleton-line-title skeleton-shimmer" style="width: ${widths[idx % widths.length]}; margin-bottom: 0;"></div>
        <div class="skeleton-line-sub skeleton-shimmer" style="width: 44%;"></div>
      </div>
      <div class="skeleton-pick-btn skeleton-shimmer"></div>
    </div>
  `).join('');
}

function persistCurrentHomeCache() {
  if (typeof HomeFeed === 'undefined' || typeof HomeFeed.composeHomeModel !== 'function') return;
  try {
    const existing = (typeof loadHomeCache === 'function' ? loadHomeCache() : null) || {};
    const model = HomeFeed.composeHomeModel();
    const entities = Object.assign({}, existing.entities || {});
    const ids = [];
    (model.quickAccess || []).forEach(c => ids.push(c.entityId));
    (model.mixes || []).forEach(c => ids.push(c.entityId));
    (model.newReleases || []).forEach(c => ids.push(c.entityId));
    (model.artists || []).forEach(c => ids.push(c.entityId));
    (model.rediscoverAlbums || []).forEach(c => ids.push(c.entityId));
    if (model.becauseShelf && Array.isArray(model.becauseShelf.items)) {
      model.becauseShelf.items.forEach(c => ids.push(c.entityId));
    }
    ids.forEach(eid => {
      if (eid && liveCatalog.entities[eid]) {
        entities[eid] = liveCatalog.entities[eid];
      }
    });
    saveHomeCache({
      ...existing,
      model: { ...model, releasesLoading: false },
      entities
    });
  } catch (e) {
    console.warn('[persistCurrentHomeCache]', e);
  }
}

function updateHomeGreeting(headerOverride = null) {
  const titleEl = document.getElementById('homeGreeting');
  const subEl = document.getElementById('homeSubtitle');
  if (headerOverride && headerOverride.title) {
    if (titleEl) titleEl.textContent = headerOverride.title;
    if (subEl && headerOverride.subtitle) subEl.textContent = headerOverride.subtitle;
    return;
  }
  updateGreeting();
}

function renderInitialSkeletons() {
  updateHomeGreeting();
  const qaSec = document.getElementById('homeQuickAccessSection');
  if (qaSec) qaSec.classList.remove('hidden');
  const qaGrid = document.getElementById('homeQuickAccessGrid');
  if (qaGrid) { delete qaGrid.dataset.sig; qaGrid.innerHTML = buildSkeletonQuickAccessHTML(6); }

  const mixesSec = document.getElementById('homeMixesSection');
  if (mixesSec) mixesSec.classList.remove('hidden');
  const mixesGrid = document.getElementById('homeMixesGrid');
  if (mixesGrid) { delete mixesGrid.dataset.sig; mixesGrid.innerHTML = buildSkeletonMixesHTML(3); }

  const picksSec = document.getElementById('homeQuickPicksSection');
  if (picksSec) picksSec.classList.remove('hidden');
  const picksGrid = document.getElementById('homeQuickPicksGrid');
  if (picksGrid) { delete picksGrid.dataset.sig; picksGrid.innerHTML = buildSkeletonQuickPicksHTML(8); }

  const recentSec = document.getElementById('homeRecentlyPlayedSection');
  if (recentSec) recentSec.classList.remove('hidden');
  const recentGrid = document.getElementById('homeRecentlyPlayedGrid');
  if (recentGrid) { delete recentGrid.dataset.sig; recentGrid.innerHTML = buildSkeletonCardsHTML(4, true); }

  const becauseSec = document.getElementById('homeBecauseSection');
  if (becauseSec) becauseSec.classList.remove('hidden');
  const becauseGrid = document.getElementById('homeBecauseGrid');
  if (becauseGrid) { delete becauseGrid.dataset.sig; becauseGrid.innerHTML = buildSkeletonCardsHTML(4, true); }

  const relSec = document.getElementById('homeNewReleasesSection');
  if (relSec) relSec.classList.remove('hidden');
  const relGrid = document.getElementById('homeNewReleasesGrid');
  if (relGrid) { delete relGrid.dataset.sig; relGrid.innerHTML = buildSkeletonCardsHTML(4, true); }

  const artistsSec = document.getElementById('homeTopArtistsSection');
  if (artistsSec) artistsSec.classList.remove('hidden');
  const artistsGrid = document.getElementById('homeTopArtistsGrid');
  if (artistsGrid) { delete artistsGrid.dataset.sig; artistsGrid.innerHTML = buildSkeletonArtistsHTML(4); }

  const rediscoverSec = document.getElementById('homeRediscoverSection');
  if (rediscoverSec) rediscoverSec.classList.remove('hidden');
  const rediscoverGrid = document.getElementById('homeRediscoverGrid');
  if (rediscoverGrid) { delete rediscoverGrid.dataset.sig; rediscoverGrid.innerHTML = buildSkeletonCardsHTML(4, true); }

  const searchesRow = document.getElementById('recentSearchesRow');
  if (searchesRow) searchesRow.innerHTML = buildSkeletonChipsHTML(5);

  const searchRecent = document.getElementById('searchRecentlyPlayedGrid');
  if (searchRecent) searchRecent.innerHTML = buildSkeletonCardsHTML(4, false);

  const libGrid = document.getElementById('libraryGrid6');
  if (libGrid) libGrid.innerHTML = buildSkeletonCardsHTML(10, true);
}

const HOME_FILTER_SECTION_ORDER = {
  all: {
    homeQuickAccessSection: 1,
    homeMixesSection: 2,
    homeQuickPicksSection: 3,
    homeRecentlyPlayedSection: 4,
    homeBecauseSection: 5,
    homeNewReleasesSection: 6,
    homeTopArtistsSection: 7,
    homeRediscoverSection: 8
  },
  rotation: {
    homeRecentlyPlayedSection: 1,
    homeQuickPicksSection: 2,
    homeTopArtistsSection: 3,
    homeQuickAccessSection: 4,
    homeMixesSection: 5,
    homeBecauseSection: 6,
    homeNewReleasesSection: 7,
    homeRediscoverSection: 8
  },
  releases: {
    homeNewReleasesSection: 1,
    homeBecauseSection: 2,
    homeMixesSection: 3,
    homeQuickPicksSection: 4,
    homeRecentlyPlayedSection: 5,
    homeQuickAccessSection: 6,
    homeTopArtistsSection: 7,
    homeRediscoverSection: 8
  },
  radios: {
    homeMixesSection: 1,
    homeQuickPicksSection: 2,
    homeBecauseSection: 3,
    homeTopArtistsSection: 4,
    homeQuickAccessSection: 5,
    homeRecentlyPlayedSection: 6,
    homeNewReleasesSection: 7,
    homeRediscoverSection: 8
  },
  rediscover: {
    homeRediscoverSection: 1,
    homeMixesSection: 2,
    homeTopArtistsSection: 3,
    homeQuickPicksSection: 4,
    homeQuickAccessSection: 5,
    homeRecentlyPlayedSection: 6,
    homeBecauseSection: 7,
    homeNewReleasesSection: 8
  }
};

function applyHomeFilterOrdering(filter) {
  const orderMap = HOME_FILTER_SECTION_ORDER[filter] || HOME_FILTER_SECTION_ORDER.all;
  Object.keys(orderMap).forEach(secId => {
    const el = document.getElementById(secId);
    if (el) el.style.order = String(orderMap[secId]);
  });

  document.querySelectorAll('#homeFilterPills .home-filter-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-home-filter') === filter);
  });

  const artistsTitle = document.getElementById('homeTopArtistsTitle');
  if (artistsTitle) {
    artistsTitle.textContent = filter === 'rediscover' ? 'Tus artistas de siempre' : 'Tus artistas en rotación';
  }
}

function renderCardRail(gridEl, items, opts = {}) {
  if (!gridEl) return;
  const list = Array.isArray(items) ? items.slice(0, opts.max || 8) : [];
  if (list.length === 0) {
    delete gridEl.dataset.sig;
    gridEl.innerHTML = opts.fallbackSkeleton ? buildSkeletonCardsHTML(4, true) : '';
    return;
  }
  const sig = list.map(i => `${i.entityId || i.uri || i.trackId}:${i.cover}:${i.title}:${i.badge || ''}`).join('|');
  if (gridEl.dataset.sig === sig) return;
  gridEl.dataset.sig = sig;

  gridEl.innerHTML = list.map((item, idx) => {
    if (item.isArtist && item.entityId) {
      return `
        <div class="artist-card" data-open-entity="${item.entityId}">
          <div class="artist-card-avatar-wrap">
            ${renderOptImg(item.cover, item.title, 'artist-card-avatar')}
          </div>
          <div class="artist-card-name">${escapeHtml(item.title)}</div>
          <div class="artist-card-meta">${escapeHtml(item.subtitle || 'Artista')}</div>
        </div>
      `;
    }
    const isTrackDirect = Boolean(opts.directTrackPlay && item.uri);
    const actionAttr = isTrackDirect
      ? `data-play-direct-uri="${escapeHtml(item.uri)}" data-title="${escapeHtml(item.title || '')}" data-artist="${escapeHtml(item.subtitle || '')}" data-cover="${escapeHtml(item.coverLarge || item.cover || '')}" data-thumb="${escapeHtml(item.thumb || item.cover || '')}" data-duration="${item.durationMs ? Math.round(item.durationMs / 1000) : ''}"`
      : `data-open-entity="${escapeHtml(item.entityId || '')}"`;
    const badgeHtml = item.badge
      ? `<span class="media-card-badge ${item.badge === 'NUEVO' ? 'is-new' : ''}">${escapeHtml(item.badge)}</span>`
      : '';
    return `
      <div class="media-card" ${actionAttr}>
        <div class="media-card-cover-wrap">
          ${renderOptImg(item.cover, item.title || 'Música', 'media-card-cover', idx < 4 && opts.highPriority ? 'fetchpriority="high"' : '')}
          ${badgeHtml}
        </div>
        <div class="media-card-title">${escapeHtml(item.title || '')}</div>
        <div class="media-card-subtitle">${escapeHtml(item.subtitle || '')}</div>
      </div>
    `;
  }).join('');
  hydrateImages(gridEl);
}

function renderHomeFromModel(model) {
  if (!model) return;
  updateHomeGreeting(model.header);
  applyHomeFilterOrdering(model.filter || 'all');

  // 1. Quick Access 3x2 Tiles
  const qaSec = document.getElementById('homeQuickAccessSection');
  const qaGrid = document.getElementById('homeQuickAccessGrid');
  const qaList = Array.isArray(model.quickAccess) ? model.quickAccess.slice(0, 6) : [];
  if (qaGrid) {
    if (qaList.length > 0) {
      if (qaSec) qaSec.classList.remove('hidden');
      const sig = qaList.map(q => `${q.entityId}:${q.cover}:${q.title}`).join('|');
      if (qaGrid.dataset.sig !== sig) {
        qaGrid.dataset.sig = sig;
        qaGrid.innerHTML = qaList.map((tile, idx) => `
          <div class="quick-tile" data-open-entity="${escapeHtml(tile.entityId)}">
            ${renderOptImg(tile.cover, tile.title, 'quick-tile-cover', idx < 3 ? 'fetchpriority="high"' : '')}
            <div class="quick-tile-meta">
              <div class="quick-tile-title">${escapeHtml(tile.title)}</div>
              <div class="quick-tile-sub">${escapeHtml(tile.subtitle || '')}</div>
            </div>
            <button type="button" class="quick-tile-play home-direct-play-entity" data-play-entity="${escapeHtml(tile.entityId)}" title="Reproducir">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
            </button>
          </div>
        `).join('');
        hydrateImages(qaGrid);
      }
    } else if (qaSec) {
      qaSec.classList.add('hidden');
    }
  }

  // 2. Dynamic Mixes & Stations Rail
  const mixesSec = document.getElementById('homeMixesSection');
  const mixesGrid = document.getElementById('homeMixesGrid');
  const mixesList = Array.isArray(model.mixes) ? model.mixes.slice(0, 4) : [];
  if (mixesGrid) {
    if (mixesList.length > 0) {
      if (mixesSec) mixesSec.classList.remove('hidden');
      const sig = mixesList.map(m => `${m.entityId}:${m.title}:${m.cover}`).join('|');
      if (mixesGrid.dataset.sig !== sig) {
        mixesGrid.dataset.sig = sig;
        mixesGrid.innerHTML = mixesList.map((m, idx) => {
          const artHtml = (Array.isArray(m.collageCovers) && m.collageCovers.length >= 4)
            ? `<div class="mix-collage-grid">${m.collageCovers.slice(0, 4).map(c => renderOptImg(c, m.title, '')).join('')}</div>`
            : renderOptImg(m.cover, m.title, '', idx < 2 ? 'fetchpriority="high"' : '');
          return `
            <div class="mix-card ${m.accentCls || ''}" data-open-entity="${escapeHtml(m.entityId)}">
              <div class="mix-card-art">${artHtml}</div>
              <div class="mix-card-meta">
                <span class="mix-card-tag">${escapeHtml(m.tag || 'HECHO PARA TI')}</span>
                <div class="mix-card-title">${escapeHtml(m.title)}</div>
                <div class="mix-card-sub">${escapeHtml(m.subtitle || '')}</div>
              </div>
              <button type="button" class="banner-play-btn home-direct-play-entity" data-play-entity="${escapeHtml(m.entityId)}" title="Reproducir">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="7 5 19 12 7 19 7 5"></polygon>
                </svg>
              </button>
            </div>
          `;
        }).join('');
        hydrateImages(mixesGrid);
      }
    } else if (mixesSec) {
      mixesSec.classList.add('hidden');
    }
  }

  // 3. Quick Picks 2x4 Track Grid (One-tap play) — never wipe DOM when only playingTrackId changes!
  const picksSec = document.getElementById('homeQuickPicksSection');
  const picksGrid = document.getElementById('homeQuickPicksGrid');
  const picksList = Array.isArray(model.quickPicks) ? model.quickPicks.slice(0, 8) : [];
  if (picksGrid) {
    if (picksList.length > 0) {
      if (picksSec) picksSec.classList.remove('hidden');
      const curPlayingId = state.playingTrackId || '';
      const sig = picksList.map(t => `${t.trackId || t.id}:${t.title}`).join('|');
      if (picksGrid.dataset.sig !== sig) {
        picksGrid.dataset.sig = sig;
        picksGrid.innerHTML = picksList.map(t => {
          const tid = t.trackId || t.id || '';
          const isPlaying = Boolean(curPlayingId && tid === curPlayingId);
          return `
            <div class="quick-pick-row ${isPlaying ? 'is-playing' : ''}"
                 data-pick-track-id="${escapeHtml(tid)}"
                 data-play-direct-uri="${escapeHtml(t.uri)}"
                 data-title="${escapeHtml(t.title)}"
                 data-artist="${escapeHtml(t.subtitle || t.artist || '')}"
                 data-cover="${escapeHtml(t.coverLarge || t.cover || '')}"
                 data-thumb="${escapeHtml(t.thumb || t.cover || '')}"
                 data-duration="${t.durationMs ? Math.round(t.durationMs / 1000) : ''}">
              ${renderOptImg(t.thumb || t.cover, t.title, 'quick-pick-thumb')}
              <div class="quick-pick-meta">
                <div class="quick-pick-title">${escapeHtml(t.title)}</div>
                <div class="quick-pick-artist">${escapeHtml(t.subtitle || t.artist || '')}</div>
              </div>
              <span class="quick-pick-play-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
              </span>
            </div>
          `;
        }).join('');
        hydrateImages(picksGrid);
      } else {
        picksGrid.querySelectorAll('.quick-pick-row').forEach(row => {
          const tid = row.getAttribute('data-pick-track-id') || '';
          row.classList.toggle('is-playing', Boolean(curPlayingId && tid === curPlayingId));
        });
      }
    } else if (picksSec) {
      picksSec.classList.add('hidden');
    }
  }

  // 4. Recently Played (Live-updating)
  const recentSec = document.getElementById('homeRecentlyPlayedSection');
  const recentGrid = document.getElementById('homeRecentlyPlayedGrid');
  if (recentGrid) {
    const rec = Array.isArray(model.recentTracks) ? model.recentTracks : [];
    if (recentSec) recentSec.classList.toggle('hidden', rec.length === 0);
    renderCardRail(recentGrid, rec, { directTrackPlay: true });
  }

  // 5. Because You Listened To [Artist]
  const becauseSec = document.getElementById('homeBecauseSection');
  const becauseTitle = document.getElementById('homeBecauseTitle');
  const becauseGrid = document.getElementById('homeBecauseGrid');
  if (becauseSec && becauseGrid) {
    const shelf = model.becauseShelf;
    if (shelf && Array.isArray(shelf.items) && shelf.items.length > 0) {
      becauseSec.classList.remove('hidden');
      if (becauseTitle) becauseTitle.textContent = shelf.title;
      renderCardRail(becauseGrid, shelf.items);
    } else if (shelf && shelf.loading) {
      becauseSec.classList.remove('hidden');
      if (becauseTitle) becauseTitle.textContent = shelf.title;
      if (becauseGrid.dataset.sig !== '__skeleton__') {
        becauseGrid.dataset.sig = '__skeleton__';
        becauseGrid.innerHTML = buildSkeletonCardsHTML(4, true);
      }
    } else {
      becauseSec.classList.add('hidden');
    }
  }

  // 6. New Releases from Your Artists
  const relSec = document.getElementById('homeNewReleasesSection');
  const relGrid = document.getElementById('homeNewReleasesGrid');
  if (relSec && relGrid) {
    const rels = Array.isArray(model.newReleases) ? model.newReleases : [];
    if (rels.length > 0) {
      relSec.classList.remove('hidden');
      renderCardRail(relGrid, rels);
    } else if (model.releasesLoading) {
      relSec.classList.remove('hidden');
      if (relGrid.dataset.sig !== '__skeleton__') {
        relGrid.dataset.sig = '__skeleton__';
        relGrid.innerHTML = buildSkeletonCardsHTML(4, true);
      }
    } else {
      relSec.classList.add('hidden');
    }
  }

  // 7. Artists in Rotation (Circular avatars)
  const artistsSec = document.getElementById('homeTopArtistsSection');
  const artistsGrid = document.getElementById('homeTopArtistsGrid');
  const artistsList = Array.isArray(model.artists) ? model.artists.slice(0, 8) : [];
  if (artistsGrid) {
    if (artistsList.length > 0) {
      if (artistsSec) artistsSec.classList.remove('hidden');
      const sig = artistsList.map(a => `${a.entityId}:${a.cover}:${a.name}`).join('|');
      if (artistsGrid.dataset.sig !== sig) {
        artistsGrid.dataset.sig = sig;
        artistsGrid.innerHTML = artistsList.map(item => `
          <div class="artist-card" data-open-entity="${escapeHtml(item.entityId)}">
            <div class="artist-card-avatar-wrap">
              ${renderOptImg(item.cover, item.name, 'artist-card-avatar')}
            </div>
            <div class="artist-card-name">${escapeHtml(item.name)}</div>
            <div class="artist-card-meta">${escapeHtml(item.meta || 'Artista')}</div>
          </div>
        `).join('');
        hydrateImages(artistsGrid);
      }
    } else if (artistsSec) {
      artistsSec.classList.add('hidden');
    }
  }

  // 8. Rediscover Your Library
  const rediscoverSec = document.getElementById('homeRediscoverSection');
  const rediscoverGrid = document.getElementById('homeRediscoverGrid');
  if (rediscoverSec && rediscoverGrid) {
    const albs = Array.isArray(model.rediscoverAlbums) ? model.rediscoverAlbums : [];
    rediscoverSec.classList.toggle('hidden', albs.length === 0);
    renderCardRail(rediscoverGrid, albs);
  }
}

function renderDynamicHome() {
  if (typeof HomeFeed === 'undefined' || typeof HomeFeed.composeHomeModel !== 'function') return;
  const model = HomeFeed.composeHomeModel();
  renderHomeFromModel(model);
}

// Backwards-compatible fallback renderer (used if legacy cache is loaded before fresh API data)
function renderHome(jumpCards, recentCards, banners, topArtists, savedAlbums) {
  renderHomeFromModel({
    filter: 'all',
    header: null,
    quickAccess: (jumpCards || []).slice(0, 6).map(j => ({
      entityId: j.entityId,
      title: j.title,
      subtitle: j.subtitle,
      cover: j.cover
    })),
    mixes: (banners || []).map((b, i) => ({
      entityId: b.entityId,
      title: b.title,
      subtitle: b.subtitle,
      tag: b.tag || 'HECHO PARA TI',
      accentCls: i === 0 ? 'mix-accent-time' : 'mix-accent-radio',
      cover: b.cover
    })),
    quickPicks: (recentCards || []).slice(0, 8),
    recentTracks: recentCards || [],
    becauseShelf: null,
    newReleases: [],
    artists: topArtists || [],
    rediscoverAlbums: savedAlbums || []
  });
}

const RECENT_SEARCHES_STORAGE_KEY = 'sp_recent_searches_v1';

function hydrateSavedSearchEntities(items) {
  if (!Array.isArray(items)) return;
  items.forEach(item => {
    if (!item || !item.entityId || liveCatalog.entities[item.entityId]) return;
    if (item.type === 'artist') {
      liveCatalog.entities[item.entityId] = {
        id: item.entityId,
        spotifyId: item.spotifyId || String(item.entityId).replace(/^art_/, ''),
        type: 'artist',
        uri: item.uri || '',
        title: item.label || 'Artista',
        name: item.label || 'Artista',
        cover: item.avatar || '',
        coverLarge: item.avatar || '',
        tracks: null
      };
    } else if (item.type === 'album' || item.type === 'playlist') {
      liveCatalog.entities[item.entityId] = {
        id: item.entityId,
        spotifyId: item.spotifyId || String(item.entityId).replace(/^(alb_|pl_)/, ''),
        type: item.type,
        uri: item.uri || '',
        title: item.label || '',
        artist: item.subtitle || '',
        cover: item.avatar || DEFAULT_ALBUM_COVER,
        coverLarge: item.avatar || DEFAULT_ALBUM_COVER,
        tracks: null
      };
    }
  });
}

function getPersistedRecentSearches() {
  try {
    const raw = safeStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        hydrateSavedSearchEntities(parsed);
        return parsed;
      }
    }
  } catch (e) {}
  return Array.isArray(liveCatalog.recentSearches) ? liveCatalog.recentSearches : [];
}

function renderSearch(recentCards) {
  const persisted = getPersistedRecentSearches();
  const chips = (persisted && persisted.length > 0)
    ? persisted
    : (Array.isArray(liveCatalog.recentSearches) ? liveCatalog.recentSearches : []);
  liveCatalog.recentSearches = chips;

  const recentBlock = document.getElementById('recentSearchesBlock');
  if (recentBlock) {
    recentBlock.style.display = chips.length > 0 ? '' : 'none';
  }
  const chipsRow = document.getElementById('recentSearchesRow');
  if (chipsRow) {
    chipsRow.innerHTML = chips.map(chip => {
      const safeLabel = (chip.label || '').replace(/"/g, '&quot;');
      const actionAttr = chip.entityId
        ? `data-open-entity="${chip.entityId}"`
        : (chip.playUri
          ? `data-play-direct-uri="${chip.playUri}" data-title="${safeLabel}" data-artist="${(chip.subtitle || '').replace(/"/g, '&quot;')}" data-cover="${chip.avatar || ''}" data-thumb="${chip.avatar || ''}"`
          : `data-search-query="${(chip.query || chip.label || '').replace(/"/g, '&quot;')}"`);
      return `
        <div class="recent-chip" ${actionAttr}>
          ${renderOptImg(chip.avatar || DEFAULT_ALBUM_COVER, chip.label || '', `chip-avatar ${chip.square ? 'square' : ''}`)}
          <span class="chip-label">${chip.label}</span>
        </div>
      `;
    }).join('');
    hydrateImages(chipsRow);
  }

  const searchRecentGrid = document.getElementById('searchRecentlyPlayedGrid');
  let finalSearchRecent = [];
  if (recentCards && recentCards.length > 0) {
    finalSearchRecent = [...recentCards];
  }
  if (finalSearchRecent.length < 4) {
    const fallbackList = liveCatalog.playlists.length > 0 ? liveCatalog.playlists : (liveCatalog.demoCatalog || []);
    for (const item of fallbackList) {
      if (finalSearchRecent.length >= 4) break;
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

  if (finalSearchRecent.length > 0 && searchRecentGrid) {
    searchRecentGrid.innerHTML = finalSearchRecent.slice(0, 4).map(item => {
      const actionAttr = item.uri
        ? `data-play-direct-uri="${item.uri}" data-title="${(item.title || '').replace(/"/g, '&quot;')}" data-artist="${(item.subtitle || '').replace(/"/g, '&quot;')}" data-cover="${item.coverLarge || item.cover}" data-thumb="${item.thumb || item.cover}" data-duration="${item.durationMs ? Math.round(item.durationMs / 1000) : ''}"`
        : `data-open-entity="${item.entityId || item.id}"`;
      return `
        <div class="media-card" ${actionAttr}>
          <div class="media-card-cover-wrap">
            ${renderOptImg(item.cover, item.title || '', 'media-card-cover')}
          </div>
          <div class="media-card-title">${item.title}</div>
          <div class="media-card-subtitle">${item.subtitle || ''}</div>
        </div>
      `;
    }).join('');
    hydrateImages(searchRecentGrid);
  }
}

function renderLibrary(filter = 'all') {
  liveCatalog.libraryFilter = filter;
  const grid = document.getElementById('libraryGrid6');
  if (!grid) return;

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
        contextSource: 'liked',
        title: t.title,
        sub: t.artist,
        cover: t.cover,
        coverLarge: t.coverLarge || t.cover,
        thumb: t.thumb || t.cover
      });
    });
  }

  if (liveCatalog.sortAlphabetical && items.length > 1) {
    const pinned = items.filter(i => i.likedCard || i.djCard);
    const regular = items.filter(i => !i.likedCard && !i.djCard);
    regular.sort((a, b) => a.title.localeCompare(b.title));
    items = pinned.concat(regular);
  }

  const sig = `${filter}:${liveCatalog.sortAlphabetical}:${items.map(i => `${i.id || i.playUri}:${i.cover || ''}:${i.sub || ''}`).join('|')}`;
  if (grid.dataset.sig === sig) return;
  grid.dataset.sig = sig;

  grid.innerHTML = items.map((item, idx) => {
    let coverContent = '';
    const lazyAttr = idx >= 18 ? 'loading="lazy"' : '';
    if (item.likedCard) {
      coverContent = `<div class="liked-songs-art">
           <svg width="56" height="56" viewBox="0 0 24 24" fill="#ffffff">
             <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
           </svg>
         </div>`;
    } else if (item.djCard) {
      coverContent = renderOptImg('https://lexicon-assets.spotifycdn.com/DJ-Beta-CoverArt-300.jpg', 'DJ Livi', 'media-card-cover', lazyAttr);
    } else {
      coverContent = renderOptImg(item.cover, item.title, 'media-card-cover', lazyAttr);
    }

    const pinHtml = item.pinned
      ? `<span class="pin-badge">📌</span>`
      : (item.djCard ? `<span class="dj-ai-badge">AI</span>` : '');

    const rawLibDur = item.durationMs ? Math.round(item.durationMs / 1000) : (item.duration || '');
    const contextAttr = item.contextSource ? ` data-context-source="${item.contextSource}"` : '';
    const actionAttr = item.playUri
      ? `data-play-direct-uri="${item.playUri}" data-title="${item.title.replace(/"/g, '&quot;')}" data-artist="${item.sub.replace(/"/g, '&quot;')}" data-cover="${item.coverLarge || item.cover || ''}" data-thumb="${item.thumb || item.cover || ''}" data-duration="${rawLibDur}"${contextAttr}`
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
  hydrateImages(grid);
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

