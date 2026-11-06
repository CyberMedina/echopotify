# Spotify Echo Show 8 (1st Gen) — Apple Music Edition
## Design System & Interactive Architecture (`1280x800`)

### 1. Target Hardware & Performance Budget
- **Device:** Amazon Echo Show 8 (1st Gen, codename `crown` / `lineage_crown`)
- **OS:** LineageOS 18.1 (Android 11 / API 30, sin Google Play Services)
- **Viewport nativo:** `1280 × 800 px` (formato horizontal 16:10)
- **SoC / RAM:** MediaTek MT8163 (Quad-core Cortex-A53) + 1 GB RAM
- **Estrategia de renderizado 60 FPS (Zero-GPU-Lag):**
  - Prohibido usar `backdrop-filter: blur()` pesado en tiempo real sobre toda la pantalla.
  - **Adaptive Ambient Canvas (`32×32 px`):** Al cargar o cambiar una portada, se dibuja una sola vez en un `<canvas width="32" height="32">` con interpolación bilineal suavizada y se escala por hardware (`transform: scale3d`). Consume **0% de CPU/GPU** durante la reproducción.

---

### 2. Paleta y Tokens Visuales (2 Modos Adaptativos)

#### A. Modo Claro Atmosférico (Home, Library, Search, Detalle de Álbum/Playlist)
Extrae los tonos pastel/luminosos del álbum activo (ej. azul cielo `#A8C0CE` + arena cálido `#E9DFCE` de *Lahai — Sampha*):
- `--bg-canvas-top`: `#AEC2CE`
- `--bg-canvas-bottom`: `#EAE0CF`
- `--text-primary`: `#181B1E`
- `--text-secondary`: `rgba(24, 27, 30, 0.58)`
- `--text-muted`: `rgba(24, 27, 30, 0.42)`
- `--surface-glass`: `rgba(255, 255, 255, 0.62)`
- `--surface-glass-strong`: `rgba(255, 255, 255, 0.82)`
- `--surface-tint-button`: `rgba(24, 27, 30, 0.07)`
- `--divider-hairline`: `rgba(24, 27, 30, 0.06)`
- `--accent-dark-pill`: `#16181A`

#### B. Modo Inmersivo Apple Music (Now Playing + Lyrics a Pantalla Completa)
Extrae los tonos profundos y saturados de la portada activa (ej. verde bosque `#2E4A16`, oliva `#496523` y tierra cálida `#5C3B19` de *Deeper Well — Kacey Musgraves*):
- `--np-text-primary`: `#FFFFFF`
- `--np-text-secondary`: `rgba(255, 255, 255, 0.62)`
- `--np-lyric-inactive`: `rgba(255, 255, 255, 0.32)`
- `--np-lyric-active-pending`: `rgba(255, 255, 255, 0.55)`
- `--np-lyric-active-sung`: `#FFFFFF`
- `--np-control-surface`: `rgba(255, 255, 255, 0.18)`
- `--np-progress-track`: `rgba(255, 255, 255, 0.28)`
- `--np-progress-fill`: `rgba(255, 255, 255, 0.88)`

---

### 3. Tipografía y Escala (`1280×800`)
Familia principal: `'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Inter', sans-serif`
- **Page Header (`Good morning`, `Search`, `Library`):** `42px`, `font-weight: 700`, `letter-spacing: -0.03em`
- **Page Subtitle (`Your music, your mood.`):** `18px`, `font-weight: 400`, `color: var(--text-secondary)`
- **Section Header (`Jump back in`, `Made for you`, etc.):** `20px`, `font-weight: 700`, `letter-spacing: -0.02em`
- **Album Detail Title (`Lahai`):** `28px`, `font-weight: 700`, `letter-spacing: -0.02em`
- **Card Title:** `15px`, `font-weight: 700`
- **Card Subtitle:** `13px`, `font-weight: 500`, `color: var(--text-secondary)`
- **Apple Music Lyrics (Columna Derecha):** `31px`, `font-weight: 700`, `line-height: 1.28`, `letter-spacing: -0.02em`

---

### 4. Especificación de las 5 Pantallas y Componentes Globales

1. **Dock de Navegación Inferior (Global en vistas principales):**
   - Centrado abajo (`bottom: 18px`), cápsula `290 × 62 px`, `border-radius: 999px`, fondo `--surface-glass-strong`.
   - 3 ítems: `Home`, `Library`, `Search`.
2. **Mini-Player Compacto Unificado (Versión 1 aprobada):**
   - Ubicado en la zona inferior derecha (`right: 52px`, `bottom: 94px`), ancho `560px`, alto `68px`, `border-radius: 20px`.
   - Izquierda: Portada `48 × 48 px` (`border-radius: 10px`) + Título en bold (`15px`) + Artista (`13px`).
   - Derecha: Botón `Play/Pause` (`⏸`) y `Next` (`⏭`). Al tocar el Mini-Player se expande la vista **Now Playing + Lyrics**.
3. **Pantalla 1 — Home:**
   - Saludo + botón de perfil circular (`46 × 46 px`).
   - `Jump back in`: 5 tarjetas cuadradas (`border-radius: 18px`).
   - `Made for you`: 2 banners anchos con arte geométrico pastel (`Discover Weekly` en lavanda/azul y `Release Radar` en verde menta) con logo Spotify y botón circular blanco `▶`.
   - `Recently played`: 5 tarjetas inferiores.
4. **Pantalla 2 — Detalle de Álbum / Playlist:**
   - Botón circular `<` arriba a la izquierda (`44 × 44 px`).
   - Columna izquierda (`310px`): Portada cuadrada grande (`border-radius: 20px`), Título, Artista, Género/Año, y fila de acciones (`▶ Play` en píldora negra `170 × 48 px`, más botones circulares `🔀` y `+`).
   - Columna derecha: Lista numerada de canciones con punto indicador `•`, separadores sutiles y menú `⋮`.
5. **Pantalla 3 — Search:**
   - Barra buscadora en píldora a todo lo ancho (`height: 56px`, `border-radius: 999px`).
   - `Recent searches`: Fila de chips en píldora con avatar circular (artistas) o cuadrado redondeado (álbum).
   - `Browse by category`: 4 tarjetas con facetas geométricas pastel (`Playlists`, `Albums`, `Artists`, `Made for you`).
   - `Recently played`: Fila de 5 tarjetas inferiores.
6. **Pantalla 4 — Library:**
   - Barra superior de filtros: Segmented Control de 4 pestañas (`Playlists`, `Albums`, `Artists`, `Liked`) a la izquierda + botón lupa circular `🔍` y selector `Recently added ⌄` a la derecha.
   - Grilla de 6 columnas × 2 filas (incluyendo la tarjeta especial `Liked Songs` con degradado violeta-azul y corazón blanco + soporte para pin verde `📌`).
7. **Pantalla 5 — Now Playing + Lyrics (Apple Music Full Screen):**
   - Botón cerrar `✕` arriba a la izquierda.
   - Columna izquierda (`410px` centrada): Portada `360 × 360 px` con sombra profunda, título + `Artista — Álbum`, botones circulares `★` y `•••`, barra de progreso interactiva con tiempos (`0:25` / `-3:27`), controles Apple Music (`🔀`, `⏪`, `⏸`, `⏩`, `🔁`) y control de volumen inferior (`🔈 ——●——`).
   - Columna derecha: Letras sincronizadas con scroll suave automático, desenfoque progresivo en extremos y **resaltado palabra por palabra (Karaoke Sync)** en el verso activo. Botón de comillas en la esquina inferior derecha.

