/* ==========================================================================
   CORE: Dynamic 16x16 Canvas Color Extractor & Lava Mesh Palette Engine
   ========================================================================== */
'use strict';

// --------------------------------------------------------------------------
// 4. DYNAMIC 16x16 CANVAS COLOR EXTRACTOR (LIGHT & APPLE MUSIC DARK PALETTE)
// --------------------------------------------------------------------------
let currentLavaRgb = [
  [45, 66, 57],
  [28, 42, 36],
  [58, 82, 70],
  [20, 30, 26]
];
let lavaColorRaf = null;

// Cache en memoria de paletas extraídas por URL para evitar re-computar y dar 0ms de respuesta
const paletteCache = new Map();
let lastTrackPaletteCoverUrl = '';
let lastAlbumPaletteCoverUrl = '';

function animateLavaPaletteTo(targetRgbQuad) {
  if (lavaColorRaf) cancelAnimationFrame(lavaColorRaf);
  const startQuad = currentLavaRgb.map(c => c.slice());
  const startTime = performance.now();
  const duration = 950;

  function tickPalette(now) {
    const t = Math.min(1, (now - startTime) / duration);
    // Cubic ease-out for silky ambient color morph
    const ease = 1 - Math.pow(1 - t, 3);
    for (let i = 0; i < 4; i++) {
      const r = Math.round(startQuad[i][0] + (targetRgbQuad[i][0] - startQuad[i][0]) * ease);
      const g = Math.round(startQuad[i][1] + (targetRgbQuad[i][1] - startQuad[i][1]) * ease);
      const b = Math.round(startQuad[i][2] + (targetRgbQuad[i][2] - startQuad[i][2]) * ease);
      currentLavaRgb[i] = [r, g, b];
      root.style.setProperty(`--np-c${i + 1}`, `rgb(${r}, ${g}, ${b})`);
    }
    if (t < 1) {
      lavaColorRaf = requestAnimationFrame(tickPalette);
    } else {
      lavaColorRaf = null;
    }
  }
  lavaColorRaf = requestAnimationFrame(tickPalette);
}

function applyExtractedPaletteData(palette, applyToLightBg = false) {
  if (!palette) return;

  if (!applyToLightBg) {
    // Aplicar al fondo dinámico Apple Music Now Playing (Lava Mesh)
    animateLavaPaletteTo(palette.lavaQuad);
    return;
  }

  // Aplicar a la vista de detalle de Álbum / Artista
  if (state.activeScreen === 'album' && (state.selectedEntityId === 'liked_songs' || (liveCatalog.entities[state.selectedEntityId] && liveCatalog.entities[state.selectedEntityId].type === 'liked'))) {
    applyNeutralLikedTheme();
    return;
  }

  const { dom, sec, avgLum } = palette;

  function saturateAndScale(rgb, satBoost, lumScale, minVal = 6, maxVal = 248) {
    const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
    const r = Math.min(maxVal, Math.max(minVal, Math.round((mean + (rgb[0] - mean) * satBoost) * lumScale)));
    const g = Math.min(maxVal, Math.max(minVal, Math.round((mean + (rgb[1] - mean) * satBoost) * lumScale)));
    const b = Math.min(maxVal, Math.max(minVal, Math.round((mean + (rgb[2] - mean) * satBoost) * lumScale)));
    return [r, g, b];
  }

  const isDarkTheme = document.body.classList.contains('theme-dark');

  if (isDarkTheme) {
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
    if (typeof uiLog === 'function') {
      uiLog('TINT', `Applied dark palette top=rgb(${topRgb.join(',')}) screen=${state.activeScreen}`);
    }
  } else {
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
    if (typeof uiLog === 'function') {
      uiLog('TINT', `Applied ${isLightAlbum ? 'light' : 'dark'} palette dom=rgb(${dom.join(',')}) screen=${state.activeScreen}`);
    }
  }
}

function computePaletteFromImageElement(img) {
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

  const q1 = sampleArea(1, 1, 6, 6);
  const q2 = sampleArea(8, 1, 6, 6);
  const q3 = sampleArea(1, 8, 6, 6);
  const q4 = sampleArea(8, 8, 6, 6);

  function toLavaRgbTuple(rgb, scale, sat = 1.85) {
    const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
    let r = (avg + (rgb[0] - avg) * sat) * scale;
    let g = (avg + (rgb[1] - avg) * sat) * scale;
    let b = (avg + (rgb[2] - avg) * sat) * scale;
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
    return [r, g, b];
  }

  const lavaQuad = [
    toLavaRgbTuple(q1, 0.78, 1.95),
    toLavaRgbTuple(q2, 0.56, 1.80),
    toLavaRgbTuple(q3, 0.72, 1.90),
    toLavaRgbTuple(q4, 0.30, 1.65)
  ];

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

  return { lavaQuad, dom, sec, avgLum };
}

