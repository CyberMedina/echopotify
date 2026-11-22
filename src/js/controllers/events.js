/* ==========================================================================
   CONTROLLER: UI Touch/Click Event Listeners, Search Input, Theme & Viewport
   ========================================================================== */
'use strict';


document.addEventListener('click', async (e) => {
  const topPlayTrigger = e.target.closest('.search-top-play-btn[data-play-direct-uri]');
  if (topPlayTrigger) {
    e.stopPropagation();
  }

  // 1. Open Entity Card (Album, Playlist, Artist, Liked Songs)
  const entityTrigger = topPlayTrigger ? null : e.target.closest('[data-open-entity]');
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
    const thumb = directPlay.getAttribute('data-thumb') || cover;
    const rawDur = parseInt(directPlay.getAttribute('data-duration'), 10);
    const duration = (Number.isFinite(rawDur) && rawDur > 0) ? rawDur : 0;
    const isContextUri = uri.startsWith('spotify:playlist:') || uri.startsWith('spotify:album:');
    const contextSource = directPlay.getAttribute('data-context-source') || '';
    const cleanId = cleanTrackId(uri);
    const isLikedContext = Boolean(contextSource === 'liked' && !isContextUri && Array.isArray(liveCatalog.likedTracks) && liveCatalog.likedTracks.length > 0);
    let likedUpcomingSlice = [];
    state.singleTrackPlayback = false;
    state.hasCustomReorderedQueue = false;
    if (isContextUri) {
      if (typeof clearAutoplayRadioSession === 'function') clearAutoplayRadioSession();
      state.isLocalContextQueue = false;
      state.activeContextType = uri.startsWith('spotify:album:') ? 'album' : 'playlist';
      state.activeContextId = '';
      state.activeContextUri = uri;
      state.activeContextName = title || '';
      state.playbackHistory = [];
      state.sdkNextTracks = [];
      state.liveQueueTracks = [];
      state.contextUpcomingTracks = [];
    } else if (isLikedContext) {
      if (typeof clearAutoplayRadioSession === 'function') clearAutoplayRadioSession();
      const clickedIdx = liveCatalog.likedTracks.findIndex(t =>
        (cleanId && cleanTrackId(t.id || t.uri) === cleanId) || (uri && t.uri === uri)
      );
      likedUpcomingSlice = clickedIdx >= 0
        ? liveCatalog.likedTracks.slice(clickedIdx + 1)
        : liveCatalog.likedTracks.filter(t => t.uri !== uri);
      const likedPrevSlice = clickedIdx > 0 ? liveCatalog.likedTracks.slice(0, clickedIdx) : [];
      state.playbackHistory = ((typeof normalizeApiTrack === 'function')
        ? likedPrevSlice.map(normalizeApiTrack).filter(Boolean)
        : likedPrevSlice).slice(-50);
      state.isLocalContextQueue = true;
      state.activeContextType = 'liked';
      state.activeContextId = 'liked_songs';
      state.activeContextUri = '';
      state.activeContextName = 'Tus me gusta';
      state.sdkNextTracks = [];
      state.contextUpcomingTracks = likedUpcomingSlice;
      state.liveQueueTracks = (typeof normalizeApiTrack === 'function')
        ? likedUpcomingSlice.map(normalizeApiTrack).filter(Boolean)
        : likedUpcomingSlice;
    } else {
      state.isLocalContextQueue = false;
      state.activeContextType = '';
      state.activeContextId = '';
      state.activeContextUri = '';
      state.activeContextName = '';
      state.playbackHistory = [];
      state.isAutoplayQueue = true;
      state.sdkNextTracks = [];
      state.contextUpcomingTracks = [];
    }
    applyTrackToUI({
      id: cleanId || uri,
      uri,
      name: title,
      artist,
      thumb,
      cover,
      coverLarge: cover,
      duration: duration || undefined
    }, 0, true);
    openNowPlaying();
    if (uri) {
      if (isContextUri) {
        playSpotifyContext(uri).then(res => {
          if (res && res.error) {
            console.warn('[Spotify Playback Error]', res.error);
            if (uri.includes('37i9dQZF1EYkqdzj48dyYq')) {
              alert('Nota: Spotify restringe el AI DJ exclusivamente a su app oficial de iOS/Android; la API de Spotify no permite iniciar la voz del DJ en clientes externos.');
            }
          }
        });
      } else if (isLikedContext) {
        const likedUris = [uri, ...likedUpcomingSlice.slice(0, 79).map(t => t.uri)].filter(Boolean);
        playSpotifyUris(likedUris, likedUpcomingSlice, { keepLocalContext: true }).then(res => {
          if (res && res.error) {
            console.warn('[Spotify Playback Error]', res.error);
          }
        });
      } else {
        playSingleTrackWithAutoplay({
          id: cleanId || uri,
          uri,
          name: title,
          artist,
          thumb,
          cover,
          duration: duration || undefined
        }).then(res => {
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
    const filter = navTrigger.getAttribute('data-filter');
    if (filter) {
      const segBtn = document.querySelector(`#librarySegmented [data-filter="${filter}"]`);
      if (segBtn) segBtn.click();
    }
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
    const trackId = trackRow.getAttribute('data-track-id');
    const trackUri = trackRow.getAttribute('data-track-uri');
    const title = trackRow.getAttribute('data-track-title');
    const artist = trackRow.getAttribute('data-track-artist');
    const album = trackRow.getAttribute('data-track-album');
    const cover = trackRow.getAttribute('data-track-cover');
    const thumb = trackRow.getAttribute('data-track-thumb') || cover;
    const rawDur = parseInt(trackRow.getAttribute('data-track-duration'), 10);
    const duration = (Number.isFinite(rawDur) && rawDur > 0) ? rawDur : 0;

    const entity = liveCatalog.entities[entityId] || liveCatalog.entities[state.selectedEntityId];
    const upcomingSlice = (entity && Array.isArray(entity.tracks)) ? entity.tracks.slice(idx + 1) : [];
    const usesNativeContext = Boolean(entity && entity.uri && (entity.type === 'album' || entity.type === 'playlist'));
    const usesLocalContext = Boolean(!usesNativeContext && entity && Array.isArray(entity.tracks));
    if (typeof clearAutoplayRadioSession === 'function') clearAutoplayRadioSession();
    state.sdkNextTracks = [];
    state.hasCustomReorderedQueue = false;
    state.singleTrackPlayback = false;
    state.isLocalContextQueue = usesLocalContext;
    if (usesNativeContext) {
      state.activeContextType = entity.type || '';
      state.activeContextId = entity.id || '';
      state.activeContextUri = entity.uri || '';
    } else if (usesLocalContext) {
      state.activeContextType = (entity.id === 'liked_songs' || entity.type === 'liked') ? 'liked' : (entity.type || '');
      state.activeContextId = entity.id || '';
      state.activeContextUri = '';
    } else {
      state.activeContextType = '';
      state.activeContextId = '';
      state.activeContextUri = '';
    }
    state.activeContextName = entity
      ? ((entity.id === 'liked_songs' || entity.type === 'liked') ? 'Tus me gusta' : (entity.title || ''))
      : '';
    if (usesLocalContext && entity && Array.isArray(entity.tracks) && idx > 0) {
      const prevRaw = entity.tracks.slice(0, idx);
      state.playbackHistory = ((typeof normalizeApiTrack === 'function')
        ? prevRaw.map(normalizeApiTrack).filter(Boolean)
        : prevRaw).slice(-50);
    } else {
      state.playbackHistory = [];
    }
    state.contextUpcomingTracks = upcomingSlice;
    state.liveQueueTracks = (typeof normalizeApiTrack === 'function')
      ? upcomingSlice.map(normalizeApiTrack).filter(Boolean)
      : upcomingSlice;
    const cleanId = cleanTrackId(trackId || trackUri);

    applyTrackToUI({
      id: cleanId || trackId || trackUri || title,
      uri: trackUri,
      name: title,
      artist,
      album,
      thumb,
      cover,
      coverLarge: cover,
      duration: duration || undefined
    }, 0, true);
    openNowPlaying();

    if (usesNativeContext) {
      playSpotifyContext(entity.uri, trackUri ? { uri: trackUri } : idx, upcomingSlice);
    } else if (usesLocalContext) {
      const uris = entity.tracks.slice(idx).map(t => t.uri).filter(Boolean);
      if (uris.length > 0) playSpotifyUris(uris, upcomingSlice, { keepLocalContext: true });
    } else if (trackUri) {
      state.isLocalContextQueue = false;
      state.activeContextType = '';
      state.activeContextId = '';
      state.activeContextUri = '';
      state.activeContextName = '';
      playSingleTrackWithAutoplay({
        id: cleanId || trackId || trackUri,
        uri: trackUri,
        name: title,
        artist,
        album,
        thumb,
        cover,
        duration: duration || undefined
      });
    }
    return;
  }

  // 5B. Click Track inside Queue ("A continuación") or API Discovery List
  const queueRow = e.target.closest('.np-queue-row');
  if (queueRow && !state.isSwipingNowPlaying) {
    if (e.target.closest('.np-queue-drag-handle') || state.isDraggingQueueRow) return;
    const qSource = queueRow.getAttribute('data-queue-source') || 'queue';
    const qIdx = parseInt(queueRow.getAttribute('data-queue-idx'), 10) || 0;
    const trackId = queueRow.getAttribute('data-track-id');
    const trackUri = queueRow.getAttribute('data-track-uri');
    const title = queueRow.getAttribute('data-track-title');
    const artist = queueRow.getAttribute('data-track-artist');
    const album = queueRow.getAttribute('data-track-album');
    const cover = queueRow.getAttribute('data-track-cover');
    const thumb = queueRow.getAttribute('data-track-thumb') || cover;
    const rawDur = parseInt(queueRow.getAttribute('data-track-duration'), 10);
    const duration = (Number.isFinite(rawDur) && rawDur > 0) ? rawDur : 0;

    const cleanId = cleanTrackId(trackId || trackUri);
    state.sdkNextTracks = [];
    state.hasCustomReorderedQueue = false;
    if (qSource === 'queue' && state.liveQueueTracks.length > qIdx) {
      const wasAutoplay = Boolean(state.isAutoplayQueue);
      const wasLocalContext = Boolean(state.isLocalContextQueue);
      if (wasAutoplay && Array.isArray(state.autoplaySessionTracks) && state.autoplaySessionTracks.length > 0) {
        const baseIdx = Math.max(0, state.autoplaySessionIndex || 0);
        state.autoplaySessionIndex = Math.min(state.autoplaySessionTracks.length - 1, baseIdx + 1 + qIdx);
      }
      const remaining = state.liveQueueTracks.slice(qIdx + 1);
      if (wasLocalContext && typeof pushCurrentTrackToHistory === 'function') {
        pushCurrentTrackToHistory();
      }
      state.singleTrackPlayback = false;
      state.liveQueueTracks = remaining;
      state.contextUpcomingTracks = remaining;
      applyTrackToUI({
        id: cleanId || trackId || trackUri || title,
        uri: trackUri,
        name: title,
        artist,
        album,
        thumb,
        cover,
        coverLarge: cover,
        duration: duration || undefined
      }, 0, true);
      const uris = [trackUri, ...remaining.slice(0, 19).map(t => t.uri)].filter(Boolean);
      if (uris.length > 0) {
        playSpotifyUris(uris, remaining, {
          keepAutoplaySession: wasAutoplay,
          keepLocalContext: wasLocalContext
        });
      }
      if (wasAutoplay && remaining.length < 8 && typeof replenishAutoplayQueue === 'function') {
        replenishAutoplayQueue();
      }
    } else {
      state.singleTrackPlayback = false;
      state.isLocalContextQueue = false;
      state.activeContextType = '';
      state.activeContextId = '';
      state.activeContextUri = '';
      state.activeContextName = '';
      state.isAutoplayQueue = true;
      state.contextUpcomingTracks = [];
      state.discoveryTracks = [];
      applyTrackToUI({
        id: cleanId || trackId || trackUri || title,
        uri: trackUri,
        name: title,
        artist,
        album,
        thumb,
        cover,
        coverLarge: cover,
        duration: duration || undefined
      }, 0, true);
      if (trackUri) {
        playSingleTrackWithAutoplay({
          id: cleanId || trackId || trackUri,
          uri: trackUri,
          name: title,
          artist,
          album,
          thumb,
          cover,
          duration: duration || undefined
        });
      }
    }
    return;
  }

  // 6. Click Lyric Line -> Seek Spotify & Local Timer
  const lyricLine = e.target.closest('.lyric-line');
  if (lyricLine && !state.isSwipingNowPlaying) {
    if (state.lyricsLastDragEndAt && (Date.now() - state.lyricsLastDragEndAt) < 320) {
      return;
    }
    const startSec = parseFloat(lyricLine.getAttribute('data-start')) || 0;
    const seekMs = Math.round(startSec * 1000);
    state.currentTimeSec = startSec;
    lockUserPlaybackIntent('seek', {
      durationMs: 2200,
      targetSeekSec: startSec,
      targetIsPlaying: state.isPlaying
    });
    if (bridge && bridge.notifyTrackSeeked) {
      bridge.notifyTrackSeeked(seekMs);
    }
    if (typeof exitLyricsManualScroll === 'function') {
      exitLyricsManualScroll({ skipSnapBack: true });
    }
    updateScrubberAndLyricsUI(true);
    if (isLocalWebPlayerActive() && typeof webPlayer.seek === 'function') {
      try { webPlayer.seek(seekMs); } catch (err) { }
    }
    if (spotifyAuth.accessToken) {
      spotifyFetch(`/me/player/seek?position_ms=${seekMs}`, { method: 'PUT' });
    }
  }
});

// Safe Touch/Click Binder for Echo Show Silk Browser (prevents "Mostrar barra de URL" system gesture)
function bindTouchButton(btn, callback) {
  if (!btn) return;
  let touchedAt = 0;
  btn.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    touchedAt = Date.now();
  }, { passive: true });

  btn.addEventListener('touchend', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (Date.now() - touchedAt < 650) {
      callback(e);
    }
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (Date.now() - touchedAt > 650) {
      callback(e);
    }
  });
}

