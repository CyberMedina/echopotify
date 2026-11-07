/* ==========================================================================
   CONTROLLER: UI Touch/Click Event Listeners, Search Input, Theme & Viewport
   ========================================================================== */
'use strict';


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
    const thumb = directPlay.getAttribute('data-thumb') || cover;
    state.singleTrackPlayback = !uri.startsWith('spotify:playlist:') && !uri.startsWith('spotify:album:');
    state.contextUpcomingTracks = [];
    applyTrackToUI({ id: uri, uri, name: title, artist, thumb, cover, coverLarge: cover, duration_ms: 210000 }, 0, true);
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
    const trackUri = trackRow.getAttribute('data-track-uri');
    const title = trackRow.getAttribute('data-track-title');
    const artist = trackRow.getAttribute('data-track-artist');
    const album = trackRow.getAttribute('data-track-album');
    const cover = trackRow.getAttribute('data-track-cover');
    const thumb = trackRow.getAttribute('data-track-thumb') || cover;
    const duration = parseInt(trackRow.getAttribute('data-track-duration'), 10) || 210;

    const entity = liveCatalog.entities[entityId];
    const upcomingSlice = (entity && Array.isArray(entity.tracks)) ? entity.tracks.slice(idx + 1) : [];
    state.singleTrackPlayback = false;
    state.contextUpcomingTracks = upcomingSlice;
    applyTrackToUI({ id: trackUri || title, uri: trackUri, name: title, artist, album, thumb, cover, coverLarge: cover, duration }, 0, true);
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
    const thumb = queueRow.getAttribute('data-track-thumb') || cover;
    const duration = parseInt(queueRow.getAttribute('data-track-duration'), 10) || 210;

    if (qSource === 'queue' && state.liveQueueTracks.length > qIdx) {
      const remaining = state.liveQueueTracks.slice(qIdx + 1);
      state.singleTrackPlayback = false;
      state.contextUpcomingTracks = remaining;
      applyTrackToUI({ id: trackId || trackUri || title, uri: trackUri, name: title, artist, album, thumb, cover, coverLarge: cover, duration }, 0, true);
      const uris = [trackUri, ...remaining.map(t => t.uri)].filter(Boolean);
      if (uris.length > 0) playSpotifyUris(uris, remaining);
    } else {
      state.singleTrackPlayback = true;
      state.contextUpcomingTracks = [];
      applyTrackToUI({ id: trackId || trackUri || title, uri: trackUri, name: title, artist, album, thumb, cover, coverLarge: cover, duration }, 0, true);
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
    lockUserPlaybackIntent('seek', {
      durationMs: 2200,
      targetSeekSec: startSec,
      targetIsPlaying: state.isPlaying
    });
    if (bridge && bridge.notifyTrackSeeked) {
      bridge.notifyTrackSeeked(seekMs);
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

// Back Button in Album View
const albumBackBtn = document.getElementById('albumBackBtn');
if (albumBackBtn) {
  albumBackBtn.addEventListener('click', (e) => {
    e.stopPropagation();
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

// Album "Play" Pill Button
document.getElementById('albumPlayAllBtn').addEventListener('click', () => {
  const entity = liveCatalog.entities[state.selectedEntityId];
  if (!entity) return;
  const upcomingSlice = (entity && Array.isArray(entity.tracks)) ? entity.tracks.slice(1) : [];
  state.singleTrackPlayback = false;
  state.contextUpcomingTracks = upcomingSlice;
  if (entity.tracks && entity.tracks[0]) {
    const t = entity.tracks[0];
    applyTrackToUI({ id: t.id || t.title, uri: t.uri, name: t.title, artist: t.artist || entity.artist, album: entity.title, thumb: t.thumb || t.cover || entity.cover, cover: t.cover || entity.cover, coverLarge: t.coverLarge || entity.coverLarge || t.cover || entity.cover, duration: t.duration }, 0, true);
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
  artistBackBtn.addEventListener('click', (e) => {
    e.stopPropagation();
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
    state.singleTrackPlayback = false;
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
    applyTrackToUI({
      id: first.id || first.uri,
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
      playSpotifyUris(uris, upcomingSlice);
    } else if (first.uri) {
      playSpotifyTrackUri(first.uri);
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
    state.singleTrackPlayback = false;
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
    applyTrackToUI({
      id: first.id || first.uri,
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
      playSpotifyUris(uris, upcomingSlice);
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
      const artist = liveCatalog.entities[state.selectedArtistId];
      toggleLikeTrack(trackId, { title: trackTitle, artist: artist ? (artist.name || artist.title) : '' });
      return;
    }
    if (e.target.closest('.artist-track-more-btn')) return;

    const item = e.target.closest('.artist-track-item');
    if (!item) return;
    if (e.target.closest('.artist-track-more-btn')) return;

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

    state.singleTrackPlayback = false;
    state.contextUpcomingTracks = upcoming;
    applyTrackToUI({
      id: trackId || trackUri || trackTitle,
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

    const uris = tracks.slice(idx).map(t => t.uri).filter(Boolean);
    if (uris.length > 0) {
      playSpotifyUris(uris, upcoming);
    } else if (trackUri) {
      playSpotifyUris([trackUri], upcoming);
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
  const cmdSeq = lockUserPlaybackIntent('play_pause', {
    durationMs: 3200,
    targetIsPlaying: state.isPlaying
  });
  updatePlayPauseIcons();

  if (isLocalWebPlayerActive()) {
    try {
      if (state.isPlaying && typeof webPlayer.resume === 'function') {
        await webPlayer.resume();
        return;
      } else if (!state.isPlaying && typeof webPlayer.pause === 'function') {
        await webPlayer.pause();
        return;
      }
    } catch (e) { }
  }

  if (spotifyAuth.accessToken) {
    const devQ = await getTargetDeviceQuery();
    if (cmdSeq !== playbackActionSeq) return;
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
  if (Array.isArray(state.liveQueueTracks) && state.liveQueueTracks.length > 0) {
    const nextTrack = state.liveQueueTracks[0];
    state.liveQueueTracks = state.liveQueueTracks.slice(1);
    state.contextUpcomingTracks = state.liveQueueTracks;
    applyTrackToUI({
      id: nextTrack.id || nextTrack.uri || nextTrack.title,
      uri: nextTrack.uri,
      name: nextTrack.title,
      artist: nextTrack.artist,
      album: nextTrack.album,
      thumb: nextTrack.thumb || nextTrack.cover,
      cover: nextTrack.cover,
      coverLarge: nextTrack.cover,
      duration: nextTrack.duration || 210
    }, 0, true);
  } else {
    lockUserPlaybackIntent('track_switch', {
      durationMs: 2800,
      targetIsPlaying: true
    });
  }
  const cmdSeq = playbackActionSeq;
  if (spotifyAuth.accessToken) {
    const devQ = await getTargetDeviceQuery();
    if (cmdSeq !== playbackActionSeq) return;
    await spotifyFetch(`/me/player/next${devQ}`, { method: 'POST' });
    setTimeout(() => {
      if (cmdSeq === playbackActionSeq) pollSpotifyCurrentPlayback();
    }, 650);
  }
}

async function skipPrevTrack() {
  if (spotifyAuth.accessToken && state.currentTimeSec < 4) {
    if (bridge && bridge.notifyTrackLoading) {
      bridge.notifyTrackLoading('');
      state.pcmFlowing = false;
      state.currentTimeSec = 0;
    }
    const cmdSeq = lockUserPlaybackIntent('track_switch', {
      durationMs: 2800,
      targetIsPlaying: true
    });
    const devQ = await getTargetDeviceQuery();
    if (cmdSeq !== playbackActionSeq) return;
    await spotifyFetch(`/me/player/previous${devQ}`, { method: 'POST' });
    setTimeout(() => {
      if (cmdSeq === playbackActionSeq) pollSpotifyCurrentPlayback();
    }, 650);
  } else {
    state.currentTimeSec = 0;
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
    updateScrubberAndLyricsUI(true);
    if (isLocalWebPlayerActive() && typeof webPlayer.seek === 'function') {
      try { webPlayer.seek(0); } catch (err) { }
    }
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
        const imgs = (t.album && Array.isArray(t.album.images)) ? t.album.images : [];
        const thumbImg = imgs.length > 0 ? getSpotifyImage(imgs, 'small') : DEFAULT_ALBUM_COVER;
        const coverImg = imgs.length > 0 ? getSpotifyImage(imgs, 'large') : thumbImg;
        const artist = t.artists.map(a => a.name).join(', ');
        return `
          <div class="recent-chip" data-play-direct-uri="${t.uri}" data-title="${t.name.replace(/"/g, '&quot;')}" data-artist="${artist.replace(/"/g, '&quot;')}" data-thumb="${thumbImg}" data-cover="${coverImg}">
            ${renderOptImg(thumbImg, t.name, 'chip-avatar square')}
            <span class="chip-label">${t.name} — ${t.artists[0].name}</span>
          </div>
        `;
      }).join('');
      hydrateImages(chipsRow);
    }

    if (res.albums && Array.isArray(res.albums.items)) {
      const searchGrid = document.getElementById('searchRecentlyPlayedGrid');
      searchGrid.innerHTML = res.albums.items.slice(0, 5).map(a => {
        const entityId = `alb_${a.id}`;
        const cover = (a.images && a.images.length > 0) ? getSpotifyImage(a.images, 'medium') : DEFAULT_ALBUM_COVER;
        const coverLarge = (a.images && a.images.length > 0) ? getSpotifyImage(a.images, 'large') : cover;
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
            coverLarge: coverLarge,
            tracks: null
          };
        }
        return `
          <div class="media-card" data-open-entity="${entityId}">
            <div class="media-card-cover-wrap">
              ${renderOptImg(cover, a.name, 'media-card-cover')}
            </div>
            <div class="media-card-title">${a.name}</div>
            <div class="media-card-subtitle">${artistName}</div>
          </div>
        `;
      }).join('');
      hydrateImages(searchGrid);
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
    syncFullscreenSwitchUI();
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

const transferPlaybackBtn = document.getElementById('transferPlaybackHereBtn');
if (transferPlaybackBtn) {
  transferPlaybackBtn.addEventListener('click', async () => {
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
}

// Responsive Viewport Scaling (Robust 1280x800 Echo Show 8 fallback)
function fitViewport() {
  const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
  const vh = window.innerHeight || document.documentElement.clientHeight || 800;
  if (vw <= 10 || vh <= 10) return;
  const scale = Math.min(vw / 1280, vh / 800);
  if (!isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 0.02) {
    echoViewport.style.transform = 'none';
    echoViewport.style.width = '100vw';
    echoViewport.style.height = '100vh';
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

