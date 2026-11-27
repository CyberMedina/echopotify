/* ==========================================================================
   SERVICE: HomeFeed — Dynamic Home Composer, Virtual Mixes, New Releases
   100% Spotify Web API (2026 Dev Mode Safe) + EchoRadio Graph Integration
   ========================================================================== */
'use strict';

(function initHomeFeedModule(global) {
  const RELEASES_CACHE_KEY = 'sp_home_releases_v1';
  const RECENT_CTX_CACHE_KEY = 'sp_home_recent_ctx_v1';
  const RELEASES_TTL_MS = 24 * 60 * 60 * 1000; // 24h cache for artist new releases

  const homeFeedState = {
    activeFilter: 'all', // 'all' | 'rotation' | 'releases' | 'radios' | 'rediscover'
    shuffleSalt: 0,
    userName: '',
    shortTermTracks: [],
    shortTermArtists: [],
    mediumTermTracks: [],
    mediumTermArtists: [],
    longTermTracks: [],
    longTermArtists: [],
    recentTracks: [],
    recentContexts: [],
    newReleases: [],
    isFetchingReleases: false,
    releasesFetchedOnce: false,
    hasLoadedLiveCatalog: false,
    becauseInFlightIds: {},
    lastHomeRefreshAt: 0,
    becauseCache: {} // { [artistId]: [albumCards] }
  };

  // --------------------------------------------------------------------------
  // DETERMINISTIC SEEDED SHUFFLE (Daily seed + user "Renovar" salt)
  // --------------------------------------------------------------------------
  function getDailySeed() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() + homeFeedState.shuffleSalt * 7919;
  }

  function seededRandom(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function seededShuffle(arr, seedOffset = 0) {
    if (!Array.isArray(arr) || arr.length <= 1) return Array.isArray(arr) ? [...arr] : [];
    const copy = [...arr];
    const rand = seededRandom(getDailySeed() + seedOffset * 104729);
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  // --------------------------------------------------------------------------
  // TIME OF DAY HELPERS (Spanish)
  // --------------------------------------------------------------------------
  function getTimeOfDayMeta(dateObj = new Date()) {
    const hr = dateObj.getHours();
    if (hr >= 5 && hr < 12) {
      return {
        bucket: 0,
        greeting: 'Buenos días',
        mixTitle: 'Mix de mañana',
        mixTag: 'PARA EMPEZAR EL DÍA',
        subtitles: [
          'Energía y ritmo para empezar el día.',
          'Tu música seleccionada para esta mañana.',
          'Lo que más estás escuchando últimamente.'
        ]
      };
    }
    if (hr >= 12 && hr < 19) {
      return {
        bucket: 1,
        greeting: 'Buenas tardes',
        mixTitle: 'Mix de tarde',
        mixTag: 'TU MOMENTO DE TARDE',
        subtitles: [
          'Tu banda sonora para seguir el ritmo.',
          'Mezclas y favoritos adaptados a tu tarde.',
          'Descubre y vuelve a tus esenciales de hoy.'
        ]
      };
    }
    if (hr >= 19 && hr < 24) {
      return {
        bucket: 2,
        greeting: 'Buenas noches',
        mixTitle: 'Mix de noche',
        mixTag: 'VIBRA NOCTURNA',
        subtitles: [
          'Tu vibra de noche, a un toque.',
          'Música para bajar el ritmo y disfrutar.',
          'Estaciones y favoritos para cerrar el día.'
        ]
      };
    }
    return {
      bucket: 3,
      greeting: 'Buenas noches',
      mixTitle: 'Sesión de madrugada',
      mixTag: 'MADRUGADA',
      subtitles: [
        'Sesión nocturna hecha a tu medida.',
        'Sonidos tranquilos para la madrugada.',
        'Tu música para acompañar la noche.'
      ]
    };
  }

  function getDynamicHeaderMeta() {
    const tod = getTimeOfDayMeta();
    const firstName = (homeFeedState.userName || '').trim().split(/\s+/)[0] || '';
    const title = firstName ? `${tod.greeting}, ${firstName}` : tod.greeting;

    const latestArtist = homeFeedState.recentTracks[0] && homeFeedState.recentTracks[0].subtitle
      ? homeFeedState.recentTracks[0].subtitle.split(',')[0].trim()
      : '';
    const subIdx = Math.abs(getDailySeed()) % (tod.subtitles.length + (latestArtist ? 1 : 0));
    const subtitle = (latestArtist && subIdx === tod.subtitles.length)
      ? `Siguiendo el ritmo de ${latestArtist} y tu biblioteca.`
      : tod.subtitles[subIdx % tod.subtitles.length];

    return { title, subtitle, tod };
  }

  // --------------------------------------------------------------------------
  // NORMALIZERS
  // --------------------------------------------------------------------------
  function normalizeTrackForMix(t, idx = 0) {
    if (!t) return null;
    const id = (typeof cleanTrackId === 'function') ? cleanTrackId(t.id || t.trackId || t.uri) : (t.id || t.trackId || '');
    const uri = t.uri || (id ? `spotify:track:${id}` : '');
    if (!uri || !uri.startsWith('spotify:track:')) return null;

    const title = t.title || t.name || '';
    if (!title) return null;

    let artist = '';
    if (typeof t.artist === 'string' && t.artist) artist = t.artist;
    else if (typeof t.subtitle === 'string' && t.subtitle) artist = t.subtitle;
    else if (Array.isArray(t.artists)) artist = t.artists.map(a => a && a.name).filter(Boolean).join(', ');

    const imgs = (t.album && Array.isArray(t.album.images)) ? t.album.images : [];
    const cover = t.cover || (imgs.length > 0 ? getSpotifyImage(imgs, 'medium') : DEFAULT_ALBUM_COVER);
    const thumb = t.thumb || (imgs.length > 0 ? getSpotifyImage(imgs, 'small') : cover);
    const coverLarge = t.coverLarge || (imgs.length > 0 ? getSpotifyImage(imgs, 'large') : cover);
    const duration = t.duration || (t.durationMs ? Math.round(t.durationMs / 1000) : (t.duration_ms ? Math.round(t.duration_ms / 1000) : 210));
    const album = (typeof t.album === 'string') ? t.album : ((t.album && t.album.name) || t.albumName || '');

    return {
      num: idx + 1,
      id: id || uri,
      uri,
      title,
      artist: artist || 'Spotify',
      album,
      thumb: thumb || DEFAULT_ALBUM_COVER,
      cover: cover || DEFAULT_ALBUM_COVER,
      coverLarge: coverLarge || cover || DEFAULT_ALBUM_COVER,
      duration,
      popular: idx < 3
    };
  }

  function dedupeTracks(list, maxCount = 24) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < list.length && out.length < maxCount; i++) {
      const nt = normalizeTrackForMix(list[i], out.length);
      if (!nt) continue;
      const key = nt.id || `${nt.title.toLowerCase()}|${nt.artist.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nt.num = out.length + 1;
      out.push(nt);
    }
    return out;
  }

  function mapApiTrackToCard(t) {
    if (!t || !t.id) return null;
    const imgs = (t.album && Array.isArray(t.album.images)) ? t.album.images : [];
    const thumb = imgs.length > 0 ? getSpotifyImage(imgs, 'small') : DEFAULT_ALBUM_COVER;
    const cover = imgs.length > 0 ? getSpotifyImage(imgs, 'medium') : DEFAULT_ALBUM_COVER;
    const coverLarge = imgs.length > 0 ? getSpotifyImage(imgs, 'large') : cover;
    const artistName = Array.isArray(t.artists) ? t.artists.map(a => a.name).join(', ') : (t.artist || '');
    const primaryArtistId = (Array.isArray(t.artists) && t.artists[0] && t.artists[0].id) ? t.artists[0].id : '';
    const primaryArtistName = (Array.isArray(t.artists) && t.artists[0] && t.artists[0].name) ? t.artists[0].name : artistName.split(',')[0].trim();

    return {
      trackId: t.id,
      id: t.id,
      uri: t.uri || `spotify:track:${t.id}`,
      title: t.name || t.title || '',
      subtitle: artistName,
      artist: artistName,
      primaryArtistId,
      primaryArtistName,
      albumId: (t.album && t.album.id) ? t.album.id : '',
      albumName: (t.album && t.album.name) ? t.album.name : '',
      thumb,
      cover,
      coverLarge,
      durationMs: t.duration_ms || (t.duration ? t.duration * 1000 : 210000)
    };
  }

  function mapApiArtistToEntity(ar) {
    if (!ar || !ar.id) return null;
    const entityId = `art_${ar.id}`;
    const thumb = (ar.images && ar.images.length > 0) ? getSpotifyImage(ar.images, 'small') : DEFAULT_SPOTIFY_COVER;
    const cover = (ar.images && ar.images.length > 0) ? getSpotifyImage(ar.images, 'medium') : DEFAULT_SPOTIFY_COVER;
    const coverLarge = (ar.images && ar.images.length > 0) ? getSpotifyImage(ar.images, 'large') : cover;
    const genre = (ar.genres && ar.genres[0]) ? ar.genres[0] : 'Artista';
    if (!liveCatalog.entities[entityId]) {
      liveCatalog.entities[entityId] = {
        id: entityId,
        spotifyId: ar.id,
        type: 'artist',
        uri: ar.uri,
        title: ar.name,
        artist: 'Artista de Spotify',
        meta: genre,
        thumb,
        cover,
        coverLarge,
        tracks: null
      };
    }
    return {
      entityId,
      spotifyId: ar.id,
      name: ar.name,
      meta: genre,
      cover,
      thumb
    };
  }

  // --------------------------------------------------------------------------
  // PERSISTED RECENT CONTEXTS & NEW RELEASES CACHE
  // --------------------------------------------------------------------------
  function loadPersistedContexts() {
    try {
      const raw = safeStorage.getItem(RECENT_CTX_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) homeFeedState.recentContexts = parsed.slice(0, 12);
      }
    } catch (_) {}
  }

  function savePersistedContexts() {
    try {
      safeStorage.setItem(RECENT_CTX_CACHE_KEY, JSON.stringify(homeFeedState.recentContexts.slice(0, 12)));
    } catch (_) {}
  }

  function recordRecentContext(ctx) {
    if (!ctx || !ctx.entityId || !ctx.title) return;
    const filtered = homeFeedState.recentContexts.filter(c => c && c.entityId !== ctx.entityId);
    filtered.unshift({
      entityId: ctx.entityId,
      title: ctx.title,
      subtitle: ctx.subtitle || '',
      cover: ctx.cover || DEFAULT_ALBUM_COVER,
      type: ctx.type || 'album',
      ts: Date.now()
    });
    homeFeedState.recentContexts = filtered.slice(0, 12);
    savePersistedContexts();
  }

  function extractContextsFromRecentRes(recentRes) {
    if (!recentRes || !Array.isArray(recentRes.items)) return;
    const seen = new Set();
    const found = [];

    recentRes.items.forEach(item => {
      if (!item) return;
      const ctx = item.context;
      if (ctx && ctx.uri) {
        const uri = String(ctx.uri);
        if (seen.has(uri)) return;
        seen.add(uri);

        if (uri.startsWith('spotify:playlist:')) {
          const plId = uri.replace('spotify:playlist:', '');
          const entityId = `pl_${plId}`;
          const ent = liveCatalog.entities[entityId];
          if (ent) {
            found.push({
              entityId: ent.id,
              title: ent.title,
              subtitle: 'Playlist reciente',
              cover: ent.cover || DEFAULT_PLAYLIST_COVER,
              type: 'playlist'
            });
          }
        } else if (uri.startsWith('spotify:album:')) {
          const albId = uri.replace('spotify:album:', '');
          const entityId = `alb_${albId}`;
          const ent = liveCatalog.entities[entityId];
          const t = item.track;
          const fallbackCover = (t && t.album && t.album.images && t.album.images.length > 0)
            ? getSpotifyImage(t.album.images, 'medium')
            : DEFAULT_ALBUM_COVER;
          if (!ent && t && t.album) {
            liveCatalog.entities[entityId] = {
              id: entityId,
              spotifyId: albId,
              type: 'album',
              uri,
              title: t.album.name,
              artist: t.artists ? t.artists.map(a => a.name).join(', ') : '',
              meta: `Álbum • ${(t.album.release_date || '').slice(0, 4)}`,
              cover: fallbackCover,
              coverLarge: getSpotifyImage(t.album.images, 'large') || fallbackCover,
              tracks: null
            };
          }
          const finalEnt = liveCatalog.entities[entityId];
          if (finalEnt) {
            found.push({
              entityId: finalEnt.id,
              title: finalEnt.title,
              subtitle: finalEnt.artist || 'Álbum reciente',
              cover: finalEnt.cover || fallbackCover,
              type: 'album'
            });
          }
        }
      }
    });

    if (found.length > 0) {
      // Merge newly discovered contexts at top while preserving local ones
      const existing = homeFeedState.recentContexts || [];
      const merged = [...found];
      const mergedIds = new Set(found.map(f => f.entityId));
      existing.forEach(c => {
        if (c && c.entityId && !mergedIds.has(c.entityId)) {
          mergedIds.add(c.entityId);
          merged.push(c);
        }
      });
      homeFeedState.recentContexts = merged.slice(0, 12);
      savePersistedContexts();
    }
  }

  function loadPersistedReleases() {
    try {
      const raw = safeStorage.getItem(RELEASES_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return null;
      // Re-register cached release entities into liveCatalog
      parsed.items.forEach(rel => {
        if (rel && rel.entityId && !liveCatalog.entities[rel.entityId]) {
          liveCatalog.entities[rel.entityId] = {
            id: rel.entityId,
            spotifyId: rel.spotifyId,
            type: 'album',
            uri: rel.uri,
            title: rel.title,
            artist: rel.subtitle,
            meta: `${rel.albumType === 'single' ? 'Sencillo' : 'Álbum'} • ${(rel.releaseDate || '').slice(0, 4)}`,
            cover: rel.cover,
            coverLarge: rel.coverLarge || rel.cover,
            tracks: null
          };
        }
      });
      homeFeedState.newReleases = parsed.items;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // BACKGROUND FETCHER: REAL NEW RELEASES FROM USER'S TOP ARTISTS (2026-safe)
  // --------------------------------------------------------------------------
  async function refreshNewReleasesInBackground(force = false) {
    if (homeFeedState.isFetchingReleases || !spotifyAuth || !spotifyAuth.accessToken) return;
    const cached = loadPersistedReleases();
    if (!force && cached && cached.updatedAt && (Date.now() - cached.updatedAt) < RELEASES_TTL_MS && cached.items.length >= 4) {
      homeFeedState.releasesFetchedOnce = true;
      return;
    }

    // Pick top 8 unique artists from short_term + medium_term
    const artistPool = [];
    const seenArt = new Set();
    const addArt = (a) => {
      const sid = a && (a.spotifyId || (a.id ? String(a.id).replace(/^art_/, '') : ''));
      if (!sid || seenArt.has(sid) || artistPool.length >= 8) return;
      seenArt.add(sid);
      artistPool.push({ id: sid, name: a.name || a.title || '' });
    };
    homeFeedState.shortTermArtists.forEach(addArt);
    homeFeedState.mediumTermArtists.forEach(addArt);
    (liveCatalog.artists || []).forEach(addArt);

    if (artistPool.length === 0) {
      homeFeedState.releasesFetchedOnce = true;
      return;
    }
    homeFeedState.isFetchingReleases = true;

    try {
      const collected = [];
      const seenAlbNames = new Set();
      const nowMs = Date.now();
      const recentWindowMs = 540 * 24 * 60 * 60 * 1000; // ~18 months

      for (let i = 0; i < artistPool.length; i += 2) {
        const batch = artistPool.slice(i, i + 2);
        await Promise.all(batch.map(async (art) => {
          try {
            const res = await spotifyFetch(`/artists/${art.id}/albums?include_groups=single,album&limit=10`);
            if (!res || !Array.isArray(res.items)) return;
            res.items.forEach(alb => {
              if (!alb || !alb.id || !alb.name) return;
              const normKey = `${art.id}|${alb.name.toLowerCase().replace(/\([^)]*\)/g, '').trim()}`;
              if (seenAlbNames.has(normKey)) return;
              seenAlbNames.add(normKey);

              const relDate = alb.release_date || '';
              const relTs = Date.parse(relDate.length === 4 ? `${relDate}-01-01` : relDate) || 0;
              const ageMs = relTs ? (nowMs - relTs) : Infinity;
              const entityId = `alb_${alb.id}`;
              const cover = (alb.images && alb.images.length > 0) ? getSpotifyImage(alb.images, 'medium') : DEFAULT_ALBUM_COVER;
              const coverLarge = (alb.images && alb.images.length > 0) ? getSpotifyImage(alb.images, 'large') : cover;
              const artistStr = Array.isArray(alb.artists) && alb.artists.length > 0
                ? alb.artists.map(x => x.name).join(', ')
                : art.name;
              const year = relDate.slice(0, 4);
              const isBrandNew = relTs > 0 && ageMs <= 45 * 24 * 60 * 60 * 1000;

              liveCatalog.entities[entityId] = {
                id: entityId,
                spotifyId: alb.id,
                type: 'album',
                uri: alb.uri,
                title: alb.name,
                artist: artistStr,
                meta: `${alb.album_type === 'single' ? 'Sencillo' : 'Álbum'} • ${year}`,
                cover,
                coverLarge,
                tracks: null
              };

              collected.push({
                entityId,
                spotifyId: alb.id,
                uri: alb.uri,
                title: alb.name,
                subtitle: artistStr,
                cover,
                coverLarge,
                albumType: alb.album_type || 'album',
                releaseDate: relDate,
                releaseTs: relTs,
                badge: isBrandNew ? 'NUEVO' : (year || ''),
                isRecent: ageMs <= recentWindowMs
              });
            });
          } catch (_) {}
        }));
        await new Promise(r => setTimeout(r, 90));
      }

      if (collected.length > 0) {
        collected.sort((a, b) => (b.releaseTs || 0) - (a.releaseTs || 0));
        const recentOnly = collected.filter(c => c.isRecent);
        const finalReleases = (recentOnly.length >= 4 ? recentOnly : collected).slice(0, 12);
        homeFeedState.newReleases = finalReleases;
        try {
          safeStorage.setItem(RELEASES_CACHE_KEY, JSON.stringify({
            updatedAt: Date.now(),
            items: finalReleases
          }));
        } catch (_) {}
        if (typeof renderDynamicHome === 'function') {
          renderDynamicHome();
        }
        if (typeof persistCurrentHomeCache === 'function') {
          persistCurrentHomeCache();
        }
      }
    } finally {
      homeFeedState.isFetchingReleases = false;
      homeFeedState.releasesFetchedOnce = true;
      if (typeof renderDynamicHome === 'function') {
        renderDynamicHome();
      }
    }
  }

  // --------------------------------------------------------------------------
  // VIRTUAL MIXES & RADIO STATIONS (Powered by EchoRadio + Multi-Horizon Data)
  // --------------------------------------------------------------------------
  function registerVirtualMix(id, title, subtitle, tag, accentCls, tracks) {
    const cleanTracks = dedupeTracks(tracks, 24);
    if (cleanTracks.length === 0) return null;

    const uniqueCovers = [];
    for (let i = 0; i < cleanTracks.length && uniqueCovers.length < 4; i++) {
      const c = cleanTracks[i].cover;
      if (c && c !== DEFAULT_ALBUM_COVER && !uniqueCovers.includes(c)) {
        uniqueCovers.push(c);
      }
    }
    const primaryCover = uniqueCovers[0] || DEFAULT_ALBUM_COVER;
    const primaryLarge = (cleanTracks[0] && cleanTracks[0].coverLarge) || primaryCover;

    liveCatalog.entities[id] = {
      id,
      spotifyId: null,
      type: 'mix',
      uri: null,
      title,
      artist: subtitle,
      meta: `Mix personalizado • ${cleanTracks.length} canciones`,
      cover: primaryCover,
      coverLarge: primaryLarge,
      tracks: cleanTracks
    };

    return {
      entityId: id,
      title,
      subtitle,
      tag,
      accentCls,
      cover: primaryCover,
      collageCovers: uniqueCovers,
      trackCount: cleanTracks.length
    };
  }

  function buildDynamicMixes() {
    const tod = getTimeOfDayMeta();
    const insights = (typeof EchoRadio !== 'undefined' && typeof EchoRadio.getHomeInsights === 'function')
      ? EchoRadio.getHomeInsights({ bucket: tod.bucket })
      : null;

    const mixes = [];

    // 1. Mix del momento (Mañana / Tarde / Noche / Madrugada)
    const timePool = [];
    if (insights && Array.isArray(insights.timeBucketTracks)) {
      timePool.push(...insights.timeBucketTracks);
    }
    timePool.push(...homeFeedState.shortTermTracks.slice(0, 15));
    timePool.push(...(liveCatalog.likedTracks || []).slice(0, 20));
    const mixTime = registerVirtualMix(
      'mix_time_of_day',
      tod.mixTitle,
      `Adaptado a tu ritmo • ${tod.greeting.toLowerCase()}`,
      tod.mixTag,
      'mix-accent-time',
      seededShuffle(timePool, 11)
    );
    if (mixTime) mixes.push(mixTime);

    // 2. Radio basada en tu último artista escuchado (o artista rotativo)
    const seedCandidates = [];
    const seenSeedArt = new Set();
    homeFeedState.recentTracks.forEach(rt => {
      if (rt && rt.primaryArtistId && rt.primaryArtistName && !seenSeedArt.has(rt.primaryArtistId)) {
        seenSeedArt.add(rt.primaryArtistId);
        seedCandidates.push({ id: rt.primaryArtistId, name: rt.primaryArtistName });
      }
    });
    homeFeedState.shortTermArtists.forEach(ar => {
      if (ar && ar.spotifyId && ar.name && !seenSeedArt.has(ar.spotifyId)) {
        seenSeedArt.add(ar.spotifyId);
        seedCandidates.push({ id: ar.spotifyId, name: ar.name });
      }
    });

    if (seedCandidates.length > 0) {
      const pickIdx = homeFeedState.shuffleSalt % Math.min(seedCandidates.length, 4);
      const seedArt = seedCandidates[pickIdx];
      const radioPool = [];
      if (insights && typeof insights.getArtistSceneTracks === 'function') {
        radioPool.push(...insights.getArtistSceneTracks(seedArt.id, 22));
      }
      // Supplement with matching tracks from first-page catalog (deterministic across reloads!)
      const seedNameLow = seedArt.name.toLowerCase();
      [...homeFeedState.recentTracks, ...homeFeedState.shortTermTracks, ...homeFeedState.mediumTermTracks, ...(liveCatalog.likedTracks || []).slice(0, 50)].forEach(t => {
        if (!t) return;
        const aStr = (t.artist || t.subtitle || '').toLowerCase();
        if (aStr.includes(seedNameLow)) radioPool.push(t);
      });
      // Pad with related top tracks if artist only has a few locally
      if (radioPool.length < 10) {
        radioPool.push(...seededShuffle(homeFeedState.mediumTermTracks, 23).slice(0, 14));
      }
      const mixArtist = registerVirtualMix(
        'mix_artist_radio',
        `Radio de ${seedArt.name}`,
        'Basada en tu escucha reciente',
        'ESTACIÓN DE RADIO',
        'mix-accent-radio',
        seededShuffle(radioPool, 17)
      );
      if (mixArtist) mixes.push(mixArtist);
    }

    // 3. Cápsula del tiempo (favoritos de siempre que no han sonado hoy — determinista con primera página)
    const recentIds = new Set([
      ...homeFeedState.recentTracks.map(t => t.trackId || t.id),
      ...homeFeedState.shortTermTracks.slice(0, 12).map(t => t.trackId || t.id)
    ]);
    const capsulePool = [
      ...homeFeedState.longTermTracks.filter(t => t && !recentIds.has(t.trackId || t.id)),
      ...(liveCatalog.likedTracks || []).slice(20, 50).filter(t => t && !recentIds.has(t.id)),
      ...homeFeedState.mediumTermTracks.filter(t => t && !recentIds.has(t.trackId || t.id))
    ];
    const mixCapsule = registerVirtualMix(
      'mix_time_capsule',
      'Cápsula del tiempo',
      'Tus favoritos que hace tiempo no suenan',
      'REDESCUBRIR',
      'mix-accent-capsule',
      seededShuffle(capsulePool, 31)
    );
    if (mixCapsule) mixes.push(mixCapsule);

    // 4. Mix de tus playlists / Descubrimiento (sorted by id before seededShuffle so order is 100% deterministic across reloads!)
    const sortedGraphTracks = (insights && Array.isArray(insights.allTracks))
      ? [...insights.allTracks].filter(t => t && t.id && !recentIds.has(t.id)).sort((a, b) => (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)))
      : [];
    const graphTracks = sortedGraphTracks.length >= 12
      ? seededShuffle(sortedGraphTracks, 43).slice(0, 24)
      : [];
    if (graphTracks.length >= 8) {
      const mixDiscovery = registerVirtualMix(
        'mix_graph_discovery',
        'Mix de tu universo',
        'Mezcla de tus playlists y artistas afines',
        'HECHO PARA TI',
        'mix-accent-discovery',
        graphTracks
      );
      if (mixDiscovery) mixes.push(mixDiscovery);
    } else if (Array.isArray(liveCatalog.playlists) && liveCatalog.playlists.length > 0) {
      const rotatedPls = seededShuffle(liveCatalog.playlists, 47);
      const pl = rotatedPls[0];
      if (pl) {
        mixes.push({
          entityId: pl.id,
          title: pl.title,
          subtitle: pl.meta || 'De tu biblioteca',
          tag: 'PLAYLIST DESTACADA',
          accentCls: 'mix-accent-discovery',
          cover: pl.cover,
          collageCovers: [pl.cover]
        });
      }
    }

    return mixes.slice(0, 4);
  }

  // --------------------------------------------------------------------------
  // QUICK ACCESS 3x2 TILES (Live Contexts + Liked Songs + Mix del Momento)
  // --------------------------------------------------------------------------
  function buildQuickAccessTiles(mixes) {
    const tiles = [];
    const seen = new Set();
    const addTile = (tile) => {
      if (!tile || !tile.entityId || seen.has(tile.entityId) || tiles.length >= 6) return;
      seen.add(tile.entityId);
      tiles.push(tile);
    };

    // 1. Most recent actual played contexts (up to 2)
    homeFeedState.recentContexts.slice(0, 2).forEach(ctx => {
      if (liveCatalog.entities[ctx.entityId]) {
        addTile(ctx);
      }
    });

    // 2. Mix del momento (always 1-tap away!)
    if (mixes && mixes[0]) {
      addTile({
        entityId: mixes[0].entityId,
        title: mixes[0].title,
        subtitle: 'Mix en vivo',
        cover: mixes[0].cover,
        type: 'mix'
      });
    }

    // 3. Tus me gusta
    if (liveCatalog.entities['liked_songs']) {
      addTile({
        entityId: 'liked_songs',
        title: 'Tus me gusta',
        subtitle: `${(liveCatalog.likedTotal || 0).toLocaleString()} canciones`,
        cover: LIKED_SONGS_COVER,
        type: 'liked'
      });
    }

    // 4. Rotated user playlists (capped to first 50 so background pagination never mutates the shuffle)
    const userPlaylists = seededShuffle(
      (liveCatalog.playlists || []).slice(0, 50).filter(p => p && p.spotifyId && !p.spotifyId.startsWith('37i9dQZF1')),
      53
    );
    userPlaylists.forEach(p => {
      addTile({
        entityId: p.id,
        title: p.title,
        subtitle: 'Playlist',
        cover: p.cover,
        type: 'playlist'
      });
    });

    // 5. Supplement with top albums / saved albums
    const fallbackAlbums = seededShuffle(liveCatalog.albums || [], 59);
    fallbackAlbums.forEach(al => {
      addTile({
        entityId: al.id,
        title: al.title,
        subtitle: al.artist,
        cover: al.cover,
        type: 'album'
      });
    });

    return tiles.slice(0, 6);
  }

  // --------------------------------------------------------------------------
  // QUICK PICKS 2x4 TRACK GRID (One-Tap Play)
  // --------------------------------------------------------------------------
  function buildQuickPicksTracks() {
    const pool = [];
    pool.push(...seededShuffle(homeFeedState.shortTermTracks, 61).slice(0, 10));
    pool.push(...seededShuffle(homeFeedState.mediumTermTracks, 67).slice(0, 6));
    const likedSlice = (liveCatalog.likedTracks || []).slice(0, 40).map(t => ({
      trackId: t.id,
      id: t.id,
      uri: t.uri,
      title: t.title,
      subtitle: t.artist,
      artist: t.artist,
      thumb: t.thumb || t.cover,
      cover: t.cover,
      coverLarge: t.coverLarge || t.cover,
      durationMs: (t.duration || 210) * 1000
    }));
    pool.push(...seededShuffle(likedSlice, 71).slice(0, 8));

    const out = [];
    const seen = new Set();
    for (let i = 0; i < pool.length && out.length < 8; i++) {
      const t = pool[i];
      if (!t || !t.uri) continue;
      const key = t.trackId || t.id || t.uri;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // "PORQUE ESCUCHASTE A [ARTISTA X]" SHELF
  // --------------------------------------------------------------------------
  function buildBecauseYouListenedShelf() {
    const recentArtists = [];
    const seen = new Set();
    homeFeedState.recentTracks.forEach(rt => {
      if (rt && rt.primaryArtistId && rt.primaryArtistName && !seen.has(rt.primaryArtistId)) {
        seen.add(rt.primaryArtistId);
        recentArtists.push({ id: rt.primaryArtistId, name: rt.primaryArtistName });
      }
    });
    if (recentArtists.length === 0) {
      homeFeedState.shortTermArtists.slice(0, 4).forEach(ar => {
        if (ar && ar.spotifyId && !seen.has(ar.spotifyId)) {
          seen.add(ar.spotifyId);
          recentArtists.push({ id: ar.spotifyId, name: ar.name });
        }
      });
    }
    if (recentArtists.length === 0) return null;

    const seed = recentArtists[homeFeedState.shuffleSalt % Math.min(recentArtists.length, 5)];
    const items = [];
    const seenEnt = new Set();

    const addItem = (card) => {
      if (!card || !card.entityId || seenEnt.has(card.entityId) || items.length >= 8) return;
      seenEnt.add(card.entityId);
      items.push(card);
    };

    // 1. Cached albums from this artist (fetched lazily if missing)
    const cachedAlbums = homeFeedState.becauseCache[seed.id];
    const isLoadingBecause = Boolean(homeFeedState.becauseInFlightIds[seed.id]);
    if (Array.isArray(cachedAlbums)) {
      cachedAlbums.forEach(addItem);
    } else if (spotifyAuth && spotifyAuth.accessToken && !isLoadingBecause) {
      homeFeedState.becauseInFlightIds[seed.id] = true;
      homeFeedState.becauseCache[seed.id] = []; // mark in-flight
      spotifyFetch(`/artists/${seed.id}/albums?include_groups=album,single&limit=8`).then(res => {
        if (!res || !Array.isArray(res.items)) return;
        const mapped = [];
        const seenNames = new Set();
        res.items.forEach(alb => {
          if (!alb || !alb.id || !alb.name) return;
          const cleanName = alb.name.toLowerCase().trim();
          if (seenNames.has(cleanName)) return;
          seenNames.add(cleanName);
          const entityId = `alb_${alb.id}`;
          const cover = (alb.images && alb.images.length > 0) ? getSpotifyImage(alb.images, 'medium') : DEFAULT_ALBUM_COVER;
          const coverLarge = (alb.images && alb.images.length > 0) ? getSpotifyImage(alb.images, 'large') : cover;
          const year = (alb.release_date || '').slice(0, 4);
          const artistStr = Array.isArray(alb.artists) ? alb.artists.map(a => a.name).join(', ') : seed.name;
          if (!liveCatalog.entities[entityId]) {
            liveCatalog.entities[entityId] = {
              id: entityId,
              spotifyId: alb.id,
              type: 'album',
              uri: alb.uri,
              title: alb.name,
              artist: artistStr,
              meta: `${alb.album_type === 'single' ? 'Sencillo' : 'Álbum'} • ${year}`,
              cover,
              coverLarge,
              tracks: null
            };
          }
          mapped.push({
            entityId,
            title: alb.name,
            subtitle: `${alb.album_type === 'single' ? 'Sencillo' : 'Álbum'} • ${year}`,
            cover,
            badge: year
          });
        });
        homeFeedState.becauseCache[seed.id] = mapped.slice(0, 6);
        if (mapped.length > 0 && typeof persistCurrentHomeCache === 'function') {
          persistCurrentHomeCache();
        }
      }).catch(() => {}).finally(() => {
        delete homeFeedState.becauseInFlightIds[seed.id];
        if (typeof renderDynamicHome === 'function') {
          renderDynamicHome();
        }
      });
    }

    // 2. Albums in library / releases matching this artist or their collaborators
    const insights = (typeof EchoRadio !== 'undefined' && typeof EchoRadio.getHomeInsights === 'function')
      ? EchoRadio.getHomeInsights()
      : null;
    const collabNames = new Set([seed.name.toLowerCase()]);
    if (insights && typeof insights.getCollaborators === 'function') {
      insights.getCollaborators(seed.id, 6).forEach(co => {
        if (co && co.name) collabNames.add(co.name.toLowerCase());
      });
    }

    const matchByArtist = (artistStr) => {
      const low = (artistStr || '').toLowerCase();
      for (const name of collabNames) {
        if (name && low.includes(name)) return true;
      }
      return false;
    };

    homeFeedState.newReleases.forEach(rel => {
      if (matchByArtist(rel.subtitle)) addItem(rel);
    });
    (liveCatalog.albums || []).forEach(al => {
      if (matchByArtist(al.artist)) {
        addItem({ entityId: al.id, title: al.title, subtitle: al.artist, cover: al.cover });
      }
    });

    // 3. Also include collaborator artists if we already have them in liveCatalog.entities
    if (insights && typeof insights.getCollaborators === 'function') {
      insights.getCollaborators(seed.id, 5).forEach(co => {
        const artEnt = liveCatalog.entities[`art_${co.id}`];
        if (artEnt && artEnt.cover && artEnt.cover !== DEFAULT_SPOTIFY_COVER) {
          addItem({
            entityId: artEnt.id,
            title: artEnt.title,
            subtitle: 'Artista relacionado',
            cover: artEnt.cover,
            isArtist: true
          });
        }
      });
    }

    const stillLoading = Boolean(homeFeedState.becauseInFlightIds[seed.id]);
    if (items.length === 0 && !stillLoading) return null;
    return {
      title: `Porque escuchaste a ${seed.name}`,
      seedArtistId: `art_${seed.id}`,
      items: items.slice(0, 8),
      loading: items.length === 0 && stillLoading
    };
  }

  // --------------------------------------------------------------------------
  // ROTATING ARTISTS & REDISCOVER LIBRARY
  // --------------------------------------------------------------------------
  function buildRotatingArtists(mode = 'all') {
    const source = mode === 'rediscover'
      ? [...homeFeedState.longTermArtists, ...homeFeedState.mediumTermArtists]
      : [...homeFeedState.shortTermArtists, ...homeFeedState.mediumTermArtists, ...(liveCatalog.artists || []).map(a => ({
        entityId: a.id,
        spotifyId: a.spotifyId,
        name: a.title,
        meta: a.meta || 'Artista',
        cover: a.cover
      }))];

    const unique = [];
    const seen = new Set();
    source.forEach(ar => {
      if (!ar || !ar.entityId || seen.has(ar.entityId)) return;
      seen.add(ar.entityId);
      unique.push(ar);
    });

    if (mode === 'rotation') return unique.slice(0, 8);
    // Keep top 2 anchored, rotate the rest by daily seed / salt
    if (unique.length <= 4) return unique;
    const head = unique.slice(0, 2);
    const tail = seededShuffle(unique.slice(2), 79);
    return [...head, ...tail].slice(0, 8);
  }

  function buildRediscoverShelf(excludeEntityIds = new Set()) {
    const albums = (liveCatalog.albums || []).filter(al => al && !excludeEntityIds.has(al.id)).map(al => ({
      entityId: al.id,
      title: al.title,
      subtitle: al.artist,
      cover: al.cover
    }));
    const rotated = seededShuffle(albums, 89);
    return rotated.slice(0, 8);
  }

  // --------------------------------------------------------------------------
  // PUBLIC API: INGEST, COMPOSE, FILTER, REFRESH & LIVE UPDATES
  // --------------------------------------------------------------------------
  function ingestCatalogData(payload = {}) {
    loadPersistedContexts();
    loadPersistedReleases();

    if (payload.userName) homeFeedState.userName = payload.userName;

    if (payload.shortTracksRes && Array.isArray(payload.shortTracksRes.items)) {
      homeFeedState.shortTermTracks = payload.shortTracksRes.items.map(mapApiTrackToCard).filter(Boolean);
    }
    if (payload.mediumTracksRes && Array.isArray(payload.mediumTracksRes.items)) {
      homeFeedState.mediumTermTracks = payload.mediumTracksRes.items.map(mapApiTrackToCard).filter(Boolean);
    }
    if (payload.longTracksRes && Array.isArray(payload.longTracksRes.items)) {
      homeFeedState.longTermTracks = payload.longTracksRes.items.map(mapApiTrackToCard).filter(Boolean);
    }
    if (payload.shortArtistsRes && Array.isArray(payload.shortArtistsRes.items)) {
      homeFeedState.shortTermArtists = payload.shortArtistsRes.items.map(mapApiArtistToEntity).filter(Boolean);
    }
    if (payload.mediumArtistsRes && Array.isArray(payload.mediumArtistsRes.items)) {
      homeFeedState.mediumTermArtists = payload.mediumArtistsRes.items.map(mapApiArtistToEntity).filter(Boolean);
    }
    if (payload.longArtistsRes && Array.isArray(payload.longArtistsRes.items)) {
      homeFeedState.longTermArtists = payload.longArtistsRes.items.map(mapApiArtistToEntity).filter(Boolean);
    }
    if (payload.recentRes && Array.isArray(payload.recentRes.items)) {
      const seen = new Set();
      const mapped = [];
      payload.recentRes.items.forEach(item => {
        const card = item && item.track ? mapApiTrackToCard(item.track) : null;
        if (!card || seen.has(card.trackId)) return;
        seen.add(card.trackId);
        mapped.push(card);
      });
      homeFeedState.recentTracks = mapped;
      extractContextsFromRecentRes(payload.recentRes);
    }

    homeFeedState.hasLoadedLiveCatalog = true;
    homeFeedState.lastHomeRefreshAt = Date.now();
  }

  // Prefetch both "Porque escuchaste" seed artist albums and "Novedades" in parallel so Home reveals once without popping
  async function preloadSecondaryShelves(maxWaitMs = 1300) {
    const tasks = [];

    // 1. Preload new releases if not cached yet
    tasks.push(refreshNewReleasesInBackground(false).catch(() => {}));

    // 2. Preload primary seed artist for "Porque escuchaste"
    const seedTrack = homeFeedState.recentTracks.find(rt => rt && rt.primaryArtistId && rt.primaryArtistName);
    const seedArt = seedTrack
      ? { id: seedTrack.primaryArtistId, name: seedTrack.primaryArtistName }
      : (homeFeedState.shortTermArtists[0] ? { id: homeFeedState.shortTermArtists[0].spotifyId, name: homeFeedState.shortTermArtists[0].name } : null);

    if (seedArt && seedArt.id && !Array.isArray(homeFeedState.becauseCache[seedArt.id]) && spotifyAuth && spotifyAuth.accessToken) {
      homeFeedState.becauseInFlightIds[seedArt.id] = true;
      const pBecause = spotifyFetch(`/artists/${seedArt.id}/albums?include_groups=album,single&limit=8`)
        .then(res => {
          if (!res || !Array.isArray(res.items)) {
            homeFeedState.becauseCache[seedArt.id] = [];
            return;
          }
          const mapped = [];
          const seenNames = new Set();
          res.items.forEach(alb => {
            if (!alb || !alb.id || !alb.name) return;
            const cleanName = alb.name.toLowerCase().trim();
            if (seenNames.has(cleanName)) return;
            seenNames.add(cleanName);
            const entityId = `alb_${alb.id}`;
            const cover = (alb.images && alb.images.length > 0) ? getSpotifyImage(alb.images, 'medium') : DEFAULT_ALBUM_COVER;
            const coverLarge = (alb.images && alb.images.length > 0) ? getSpotifyImage(alb.images, 'large') : cover;
            const year = (alb.release_date || '').slice(0, 4);
            const artistStr = Array.isArray(alb.artists) ? alb.artists.map(a => a.name).join(', ') : seedArt.name;
            if (!liveCatalog.entities[entityId]) {
              liveCatalog.entities[entityId] = {
                id: entityId,
                spotifyId: alb.id,
                type: 'album',
                uri: alb.uri,
                title: alb.name,
                artist: artistStr,
                meta: `${alb.album_type === 'single' ? 'Sencillo' : 'Álbum'} • ${year}`,
                cover,
                coverLarge,
                tracks: null
              };
            }
            mapped.push({
              entityId,
              title: alb.name,
              subtitle: `${alb.album_type === 'single' ? 'Sencillo' : 'Álbum'} • ${year}`,
              cover,
              badge: year
            });
          });
          homeFeedState.becauseCache[seedArt.id] = mapped.slice(0, 6);
        })
        .catch(() => {
          homeFeedState.becauseCache[seedArt.id] = [];
        })
        .finally(() => {
          delete homeFeedState.becauseInFlightIds[seedArt.id];
        });
      tasks.push(pBecause);
    }

    if (tasks.length === 0) return;
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise(r => setTimeout(r, maxWaitMs))
    ]);
  }

  function composeHomeModel() {
    const filter = homeFeedState.activeFilter || 'all';
    const header = getDynamicHeaderMeta();
    const mixes = buildDynamicMixes();
    const quickAccess = buildQuickAccessTiles(mixes);
    const quickPicks = buildQuickPicksTracks();
    const recentTracks = homeFeedState.recentTracks.slice(0, 8);
    const becauseShelf = buildBecauseYouListenedShelf();
    const newReleases = homeFeedState.newReleases.slice(0, 8);
    const artists = buildRotatingArtists(filter);
    const quickIds = new Set(quickAccess.map(q => q.entityId));
    const rediscoverAlbums = buildRediscoverShelf(quickIds);

    const releasesLoading = Boolean(
      newReleases.length === 0 &&
      (homeFeedState.isFetchingReleases || (!homeFeedState.releasesFetchedOnce && spotifyAuth && spotifyAuth.accessToken))
    );

    return {
      filter,
      header,
      quickAccess,
      mixes,
      quickPicks,
      recentTracks,
      becauseShelf,
      newReleases,
      releasesLoading,
      artists,
      rediscoverAlbums
    };
  }

  function hydrateFromCache(cachedModel, userProfile = null) {
    if (!cachedModel || typeof cachedModel !== 'object') return;
    if (userProfile && userProfile.name && !homeFeedState.userName) {
      homeFeedState.userName = userProfile.name;
    }
    if (Array.isArray(cachedModel.recentTracks) && homeFeedState.recentTracks.length === 0) {
      homeFeedState.recentTracks = cachedModel.recentTracks;
    }
    if (Array.isArray(cachedModel.newReleases) && cachedModel.newReleases.length > 0 && homeFeedState.newReleases.length === 0) {
      homeFeedState.newReleases = cachedModel.newReleases;
      homeFeedState.releasesFetchedOnce = true;
    }
    if (Array.isArray(cachedModel.artists) && homeFeedState.mediumTermArtists.length === 0) {
      homeFeedState.mediumTermArtists = cachedModel.artists;
    }
    if (cachedModel.becauseShelf && cachedModel.becauseShelf.seedArtistId && Array.isArray(cachedModel.becauseShelf.items) && cachedModel.becauseShelf.items.length > 0) {
      const sid = String(cachedModel.becauseShelf.seedArtistId).replace(/^art_/, '');
      if (sid && !homeFeedState.becauseCache[sid]) {
        homeFeedState.becauseCache[sid] = cachedModel.becauseShelf.items;
      }
    }
  }

  function setFilter(nextFilter) {
    const allowed = ['all', 'rotation', 'releases', 'radios', 'rediscover'];
    const target = allowed.includes(nextFilter) ? nextFilter : 'all';
    if (homeFeedState.activeFilter === target) return;
    homeFeedState.activeFilter = target;
    if (typeof renderDynamicHome === 'function') {
      renderDynamicHome();
    }
    const homeEl = document.getElementById('view-home');
    if (homeEl) homeEl.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function shuffleFeed() {
    homeFeedState.shuffleSalt += 1;
    if (typeof renderDynamicHome === 'function') {
      renderDynamicHome();
    }
    if (typeof showToast === 'function') {
      showToast('Inicio renovado con nuevas sugerencias', true);
    }
  }

  // Reactive update whenever the user plays a new track during the session
  function onTrackChanged(trackInfo) {
    if (!trackInfo || (!trackInfo.id && !trackInfo.uri) || !trackInfo.name) return;
    const tid = (typeof cleanTrackId === 'function') ? cleanTrackId(trackInfo.id || trackInfo.uri) : (trackInfo.id || '');
    const uri = trackInfo.uri || (tid ? `spotify:track:${tid}` : '');
    if (!uri || !uri.startsWith('spotify:track:')) return;

    const firstArt = (Array.isArray(trackInfo.artists) && trackInfo.artists[0]) ? trackInfo.artists[0] : null;
    const primaryArtistId = firstArt && firstArt.id ? String(firstArt.id).replace(/^art_/, '') : '';
    const primaryArtistName = (firstArt && firstArt.name) || (trackInfo.artist || '').split(',')[0].trim();

    const card = {
      trackId: tid || uri,
      id: tid || uri,
      uri,
      title: trackInfo.name,
      subtitle: trackInfo.artist || '',
      artist: trackInfo.artist || '',
      primaryArtistId,
      primaryArtistName,
      albumName: trackInfo.album || '',
      thumb: trackInfo.thumb || trackInfo.cover || DEFAULT_ALBUM_COVER,
      cover: trackInfo.cover || DEFAULT_ALBUM_COVER,
      coverLarge: trackInfo.coverLarge || trackInfo.cover || DEFAULT_ALBUM_COVER,
      durationMs: (trackInfo.duration || 210) * 1000
    };

    const filtered = homeFeedState.recentTracks.filter(t => t && (t.trackId !== card.trackId && t.uri !== card.uri));
    filtered.unshift(card);
    homeFeedState.recentTracks = filtered.slice(0, 20);

    // Also record active context into Quick Access if applicable
    if (trackInfo.contextId && liveCatalog.entities[trackInfo.contextId]) {
      const ent = liveCatalog.entities[trackInfo.contextId];
      recordRecentContext({
        entityId: ent.id,
        title: ent.title,
        subtitle: ent.type === 'playlist' ? 'Playlist reciente' : (ent.artist || 'Escuchando'),
        cover: ent.cover || DEFAULT_ALBUM_COVER,
        type: ent.type
      });
    }

    if (typeof state !== 'undefined' && state.activeScreen === 'home' && typeof renderDynamicHome === 'function') {
      renderDynamicHome();
    }
  }

  // Refresh recently-played from Spotify silently when returning to Home after >2 minutes
  async function onReturnToHome() {
    if (!homeFeedState.hasLoadedLiveCatalog) return;
    if (typeof renderDynamicHome === 'function') {
      renderDynamicHome();
    }
    const elapsed = Date.now() - (homeFeedState.lastHomeRefreshAt || 0);
    if (elapsed > 120000 && spotifyAuth && spotifyAuth.accessToken) {
      homeFeedState.lastHomeRefreshAt = Date.now();
      const recentRes = await spotifyFetch('/me/player/recently-played?limit=30').catch(() => null);
      if (recentRes && Array.isArray(recentRes.items)) {
        ingestCatalogData({ recentRes });
        if (typeof renderDynamicHome === 'function') {
          renderDynamicHome();
        }
      }
    }
  }

  function clearOnLogout() {
    homeFeedState.activeFilter = 'all';
    homeFeedState.shuffleSalt = 0;
    homeFeedState.userName = '';
    homeFeedState.hasLoadedLiveCatalog = false;
    homeFeedState.shortTermTracks = [];
    homeFeedState.shortTermArtists = [];
    homeFeedState.mediumTermTracks = [];
    homeFeedState.mediumTermArtists = [];
    homeFeedState.longTermTracks = [];
    homeFeedState.longTermArtists = [];
    homeFeedState.recentTracks = [];
    homeFeedState.recentContexts = [];
    homeFeedState.newReleases = [];
    homeFeedState.releasesFetchedOnce = false;
    homeFeedState.isFetchingReleases = false;
    homeFeedState.becauseInFlightIds = {};
    homeFeedState.becauseCache = {};
    safeStorage.removeItem(RELEASES_CACHE_KEY);
    safeStorage.removeItem(RECENT_CTX_CACHE_KEY);
  }

  // Re-compose Home mixes automatically once EchoRadio finishes indexing the local graph
  // Silently update cache when EchoRadio finishes indexing (never pop/yank visible Home cards mid-view)
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('echoradio:graph-ready', () => {
      if (typeof persistCurrentHomeCache === 'function') {
        persistCurrentHomeCache();
      }
    });
  }

  loadPersistedContexts();
  loadPersistedReleases();

  global.HomeFeed = {
    ingestCatalogData,
    preloadSecondaryShelves,
    hydrateFromCache,
    composeHomeModel,
    setFilter,
    shuffleFeed,
    onTrackChanged,
    onReturnToHome,
    refreshNewReleasesInBackground,
    getActiveFilter: () => homeFeedState.activeFilter,
    clearOnLogout
  };
})(typeof window !== 'undefined' ? window : globalThis);
