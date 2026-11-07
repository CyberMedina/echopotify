# echopotify

Spotify Player — Apple Music Edition optimizado para Amazon Echo Show 8 (1280×800) y navegadores web.

## Características

- 🎵 **Spotify Web Playback SDK & Smart Routing**: Reproducción de audio en vivo y control inteligente de dispositivos.
- 🔐 **OAuth 2.0 PKCE + Alexa HTML SDK**: Autenticación 100% en cliente sin servidores intermedios ni mocks.
- 🎨 **Apple Music Design System**: Fondo líquido dinámico extraído en tiempo real (16×16 Canvas), modo claro/oscuro automático y letras karaoke palabra por palabra (LRCLIB).
- 📱 **Echo Show 8 Ready**: Optimizado para resolución horizontal 1280×800 y navegación táctil en Silk Browser / WebView.

## Arquitectura Modular (`src/`)

La aplicación sirve directamente desde `index.html` sin necesidad de bundlers externos, estructurada por dominios:

```text
├── index.html                  # Punto de entrada único (1280x800 Viewport)
└── src/
    ├── css/
    │   ├── base.css            # Variables, Reset, Viewport 1280x800 y Fondo Ambiental
    │   ├── views.css           # Vistas: Home, Álbum/Playlist, Artista, Búsqueda y Biblioteca
    │   ├── now-playing.css     # Reproductor Pantalla Completa, Lava Mesh, Karaoke y Cola
    │   └── theme-modals.css    # Modo Oscuro, Skeletons Shimmer, Login y Ajustes
    └── js/
        ├── core/
        │   ├── state.js        # Estado reactivo, SafeStorage, Caché e Imágenes GPU
        │   ├── dom.js          # Referencias DOM centralizadas
        │   └── color.js        # Extractor de paleta dinámica 16x16 Canvas
        ├── services/
        │   ├── auth.js         # Motor OAuth 2.0 PKCE, Refresh Token y Alexa SDK
        │   ├── spotify.js      # Cliente API Web de Spotify y Web Playback SDK
        │   └── lyrics.js       # Motor de letras sincronizadas LRCLIB
        ├── views/
        │   ├── catalog.js      # Orquestador de datos reales y renderizado de Catálogo
        │   ├── details.js      # Vistas de Álbum, Playlist, Artista y Favoritos
        │   └── player.js       # Sincronización en vivo, Karaoke 60fps y Cola
        ├── controllers/
        │   ├── navigation.js   # Router de pantallas y pila de navegación (History Stack)
        │   └── events.js       # Eventos táctiles, búsqueda en vivo, temas y viewport
        └── main.js             # Inicialización y bucle principal a 60fps
```
