/* ==========================================================================
   VIEW: Live Spotify Data Orchestrator, Skeletons & Catalog Renderers (Home, Search, Library)
   ========================================================================== */
'use strict';

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
  if (!spotifyAuth.accessToken) {
    switchScreen('login');
    return;
  }

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

  // Pre-warm Library, Search & Top Artists thumbnails in background idle time so tab switching is 0ms
  const urlsToPrewarm = [];
  liveCatalog.recentSearches.forEach(s => { if (s && s.avatar) urlsToPrewarm.push(s.avatar); });
  liveCatalog.playlists.slice(0, 18).forEach(p => { if (p && p.cover) urlsToPrewarm.push(p.cover); });
  liveCatalog.albums.slice(0, 12).forEach(a => { if (a && a.cover) urlsToPrewarm.push(a.cover); });
  liveCatalog.artists.slice(0, 12).forEach(ar => { if (ar && ar.cover) urlsToPrewarm.push(ar.cover); });
  prewarmImageUrls(urlsToPrewarm);
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
            ${renderOptImg(b.cover, b.title, 'banner-artwork', 'fetchpriority="high"')}
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
  hydrateImages(grid);
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
        jumpGrid.innerHTML = jumpList.slice(0, 8).map((item, idx) => `
          <div class="media-card" data-open-entity="${item.entityId}">
            <div class="media-card-cover-wrap">
              ${renderOptImg(item.cover, item.title, 'media-card-cover', idx < 5 ? 'fetchpriority="high"' : '')}
            </div>
            <div class="media-card-title">${item.title}</div>
            <div class="media-card-subtitle">${item.subtitle}</div>
          </div>
        `).join('');
        hydrateImages(jumpGrid);
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
              ${renderOptImg(item.cover, item.name, 'artist-card-avatar')}
            </div>
            <div class="artist-card-name">${item.name}</div>
            <div class="artist-card-meta">${item.meta || 'Artist'}</div>
          </div>
        `).join('');
        hydrateImages(artistsGrid);
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
            ? `data-play-direct-uri="${item.uri}" data-title="${(item.title || '').replace(/"/g, '&quot;')}" data-artist="${(item.subtitle || '').replace(/"/g, '&quot;')}" data-cover="${item.coverLarge || item.cover}" data-thumb="${item.thumb || item.cover}"`
            : `data-open-entity="${item.entityId}"`;
          return `
            <div class="media-card" ${actionAttr}>
              <div class="media-card-cover-wrap">
                ${renderOptImg(item.cover, item.title || 'Track', 'media-card-cover')}
              </div>
              <div class="media-card-title">${item.title}</div>
              <div class="media-card-subtitle">${item.subtitle || ''}</div>
            </div>
          `;
        }).join('');
        hydrateImages(recentGrid);
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
              ${renderOptImg(item.cover, item.title, 'media-card-cover')}
            </div>
            <div class="media-card-title">${item.title}</div>
            <div class="media-card-subtitle">${item.subtitle || ''}</div>
          </div>
        `).join('');
        hydrateImages(savedAlbumsGrid);
      }
    } else {
      delete savedAlbumsGrid.dataset.sig;
      savedAlbumsGrid.innerHTML = buildSkeletonCardsHTML(5, true);
    }
  }
}

function renderSearch(recentCards) {
  const chipsRow = document.getElementById('recentSearchesRow');
  if (chipsRow) {
    chipsRow.innerHTML = liveCatalog.recentSearches.map(chip => `
      <div class="recent-chip" ${chip.entityId ? `data-open-entity="${chip.entityId}"` : `data-search-query="${chip.query || chip.label}"`}>
        ${renderOptImg(chip.avatar, chip.label, `chip-avatar ${chip.square ? 'square' : ''}`)}
        <span class="chip-label">${chip.label}</span>
      </div>
    `).join('');
    hydrateImages(chipsRow);
  }

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

  if (finalSearchRecent.length > 0 && searchRecentGrid) {
    searchRecentGrid.innerHTML = finalSearchRecent.slice(0, 5).map(item => {
      const actionAttr = item.uri
        ? `data-play-direct-uri="${item.uri}" data-title="${(item.title || '').replace(/"/g, '&quot;')}" data-artist="${(item.subtitle || '').replace(/"/g, '&quot;')}" data-cover="${item.coverLarge || item.cover}" data-thumb="${item.thumb || item.cover}"`
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
           <svg width="54" height="54" viewBox="0 0 24 24" fill="#ffffff">
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

    const actionAttr = item.playUri
      ? `data-play-direct-uri="${item.playUri}" data-title="${item.title.replace(/"/g, '&quot;')}" data-artist="${item.sub.replace(/"/g, '&quot;')}" data-cover="${item.coverLarge || item.cover || ''}" data-thumb="${item.thumb || item.cover || ''}"`
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