function storePaletteInCache(primaryUrl, altUrls, paletteData) {
  if (!paletteData) return;
  if (primaryUrl) paletteCache.set(primaryUrl, paletteData);
  if (Array.isArray(altUrls)) {
    altUrls.forEach(u => {
      if (u && typeof u === 'string') paletteCache.set(u, paletteData);
    });
  }
}

function extractDynamicPaletteFromCover(imgUrl, applyToLightBg = false, altUrls = []) {
  if (!imgUrl || imgUrl.startsWith('data:image')) return false;

  if (applyToLightBg) {
    lastAlbumPaletteCoverUrl = imgUrl;
  } else {
    lastTrackPaletteCoverUrl = imgUrl;
  }

  // 1. Caché en memoria (0ms instantáneo)
  const candidates = [imgUrl, ...(Array.isArray(altUrls) ? altUrls : [])].filter(Boolean);
  for (const cand of candidates) {
    if (paletteCache.has(cand)) {
      const cached = paletteCache.get(cand);
      storePaletteInCache(imgUrl, altUrls, cached);
      if (typeof uiLog === 'function') uiLog('TINT', `Cache HIT 0ms (${cand.slice(-12)})`);
      applyExtractedPaletteData(cached, applyToLightBg);
      return true;
    }
  }

  // 2. Extracción síncrona en 0ms desde cualquier <img> ya decodificado en el DOM
  if (document.images) {
    for (let i = 0; i < document.images.length; i++) {
      const domImg = document.images[i];
      if (domImg && domImg.complete && domImg.naturalWidth > 0 && candidates.includes(domImg.src)) {
        try {
          const paletteData = computePaletteFromImageElement(domImg);
          storePaletteInCache(imgUrl, altUrls, paletteData);
          if (typeof uiLog === 'function') uiLog('TINT', `DOM SYNC 0ms (${domImg.src.slice(-12)})`);
          applyExtractedPaletteData(paletteData, applyToLightBg);
          return true;
        } catch (err) {
          // Si el <img> fue cacheado sin CORS previamente, continuará al paso 3 con ?cors=1
        }
      }
    }
  }

  // 3. Carga asíncrona con protección contra condición de carrera y bypass de caché sin CORS
  const startMs = performance.now();
  function loadWithCors(targetSrc, isRetry) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        const paletteData = computePaletteFromImageElement(img);
        storePaletteInCache(imgUrl, altUrls, paletteData);
        const dt = Math.round(performance.now() - startMs);
        // Solo aplicar si sigue siendo la portada activa solicitada
        const isStillCurrent = applyToLightBg
          ? (lastAlbumPaletteCoverUrl === imgUrl || candidates.includes(lastAlbumPaletteCoverUrl))
          : (lastTrackPaletteCoverUrl === imgUrl || candidates.includes(lastTrackPaletteCoverUrl));
        if (typeof uiLog === 'function') {
          uiLog('TINT', `Async load +${dt}ms (${imgUrl.slice(-12)}) active=${isStillCurrent}`);
        }
        if (isStillCurrent) {
          applyExtractedPaletteData(paletteData, applyToLightBg);
        }
      } catch (e) {
        if (!isRetry) {
          const sep = imgUrl.includes('?') ? '&' : '?';
          loadWithCors(`${imgUrl}${sep}cors=1`, true);
        }
      }
    };
    img.onerror = function () {
      if (!isRetry) {
        const sep = imgUrl.includes('?') ? '&' : '?';
        loadWithCors(`${imgUrl}${sep}cors=1`, true);
      } else if (typeof uiLog === 'function') {
        uiLog('ERR', `Tint image load failed: ${imgUrl.slice(-16)}`);
      }
    };
    img.src = targetSrc;
  }

  loadWithCors(imgUrl, false);
  return false;
}

function prewarmTrackPalette(imgUrl, altUrls = []) {
  if (!imgUrl || imgUrl.startsWith('data:image')) return;
  const candidates = [imgUrl, ...(Array.isArray(altUrls) ? altUrls : [])].filter(Boolean);
  for (const cand of candidates) {
    if (paletteCache.has(cand)) {
      storePaletteInCache(imgUrl, altUrls, paletteCache.get(cand));
      return;
    }
  }
  if (document.images) {
    for (let i = 0; i < document.images.length; i++) {
      const domImg = document.images[i];
      if (domImg && domImg.complete && domImg.naturalWidth > 0 && candidates.includes(domImg.src)) {
        try {
          const paletteData = computePaletteFromImageElement(domImg);
          storePaletteInCache(imgUrl, altUrls, paletteData);
          return;
        } catch (err) {}
      }
    }
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function () {
    try {
      const paletteData = computePaletteFromImageElement(img);
      storePaletteInCache(imgUrl, altUrls, paletteData);
    } catch (e) {}
  };
  img.src = imgUrl;
}