// Back Button in Album View
const albumBackBtn = document.getElementById('albumBackBtn');
if (albumBackBtn) {
  bindTouchButton(albumBackBtn, (e) => {
    goBack();
  });
}

// Click on Artist in Album View -> Navigate to Artist View
const albumDetailArtistEl = document.getElementById('albumDetailArtist');
if (albumDetailArtistEl) {
  albumDetailArtistEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const artistLink = e.target.closest('.album-artist-link');
    if (artistLink) {
      const targetId = artistLink.getAttribute('data-artist-id');
      const targetName = artistLink.getAttribute('data-artist-name');
      navigateToArtist(targetId, targetName);
      return;
    }
    const entity = liveCatalog.entities[state.selectedEntityId];
    if (entity && entity.artist && entity.type !== 'playlist' && entity.type !== 'liked') {
      const targetId = entity.artistId || (entity.artists && entity.artists[0] && entity.artists[0].id) || null;
      navigateToArtist(targetId, entity.artist);
    }
  });
}

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

// Album "Play" & "Shuffle" Pill Buttons
function startAlbumOrPlaylistPlayback(shuffled = false) {
  const entity = liveCatalog.entities[state.selectedEntityId];
  if (!entity) return;

  if (typeof clearAutoplayRadioSession === 'function') clearAutoplayRadioSession();
  state.sdkNextTracks = [];
  state.hasCustomReorderedQueue = false;
  state.singleTrackPlayback = false;

  const tracks = Array.isArray(entity.tracks) ? entity.tracks : [];
  const usesNativeContext = Boolean(entity.uri && (entity.type === 'album' || entity.type === 'playlist'));
  state.playbackHistory = [];
  state.isLocalContextQueue = !usesNativeContext;
  state.activeContextType = (entity.id === 'liked_songs' || entity.type === 'liked') ? 'liked' : (entity.type || '');
  state.activeContextId = entity.id || '';
  state.activeContextUri = usesNativeContext ? (entity.uri || '') : '';
  state.activeContextName = (entity.id === 'liked_songs' || entity.type === 'liked') ? 'Tus me gusta' : (entity.title || '');

  if (!shuffled) {
    const upcomingSlice = tracks.length > 0 ? tracks.slice(1) : [];
    state.contextUpcomingTracks = upcomingSlice;
    state.liveQueueTracks = (typeof normalizeApiTrack === 'function')
      ? upcomingSlice.map(normalizeApiTrack).filter(Boolean)
      : upcomingSlice;
    if (tracks[0]) {
      const t = tracks[0];
      const cleanId = cleanTrackId(t.id || t.uri);
      applyTrackToUI({
        id: cleanId || t.id || t.title,
        uri: t.uri,
        name: t.title,
        artist: t.artist || entity.artist,
        album: entity.title,
        thumb: t.thumb || t.cover || entity.cover,
        cover: t.cover || entity.cover,
        coverLarge: t.coverLarge || entity.coverLarge || t.cover || entity.cover,
        duration: t.duration
      }, 0, true);
    }
    openNowPlaying();
    if (usesNativeContext) {
      playSpotifyContext(entity.uri, 0, upcomingSlice, { preserveShuffle: false });
    } else if (tracks.length > 0) {
      const uris = tracks.map(t => t.uri).filter(Boolean);
      if (uris.length > 0) playSpotifyUris(uris, upcomingSlice, { keepLocalContext: true });
    }
    return;
  }

  // Modo Aleatorio
  if (usesNativeContext) {
    state.contextUpcomingTracks = [];
    state.liveQueueTracks = [];
    openNowPlaying();
    playSpotifyContext(entity.uri, undefined, [], { preserveShuffle: true, setShuffle: true });
  } else if (tracks.length > 0) {
    const shuffledTracks = [...tracks].sort(() => Math.random() - 0.5);
    const first = shuffledTracks[0];
    const remaining = shuffledTracks.slice(1);
    state.contextUpcomingTracks = remaining;
    state.liveQueueTracks = (typeof normalizeApiTrack === 'function')
      ? remaining.map(normalizeApiTrack).filter(Boolean)
      : remaining;
    const cleanId = cleanTrackId(first.id || first.uri);
    applyTrackToUI({
      id: cleanId || first.id || first.title,
      uri: first.uri,
      name: first.title,
      artist: first.artist || entity.artist,
      album: entity.title,
      thumb: first.thumb || first.cover || entity.cover,
      cover: first.cover || entity.cover,
      coverLarge: first.coverLarge || entity.coverLarge || first.cover || entity.cover,
      duration: first.duration
    }, 0, true);
    openNowPlaying();
    const uris = shuffledTracks.map(t => t.uri).filter(Boolean);
    if (uris.length > 0) playSpotifyUris(uris, remaining, { keepLocalContext: true });
  }
}

document.getElementById('albumPlayAllBtn').addEventListener('click', () => {
  startAlbumOrPlaylistPlayback(false);
});

// Artist View Navigation & Buttons
const artistBackBtn = document.getElementById('artistBackBtn');
if (artistBackBtn) {
  bindTouchButton(artistBackBtn, (e) => {
    goBack();
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
    const artist = liveCatalog.entities[state.selectedArtistId];
    if (artist && artist.tracks) {
      renderArtistTracks(artist.tracks);
    }
  });
}

// Play button on Artist Header
const artistPlayBtn = document.getElementById('artistPlayBtn');
if (artistPlayBtn) {
  artistPlayBtn.addEventListener('click', () => {
    const artist = liveCatalog.entities[state.selectedArtistId];
    const tracks = (artist && artist.tracks) ? artist.tracks : [];
    if (!tracks || tracks.length === 0) return;
    const first = tracks[0];
    if (typeof clearAutoplayRadioSession === 'function') clearAutoplayRadioSession();
    state.sdkNextTracks = [];
    state.hasCustomReorderedQueue = false;
    state.singleTrackPlayback = false;
    state.isLocalContextQueue = true;
    state.activeContextType = 'artist';
    state.activeContextId = artist.id || state.selectedArtistId || '';
    state.activeContextUri = '';
    state.activeContextName = artist.name || artist.title || 'Artista';
    state.playbackHistory = [];
    state.contextUpcomingTracks = tracks.slice(1).map(t => ({
      id: t.id || t.uri,
      uri: t.uri,
      name: t.title,
      artist: t.artist || artist.name || artist.title,
      album: t.album || 'Top Tracks',
      thumb: t.thumb || t.cover || artist.cover,
      cover: t.cover || artist.cover,
      coverLarge: t.coverLarge || t.cover || artist.cover,
      duration: t.duration || 210
    }));
    state.liveQueueTracks = (typeof normalizeApiTrack === 'function')
      ? state.contextUpcomingTracks.map(normalizeApiTrack).filter(Boolean)
      : state.contextUpcomingTracks;
    const cleanFirstId = cleanTrackId(first.id || first.uri);
    applyTrackToUI({
      id: cleanFirstId || first.id || first.uri,
      uri: first.uri,
      name: first.title,
      artist: first.artist || artist.name || artist.title,
      album: first.album || 'Top Tracks',
      thumb: first.thumb || first.cover || artist.cover,
      cover: first.cover || artist.cover,
      coverLarge: first.coverLarge || first.cover || artist.cover,
      duration: first.duration || 210
    }, 0, true);
    openNowPlaying();
    const uris = tracks.map(t => t.uri).filter(Boolean);
    if (uris.length > 0) {
      playSpotifyUris(uris, state.contextUpcomingTracks, { keepLocalContext: true });
    } else if (first.uri) {
      playSpotifyUris([first.uri], state.contextUpcomingTracks, { keepLocalContext: true });
    }
  });
}

// Shuffle button on Artist Header
const artistShuffleBtn = document.getElementById('artistShuffleBtn');
if (artistShuffleBtn) {
  artistShuffleBtn.addEventListener('click', () => {
    const artist = liveCatalog.entities[state.selectedArtistId];
    const tracks = (artist && artist.tracks) ? artist.tracks : [];
    if (!tracks || tracks.length === 0) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    const first = shuffled[0];
    if (typeof clearAutoplayRadioSession === 'function') clearAutoplayRadioSession();
    state.sdkNextTracks = [];
    state.hasCustomReorderedQueue = false;
    state.singleTrackPlayback = false;
    state.isLocalContextQueue = true;
    state.activeContextType = 'artist';
    state.activeContextId = artist.id || state.selectedArtistId || '';
    state.activeContextUri = '';
    state.activeContextName = artist.name || artist.title || 'Artista';
    state.playbackHistory = [];
    state.contextUpcomingTracks = shuffled.slice(1).map(t => ({
      id: t.id || t.uri,
      uri: t.uri,
      name: t.title,
      artist: t.artist || artist.name || artist.title,
      album: t.album || 'Top Tracks',
      thumb: t.thumb || t.cover || artist.cover,
      cover: t.cover || artist.cover,
      coverLarge: t.coverLarge || t.cover || artist.cover,
      duration: t.duration || 210
    }));
    state.liveQueueTracks = (typeof normalizeApiTrack === 'function')
      ? state.contextUpcomingTracks.map(normalizeApiTrack).filter(Boolean)
      : state.contextUpcomingTracks;
    const cleanFirstId = cleanTrackId(first.id || first.uri);
    applyTrackToUI({
      id: cleanFirstId || first.id || first.uri,
      uri: first.uri,
      name: first.title,
      artist: first.artist || artist.name || artist.title,
      album: first.album || 'Top Tracks',
      thumb: first.thumb || first.cover || artist.cover,
      cover: first.cover || artist.cover,
      coverLarge: first.coverLarge || first.cover || artist.cover,
      duration: first.duration || 210
    }, 0, true);
    openNowPlaying();
    const uris = shuffled.map(t => t.uri).filter(Boolean);
    if (uris.length > 0) {
      playSpotifyUris(uris, state.contextUpcomingTracks, { keepLocalContext: true });
    } else if (first.uri) {
      playSpotifyUris([first.uri], state.contextUpcomingTracks, { keepLocalContext: true });
    }
  });
}

// Follow button toggle
const artistFollowBtn = document.getElementById('artistFollowBtn');
if (artistFollowBtn) {
  artistFollowBtn.addEventListener('click', () => {
    artistFollowBtn.classList.toggle('following');
    if (artistFollowBtn.classList.contains('following')) {
      artistFollowBtn.innerHTML = `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#1ed760" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else {
      artistFollowBtn.innerHTML = `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    }
  });
}

