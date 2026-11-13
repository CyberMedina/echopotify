/* ==========================================================================
   VIEW: Album, Playlist & Artist Detail Views + Toast & Like Actions
   ========================================================================== */
'use strict';

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

async function checkAndCacheLikedTracks(tracks) {
  if (!spotifyAuth.accessToken || !Array.isArray(tracks) || tracks.length === 0) return;
  const ids = tracks
    .map(t => cleanTrackId(t.id || t.uri))
    .filter(id => id && /^[0-9A-Za-z]{22}$/.test(id));
  if (ids.length === 0) return;

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const res = await spotifyFetch(`/me/tracks/contains?ids=${chunk.join(',')}`);
      if (Array.isArray(res)) {
        chunk.forEach((id, idx) => {
          const isLiked = Boolean(res[idx]);
          if (isLiked) {
            liveCatalog.likedTrackIds.add(id);
          } else {
            liveCatalog.likedTrackIds.delete(id);
          }
          document.querySelectorAll(`[data-track-id="${id}"]`).forEach(btn => {
            btn.classList.toggle('liked', isLiked);
            btn.setAttribute('title', isLiked ? 'Eliminar de Tus me gusta' : 'Guardar en Tus me gusta');
            const svg = btn.querySelector('svg');
            if (svg) {
              svg.setAttribute('fill', isLiked ? '#1ed760' : 'none');
              svg.setAttribute('stroke', isLiked ? '#1ed760' : 'currentColor');
            }
          });
        });
        if (state.playingTrackId && chunk.includes(state.playingTrackId)) {
          const currentLiked = liveCatalog.likedTrackIds.has(state.playingTrackId);
          spotifyAuth.isLiked = currentLiked;
          updateLikeButtonsUI(currentLiked);
        }
      }
    } catch (err) {
      console.warn('[checkAndCacheLikedTracks error]', err);
    }
  }
}

async function toggleLikeTrack(trackIdInput, trackInfo = null) {
  const trackId = cleanTrackId(trackIdInput);
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
    const thumbUrl = track.thumb || track.cover || DEFAULT_ALBUM_COVER;
    const trackUri = track.uri || (track.id ? `spotify:track:${track.id}` : '');
    const coverUrl = track.coverLarge || track.cover || thumbUrl;
    return `
      <div class="artist-track-item ${isPlaying ? 'playing' : ''}"
           data-artist-track-index="${idx}"
           data-track-id="${escapeHtml(track.id || '')}"
           data-track-uri="${escapeHtml(trackUri)}"
           data-track-title="${escapeHtml(track.title || '')}"
           data-track-artist="${escapeHtml(track.artist || '')}"
           data-track-album="${escapeHtml(track.album || '')}"
           data-track-thumb="${escapeHtml(thumbUrl)}"
           data-track-cover="${escapeHtml(coverUrl)}"
           data-track-duration="${track.duration || 210}">
        <span class="artist-track-num">${idx + 1}</span>
        ${renderOptImg(thumbUrl, track.title, 'artist-track-thumb')}
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
  hydrateImages(tracklistEl);
  checkAndCacheLikedTracks(visibleTracks);

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
          ${renderOptImg(album.cover, album.title, 'artist-album-cover')}
        </div>
        <div class="artist-album-title" title="${album.title}">${album.title}</div>
        <div class="artist-album-year">${album.year || ''}</div>
      </div>
    `;
  }).join('');
  hydrateImages(railEl);
}

