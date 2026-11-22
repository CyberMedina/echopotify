# Spotify Echo Show 8 (3rd Gen) — Apple Music Edition
## Design System & Interactive Architecture (`1024×640` lógico @ `1.25×` / ~200 DPI sobre panel físico `1280×800`)

### 1. Target Hardware & Performance Budget
- **Device:** Amazon Echo Show 8 (3rd Gen — perfil APL `hubLandscapeMedium`, 8.0" 16:10)
- **Resolución física:** `1280 × 800 px` (~189 PPI)
- **Canvas lógico (`1.25×` / ~200 DPI):** `1024 × 640 px` (`--viewport-w: 1024px; --viewport-h: 640px`), escalado automáticamente vía `fitViewport()` (y compatible con navegador Silk si reporta `devicePixelRatio` 1.0 o 1.333)
- **Márgenes y alineación:** Márgenes laterales unificados de `48px` lógicos (`60px` físicos), alineación a la izquierda en cabeceras, secciones, metadatos de tarjetas, listas de pistas y letras (siguiendo el eje vertical de lectura del Alexa Design System)
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

### 3. Tipografía, Iconos y Escala (`1024×640` lógico @ `1.25×`)
Familia principal: `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Inter', 'Segoe UI', Roboto, sans-serif`
- **Page Header (`Good morning`, `Search`, `Library`):** `38px` lógicos (`47.5px` físicos), `font-weight: 700`, `letter-spacing: -0.03em`
- **Page Subtitle (`Your music, your mood.`):** `16.5px` lógicos (`20.6px` físicos), `font-weight: 400`, `color: var(--text-secondary)`
- **Section Header (`Jump back in`, `Made for you`, etc.):** `20px` lógicos (`25px` físicos), `font-weight: 700`, `letter-spacing: -0.02em`
- **Album Detail Title:** `26px` lógicos (`32.5px` físicos), `font-weight: 700`, `letter-spacing: -0.025em`
- **Card Title:** `15.5px` lógicos (`19.4px` físicos), `font-weight: 700`
- **Card Subtitle:** `13.5px` lógicos (`16.9px` físicos), `font-weight: 500`, `color: var(--text-secondary)`
- **Apple Music Lyrics (Columna Derecha):** `29px` lógicos (`36.25px` físicos), `font-weight: 700`, `line-height: 1.24`, `letter-spacing: -0.022em`
- **Piso mínimo de texto:** `13px` lógicos (`16.25px` físicos) en tiempos/captions; badges desde `11–12px` lógicos (`13.75–15px` físicos)
- **Targets táctiles:** `44–64px` lógicos (`55–80px` físicos, alineados a la guía de `64–72 dp` del Alexa Design System para Echo Show)

---

### 4. Especificación de las 5 Pantallas y Componentes Globales

1. **Dock de Navegación Inferior (Global en vistas principales):**
   - Centrado abajo (`bottom: 18px`), cápsula `396 × 70 px` lógicos (`495 × 87.5 px` físicos), `border-radius: 999px`, fondo `--glass-dock`.
   - 3 ítems: `Home`, `Library`, `Search` (iconos `26×26 px`, etiqueta `13.5px`).
2. **Mini-Player Compacto Unificado (Versión 1 aprobada):**
   - Ubicado en la zona inferior derecha (`right: 48px`, `bottom: 98px`), ancho `416px`, alto `68px`, `border-radius: 18px`.
   - Izquierda: Portada `48 × 48 px` (`border-radius: 10px`) + Título en bold (`15.5px`) + Artista (`13.5px`).
   - Derecha: Botones `Like`, `Play/Pause` y `Next` (`46 × 46 px` táctiles, iconos `22–24px`). Al tocar el Mini-Player se expande la vista **Now Playing + Lyrics**.
3. **Pantalla 1 — Home:**
   - Saludo + botón de perfil circular (`48 × 48 px`, icono `22×22`).
   - `Jump back in` / `Favorite artists` / `Recently played` / `Saved albums`: carriles horizontales de **4 columnas** (`gap: 20px`).
   - `Made for you`: 2 banners anchos (`height: 108px`) con arte y botón circular `▶` (`48 × 48 px`).
4. **Pantalla 2 — Detalle de Álbum / Playlist:**
   - Botón circular `<` arriba a la izquierda (`48 × 48 px`).
   - Columna izquierda (`286px`): Portada cuadrada (`272 × 272 px`, `border-radius: 18px`), Título, Artista, Género/Año, y fila de acciones (`▶ Play` en píldora `height: 50px`, más botones circulares `50 × 50 px`).
   - Columna derecha: Lista numerada (`height: 58px`) con botones `Like` y `⋮` (`46 × 46 px`).
5. **Pantalla 3 — Search:**
   - Barra buscadora en píldora a todo lo ancho (`height: 54px`, `border-radius: 999px`).
   - `Recent searches`: Fila de chips en píldora (`height: 50px`).
   - `Browse by category`: 4 tarjetas (`height: 92px`) con iconos `22×22`.
   - `Recently played`: Grilla de **4 columnas**.
6. **Pantalla 4 — Library:**
   - Barra superior de filtros: Segmented Control de 4 pestañas (`Playlists`, `Albums`, `Artists`, `Liked`, `height: 44px`) a la izquierda + botón lupa circular (`48 × 48 px`) y selector `Recently added ⌄` (`height: 48px`) a la derecha.
   - Grilla de **5 columnas** (`gap: 18px / 20px`) incluyendo `Liked Songs` y `DJ Livi`.
7. **Pantalla 5 — Now Playing + Lyrics (Apple Music Full Screen):**
   - Grabber superior deslizable (`top: 4px`).
   - Columna izquierda (`380px`): Portada `264 × 264 px` (`330 × 330 px` físicos en modo dividido, `350 × 350 px` en modo centrado) con sombra profunda, título (`24px`) + `Artista` (`18.5px`), botones circulares (`44 × 44 px`), barra de progreso interactiva (`8px` alto) con tiempos (`13px`), controles Apple Music (`46px` / `56px` / `64px`) y píldora de dispositivo Spotify Connect (`height: 44px`).
   - Columna derecha (`508 × 560 px`): Letras sincronizadas (`29px`, `padding-top: 170px`) o Cola de reproducción con scroll suave y botones inferiores `Letra` / `Cola` (`height: 48px`).