// Handler for selecting an artist popular track
function handleArtistTrackSelect(item) {
  if (!item) return;
  const idx = parseInt(item.getAttribute('data-artist-track-index'), 10) || 0;
  const artist = liveCatalog.entities[state.selectedArtistId] || {};
  const tracks = (artist && Array.isArray(artist.tracks)) ? artist.tracks : [];

  const trackId = item.getAttribute('data-track-id') || (tracks[idx] ? tracks[idx].id : '');
  const trackUri = item.getAttribute('data-track-uri') || (tracks[idx] ? tracks[idx].uri : '') || (trackId ? `spotify:track:${trackId}` : '');
  const trackTitle = item.getAttribute('data-track-title') || (tracks[idx] ? tracks[idx].title : '');
  const trackArtist = item.getAttribute('data-track-artist') || (tracks[idx] ? tracks[idx].artist : '') || artist.name || artist.title || 'Artista';
  const trackThumb = item.getAttribute('data-track-thumb') || (tracks[idx] ? tracks[idx].thumb : '') || artist.cover || '';
  const trackCover = item.getAttribute('data-track-cover') || (tracks[idx] ? tracks[idx].coverLarge || tracks[idx].cover : '') || trackThumb;
  const trackDuration = parseInt(item.getAttribute('data-track-duration'), 10) || (tracks[idx] ? tracks[idx].duration : 210);

  if (!trackTitle && !trackUri) return;

  document.querySelectorAll('.artist-track-item').forEach((el, i) => {
    el.classList.toggle('playing', i === idx);
  });

  const upcoming = tracks.slice(idx + 1).map(t => ({
    id: t.id || t.uri,
    uri: t.uri,
    name: t.title,
    artist: t.artist || artist.name || artist.title,
    album: t.album || 'Top Tracks',
    thumb: t.thumb || t.cover || artist.cover,
    cover: t.cover || artist.cover,
    coverLarge: t.coverLarge || t.cover || artist.cover,
    duration: t.duration || 210
  }));

  if (typeof clearAutoplayRadioSession === 'function') clearAutoplayRadioSession();
  state.sdkNextTracks = [];
  state.hasCustomReorderedQueue = false;
  state.singleTrackPlayback = false;
  state.isLocalContextQueue = true;
  state.activeContextType = 'artist';
  state.activeContextId = artist.id || state.selectedArtistId || '';
  state.activeContextUri = '';
  state.activeContextName = artist.name || artist.title || 'Artista';
  const artistPrevRaw = idx > 0 ? tracks.slice(0, idx) : [];
  state.playbackHistory = ((typeof normalizeApiTrack === 'function')
    ? artistPrevRaw.map(normalizeApiTrack).filter(Boolean)
    : artistPrevRaw).slice(-50);
  state.contextUpcomingTracks = upcoming;
  state.liveQueueTracks = (typeof normalizeApiTrack === 'function')
    ? upcoming.map(normalizeApiTrack).filter(Boolean)
    : upcoming;
  const cleanId = cleanTrackId(trackId || trackUri);

  applyTrackToUI({
    id: cleanId || trackId || trackUri || trackTitle,
    uri: trackUri,
    name: trackTitle,
    artist: trackArtist,
    album: (tracks[idx] && tracks[idx].album) ? tracks[idx].album : 'Top Tracks',
    thumb: trackThumb,
    cover: trackCover,
    coverLarge: trackCover,
    duration: trackDuration
  }, 0, true);

  openNowPlaying();

  // Reproducir directamente la lista de canciones del artista desde la pista elegida manteniendo el contexto local exacto
  const uris = tracks.slice(idx).map(t => t.uri).filter(Boolean);
  if (uris.length > 0) {
    playSpotifyUris(uris, upcoming, { keepLocalContext: true });
  } else if (trackUri) {
    playSpotifyUris([trackUri], upcoming, { keepLocalContext: true });
  }
}

// Click & Touch on Populares track
const artistTracklistEl = document.getElementById('artistTracklist');
if (artistTracklistEl) {
  let touchStartT = 0;
  let touchStartY = 0;
  let touchMoved = false;

  artistTracklistEl.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 1) {
      touchStartT = Date.now();
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
    }
  }, { passive: true });

  artistTracklistEl.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches.length === 1 && Math.abs(e.touches[0].clientY - touchStartY) > 12) {
      touchMoved = true;
    }
  }, { passive: true });

  artistTracklistEl.addEventListener('touchend', (e) => {
    if (touchMoved || Date.now() - touchStartT > 650) return;
    const item = e.target.closest('.artist-track-item');
    if (item && !e.target.closest('.artist-track-like-btn, .artist-track-more-btn')) {
      e.stopPropagation();
      e.preventDefault();
      handleArtistTrackSelect(item);
    }
  });

  artistTracklistEl.addEventListener('click', (e) => {
    const likeBtn = e.target.closest('.artist-track-like-btn');
    if (likeBtn) {
      e.stopPropagation();
      const trackId = likeBtn.getAttribute('data-track-id');
      const trackTitle = likeBtn.getAttribute('data-track-title') || '';
      const artist = liveCatalog.entities[state.selectedArtistId];
      toggleLikeTrack(trackId, { title: trackTitle, artist: artist ? (artist.name || artist.title) : '' });
      return;
    }
    if (e.target.closest('.artist-track-more-btn')) return;

    const item = e.target.closest('.artist-track-item');
    if (!item) return;
    handleArtistTrackSelect(item);
  });
}

// Dedicated Lyrics Button Click Handler (Apple Music style)
if (npToggleLyricsBtn) {
  bindTouchButton(npToggleLyricsBtn, (e) => {
    if (!state.hasValidLyrics && !state.lyricsLoading && state.playingTrackTitle && typeof ensureLyricsLoadedForCurrentTrack === 'function') {
      state.userPrefersLyrics = true;
      state.userForcedCentered = false;
      state.nowPlayingMode = 'lyrics';
      ensureLyricsLoadedForCurrentTrack('manual');
      updateNowPlayingRightPanelMode();
      return;
    }

    const hasLyrics = Boolean(state.hasValidLyrics || state.lyricsLoading);
    if (!hasLyrics) return;

    if (state.nowPlayingMode === 'lyrics') {
      state.nowPlayingMode = 'centered';
      state.userForcedCentered = true;
    } else {
      state.nowPlayingMode = 'lyrics';
      state.userPrefersLyrics = true;
      state.userForcedCentered = false;
    }
    updateNowPlayingRightPanelMode();
  });
}

// Dedicated Queue Button Click Handler (Apple Music style)
if (npToggleQueueBtn) {
  bindTouchButton(npToggleQueueBtn, (e) => {
    if (state.nowPlayingMode === 'queue') {
      state.nowPlayingMode = 'centered';
      state.userForcedCentered = true;
    } else {
      state.nowPlayingMode = 'queue';
      state.userPrefersLyrics = false;
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
  if (Date.now() < state.userIntent.expiresAt && state.userIntent.type === 'play_pause') {
    if (Boolean(isPlaying) !== state.userIntent.targetIsPlaying) return;
  }
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
document.getElementById('albumShuffleBtn').addEventListener('click', () => {
  startAlbumOrPlaylistPlayback(true);
});

// Mini-Player Click -> Opens Apple Music Now Playing Overlay
miniPlayer.addEventListener('click', (e) => {
  if (e.target.closest('.mini-ctrl-btn')) return;
  openNowPlaying();
});

async function resolveSavedContextForResume(trackId, trackUri) {
  const cid = cleanTrackId(trackId || trackUri);
  if (!cid && !trackUri) return null;

  const saved = (typeof loadLastPlayedTrack === 'function') ? loadLastPlayedTrack() : null;
  const savedCid = saved ? cleanTrackId(saved.id || saved.uri) : '';
  const savedMatchesTrack = Boolean(saved && ((cid && savedCid === cid) || (trackUri && saved.uri === trackUri)));

  const ctxType = state.activeContextType || (savedMatchesTrack ? (saved.contextType || '') : '');
  const ctxId = state.activeContextId || (savedMatchesTrack ? (saved.contextId || '') : '');
  const ctxUri = state.activeContextUri || (savedMatchesTrack ? (saved.contextUri || '') : '');
  const ctxName = state.activeContextName || (savedMatchesTrack ? (saved.contextName || '') : '');

  if (ctxType === 'liked') {
    let tracks = Array.isArray(liveCatalog.likedTracks) ? liveCatalog.likedTracks : [];
    if (tracks.length === 0 && spotifyAuth.accessToken) {
      try {
        const res = await spotifyFetch('/me/tracks?limit=50');
        if (res && Array.isArray(res.items)) {
          tracks = res.items
            .filter(i => i && i.track && !i.track.is_local && i.track.is_playable !== false && i.track.uri && !i.track.uri.startsWith('spotify:local:'))
            .map((i, idx) => {
              const imgs = (i.track.album && Array.isArray(i.track.album.images)) ? i.track.album.images : [];
              return {
                num: idx + 1,
                id: i.track.id,
                uri: i.track.uri,
                title: i.track.name,
                artist: i.track.artists ? i.track.artists.map(a => a.name).join(', ') : '',
                album: i.track.album ? i.track.album.name : '',
                thumb: imgs.length > 0 ? getSpotifyImage(imgs, 'small') : DEFAULT_ALBUM_COVER,
                cover: imgs.length > 0 ? getSpotifyImage(imgs, 'medium') : DEFAULT_ALBUM_COVER,
                coverLarge: imgs.length > 0 ? getSpotifyImage(imgs, 'large') : DEFAULT_ALBUM_COVER,
                duration: Math.round((i.track.duration_ms || 200000) / 1000)
              };
            });
          if (tracks.length > 0) {
            liveCatalog.likedTracks = tracks;
            liveCatalog.likedTrackIds = new Set(tracks.map(t => t.id).filter(Boolean));
          }
        }
      } catch (e) {}
    }
    const idx = tracks.findIndex(t =>
      (cid && cleanTrackId(t.id || t.uri) === cid) || (trackUri && t.uri === trackUri)
    );
    if (idx >= 0) {
      const upcoming = tracks.slice(idx + 1);
      const prev = tracks.slice(0, idx);
      state.isLocalContextQueue = true;
      state.activeContextType = 'liked';
      state.activeContextId = 'liked_songs';
      state.activeContextName = 'Tus me gusta';
      state.contextUpcomingTracks = upcoming;
      state.liveQueueTracks = (typeof normalizeApiTrack === 'function')
        ? upcoming.map(normalizeApiTrack).filter(Boolean)
        : upcoming;
      state.playbackHistory = ((typeof normalizeApiTrack === 'function')
        ? prev.map(normalizeApiTrack).filter(Boolean)
        : prev).slice(-50);
      const curUri = tracks[idx].uri || trackUri || (cid ? `spotify:track:${cid}` : '');
      const uris = [curUri, ...upcoming.slice(0, 79).map(t => t.uri)].filter(Boolean);
      return { mode: 'local_uris', uris, upcoming };
    }
  }

  if (ctxType === 'artist' && ctxId) {
    const artist = liveCatalog.entities[ctxId];
    const tracks = (artist && Array.isArray(artist.tracks)) ? artist.tracks : [];
    const idx = tracks.findIndex(t =>
      (cid && cleanTrackId(t.id || t.uri) === cid) || (trackUri && t.uri === trackUri)
    );
    if (idx >= 0) {
      const upcoming = tracks.slice(idx + 1);
      const prev = tracks.slice(0, idx);
      state.isLocalContextQueue = true;
      state.activeContextType = 'artist';
      state.activeContextId = ctxId;
      state.activeContextName = (artist && (artist.name || artist.title)) || ctxName || 'Artista';
      state.contextUpcomingTracks = upcoming;
      state.liveQueueTracks = (typeof normalizeApiTrack === 'function')
        ? upcoming.map(normalizeApiTrack).filter(Boolean)
        : upcoming;
      state.playbackHistory = ((typeof normalizeApiTrack === 'function')
        ? prev.map(normalizeApiTrack).filter(Boolean)
        : prev).slice(-50);
      const curUri = tracks[idx].uri || trackUri || (cid ? `spotify:track:${cid}` : '');
      const uris = [curUri, ...upcoming.slice(0, 79).map(t => t.uri)].filter(Boolean);
      return { mode: 'local_uris', uris, upcoming };
    }
  }

  if ((ctxType === 'playlist' || ctxType === 'album') && ctxUri) {
    state.isLocalContextQueue = false;
    state.activeContextType = ctxType;
    state.activeContextId = ctxId;
    state.activeContextUri = ctxUri;
    state.activeContextName = ctxName;
    return { mode: 'context_uri', contextUri: ctxUri };
  }

  return null;
}

async function playCloudItemDirectly(cloudPb, cloudItem) {
  const posMs = Math.max(0, Math.floor((cloudPb && cloudPb.progress_ms) || 0));
  const ctxUri = (cloudPb && cloudPb.context && cloudPb.context.uri) ? String(cloudPb.context.uri) : '';
  const isPlayableContext = ctxUri.startsWith('spotify:album:') || ctxUri.startsWith('spotify:playlist:') || ctxUri.startsWith('spotify:artist:');
  if (isPlayableContext) {
    const ctxRes = await playSpotifyContext(ctxUri, { uri: cloudItem.uri }, [], {
      positionMs: posMs,
      preserveShuffle: true,
      suppressErrorUI: true
    });
    if (ctxRes && !ctxRes.error) return ctxRes;
  }
  const restored = await resolveSavedContextForResume(cloudItem.id, cloudItem.uri);
  if (restored && restored.mode === 'local_uris' && restored.uris.length > 0) {
    if (state.nowPlayingMode === 'queue' && typeof renderQueuePanelUI === 'function') {
      renderQueuePanelUI();
    }
    return playSpotifyUris(restored.uris, restored.upcoming, { positionMs: posMs, keepLocalContext: true });
  }
  if (restored && restored.mode === 'context_uri' && restored.contextUri) {
    const ctxRes = await playSpotifyContext(restored.contextUri, { uri: cloudItem.uri }, [], {
      positionMs: posMs,
      preserveShuffle: true,
      suppressErrorUI: true
    });
    if (ctxRes && !ctxRes.error) return ctxRes;
  }
  return playSpotifyTrackUri(cloudItem.uri, [], { positionMs: posMs });
}

async function tryResumeCloudOrFallbackOnLocalSdk(devId, cmdSeq, preloadedCloudPbPromise) {
  let cloudPb = null;
  try {
    cloudPb = preloadedCloudPbPromise ? await preloadedCloudPbPromise : await spotifyFetch('/me/player');
  } catch (e) { }
  if (cmdSeq !== playbackActionSeq) return true;

  const cloudItem = (cloudPb && cloudPb.item && cloudPb.item.uri) ? cloudPb.item : null;
  const cloudCid = cloudItem ? cleanTrackId(cloudItem.id || cloudItem.uri) : '';
  const currentCid = cleanTrackId(state.playingTrackId || state.playingTrackUri);
  const shouldResumeCloud = Boolean(
    cloudItem && (state.isCachedPlaceholderTrack || (cloudCid && currentCid && cloudCid === currentCid))
  );

  if (shouldResumeCloud) {
    const progressSec = Math.max(0, (cloudPb.progress_ms || 0) / 1000);
    applyTrackToUI(cloudItem, progressSec, true, 'poll');
    const cloudDev = (cloudPb && cloudPb.device) ? cloudPb.device : null;
    const isLiveExternalSession = Boolean(
      cloudDev &&
      cloudDev.is_active &&
      cloudDev.id &&
      cloudDev.id !== devId &&
      !(cloudDev.name || '').includes('SpotiEcho')
    );

    if (!isLiveExternalSession) {
      await playCloudItemDirectly(cloudPb, cloudItem);
      return true;
    }

    const okTransfer = await transferPlaybackToDevice(devId, true, { silent: true });
    if (cmdSeq !== playbackActionSeq) return true;
    if (okTransfer) {
      setTimeout(() => {
        if (cmdSeq === playbackActionSeq && typeof pollSpotifyCurrentPlayback === 'function') {
          pollSpotifyCurrentPlayback();
        }
      }, 900);
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
            } else if (typeof setPlaybackBuffering === 'function') {
              setPlaybackBuffering(false);
            }
            return;
          }
          // El transfer devolvió 204 sin cargar pista real en el SDK local: reproducir directamente
          await playCloudItemDirectly(cloudPb, cloudItem);
        } catch (e) { }
      }, 1200);
      return true;
    }
    await playCloudItemDirectly(cloudPb, cloudItem);
    return true;
  }

  if (state.playingTrackUri) {
    const restored = await resolveSavedContextForResume(state.playingTrackId, state.playingTrackUri);
    if (restored && restored.mode === 'local_uris' && restored.uris.length > 0) {
      if (state.nowPlayingMode === 'queue' && typeof renderQueuePanelUI === 'function') {
        renderQueuePanelUI();
      }
      await playSpotifyUris(restored.uris, restored.upcoming, { keepLocalContext: true });
      return true;
    }
    if (restored && restored.mode === 'context_uri' && restored.contextUri) {
      const ctxRes = await playSpotifyContext(restored.contextUri, { uri: state.playingTrackUri }, [], {
        preserveShuffle: true,
        suppressErrorUI: true
      });
      if (ctxRes && !ctxRes.error) return true;
    }
    await playSpotifyTrackUri(state.playingTrackUri, state.contextUpcomingTracks || []);
    return true;
  }
  return false;
}

