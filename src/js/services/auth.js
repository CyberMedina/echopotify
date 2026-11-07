/* ==========================================================================
   SERVICE: Spotify OAuth 2.0 PKCE Engine
   ========================================================================== */
'use strict';

// --------------------------------------------------------------------------
// SPOTIFY OAUTH 2.0 PKCE ENGINE (SECURE BROWSER LOGIN FOR GITHUB PAGES / SILK)
// --------------------------------------------------------------------------
const PKCE_VERIFIER_KEY = 'sp_pkce_code_verifier';

function generateRandomString(length) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  if (window.crypto && window.crypto.getRandomValues) {
    const values = crypto.getRandomValues(new Uint8Array(length));
    return values.reduce((acc, x) => acc + possible[x % possible.length], '');
  }
  let res = '';
  for (let i = 0; i < length; i++) {
    res += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return res;
}

function sha256_pure(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let lengthProperty = 'length';
  let i, j;
  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;
  let hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  hash = hash.slice(0, 8);
  ascii += '\x80';
  while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;
  for (j = 0; j < words[lengthProperty];) {
    const w = words.slice(j, j += 16);
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
          w[i - 16]
          + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
          + w[i - 7]
          + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
        ) | 0);
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);
  for (i = 0; i < 8; i++) {
    view.setUint32(i * 4, hash[i], false);
  }
  return buffer;
}

async function sha256(plain) {
  if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(plain);
      return await window.crypto.subtle.digest('SHA-256', data);
    } catch (e) {
      // Fallback to pure JS
    }
  }
  return sha256_pure(plain);
}

function base64encode(input) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(input)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function getPKCERedirectUri() {
  const raw = window.location.origin + window.location.pathname;
  return raw.replace(/\/index\.html$/, '/');
}

async function startSpotifyPKCELogin() {
  try {
    if (window.location.protocol === 'file:') {
      alert('Spotify OAuth exige abrir la página a través de una URL HTTP o HTTPS (ej. http://localhost:8080, https://192.168.1.17 o GitHub Pages). Los navegadores bloquean las redirecciones a file:///.');
      return;
    }

    const clientId = spotifyAuth.clientId || DEFAULT_CLIENT_ID;
    // Normalizar URI eliminando index.html para coincidir con la configuración del Dashboard
    const redirectUri = getPKCERedirectUri();

    const codeVerifier = generateRandomString(64);
    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64encode(hashed);

    safeStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);

    const scopes = [
      'streaming',
      'user-read-email',
      'user-read-private',
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'user-read-recently-played',
      'user-top-read',
      'user-library-read',
      'user-library-modify',
      'playlist-read-private',
      'playlist-read-collaborative'
    ].join(' ');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: scopes,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      redirect_uri: redirectUri
    });

    console.log('[PKCE] Iniciando login hacia:', redirectUri);
    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
  } catch (err) {
    console.error('[PKCE Error]', err);
    alert('Error al iniciar login con Spotify: ' + (err && err.message ? err.message : err));
  }
}

async function checkPKCEAuthCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const error = urlParams.get('error');

  if (error) {
    console.error('[PKCE Auth Error]', error);
    alert('Error de autenticación con Spotify: ' + error);
    window.history.replaceState({}, document.title, window.location.pathname);
    return false;
  }

  if (!code) return false;

  const codeVerifier = safeStorage.getItem(PKCE_VERIFIER_KEY);
  if (!codeVerifier) {
    console.warn('[PKCE] No code verifier found in storage');
    window.history.replaceState({}, document.title, window.location.pathname);
    return false;
  }

  const clientId = spotifyAuth.clientId || DEFAULT_CLIENT_ID;
  const redirectUri = getPKCERedirectUri();

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
      })
    });

    safeStorage.removeItem(PKCE_VERIFIER_KEY);
    window.history.replaceState({}, document.title, window.location.pathname);

    if (!response.ok) {
      console.error('[PKCE Token Exchange Failed]', response.status);
      return false;
    }

    const data = await response.json();
    if (data.access_token) {
      spotifyAuth.accessToken = data.access_token;
      safeStorage.setItem('sp_access_token', data.access_token);
    }
    if (data.refresh_token) {
      spotifyAuth.refreshToken = data.refresh_token;
      safeStorage.setItem('sp_refresh_token', data.refresh_token);
    }
    console.log('[PKCE] Autenticación completada con éxito!');
    return true;
  } catch (e) {
    console.error('[PKCE Token Exchange Exception]', e);
    window.history.replaceState({}, document.title, window.location.pathname);
    return false;
  }
}