async function openArtistDetail(entityId, artistHint = null) {
  if (state.isNowPlayingOpen) {
    closeNowPlaying();
  }

  const cleanEntityId = entityId;

  let artist = liveCatalog.entities[cleanEntityId] || liveCatalog.entities[entityId] || null;

  if (!artist && typeof cleanEntityId === 'string') {
    const slug = cleanEntityId.toLowerCase().replace(/[^a-z0-9]/g, '_');
    artist = liveCatalog.entities[slug] || null;
  }

  if (!artist && artistHint) {
    const hintSlug = resolveArtistIdByName(artistHint);
    if (hintSlug) {
      artist = liveCatalog.entities[hintSlug] || null;
    }
  }

  let spotifyId = (artist && artist.spotifyId) ||
    (typeof cleanEntityId === 'string' && cleanEntityId.startsWith('art_') ? cleanEntityId.replace('art_', '') : null) ||
    (typeof cleanEntityId === 'string' && /^[0-9A-Za-z]{22}$/.test(cleanEntityId) ? cleanEntityId : null);

  if (!spotifyId && artistHint) {
    const resolved = resolveArtistIdByName(artistHint);
    if (resolved && resolved.startsWith('art_')) {
      spotifyId = resolved.replace('art_', '');
    }
  }

  if (!artist) {
    const cleanName = (artistHint || (typeof cleanEntityId === 'string' && !cleanEntityId.startsWith('art_') && cleanEntityId.length < 35 ? cleanEntityId : 'Artista')).trim();
    artist = {
      id: cleanEntityId,
      spotifyId: spotifyId,
      title: cleanName,
      name: cleanName,
      cover: '',
      tracks: null,
      albums: null
    };
  }

  state.selectedArtistId = artist.id || cleanEntityId;
  liveCatalog.entities[cleanEntityId] = artist;
  if (artist.id) liveCatalog.entities[artist.id] = artist;
  if (spotifyId) {
    liveCatalog.entities[spotifyId] = artist;
    liveCatalog.entities[`art_${spotifyId}`] = artist;
  }

  // Update Header UI
  const avatarEl = document.getElementById('artistHeroAvatar');
  if (avatarEl) {
    if (artist.cover || artist.coverLarge) {
      swapHeroImageAtomically(avatarEl, artist.coverLarge || artist.cover, artist.cover || artist.thumb);
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

  // Default tab: Inicio
  switchArtistTab('inicio');
  state.artistShowingAllTracks = false;
  updateArtistSeeMoreButton(false);

  // Switch view to artist (extracts palette synchronously from cover/coverLarge or preserves previous tint until API loads)
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
  if (spotifyAuth.accessToken) {
    if (!spotifyId && artist.name && artist.name !== 'Artista') {
      try {
        const searchRes = await spotifyFetch(`/search?q=${encodeURIComponent(artist.name)}&type=artist&limit=1`);
        if (searchRes && searchRes.artists && searchRes.artists.items && searchRes.artists.items.length > 0) {
          spotifyId = searchRes.artists.items[0].id;
          artist.spotifyId = spotifyId;
        }
      } catch (searchErr) {
        console.warn('[search artist in openArtistDetail]', searchErr);
      }
    }
  }

  if (spotifyId && spotifyAuth.accessToken) {
    try {
      const [profileResult, topResult, albumsResult] = await Promise.allSettled([
        spotifyFetch(`/artists/${spotifyId}`),
        spotifyFetch(`/artists/${spotifyId}/top-tracks?market=from_token`),
        spotifyFetch(`/artists/${spotifyId}/albums?include_groups=album,single&limit=20&market=from_token`)
      ]);

      const profileRes = (profileResult.status === 'fulfilled' && profileResult.value && !profileResult.value.error) ? profileResult.value : null;
      let topRes = (topResult.status === 'fulfilled' && topResult.value && !topResult.value.error) ? topResult.value : null;
      let albumsRes = (albumsResult.status === 'fulfilled' && albumsResult.value && !albumsResult.value.error) ? albumsResult.value : null;

      // Si from_token falla o viene vacío, fallback a mercado de EE. UU. (US)
      if (!topRes || !Array.isArray(topRes.tracks) || topRes.tracks.length === 0) {
        try {
          const fallbackTop = await spotifyFetch(`/artists/${spotifyId}/top-tracks?market=US`);
          if (fallbackTop && Array.isArray(fallbackTop.tracks)) {
            topRes = fallbackTop;
          }
        } catch (e) {}
      }

      if (!albumsRes || !Array.isArray(albumsRes.items) || albumsRes.items.length === 0) {
        try {
          const fallbackAlb = await spotifyFetch(`/artists/${spotifyId}/albums?include_groups=album,single&limit=20&market=US`);
          if (fallbackAlb && Array.isArray(fallbackAlb.items)) {
            albumsRes = fallbackAlb;
          }
        } catch (e) {}
      }

      if (profileRes) {
        if (profileRes.name) {
          artist.name = profileRes.name;
          artist.title = profileRes.name;
          if (titleEl) titleEl.textContent = profileRes.name;
        }
        if (profileRes.images && profileRes.images.length > 0) {
          const freshLarge = getSpotifyImage(profileRes.images, 'large');
          const freshMed = getSpotifyImage(profileRes.images, 'medium') || freshLarge;
          if (freshLarge) {
            artist.coverLarge = freshLarge;
            artist.cover = freshMed;
            if (avatarEl) {
              swapHeroImageAtomically(avatarEl, freshLarge, freshMed);
              avatarEl.style.opacity = '1';
            }
            extractDynamicPaletteFromCover(freshMed, true, [freshMed, freshLarge]);
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
        artist.tracks = topRes.tracks.map((t, idx) => {
          const imgs = (t.album && Array.isArray(t.album.images)) ? t.album.images : [];
          const medUrl = getSpotifyImage(imgs, 'medium') || artist.cover || '';
          const smallUrl = getSpotifyImage(imgs, 'small') || medUrl;
          const largeUrl = getSpotifyImage(imgs, 'large') || medUrl;
          return {
            num: idx + 1,
            id: t.id,
            uri: t.uri,
            title: t.name,
            artist: t.artists ? t.artists.map(a => a.name).join(', ') : (artist.name || artist.title),
            album: t.album ? t.album.name : '',
            thumb: smallUrl,
            cover: medUrl,
            coverLarge: largeUrl,
            duration: Math.round((t.duration_ms || 200000) / 1000),
            explicit: !!t.explicit
          };
        });
        liveCatalog.entities[cleanEntityId] = artist;
        if (artist.id) liveCatalog.entities[artist.id] = artist;
        if (spotifyId) {
          liveCatalog.entities[spotifyId] = artist;
          liveCatalog.entities[`art_${spotifyId}`] = artist;
        }
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
            const albCover = getSpotifyImage(alb.images, 'medium') || DEFAULT_ALBUM_COVER;
            const albCoverLarge = getSpotifyImage(alb.images, 'large') || albCover;
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
              coverLarge: albCoverLarge,
              tracks: null
            };

            cleanAlbums.push({
              id: albEntityId,
              title: alb.name,
              year: year,
              cover: albCover,
              coverLarge: albCoverLarge,
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

function renderAlbumDetailArtist(entity) {
  const el = document.getElementById('albumDetailArtist');
  if (!el) return;
  if (!entity) {
    el.textContent = '';
    return;
  }
  if (entity.type === 'playlist' || entity.type === 'liked' || entity.id === 'liked_songs') {
    el.textContent = entity.artist || '';
    return;
  }

  let artistsList = [];
  if (Array.isArray(entity.artists) && entity.artists.length > 0) {
    artistsList = entity.artists;
  } else if (entity.artist) {
    artistsList = parseArtistsList({ artist: entity.artist });
  }

  if (artistsList && artistsList.length > 0) {
    el.innerHTML = artistsList.map((art, idx) => {
      const artId = escapeHtml(art.id || (entity.artistId || ''));
      const artName = escapeHtml(art.name || entity.artist || '');
      return `<span class="album-artist-link" data-artist-index="${idx}" data-artist-id="${artId}" data-artist-name="${artName}" role="button" tabindex="0">${artName}</span>`;
    }).join('<span class="artist-sep">, </span>');
  } else {
    el.textContent = entity.artist || '';
  }
}

async function openEntityDetail(entityId) {
  state.selectedEntityId = entityId;
  let entity = liveCatalog.entities[entityId];
  if (!entity) {
    if (typeof entityId === 'string' && entityId.startsWith('art_')) return openArtistDetail(entityId);
    return;
  }

  if (entity && (entity.type === 'artist' || (typeof entityId === 'string' && entityId.startsWith('art_')))) {
    return openArtistDetail(entityId);
  }

  if (entityId === 'liked_songs' || entity.type === 'liked') {
    entity.cover = LIKED_SONGS_COVER;
    entity.coverLarge = LIKED_SONGS_COVER;
    if (Array.isArray(liveCatalog.likedTracks)) {
      entity.tracks = liveCatalog.likedTracks;
      entity.tracks.forEach((t, i) => { t.num = i + 1; });
    }
  } else if (entity.cover === DEFAULT_PLAYLIST_COVER && entity.tracks && entity.tracks.length > 0) {
    const firstWithCover = entity.tracks.find(t => t.cover && t.cover !== DEFAULT_ALBUM_COVER && t.cover !== DEFAULT_PLAYLIST_COVER);
    if (firstWithCover) {
      entity.cover = firstWithCover.cover;
      entity.coverLarge = firstWithCover.coverLarge || firstWithCover.cover;
    }
  }

  const detailCoverEl = document.getElementById('albumDetailCover');
  swapHeroImageAtomically(detailCoverEl, entity.coverLarge || entity.cover, entity.cover);
  document.getElementById('albumDetailTitle').textContent = entity.title;
  renderAlbumDetailArtist(entity);
  document.getElementById('albumDetailMeta').textContent = entity.meta || '';

  // switchScreen('album') sets state.activeScreen='album' and extracts palette synchronously (0ms) from cached DOM <img> or paletteCache
  switchScreen('album');

  const tracklistEl = document.getElementById('albumTracklistContainer');

  // Fetch tracks on demand if not yet loaded
  if (!entity.tracks && entity.spotifyId) {
    tracklistEl.innerHTML = buildSkeletonTracksHTML(7);

    if (entity.type === 'playlist') {
      const plData = await spotifyFetch(`/playlists/${entity.spotifyId}`);
      if (plData) {
        if (plData.images && plData.images.length > 0 && (!entity.cover || entity.cover === DEFAULT_PLAYLIST_COVER)) {
          const freshLarge = getSpotifyImage(plData.images, 'large');
          const freshMed = getSpotifyImage(plData.images, 'medium') || freshLarge;
          if (freshLarge) {
            entity.cover = freshMed;
            entity.coverLarge = freshLarge;
            if (detailCoverEl) swapHeroImageAtomically(detailCoverEl, freshLarge, freshMed);
            extractDynamicPaletteFromCover(freshMed, true, [freshMed, freshLarge]);
            document.querySelectorAll(`[data-open-entity="${entity.id}"] img, [data-entity-id="${entity.id}"] img`).forEach(img => {
              swapHeroImageAtomically(img, freshMed, freshMed);
            });
          }
        }

        if (plData.tracks && Array.isArray(plData.tracks.items)) {
          entity.tracksTotal = (typeof plData.tracks.total === 'number') ? plData.tracks.total : plData.tracks.items.length;
          entity.tracksNextOffset = plData.tracks.items.length;
          entity.hasMoreTracks = entity.tracksNextOffset < entity.tracksTotal;
          entity.tracks = plData.tracks.items
            .filter(i => i && i.track && !i.track.is_local && i.track.is_playable !== false && i.track.uri && !i.track.uri.startsWith('spotify:local:'))
            .map((i, idx) => {
              const imgs = (i.track.album && Array.isArray(i.track.album.images)) ? i.track.album.images : [];
              const medUrl = getSpotifyImage(imgs, 'medium') || entity.cover;
              const smallUrl = getSpotifyImage(imgs, 'small') || medUrl;
              const largeUrl = getSpotifyImage(imgs, 'large') || entity.coverLarge || medUrl;
              return {
                num: idx + 1,
                id: i.track.id,
                uri: i.track.uri,
                title: i.track.name,
                artist: i.track.artists ? i.track.artists.map(a => a.name).join(', ') : entity.artist,
                album: i.track.album ? i.track.album.name : entity.title,
                thumb: smallUrl,
                cover: medUrl,
                coverLarge: largeUrl,
                duration: Math.round((i.track.duration_ms || 200000) / 1000),
                popular: idx < 2
              };
            });

          // Auto-cover: if playlist still has default cover, adopt the first track's cover
          if ((!entity.cover || entity.cover === DEFAULT_PLAYLIST_COVER) && entity.tracks.length > 0) {
            const firstWithCover = entity.tracks.find(t => t.cover && t.cover !== DEFAULT_ALBUM_COVER && t.cover !== DEFAULT_PLAYLIST_COVER);
            if (firstWithCover) {
              entity.cover = firstWithCover.cover;
              entity.coverLarge = firstWithCover.coverLarge || firstWithCover.cover;
              if (detailCoverEl) swapHeroImageAtomically(detailCoverEl, entity.coverLarge, entity.cover);
              extractDynamicPaletteFromCover(entity.cover, true, [entity.cover, entity.coverLarge]);
              document.querySelectorAll(`[data-open-entity="${entity.id}"] img, [data-entity-id="${entity.id}"] img`).forEach(img => {
                swapHeroImageAtomically(img, entity.cover, entity.cover);
              });
            }
          }
        }
      }
    } else if (entity.type === 'album') {
      const albData = await spotifyFetch(`/albums/${entity.spotifyId}`);
      if (albData) {
        if (Array.isArray(albData.artists) && albData.artists.length > 0) {
          entity.artists = albData.artists.map(a => {
            const rawId = a.id || (a.uri ? a.uri.replace('spotify:artist:', '') : null);
            const name = (a.name || '').trim();
            return {
              id: rawId ? (rawId.startsWith('art_') ? rawId : `art_${rawId}`) : resolveArtistIdByName(name),
              name: name,
              uri: a.uri || (rawId ? `spotify:artist:${rawId}` : null)
            };
          });
          entity.artistId = entity.artists[0].id;
          entity.artist = entity.artists.map(a => a.name).join(', ');
          renderAlbumDetailArtist(entity);
        }
        if (albData.tracks && Array.isArray(albData.tracks.items)) {
          entity.tracks = albData.tracks.items.map((t, idx) => ({
            num: idx + 1,
            id: t.id,
            uri: t.uri,
            title: t.name,
            artist: t.artists ? t.artists.map(a => a.name).join(', ') : entity.artist,
            album: entity.title,
            thumb: entity.thumb || entity.cover,
            cover: entity.cover,
            coverLarge: entity.coverLarge || entity.cover,
            duration: Math.round((t.duration_ms || 200000) / 1000),
            popular: idx === 0
          }));
        }
      }
    } else if (entity.type === 'artist') {
      const topData = await spotifyFetch(`/artists/${entity.spotifyId}/top-tracks?market=from_token`);
      if (topData && Array.isArray(topData.tracks)) {
        entity.tracks = topData.tracks.map((t, idx) => {
          const imgs = (t.album && Array.isArray(t.album.images)) ? t.album.images : [];
          const medUrl = getSpotifyImage(imgs, 'medium') || entity.cover;
          const smallUrl = getSpotifyImage(imgs, 'small') || medUrl;
          const largeUrl = getSpotifyImage(imgs, 'large') || medUrl;
          return {
            num: idx + 1,
            id: t.id,
            uri: t.uri,
            title: t.name,
            artist: entity.title,
            album: t.album ? t.album.name : '',
            thumb: smallUrl,
            cover: medUrl,
            coverLarge: largeUrl,
            duration: Math.round((t.duration_ms || 200000) / 1000),
            popular: idx < 3
          };
        });
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
           data-track-thumb="${track.thumb || track.cover || entity.cover}"
           data-track-cover="${track.coverLarge || track.cover || entity.coverLarge || entity.cover}"
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
  if (entity.type !== 'liked') {
    checkAndCacheLikedTracks(tracks);
  }
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
      .filter(i => i && i.track && !i.track.is_local && i.track.is_playable !== false && i.track.uri && !i.track.uri.startsWith('spotify:local:'))
      .map((i, idx) => {
        const imgs = (i.track.album && Array.isArray(i.track.album.images)) ? i.track.album.images : [];
        const medUrl = getSpotifyImage(imgs, 'medium') || entity.cover;
        const smallUrl = getSpotifyImage(imgs, 'small') || medUrl;
        const largeUrl = getSpotifyImage(imgs, 'large') || entity.coverLarge || medUrl;
        return {
          num: startIndex + idx + 1,
          id: i.track.id,
          uri: i.track.uri,
          title: i.track.name,
          artist: i.track.artists ? i.track.artists.map(a => a.name).join(', ') : entity.artist,
          album: i.track.album ? i.track.album.name : entity.title,
          thumb: smallUrl,
          cover: medUrl,
          coverLarge: largeUrl,
          duration: Math.round((i.track.duration_ms || 200000) / 1000),
          popular: false
        };
      });

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
               data-track-thumb="${track.thumb || track.cover || entity.cover}"
               data-track-cover="${track.coverLarge || track.cover || entity.coverLarge || entity.cover}"
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
      checkAndCacheLikedTracks(newMappedTracks);
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