async function togglePlayPause() {
  activateWebPlayerAudio();
  if (state.isPlaying && state.isBuffering && (Date.now() - (state.bufferingStartedAt || 0)) < 1200) {
    return;
  }

  state.isPlaying = !state.isPlaying;
  const cmdSeq = lockUserPlaybackIntent('play_pause', {
    durationMs: 3200,
    targetIsPlaying: state.isPlaying
  });
  updatePlayPauseIcons();

  if (!state.isPlaying && typeof setPlaybackBuffering === 'function') {
    setPlaybackBuffering(false);
  }

  if (state.isPlaying && !state.hasValidLyrics && !state.lyricsLoading && state.playingTrackTitle && typeof ensureLyricsLoadedForCurrentTrack === 'function') {
    ensureLyricsLoadedForCurrentTrack('play');
  }

  if (isLocalWebPlayerActive()) {
    try {
      if (!state.isPlaying && typeof webPlayer.pause === 'function') {
        await webPlayer.pause();
        return;
      }
      if (state.isPlaying && typeof webPlayer.getCurrentState === 'function') {
        const localState = await webPlayer.getCurrentState();
        if (cmdSeq !== playbackActionSeq) return;
        if (localState && localState.track_window && localState.track_window.current_track && typeof webPlayer.resume === 'function') {
          await webPlayer.resume();
          if (typeof setPlaybackBuffering === 'function') setPlaybackBuffering(false);
          return;
        }
        if (typeof setPlaybackBuffering === 'function') setPlaybackBuffering(true);
        if (await tryResumeCloudOrFallbackOnLocalSdk(webPlayerDeviceId, cmdSeq, null)) {
          return;
        }
      }
    } catch (e) { }
  }

  if (spotifyAuth.accessToken) {
    if (state.isPlaying) {
      if (typeof setPlaybackBuffering === 'function') setPlaybackBuffering(true);
      const cloudPbPromise = spotifyFetch('/me/player').catch(() => null);
      const devId = await resolvePlaybackDeviceId();
      if (cmdSeq !== playbackActionSeq) return;

      if (devId && devId === webPlayerDeviceId && webPlayer) {
        try {
          const localState = (typeof webPlayer.getCurrentState === 'function') ? await webPlayer.getCurrentState() : null;
          if (cmdSeq !== playbackActionSeq) return;
          if (localState && localState.track_window && localState.track_window.current_track && typeof webPlayer.resume === 'function') {
            await webPlayer.resume();
            if (typeof setPlaybackBuffering === 'function') setPlaybackBuffering(false);
            return;
          }
        } catch (e) { }
        if (await tryResumeCloudOrFallbackOnLocalSdk(devId, cmdSeq, cloudPbPromise)) {
          return;
        }
      }

      const devQ = devId ? `?device_id=${devId}` : '';
      const res = await spotifyFetch(`/me/player/play${devQ}`, { method: 'PUT' });
      if (cmdSeq !== playbackActionSeq) return;
      if (!res || res.error) {
        const status = (res && (res._status || (res.error && res.error.status))) || 0;
        if (status === 404 && state.playingTrackUri) {
          await playSpotifyTrackUri(state.playingTrackUri, state.contextUpcomingTracks || []);
          return;
        }
        const retryDevId = devId || await resolvePlaybackDeviceId();
        if (cmdSeq !== playbackActionSeq) return;
        if (retryDevId && (await transferPlaybackToDevice(retryDevId, true, { silent: true }))) {
          if (typeof setPlaybackBuffering === 'function') setPlaybackBuffering(false);
          setTimeout(pollSpotifyCurrentPlayback, 700);
          return;
        }
        state.isPlaying = false;
        if (typeof setPlaybackBuffering === 'function') setPlaybackBuffering(false);
        updatePlayPauseIcons();
      } else if (typeof setPlaybackBuffering === 'function' && devId !== webPlayerDeviceId) {
        setPlaybackBuffering(false);
      }
    } else {
      const devQ = await getTargetDeviceQuery();
      if (cmdSeq !== playbackActionSeq) return;
      await spotifyFetch(`/me/player/pause${devQ}`, { method: 'PUT' });
    }
  } else if (typeof setPlaybackBuffering === 'function') {
    setPlaybackBuffering(false);
  }
}

function getCurrentTrackSnapshot() {
  if (!state.playingTrackId && !state.playingTrackUri && !state.playingTrackTitle) return null;
  return {
    id: state.playingTrackId || cleanTrackId(state.playingTrackUri) || state.playingTrackTitle,
    uri: state.playingTrackUri || (state.playingTrackId ? `spotify:track:${cleanTrackId(state.playingTrackId)}` : ''),
    title: state.playingTrackTitle || 'Canción',
    artist: state.playingArtist || 'Spotify',
    artists: Array.isArray(state.playingArtists) ? [...state.playingArtists] : [],
    album: state.playingAlbumTitle || '',
    thumb: state.playingThumb || state.playingCover || DEFAULT_ALBUM_COVER,
    cover: state.playingCover || DEFAULT_ALBUM_COVER,
    duration: state.durationSec || 210
  };
}

function pushCurrentTrackToHistory() {
  const snap = getCurrentTrackSnapshot();
  if (!snap || (!snap.uri && !snap.id)) return;
  if (!Array.isArray(state.playbackHistory)) state.playbackHistory = [];
  const snapCid = cleanTrackId(snap.id || snap.uri);
  const last = state.playbackHistory[state.playbackHistory.length - 1];
  const lastCid = last ? cleanTrackId(last.id || last.uri) : '';
  if (last && ((snapCid && lastCid === snapCid) || (snap.uri && last.uri === snap.uri))) {
    return;
  }
  state.playbackHistory.push(snap);
  if (state.playbackHistory.length > 50) {
    state.playbackHistory = state.playbackHistory.slice(-50);
  }
}

async function skipNextTrack() {
  // Record Spotify 30-second skip/satisfaction feedback BEFORE advancing
  const playedBeforeSkip = state.currentTimeSec || 0;
  const durBeforeSkip = state.durationSec || 210;
  const curRadioEntry = (state.isAutoplayQueue && Array.isArray(state.autoplaySessionTracks) && state.autoplaySessionIndex >= 0)
    ? state.autoplaySessionTracks[state.autoplaySessionIndex]
    : null;
  const skippedSnapshot = state.playingTrackId ? {
    id: state.playingTrackId,
    uri: state.playingTrackUri,
    title: state.playingTrackTitle,
    artist: state.playingArtist,
    artists: state.playingArtists,
    duration: durBeforeSkip,
    radioChannel: curRadioEntry ? curRadioEntry.radioChannel : null
  } : null;

  if (skippedSnapshot && typeof EchoRadio !== 'undefined' && typeof EchoRadio.recordPlaybackOutcome === 'function') {
    EchoRadio.recordPlaybackOutcome(skippedSnapshot, playedBeforeSkip, durBeforeSkip, 'skip');
    // Fast skip (<10s) in Radio: preserve visible #1 and only re-rank #2+ so UI Queue #1 matches what plays
    if (
      playedBeforeSkip < 10 &&
      state.isAutoplayQueue &&
      Array.isArray(state.autoplaySessionTracks) &&
      typeof EchoRadio.reRankQueueAfterSkip === 'function'
    ) {
      const curIdx = Math.max(0, state.autoplaySessionIndex || 0);
      const head = state.autoplaySessionTracks.slice(0, curIdx + 1);
      const tail = state.autoplaySessionTracks.slice(curIdx + 1);
      if (tail.length > 2) {
        const steeredRest = EchoRadio.reRankQueueAfterSkip(skippedSnapshot, tail.slice(1));
        const nextTail = [tail[0], ...steeredRest];
        state.autoplaySessionTracks = head.concat(nextTail);
        state.liveQueueTracks = nextTail;
        state.contextUpcomingTracks = nextTail;
      }
    }
  }

  if (bridge && bridge.notifyTrackLoading) {
    bridge.notifyTrackLoading('');
    state.pcmFlowing = false;
    state.currentTimeSec = 0;
  }

  if (state.isAutoplayQueue && Array.isArray(state.autoplaySessionTracks) && state.autoplaySessionTracks.length > 0) {
    const nextIdx = (typeof state.autoplaySessionIndex === 'number' && state.autoplaySessionIndex >= 0)
      ? state.autoplaySessionIndex + 1
      : 1;
    if (nextIdx < state.autoplaySessionTracks.length) {
      state.autoplaySessionIndex = nextIdx;
      const nextTrack = state.autoplaySessionTracks[nextIdx];
      const remaining = state.autoplaySessionTracks.slice(nextIdx + 1);
      state.sdkNextTracks = [];
      state.liveQueueTracks = remaining;
      state.contextUpcomingTracks = remaining;
      if (typeof recordAutoplayHistory === 'function') {
        recordAutoplayHistory(nextTrack.id || nextTrack.uri);
      }
      applyTrackToUI({
        id: nextTrack.id || nextTrack.uri || nextTrack.title,
        uri: nextTrack.uri,
        name: nextTrack.title,
        artist: nextTrack.artist,
        artists: nextTrack.artists,
        album: nextTrack.album,
        thumb: nextTrack.thumb || nextTrack.cover,
        cover: nextTrack.cover,
        coverLarge: nextTrack.cover,
        duration: nextTrack.duration || 210
      }, 0, true);
      if (remaining.length < 5 && typeof replenishAutoplayQueue === 'function') {
        replenishAutoplayQueue();
      }
      const forwardUris = [nextTrack.uri, ...remaining.slice(0, 19).map(t => t.uri)].filter(Boolean);
      if (forwardUris.length > 0) {
        await playSpotifyUris(forwardUris, remaining, { keepAutoplaySession: true });
      }
      return;
    }
  }

  // Usar cola completa reordenada si el usuario movió canciones; si no, fusionar sdkNextTracks (#1 real) con liveQueueTracks completos para no recortar la cola a 2 temas
  const usingLocalSdk = typeof isLocalWebPlayerActive === 'function' && isLocalWebPlayerActive();
  const wasCustomReordered = Boolean(state.hasCustomReorderedQueue);
  const wasLocalContext = Boolean(state.isLocalContextQueue);
  let queueSource = [];
  if ((wasCustomReordered || wasLocalContext) && Array.isArray(state.liveQueueTracks) && state.liveQueueTracks.length > 0) {
    queueSource = state.liveQueueTracks;
  } else if (Array.isArray(state.liveQueueTracks) && state.liveQueueTracks.length > 0) {
    if (usingLocalSdk && Array.isArray(state.sdkNextTracks) && state.sdkNextTracks.length > 0) {
      const seenKeys = new Set();
      for (const t of [...state.sdkNextTracks, ...state.liveQueueTracks]) {
        if (!t) continue;
        const key = cleanTrackId(t.id || t.uri) || (t.title || '').trim().toLowerCase();
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        queueSource.push(t);
      }
    } else {
      queueSource = state.liveQueueTracks;
    }
  } else if (usingLocalSdk && Array.isArray(state.sdkNextTracks) && state.sdkNextTracks.length > 0) {
    queueSource = state.sdkNextTracks;
  } else if (!spotifyAuth.shuffleState && Array.isArray(state.contextUpcomingTracks) && state.contextUpcomingTracks.length > 0) {
    queueSource = state.contextUpcomingTracks.map(normalizeApiTrack).filter(Boolean);
  }

  let pickedNextTrack = null;
  let pickedRemaining = [];
  if (queueSource.length > 0) {
    pickedNextTrack = queueSource[0];
    pickedRemaining = queueSource.slice(1);
    if (wasCustomReordered || wasLocalContext) {
      state.sdkNextTracks = [];
    } else if (Array.isArray(state.sdkNextTracks) && state.sdkNextTracks.length > 0) {
      state.sdkNextTracks = state.sdkNextTracks.slice(1);
    }
    state.liveQueueTracks = pickedRemaining;
    if (!spotifyAuth.shuffleState) {
      state.contextUpcomingTracks = pickedRemaining;
    }
    state.hasCustomReorderedQueue = false;
    if (typeof recordAutoplayHistory === 'function') {
      recordAutoplayHistory(pickedNextTrack.id || pickedNextTrack.uri);
    }
    pushCurrentTrackToHistory();
    applyTrackToUI({
      id: pickedNextTrack.id || pickedNextTrack.uri || pickedNextTrack.title,
      uri: pickedNextTrack.uri,
      name: pickedNextTrack.title,
      artist: pickedNextTrack.artist,
      artists: pickedNextTrack.artists,
      album: pickedNextTrack.album,
      thumb: pickedNextTrack.thumb || pickedNextTrack.cover,
      cover: pickedNextTrack.cover,
      coverLarge: pickedNextTrack.cover,
      duration: pickedNextTrack.duration || 210
    }, 0, true);
    if (state.nowPlayingMode === 'queue' && typeof renderQueuePanelUI === 'function') {
      renderQueuePanelUI();
    }
    if (state.isAutoplayQueue && pickedRemaining.length < 8 && typeof replenishAutoplayQueue === 'function') {
      replenishAutoplayQueue();
    }
    if ((wasCustomReordered || wasLocalContext) && pickedNextTrack.uri) {
      const nextUris = [pickedNextTrack.uri, ...pickedRemaining.slice(0, 19).map(t => t.uri)].filter(Boolean);
      if (nextUris.length > 0) {
        await playSpotifyUris(nextUris, pickedRemaining, {
          keepAutoplaySession: Boolean(state.isAutoplayQueue),
          keepLocalContext: wasLocalContext
        });
        return;
      }
    }
  } else if (Array.isArray(state.discoveryTracks) && state.discoveryTracks.length > 0) {
    const nextDiscovery = state.discoveryTracks[0];
    state.discoveryTracks = state.discoveryTracks.slice(1);
    if (nextDiscovery && nextDiscovery.uri) {
      applyTrackToUI({
        id: cleanTrackId(nextDiscovery.id || nextDiscovery.uri) || nextDiscovery.title,
        uri: nextDiscovery.uri,
        name: nextDiscovery.title,
        artist: nextDiscovery.artist,
        artists: nextDiscovery.artists,
        album: nextDiscovery.album,
        thumb: nextDiscovery.thumb || nextDiscovery.cover,
        cover: nextDiscovery.cover,
        coverLarge: nextDiscovery.cover,
        duration: nextDiscovery.duration || 0
      }, 0, true);
      await playSingleTrackWithAutoplay(nextDiscovery);
      return;
    }
  } else {
    lockUserPlaybackIntent('track_switch', {
      durationMs: 2800,
      targetIsPlaying: true
    });
  }

  const cmdSeq = playbackActionSeq;
  if (isLocalWebPlayerActive() && typeof webPlayer.nextTrack === 'function') {
    try {
      await webPlayer.nextTrack();
      return;
    } catch (e) {}
  }

  if (spotifyAuth.accessToken) {
    const devQ = await getTargetDeviceQuery();
    if (cmdSeq !== playbackActionSeq) return;
    const nextRes = await spotifyFetch(`/me/player/next${devQ}`, { method: 'POST' });
    if (nextRes && nextRes.error && state.isAutoplayQueue && pickedNextTrack && pickedNextTrack.uri) {
      const fallbackUris = [pickedNextTrack.uri, ...pickedRemaining.map(t => t.uri)].filter(Boolean);
      if (fallbackUris.length > 0) {
        await playSpotifyUris(fallbackUris, pickedRemaining, { keepAutoplaySession: true });
      }
    }
    setTimeout(() => {
      if (cmdSeq === playbackActionSeq) pollSpotifyCurrentPlayback();
    }, 650);
  }
}

async function restartCurrentTrackToZero() {
  // Restarting a song after listening >= 40% is a strong positive replay signal
  if (state.playingTrackId && typeof EchoRadio !== 'undefined' && typeof EchoRadio.recordPlaybackOutcome === 'function') {
    const curRadioEntry = (state.isAutoplayQueue && Array.isArray(state.autoplaySessionTracks) && state.autoplaySessionIndex >= 0)
      ? state.autoplaySessionTracks[state.autoplaySessionIndex]
      : null;
    EchoRadio.recordPlaybackOutcome({
      id: state.playingTrackId,
      uri: state.playingTrackUri,
      title: state.playingTrackTitle,
      artist: state.playingArtist,
      artists: state.playingArtists,
      duration: state.durationSec || 210,
      radioChannel: curRadioEntry ? curRadioEntry.radioChannel : null
    }, state.currentTimeSec || 0, state.durationSec || 210, 'replay');
  }
  state.currentTimeSec = 0;
  state.lastSeekToZeroAt = Date.now();
  lockUserPlaybackIntent('seek', {
    durationMs: 2200,
    targetSeekSec: 0,
    targetIsPlaying: state.isPlaying
  });
  if (npScrubberFill) {
    clearTimeout(scrubberResetTimer);
    npScrubberFill.classList.add('scrubber-resetting');
    scrubberResetTimer = setTimeout(() => {
      npScrubberFill.classList.remove('scrubber-resetting');
    }, 360);
  }
  if (bridge && bridge.notifyTrackSeeked) {
    bridge.notifyTrackSeeked(0);
  }
  if (typeof exitLyricsManualScroll === 'function') {
    exitLyricsManualScroll({ skipSnapBack: true });
  }
  updateScrubberAndLyricsUI(true);
  if (isLocalWebPlayerActive() && typeof webPlayer.seek === 'function') {
    try {
      await webPlayer.seek(0);
      return;
    } catch (err) { }
  }
  if (spotifyAuth.accessToken) {
    const devQ = await getTargetDeviceQuery();
    spotifyFetch(`/me/player/seek?position_ms=0${devQ ? '&' + devQ.slice(1) : ''}`, { method: 'PUT' });
  }
}

async function skipPrevTrack() {
  if (spotifyAuth.accessToken && state.currentTimeSec < 4) {
    if (state.isAutoplayQueue && Array.isArray(state.autoplaySessionTracks) && state.autoplaySessionIndex > 0) {
      if (bridge && bridge.notifyTrackLoading) {
        bridge.notifyTrackLoading('');
        state.pcmFlowing = false;
        state.currentTimeSec = 0;
      }
      const prevIdx = state.autoplaySessionIndex - 1;
      state.autoplaySessionIndex = prevIdx;
      const prevTrack = state.autoplaySessionTracks[prevIdx];
      const remaining = state.autoplaySessionTracks.slice(prevIdx + 1);
      state.sdkNextTracks = [];
      state.liveQueueTracks = remaining;
      state.contextUpcomingTracks = remaining;
      applyTrackToUI({
        id: prevTrack.id || prevTrack.uri || prevTrack.title,
        uri: prevTrack.uri,
        name: prevTrack.title,
        artist: prevTrack.artist,
        artists: prevTrack.artists,
        album: prevTrack.album,
        thumb: prevTrack.thumb || prevTrack.cover,
        cover: prevTrack.cover,
        coverLarge: prevTrack.cover,
        duration: prevTrack.duration || 210
      }, 0, true);
      if (state.nowPlayingMode === 'queue' && typeof renderQueuePanelUI === 'function') {
        renderQueuePanelUI();
      }
      const forwardUris = [prevTrack.uri, ...remaining.slice(0, 19).map(t => t.uri)].filter(Boolean);
      if (forwardUris.length > 0) {
        await playSpotifyUris(forwardUris, remaining, { keepAutoplaySession: true });
      }
      return;
    }

    if (state.isLocalContextQueue) {
      if (Array.isArray(state.playbackHistory) && state.playbackHistory.length > 0) {
        if (bridge && bridge.notifyTrackLoading) {
          bridge.notifyTrackLoading('');
          state.pcmFlowing = false;
          state.currentTimeSec = 0;
        }
        const prevTrack = state.playbackHistory.pop();
        const curSnap = getCurrentTrackSnapshot();
        const existingQueue = Array.isArray(state.liveQueueTracks) ? state.liveQueueTracks : [];
        if (curSnap) {
          const curCid = cleanTrackId(curSnap.id || curSnap.uri);
          const filteredTail = existingQueue.filter(t => {
            const tid = t ? cleanTrackId(t.id || t.uri) : '';
            return !curCid || tid !== curCid;
          });
          state.liveQueueTracks = [curSnap, ...filteredTail];
        } else {
          state.liveQueueTracks = existingQueue;
        }
        state.contextUpcomingTracks = [...state.liveQueueTracks];
        state.sdkNextTracks = [];
        state.hasCustomReorderedQueue = false;
        applyTrackToUI({
          id: prevTrack.id || prevTrack.uri || prevTrack.title,
          uri: prevTrack.uri,
          name: prevTrack.title,
          artist: prevTrack.artist,
          artists: prevTrack.artists,
          album: prevTrack.album,
          thumb: prevTrack.thumb || prevTrack.cover,
          cover: prevTrack.cover,
          coverLarge: prevTrack.cover,
          duration: prevTrack.duration || 210
        }, 0, true);
        if (state.nowPlayingMode === 'queue' && typeof renderQueuePanelUI === 'function') {
          renderQueuePanelUI();
        }
        const prevUris = [prevTrack.uri, ...state.liveQueueTracks.slice(0, 19).map(t => t.uri)].filter(Boolean);
        if (prevUris.length > 0) {
          await playSpotifyUris(prevUris, state.liveQueueTracks, { keepLocalContext: true });
        }
        return;
      }
      await restartCurrentTrackToZero();
      return;
    }

    if (bridge && bridge.notifyTrackLoading) {
      bridge.notifyTrackLoading('');
      state.pcmFlowing = false;
      state.currentTimeSec = 0;
    }
    const cmdSeq = lockUserPlaybackIntent('track_switch', {
      durationMs: 2800,
      targetIsPlaying: true
    });
    const isFastDoubleTapPrev = Boolean(state.lastSeekToZeroAt && (Date.now() - state.lastSeekToZeroAt) < 2500);
    if (isLocalWebPlayerActive() && typeof webPlayer.previousTrack === 'function' && !isFastDoubleTapPrev) {
      try {
        await webPlayer.previousTrack();
        return;
      } catch (e) {}
    }
    const devQ = await getTargetDeviceQuery();
    if (cmdSeq !== playbackActionSeq) return;
    await spotifyFetch(`/me/player/previous${devQ}`, { method: 'POST' });
    setTimeout(() => {
      if (cmdSeq === playbackActionSeq) pollSpotifyCurrentPlayback();
    }, 650);
  } else {
    await restartCurrentTrackToZero();
  }
}

bindTouchButton(miniPlayPauseBtn, () => {
  togglePlayPause();
});

bindTouchButton(miniNextBtn, () => {
  skipNextTrack();
});

if (miniLikeBtn) {
  bindTouchButton(miniLikeBtn, () => {
    if (!state.playingTrackId) return;
    toggleLikeTrack(state.playingTrackId, {
      title: state.playingTrackTitle,
      artist: state.playingTrackArtist,
      cover: state.playingCover
    });
  });
}

if (npCloseBtn) bindTouchButton(npCloseBtn, closeNowPlaying);
if (npGrabberZone) {
  bindTouchButton(npGrabberZone, (e) => {
    if (!state.isSwipingNowPlaying) closeNowPlaying();
  });
}
bindTouchButton(npPlayPauseBtn, togglePlayPause);
bindTouchButton(npNextBtn, skipNextTrack);
bindTouchButton(npPrevBtn, skipPrevTrack);

function shuffleTracksFisherYates(list) {
  const out = Array.isArray(list) ? [...list] : [];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const npShuffleBtn = document.getElementById('npShuffleBtn');
if (npShuffleBtn) {
  bindTouchButton(npShuffleBtn, async () => {
    const nextShuffle = !spotifyAuth.shuffleState;
    spotifyAuth.shuffleState = nextShuffle;
    state.shuffleToggleLockUntil = Date.now() + 2500;
    if (typeof triggerControlPop === 'function') triggerControlPop(npShuffleBtn);
    if (typeof updateShuffleButtonUI === 'function') updateShuffleButtonUI();

    // En modo Autoplay/Radio o contexto local (Tus me gusta / Artista), mezclar la cola al instante sin salir del contexto
    if ((state.isAutoplayQueue || state.isLocalContextQueue) && nextShuffle && Array.isArray(state.liveQueueTracks) && state.liveQueueTracks.length > 1) {
      const shuffled = shuffleTracksFisherYates(state.liveQueueTracks);
      state.liveQueueTracks = shuffled;
      state.contextUpcomingTracks = [...shuffled];
      if (state.isAutoplayQueue && Array.isArray(state.autoplaySessionTracks) && state.autoplaySessionTracks.length > 0) {
        const curIdx = Math.max(0, state.autoplaySessionIndex || 0);
        state.autoplaySessionTracks = state.autoplaySessionTracks.slice(0, curIdx + 1).concat(shuffled);
      }
      state.hasCustomReorderedQueue = true;
      if (typeof renderQueuePanelUI === 'function') renderQueuePanelUI();
      return;
    }

    if (state.isLocalContextQueue) {
      return;
    }

    const prevQueue = Array.isArray(state.liveQueueTracks) ? [...state.liveQueueTracks] : [];
    state.hasCustomReorderedQueue = false;
    state.sdkNextTracks = [];

    if (spotifyAuth.accessToken) {
      if (state.nowPlayingMode === 'queue' && prevQueue.length > 0 && typeof renderQueuePanelUI === 'function') {
        state.liveQueueTracks = [];
        state.queueLoading = true;
        renderQueuePanelUI();
      }
      const devQ = await getTargetDeviceQuery();
      const sep = devQ ? '&' : '?';
      const res = await spotifyFetch(`/me/player/shuffle${devQ}${sep}state=${nextShuffle ? 'true' : 'false'}`, { method: 'PUT' });
      if (res && res.error) {
        if (nextShuffle && prevQueue.length > 1) {
          const shuffled = shuffleTracksFisherYates(prevQueue);
          state.liveQueueTracks = shuffled;
          state.contextUpcomingTracks = [...shuffled];
          state.hasCustomReorderedQueue = true;
          state.queueLoading = false;
          if (typeof renderQueuePanelUI === 'function') renderQueuePanelUI();
          return;
        }
        spotifyAuth.shuffleState = !nextShuffle;
        state.shuffleToggleLockUntil = 0;
        state.liveQueueTracks = prevQueue;
        state.queueLoading = false;
        if (typeof updateShuffleButtonUI === 'function') updateShuffleButtonUI();
        if (typeof renderQueuePanelUI === 'function') renderQueuePanelUI();
        if (typeof showToast === 'function') showToast('Aleatorio no disponible en esta reproducción');
        return;
      }
      setTimeout(() => {
        if (typeof fetchAndRenderQueueForCurrentTrack === 'function') {
          fetchAndRenderQueueForCurrentTrack();
        }
      }, 450);
    }
  });
}

const npRepeatBtn = document.getElementById('npRepeatBtn');
if (npRepeatBtn) {
  bindTouchButton(npRepeatBtn, async () => {
    const current = spotifyAuth.repeatState || 'off';
    const nextState = current === 'off' ? 'context' : (current === 'context' ? 'track' : 'off');
    spotifyAuth.repeatState = nextState;
    state.repeatToggleLockUntil = Date.now() + 2500;
    if (typeof triggerControlPop === 'function') triggerControlPop(npRepeatBtn);
    if (typeof updateRepeatButtonUI === 'function') updateRepeatButtonUI();
    if (spotifyAuth.accessToken) {
      const devQ = await getTargetDeviceQuery();
      const sep = devQ ? '&' : '?';
      const res = await spotifyFetch(`/me/player/repeat${devQ}${sep}state=${nextState}`, { method: 'PUT' });
      if (res && res.error) {
        spotifyAuth.repeatState = current;
        state.repeatToggleLockUntil = 0;
        if (typeof updateRepeatButtonUI === 'function') updateRepeatButtonUI();
        if (typeof showToast === 'function') showToast('Repetición no disponible en esta reproducción');
        return;
      }
      if (state.nowPlayingMode === 'queue') {
        setTimeout(() => {
          if (typeof fetchAndRenderQueueForCurrentTrack === 'function') {
            fetchAndRenderQueueForCurrentTrack();
          }
        }, 450);
      }
    }
  });
}

// Click on Artist in Now Playing -> Open specific artist screen (handles multiple artists)
if (npTrackArtist) {
  npTrackArtist.addEventListener('click', (e) => {
    e.stopPropagation();
    const artistLink = e.target.closest('.np-artist-link');
    if (artistLink) {
      const idx = parseInt(artistLink.getAttribute('data-artist-index'), 10) || 0;
      const art = (state.playingArtists && state.playingArtists[idx]) ? state.playingArtists[idx] : null;
      const targetId = artistLink.getAttribute('data-artist-id') || (art ? art.id : null);
      const targetName = artistLink.getAttribute('data-artist-name') || (art ? art.name : null);
      navigateToArtist(targetId, targetName);
      return;
    }
    const first = (state.playingArtists && state.playingArtists[0]) ? state.playingArtists[0] : null;
    navigateToArtist(first ? first.id : state.playingArtistId, first ? first.name : state.playingArtist);
  });
}



if (npQueueCurrentArtist) {
  npQueueCurrentArtist.addEventListener('click', (e) => {
    e.stopPropagation();
    const artistLink = e.target.closest('.np-artist-link');
    if (artistLink) {
      const idx = parseInt(artistLink.getAttribute('data-artist-index'), 10) || 0;
      const art = (state.playingArtists && state.playingArtists[idx]) ? state.playingArtists[idx] : null;
      const targetId = artistLink.getAttribute('data-artist-id') || (art ? art.id : null);
      const targetName = artistLink.getAttribute('data-artist-name') || (art ? art.name : null);
      navigateToArtist(targetId, targetName);
      return;
    }
    const first = (state.playingArtists && state.playingArtists[0]) ? state.playingArtists[0] : null;
    navigateToArtist(first ? first.id : state.playingArtistId, first ? first.name : state.playingArtist);
  });
}

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
  if (state.isBuffering) return;
  const rect = npScrubberTrack.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  state.currentTimeSec = ratio * state.durationSec;
  const seekMs = Math.round(state.currentTimeSec * 1000);
  lockUserPlaybackIntent('seek', {
    durationMs: 2200,
    targetSeekSec: state.currentTimeSec,
    targetIsPlaying: state.isPlaying
  });
  if (bridge && bridge.notifyTrackSeeked) {
    bridge.notifyTrackSeeked(seekMs);
  }
  if (typeof exitLyricsManualScroll === 'function') {
    exitLyricsManualScroll({ skipSnapBack: true });
  }
  updateScrubberAndLyricsUI(true);
  if (isLocalWebPlayerActive() && typeof webPlayer.seek === 'function') {
    try { webPlayer.seek(seekMs); } catch (err) { }
  }
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
    libSortPill.innerHTML = `${liveCatalog.sortAlphabetical ? 'Alphabetical A–Z' : 'Recently added'} <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
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

// Live Spotify Catalog Search Input & Two-State UI
let searchDebounce = null;
let searchReqSeq = 0;
let activeSearchFilter = 'all';
let lastSearchPayload = null;

function saveRecentSearchItem(entry) {
  if (!entry || !entry.label) return;
  try {
    const key = typeof RECENT_SEARCHES_STORAGE_KEY === 'string' ? RECENT_SEARCHES_STORAGE_KEY : 'sp_recent_searches_v1';
    const current = Array.isArray(liveCatalog.recentSearches) ? [...liveCatalog.recentSearches] : [];
    const entryId = entry.entityId || entry.playUri || entry.query || entry.label;
    const filtered = current.filter(item => {
      if (!item) return false;
      const itemId = item.entityId || item.playUri || item.query || item.label;
      return itemId !== entryId && (item.label || '').toLowerCase() !== entry.label.toLowerCase();
    });
    const nextList = [entry, ...filtered].slice(0, 8);
    liveCatalog.recentSearches = nextList;
    safeStorage.setItem(key, JSON.stringify(nextList));
  } catch (e) {}
}

function buildSearchLoadingSkeletonHTML() {
  const rowWidths = [
    ['56%', '34%'],
    ['68%', '42%'],
    ['48%', '30%'],
    ['62%', '38%']
  ];
  const rowsHtml = rowWidths.map(([tw, aw]) => `
    <div class="search-skeleton-track-row">
      <div class="search-skeleton-thumb skeleton-shimmer"></div>
      <div class="search-skeleton-meta">
        <div class="search-skeleton-line skeleton-shimmer" style="width: ${tw};"></div>
        <div class="search-skeleton-line-sm skeleton-shimmer" style="width: ${aw};"></div>
      </div>
      <div class="search-skeleton-dur skeleton-shimmer"></div>
    </div>
  `).join('');

  return `
    <div class="search-top-grid">
      <div>
        <div class="search-skeleton-heading skeleton-shimmer" style="width: 150px;"></div>
        <div class="search-top-result-card search-skeleton-card" aria-hidden="true">
          <div class="search-top-art skeleton-shimmer"></div>
          <div>
            <div class="search-skeleton-top-title skeleton-shimmer"></div>
            <div class="search-skeleton-top-sub skeleton-shimmer"></div>
          </div>
        </div>
      </div>
      <div>
        <div class="search-skeleton-heading skeleton-shimmer" style="width: 110px;"></div>
        <div class="search-tracks-list">${rowsHtml}</div>
      </div>
    </div>
    <div class="search-section">
      <div class="search-skeleton-heading skeleton-shimmer" style="width: 110px;"></div>
      <div class="grid-4-cols">${buildSkeletonCardsHTML(4, true)}</div>
    </div>
  `;
}

function formatTrackDurShort(ms) {
  if (!ms || ms <= 0) return '';
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function buildSearchTrackRowHTML(t) {
  const imgs = (t.album && Array.isArray(t.album.images)) ? t.album.images : [];
  const thumbImg = imgs.length > 0 ? getSpotifyImage(imgs, 'small') : DEFAULT_ALBUM_COVER;
  const coverImg = imgs.length > 0 ? getSpotifyImage(imgs, 'large') : thumbImg;
  const artistStr = Array.isArray(t.artists) ? t.artists.map(a => a.name).join(', ') : '';
  const durSec = t.duration_ms ? Math.round(t.duration_ms / 1000) : '';
  const isLiked = t.id ? liveCatalog.likedTrackIds.has(t.id) : false;
  const safeTitle = (t.name || '').replace(/"/g, '&quot;');
  const safeArtist = artistStr.replace(/"/g, '&quot;');
  return `
    <div class="search-track-row"
         data-play-direct-uri="${t.uri}"
         data-search-save="1"
         data-search-type="track"
         data-search-label="${safeTitle}"
         data-search-sub="${safeArtist}"
         data-search-avatar="${thumbImg}"
         data-search-square="1"
         data-title="${safeTitle}"
         data-artist="${safeArtist}"
         data-cover="${coverImg}"
         data-thumb="${thumbImg}"
         data-duration="${durSec}">
      ${renderOptImg(thumbImg, safeTitle, 'search-track-thumb')}
      <div class="search-track-meta">
        <div class="search-track-title">${t.name}</div>
        <div class="search-track-artist">${artistStr}</div>
      </div>
      <span class="search-track-dur">${formatTrackDurShort(t.duration_ms)}</span>
      <button type="button" class="track-row-like-btn ${isLiked ? 'liked' : ''}" data-track-id="${t.id || ''}" data-track-title="${safeTitle}" data-track-artist="${safeArtist}" data-track-cover="${coverImg}" title="${isLiked ? 'Eliminar de Tus me gusta' : 'Guardar en Tus me gusta'}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="${isLiked ? '#1ed760' : 'none'}" stroke="${isLiked ? '#1ed760' : 'currentColor'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
        </svg>
      </button>
    </div>
  `;
}

function buildSearchArtistCardHTML(ar, extraCls = '') {
  const entityId = `art_${ar.id}`;
  const avatar = (ar.images && ar.images.length > 0) ? (getSpotifyImage(ar.images, 'medium') || DEFAULT_SPOTIFY_COVER) : DEFAULT_SPOTIFY_COVER;
  const avatarLarge = (ar.images && ar.images.length > 0) ? (getSpotifyImage(ar.images, 'large') || avatar) : avatar;
  if (!liveCatalog.entities[entityId]) {
    liveCatalog.entities[entityId] = {
      id: entityId,
      spotifyId: ar.id,
      type: 'artist',
      uri: ar.uri,
      title: ar.name,
      name: ar.name,
      cover: avatar,
      coverLarge: avatarLarge,
      tracks: null
    };
  }
  const safeName = (ar.name || '').replace(/"/g, '&quot;');
  return `
    <div class="search-artist-card ${extraCls}"
         data-open-entity="${entityId}"
         data-search-save="1"
         data-search-type="artist"
         data-search-spotify-id="${ar.id}"
         data-search-uri="${ar.uri || ''}"
         data-search-label="${safeName}"
         data-search-sub="Artista"
         data-search-avatar="${avatar}"
         data-search-square="0">
      <div class="search-artist-avatar-wrap">
        ${renderOptImg(avatar, safeName, 'search-artist-avatar')}
      </div>
      <div class="media-card-title">${ar.name}</div>
      <div class="media-card-subtitle">Artista</div>
    </div>
  `;
}

function buildSearchAlbumCardHTML(al, extraCls = '') {
  const entityId = `alb_${al.id}`;
  const cover = (al.images && al.images.length > 0) ? getSpotifyImage(al.images, 'medium') : DEFAULT_ALBUM_COVER;
  const coverLarge = (al.images && al.images.length > 0) ? getSpotifyImage(al.images, 'large') : cover;
  const artistName = al.artists ? al.artists.map(x => x.name).join(', ') : '';
  const year = (al.release_date || '').slice(0, 4);
  if (!liveCatalog.entities[entityId]) {
    liveCatalog.entities[entityId] = {
      id: entityId,
      spotifyId: al.id,
      type: 'album',
      uri: al.uri,
      title: al.name,
      artist: artistName,
      meta: `Álbum • ${year}`,
      cover,
      coverLarge,
      tracks: null
    };
  }
  const safeTitle = (al.name || '').replace(/"/g, '&quot;');
  const safeSub = (year ? `${year} • ${artistName}` : artistName).replace(/"/g, '&quot;');
  return `
    <div class="media-card ${extraCls}"
         data-open-entity="${entityId}"
         data-search-save="1"
         data-search-type="album"
         data-search-spotify-id="${al.id}"
         data-search-uri="${al.uri || ''}"
         data-search-label="${safeTitle}"
         data-search-sub="${artistName.replace(/"/g, '&quot;')}"
         data-search-avatar="${cover}"
         data-search-square="1">
      <div class="media-card-cover-wrap">
        ${renderOptImg(cover, safeTitle, 'media-card-cover')}
      </div>
      <div class="media-card-title">${al.name}</div>
      <div class="media-card-subtitle">${safeSub}</div>
    </div>
  `;
}

function buildSearchPlaylistCardHTML(pl, extraCls = '') {
  const entityId = `pl_${pl.id}`;
  const cover = (pl.images && pl.images.length > 0) ? getSpotifyImage(pl.images, 'medium') : DEFAULT_PLAYLIST_COVER;
  const coverLarge = (pl.images && pl.images.length > 0) ? getSpotifyImage(pl.images, 'large') : cover;
  const ownerName = (pl.owner && pl.owner.display_name) ? pl.owner.display_name : 'Spotify';
  if (!liveCatalog.entities[entityId]) {
    liveCatalog.entities[entityId] = {
      id: entityId,
      spotifyId: pl.id,
      type: 'playlist',
      uri: pl.uri,
      title: pl.name,
      artist: `De ${ownerName}`,
      meta: `Playlist • ${ownerName}`,
      cover,
      coverLarge,
      tracks: null
    };
  }
  const safeTitle = (pl.name || '').replace(/"/g, '&quot;');
  const safeOwner = ownerName.replace(/"/g, '&quot;');
  return `
    <div class="media-card ${extraCls}"
         data-open-entity="${entityId}"
         data-search-save="1"
         data-search-type="playlist"
         data-search-spotify-id="${pl.id}"
         data-search-uri="${pl.uri || ''}"
         data-search-label="${safeTitle}"
         data-search-sub="De ${safeOwner}"
         data-search-avatar="${cover}"
         data-search-square="1">
      <div class="media-card-cover-wrap">
        ${renderOptImg(cover, safeTitle, 'media-card-cover')}
      </div>
      <div class="media-card-title">${pl.name}</div>
      <div class="media-card-subtitle">De ${ownerName}</div>
    </div>
  `;
}

function buildTopResultCardHTML(query, tracks, artists, albums, playlists) {
  const qLow = (query || '').trim().toLowerCase();
  const topArtist = artists[0] || null;
  const topTrack = tracks[0] || null;
  const topAlbum = albums[0] || null;
  const topPlaylist = playlists[0] || null;

  const artistNameLow = (topArtist && topArtist.name ? topArtist.name.toLowerCase() : '');
  const artistStrongMatch = Boolean(topArtist && (artistNameLow === qLow || (qLow.length >= 3 && artistNameLow.startsWith(qLow))));

  const playSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-left:2px;"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>`;

  if (artistStrongMatch || (!topTrack && topArtist)) {
    const entityId = `art_${topArtist.id}`;
    const avatar = (topArtist.images && topArtist.images.length > 0) ? (getSpotifyImage(topArtist.images, 'medium') || DEFAULT_SPOTIFY_COVER) : DEFAULT_SPOTIFY_COVER;
    const avatarLarge = (topArtist.images && topArtist.images.length > 0) ? (getSpotifyImage(topArtist.images, 'large') || avatar) : avatar;
    if (!liveCatalog.entities[entityId]) {
      liveCatalog.entities[entityId] = {
        id: entityId,
        spotifyId: topArtist.id,
        type: 'artist',
        uri: topArtist.uri,
        title: topArtist.name,
        name: topArtist.name,
        cover: avatar,
        coverLarge: avatarLarge,
        tracks: null
      };
    }
    const safeName = (topArtist.name || '').replace(/"/g, '&quot;');
    const artistPlayUri = topTrack ? topTrack.uri : '';
    const playBtnHtml = artistPlayUri
      ? `<button type="button" class="search-top-play-btn" data-play-direct-uri="${artistPlayUri}" data-title="${(topTrack.name || '').replace(/"/g, '&quot;')}" data-artist="${(topTrack.artists ? topTrack.artists.map(a => a.name).join(', ') : safeName).replace(/"/g, '&quot;')}" data-cover="${avatarLarge}" data-thumb="${avatar}" aria-label="Reproducir">${playSvg}</button>`
      : '';
    return `
      <div class="search-top-result-card"
           data-open-entity="${entityId}"
           data-search-save="1"
           data-search-type="artist"
           data-search-spotify-id="${topArtist.id}"
           data-search-uri="${topArtist.uri || ''}"
           data-search-label="${safeName}"
           data-search-sub="Artista"
           data-search-avatar="${avatar}"
           data-search-square="0">
        ${renderOptImg(avatar, safeName, 'search-top-art is-artist')}
        <div>
          <div class="search-top-title">${topArtist.name}</div>
          <div class="search-top-meta"><span class="search-type-badge">Artista</span></div>
        </div>
        ${playBtnHtml}
      </div>
    `;
  }

  if (topTrack) {
    const imgs = (topTrack.album && Array.isArray(topTrack.album.images)) ? topTrack.album.images : [];
    const thumbImg = imgs.length > 0 ? getSpotifyImage(imgs, 'medium') : DEFAULT_ALBUM_COVER;
    const coverImg = imgs.length > 0 ? getSpotifyImage(imgs, 'large') : thumbImg;
    const artistStr = Array.isArray(topTrack.artists) ? topTrack.artists.map(a => a.name).join(', ') : '';
    const durSec = topTrack.duration_ms ? Math.round(topTrack.duration_ms / 1000) : '';
    const safeTitle = (topTrack.name || '').replace(/"/g, '&quot;');
    const safeArtist = artistStr.replace(/"/g, '&quot;');
    return `
      <div class="search-top-result-card"
           data-play-direct-uri="${topTrack.uri}"
           data-search-save="1"
           data-search-type="track"
           data-search-label="${safeTitle}"
           data-search-sub="${safeArtist}"
           data-search-avatar="${thumbImg}"
           data-search-square="1"
           data-title="${safeTitle}"
           data-artist="${safeArtist}"
           data-cover="${coverImg}"
           data-thumb="${thumbImg}"
           data-duration="${durSec}">
        ${renderOptImg(thumbImg, safeTitle, 'search-top-art')}
        <div>
          <div class="search-top-title">${topTrack.name}</div>
          <div class="search-top-meta">
            <span class="search-type-badge">Canción</span>
            <span class="search-top-sub">${artistStr}</span>
          </div>
        </div>
        <button type="button" class="search-top-play-btn" aria-label="Reproducir">${playSvg}</button>
      </div>
    `;
  }

  const fallback = topAlbum || topPlaylist;
  if (!fallback) return '';
  const isAlb = Boolean(topAlbum);
  const entityId = isAlb ? `alb_${fallback.id}` : `pl_${fallback.id}`;
  const cover = (fallback.images && fallback.images.length > 0) ? getSpotifyImage(fallback.images, 'medium') : DEFAULT_ALBUM_COVER;
  const coverLarge = (fallback.images && fallback.images.length > 0) ? getSpotifyImage(fallback.images, 'large') : cover;
  const sub = isAlb
    ? (fallback.artists ? fallback.artists.map(x => x.name).join(', ') : '')
    : ((fallback.owner && fallback.owner.display_name) || 'Spotify');
  if (!liveCatalog.entities[entityId]) {
    liveCatalog.entities[entityId] = {
      id: entityId,
      spotifyId: fallback.id,
      type: isAlb ? 'album' : 'playlist',
      uri: fallback.uri,
      title: fallback.name,
      artist: sub,
      meta: `${isAlb ? 'Álbum' : 'Playlist'} • ${sub}`,
      cover,
      coverLarge,
      tracks: null
    };
  }
  const safeTitle = (fallback.name || '').replace(/"/g, '&quot;');
  return `
    <div class="search-top-result-card"
         data-open-entity="${entityId}"
         data-search-save="1"
         data-search-type="${isAlb ? 'album' : 'playlist'}"
         data-search-spotify-id="${fallback.id}"
         data-search-uri="${fallback.uri || ''}"
         data-search-label="${safeTitle}"
         data-search-sub="${sub.replace(/"/g, '&quot;')}"
         data-search-avatar="${cover}"
         data-search-square="1">
      ${renderOptImg(cover, safeTitle, 'search-top-art')}
      <div>
        <div class="search-top-title">${fallback.name}</div>
        <div class="search-top-meta">
          <span class="search-type-badge">${isAlb ? 'Álbum' : 'Playlist'}</span>
          <span class="search-top-sub">${sub}</span>
        </div>
      </div>
      <button type="button" class="search-top-play-btn" data-play-direct-uri="${fallback.uri}" data-title="${safeTitle}" data-artist="${sub.replace(/"/g, '&quot;')}" data-cover="${coverLarge}" data-thumb="${cover}" aria-label="Reproducir">${playSvg}</button>
    </div>
  `;
}

function renderSearchResults(payload, filter = 'all') {
  const container = document.getElementById('searchResultsContainer');
  if (!container || !payload) return;

  const { query, tracks, artists, albums, playlists } = payload;
  const hasAny = tracks.length > 0 || artists.length > 0 || albums.length > 0 || playlists.length > 0;
  if (!hasAny) {
    container.innerHTML = `<div class="search-empty-state">No se encontraron resultados para «${escapeHtml(query)}»</div>`;
    return;
  }

  let html = '';

  if (filter === 'all') {
    const topCardHtml = buildTopResultCardHTML(query, tracks, artists, albums, playlists);
    const songsHtml = tracks.slice(0, 5).map(buildSearchTrackRowHTML).join('');
    if (topCardHtml || songsHtml) {
      html += `
        <div class="search-top-grid">
          ${topCardHtml ? `<div><h3 class="search-sub-heading">Mejor resultado</h3>${topCardHtml}</div>` : ''}
          ${songsHtml ? `<div><h3 class="search-sub-heading">Canciones</h3><div class="search-tracks-list">${songsHtml}</div></div>` : ''}
        </div>
      `;
    }
    if (artists.length > 0) {
      html += `
        <div class="search-section">
          <h3 class="search-sub-heading">Artistas</h3>
          <div class="search-cards-rail">${artists.slice(0, 8).map(a => buildSearchArtistCardHTML(a)).join('')}</div>
        </div>
      `;
    }
    if (albums.length > 0) {
      html += `
        <div class="search-section">
          <h3 class="search-sub-heading">Álbumes</h3>
          <div class="search-cards-rail">${albums.slice(0, 8).map(al => buildSearchAlbumCardHTML(al, 'search-rail-card')).join('')}</div>
        </div>
      `;
    }
    if (playlists.length > 0) {
      html += `
        <div class="search-section" style="margin-bottom:0;">
          <h3 class="search-sub-heading">Playlists</h3>
          <div class="search-cards-rail">${playlists.slice(0, 8).map(pl => buildSearchPlaylistCardHTML(pl, 'search-rail-card')).join('')}</div>
        </div>
      `;
    }
  } else if (filter === 'tracks') {
    html = tracks.length > 0
      ? `<div class="search-tracks-list">${tracks.slice(0, 10).map(buildSearchTrackRowHTML).join('')}</div>`
      : `<div class="search-empty-state">No se encontraron canciones</div>`;
  } else if (filter === 'artists') {
    html = artists.length > 0
      ? `<div class="search-cards-rail" style="flex-wrap:wrap;">${artists.slice(0, 10).map(a => buildSearchArtistCardHTML(a)).join('')}</div>`
      : `<div class="search-empty-state">No se encontraron artistas</div>`;
  } else if (filter === 'albums') {
    html = albums.length > 0
      ? `<div class="grid-4-cols">${albums.slice(0, 8).map(al => buildSearchAlbumCardHTML(al)).join('')}</div>`
      : `<div class="search-empty-state">No se encontraron álbumes</div>`;
  } else if (filter === 'playlists') {
    html = playlists.length > 0
      ? `<div class="grid-4-cols">${playlists.slice(0, 8).map(pl => buildSearchPlaylistCardHTML(pl)).join('')}</div>`
      : `<div class="search-empty-state">No se encontraron playlists</div>`;
  }

  container.innerHTML = html;
  hydrateImages(container);
  if (tracks.length > 0 && typeof checkAndCacheLikedTracks === 'function') {
    checkAndCacheLikedTracks(tracks);
  }
}

function setSearchViewMode(isResults) {
  const browseEl = document.getElementById('searchBrowseState');
  const resultsEl = document.getElementById('searchResultsState');
  const clearBtn = document.getElementById('searchClearBtn');
  if (browseEl) browseEl.classList.toggle('hidden', isResults);
  if (resultsEl) resultsEl.classList.toggle('hidden', !isResults);
  if (clearBtn) clearBtn.classList.toggle('hidden', !isResults);
}

const searchInputEl = document.getElementById('searchInput');
if (searchInputEl) {
  searchInputEl.addEventListener('input', (e) => {
    const q = (e.target.value || '').trim();
    clearTimeout(searchDebounce);
    if (!q) {
      searchReqSeq++;
      lastSearchPayload = null;
      setSearchViewMode(false);
      renderSearch();
      return;
    }

    setSearchViewMode(true);
    const resultsContainer = document.getElementById('searchResultsContainer');
    if (resultsContainer) {
      resultsContainer.innerHTML = buildSearchLoadingSkeletonHTML();
    }

    const reqSeq = ++searchReqSeq;
    searchDebounce = setTimeout(async () => {
      const res = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track,album,artist,playlist&limit=10`);
      if (!res || reqSeq !== searchReqSeq) return;

      const rawTracks = (res.tracks && Array.isArray(res.tracks.items)) ? res.tracks.items.filter(t => t && t.uri && !t.uri.startsWith('spotify:local:')) : [];
      const dedupTracks = [];
      const seenTracks = new Set();
      for (const t of rawTracks) {
        const primaryArtist = (Array.isArray(t.artists) && t.artists[0] && t.artists[0].name) ? t.artists[0].name : '';
        const key = `${(t.name || '').trim().toLowerCase()}|${primaryArtist.trim().toLowerCase()}`;
        if (seenTracks.has(key)) continue;
        seenTracks.add(key);
        dedupTracks.push(t);
      }

      lastSearchPayload = {
        query: q,
        tracks: dedupTracks,
        artists: (res.artists && Array.isArray(res.artists.items)) ? res.artists.items.filter(Boolean) : [],
        albums: (res.albums && Array.isArray(res.albums.items)) ? res.albums.items.filter(Boolean) : [],
        playlists: (res.playlists && Array.isArray(res.playlists.items)) ? res.playlists.items.filter(Boolean) : []
      };
      renderSearchResults(lastSearchPayload, activeSearchFilter);
    }, 300);
  });
}

const searchClearBtnEl = document.getElementById('searchClearBtn');
if (searchClearBtnEl) {
  searchClearBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    searchReqSeq++;
    clearTimeout(searchDebounce);
    lastSearchPayload = null;
    activeSearchFilter = 'all';
    document.querySelectorAll('#searchFilterPills .search-filter-pill').forEach(p => {
      p.classList.toggle('active', p.getAttribute('data-search-filter') === 'all');
    });
    if (searchInputEl) {
      searchInputEl.value = '';
      if (typeof searchInputEl.focus === 'function') searchInputEl.focus();
    }
    setSearchViewMode(false);
    renderSearch();
  });
}

const searchFilterPillsEl = document.getElementById('searchFilterPills');
if (searchFilterPillsEl) {
  searchFilterPillsEl.querySelectorAll('.search-filter-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextFilter = pill.getAttribute('data-search-filter') || 'all';
      activeSearchFilter = nextFilter;
      searchFilterPillsEl.querySelectorAll('.search-filter-pill').forEach(p => p.classList.toggle('active', p === pill));
      if (lastSearchPayload) {
        renderSearchResults(lastSearchPayload, activeSearchFilter);
      }
    });
  });
}

const searchResultsContainerEl = document.getElementById('searchResultsContainer');
if (searchResultsContainerEl) {
  searchResultsContainerEl.addEventListener('click', (e) => {
    if (e.target.closest('.track-row-like-btn')) return;
    const item = e.target.closest('[data-search-save="1"]');
    if (!item) return;
    const type = item.getAttribute('data-search-type') || '';
    const label = item.getAttribute('data-search-label') || '';
    const sub = item.getAttribute('data-search-sub') || '';
    const avatar = item.getAttribute('data-search-avatar') || '';
    const square = item.getAttribute('data-search-square') === '1';
    const entityId = item.getAttribute('data-open-entity') || '';
    const playUri = item.getAttribute('data-play-direct-uri') || '';
    const spotifyId = item.getAttribute('data-search-spotify-id') || '';
    const uri = item.getAttribute('data-search-uri') || '';
    saveRecentSearchItem({
      label,
      subtitle: sub,
      avatar,
      square,
      type,
      entityId: entityId || undefined,
      playUri: playUri || undefined,
      spotifyId: spotifyId || undefined,
      uri: uri || undefined,
      query: label
    });
  });
}

// Clear Recent Searches
const clearRecentBtnEl = document.getElementById('clearRecentBtn');
if (clearRecentBtnEl) {
  clearRecentBtnEl.addEventListener('click', () => {
    liveCatalog.recentSearches = [];
    const key = typeof RECENT_SEARCHES_STORAGE_KEY === 'string' ? RECENT_SEARCHES_STORAGE_KEY : 'sp_recent_searches_v1';
    safeStorage.setItem(key, JSON.stringify([]));
    if (searchInputEl) searchInputEl.value = '';
    setSearchViewMode(false);
    renderSearch();
  });
}

// Profile Modal Controls
document.querySelectorAll('.profile-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    syncFullscreenSwitchUI();
    if (typeof syncLyricsModeUI === 'function') syncLyricsModeUI();
    spotifyModal.classList.add('open');
  });
});

const closeSpotifyModalBtn = document.getElementById('closeSpotifyModalBtn');
if (closeSpotifyModalBtn) {
  closeSpotifyModalBtn.addEventListener('click', () => {
    spotifyModal.classList.remove('open');
  });
}
if (spotifyModal) {
  spotifyModal.addEventListener('click', (e) => {
    if (e.target === spotifyModal) {
      spotifyModal.classList.remove('open');
    }
  });
}

// Devices Modal Controls (Spotify Connect - Solo debajo del reproductor)
const npDevRow = document.getElementById('npDeviceIndicatorRow');
if (npDevRow) {
  npDevRow.addEventListener('click', (e) => {
    e.stopPropagation();
    openDevicesModal();
  });
}
const closeDevBtn = document.getElementById('closeDevicesModalBtn');
if (closeDevBtn) {
  closeDevBtn.addEventListener('click', () => {
    closeDevicesModal();
  });
}
const devModalEl = document.getElementById('devicesModal');
if (devModalEl) {
  devModalEl.addEventListener('click', (e) => {
    if (e.target === devModalEl) {
      closeDevicesModal();
    }
  });
}

// --------------------------------------------------------------------------
// THEME CONTROLLER (Auto Day/Night, Light, Dark)
// --------------------------------------------------------------------------
const THEME_STORAGE_KEY = 'echo_theme_mode';
let currentThemeMode = safeStorage.getItem(THEME_STORAGE_KEY) || 'auto';
let autoThemeTimer = null;

function isNightTime() {
  const hour = new Date().getHours();
  // Night is from 19:00 (7 PM) to 06:59 (7 AM)
  return hour >= 19 || hour < 7;
}

function applyTheme(mode, updateUI = true) {
  currentThemeMode = mode;
  safeStorage.setItem(THEME_STORAGE_KEY, mode);

  let isDark = false;
  if (mode === 'dark') {
    isDark = true;
  } else if (mode === 'light') {
    isDark = false;
  } else {
    // 'auto' mode: follow local time of day strictly (07:00–18:59 light, 19:00–06:59 dark)
    isDark = isNightTime();
  }

  if (isDark) {
    document.body.classList.add('theme-dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.body.classList.remove('theme-dark');
    document.documentElement.setAttribute('data-theme', 'light');
  }
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme && metaTheme.setAttribute) {
    metaTheme.setAttribute('content', isDark ? '#0f1013' : '#efe6d8');
  }

  if (state.activeScreen === 'album') {
    if (state.selectedEntityId === 'liked_songs' || (liveCatalog.entities[state.selectedEntityId] && liveCatalog.entities[state.selectedEntityId].type === 'liked')) {
      applyNeutralLikedTheme();
    } else {
      const currentEntity = liveCatalog.entities[state.selectedEntityId];
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
        const shouldBeDark = isNightTime();
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

// Initialize theme on load
applyTheme(currentThemeMode, true);

const transferPlaybackBtn = document.getElementById('transferPlaybackHereBtn');
if (transferPlaybackBtn) {
  transferPlaybackBtn.addEventListener('click', async () => {
    const devRes = await spotifyFetch('/me/player/devices');
    const devices = (devRes && Array.isArray(devRes.devices)) ? devRes.devices : [];
    const echoId = await findEngineDeviceId();
    const safeFallbackDev = devices.find(d => typeof isAutoFallbackForbiddenDevice !== 'function' || !isAutoFallbackForbiddenDevice(d));
    const target = webPlayerDeviceId || echoId || (safeFallbackDev && safeFallbackDev.id) || '';
    if (!target) {
      if (typeof showToast === 'function') {
        showToast('SpotiEcho Web Player aún no está listo en este dispositivo');
      }
      return;
    }
    state.userSelectedDeviceId = target;
    const ok = await transferPlaybackToDevice(target, true);
    if (ok && spotifyStatusText) {
      spotifyStatusText.textContent = `Reproduciendo en: ${target === webPlayerDeviceId ? 'SpotiEcho Web Player' : (echoId ? 'Echo Show 8 (Nativo)' : (safeFallbackDev ? safeFallbackDev.name : 'SpotiEcho'))}`;
    }
  });
}

// Responsive Viewport Scaling (1024x640 logical canvas = 1.25x @ ~200 DPI on Echo Show 8 3rd Gen)
function fitViewport() {
  const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
  const vh = window.innerHeight || document.documentElement.clientHeight || 640;
  if (vw <= 10 || vh <= 10) return;
  const scale = Math.min(vw / 1024, vh / 640);
  if (!isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 0.02) {
    window._echoViewportScale = 1;
    echoViewport.style.transform = 'none';
    echoViewport.style.width = '100vw';
    echoViewport.style.height = '100vh';
  } else {
    window._echoViewportScale = scale;
    echoViewport.style.transform = `scale(${scale})`;
    echoViewport.style.width = `${Math.ceil(vw / scale)}px`;
    echoViewport.style.height = `${Math.ceil(vh / scale)}px`;
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

