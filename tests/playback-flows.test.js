'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const SCRIPT_FILES = [
  'src/js/core/state.js',
  'src/js/core/dom.js',
  'src/js/services/spotify.js',
  'src/js/services/lyrics.js',
  'src/js/views/player.js',
  'src/js/controllers/navigation.js',
  'src/js/controllers/events.js'
];

function createClassListStub(owner) {
  const classes = new Set();
  const syncAttr = () => {
    owner.className = Array.from(classes).join(' ');
  };
  return {
    _set: classes,
    add(...names) {
      for (const n of names) {
        if (n) classes.add(n);
      }
      syncAttr();
    },
    remove(...names) {
      for (const n of names) {
        classes.delete(n);
      }
      syncAttr();
    },
    toggle(name, force) {
      if (force === undefined) {
        if (classes.has(name)) {
          classes.delete(name);
          syncAttr();
          return false;
        }
        classes.add(name);
        syncAttr();
        return true;
      }
      if (force) {
        classes.add(name);
        syncAttr();
        return true;
      }
      classes.delete(name);
      syncAttr();
      return false;
    },
    contains(name) {
      return classes.has(name);
    }
  };
}

function createStyleStub() {
  const props = new Map();
  return new Proxy({
    setProperty(k, v) {
      props.set(k, String(v));
    },
    getPropertyValue(k) {
      return props.get(k) || '';
    }
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return props.get(prop) || '';
    },
    set(target, prop, val) {
      props.set(prop, String(val));
      return true;
    }
  });
}

function matchesSelector(el, sel) {
  if (!el || !sel) return false;
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('.')) return Boolean(el.classList && el.classList.contains(sel.slice(1)));
  if (sel.startsWith('[') && sel.endsWith(']')) {
    return el.getAttribute && el.getAttribute(sel.slice(1, -1)) !== null;
  }
  return el.tagName === sel.toUpperCase();
}

function createElementStub(tagName = 'div', id = '', resolveElById = null) {
  const listeners = new Map();
  const attrs = new Map();
  if (id) attrs.set('id', id);
  let rawClassName = '';

  const el = {
    tagName: String(tagName).toUpperCase(),
    id,
    parentElement: null,
    get className() {
      return rawClassName;
    },
    set className(val) {
      rawClassName = String(val || '');
      el.classList._set.clear();
      rawClassName.split(/\s+/).filter(Boolean).forEach(c => el.classList._set.add(c));
    },
    _syncClassNameFromSet(nextVal) {
      rawClassName = String(nextVal || '');
    },
    textContent: '',
    value: '',
    title: '',
    src: '',
    complete: true,
    naturalWidth: 300,
    scrollTop: 0,
    scrollHeight: 400,
    clientHeight: 400,
    offsetHeight: 640,
    offsetTop: 220,
    dataset: {},
    style: createStyleStub(),
    _innerHTML: '',
    get innerHTML() {
      return el._innerHTML;
    },
    set innerHTML(val) {
      el._innerHTML = String(val || '');
    },
    setAttribute(k, v) {
      attrs.set(String(k), String(v));
      if (k === 'class') {
        el.className = String(v);
      }
    },
    getAttribute(k) {
      return attrs.has(String(k)) ? attrs.get(String(k)) : null;
    },
    removeAttribute(k) {
      attrs.delete(String(k));
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type);
      if (list) listeners.set(type, list.filter(f => f !== fn));
    },
    trigger(type, ev = {}) {
      const list = listeners.get(type) || [];
      const payload = {
        target: el,
        currentTarget: el,
        cancelable: true,
        stopPropagation() {},
        preventDefault() {},
        ...ev
      };
      for (const fn of list) fn(payload);
    },
    click() {
      el.trigger('click');
    },
    dispatchEvent() {
      return true;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1024, height: 640, right: 1024, bottom: 640 };
    },
    closest(sel) {
      let cur = el;
      while (cur) {
        if (matchesSelector(cur, sel)) return cur;
        cur = cur.parentElement || null;
      }
      if (sel === '#npRightLyrics' && el.id === 'lyricsScrollTrack' && resolveElById) {
        return resolveElById('npRightLyrics');
      }
      return null;
    },
    remove() {},
    replaceWith() {},
    querySelector(sel) {
      const all = el.querySelectorAll(sel);
      return all.length > 0 ? all[0] : null;
    },
    querySelectorAll(sel) {
      if (sel === '.lyrics-skeleton-list' && el._innerHTML && el._innerHTML.includes('lyrics-skeleton-list')) {
        const sk = createElementStub('div', '', resolveElById);
        sk.parentElement = el;
        return [sk];
      }
      if (sel === '.lyric-line' && el.id === 'lyricsScrollTrack' && el._innerHTML) {
        const matches = [...el._innerHTML.matchAll(/class="(lyric-line[^"]*)"\s+data-line-idx="(\d+)"\s+data-start="([^"]+)"\s+data-end="([^"]+)"/g)];
        return matches.map((m, i) => {
          const lineEl = createElementStub('div', '', resolveElById);
          lineEl.parentElement = el;
          lineEl.setAttribute('class', m[1]);
          lineEl.setAttribute('data-line-idx', m[2]);
          lineEl.setAttribute('data-start', m[3]);
          lineEl.setAttribute('data-end', m[4]);
          lineEl.offsetTop = 180 + i * 48;
          return lineEl;
        });
      }
      if (sel === '.device-other-row' && el.id === 'devicesListContainer' && el._innerHTML) {
        const matches = [...el._innerHTML.matchAll(/class="device-other-row"\s+data-device-id="([^"]*)"\s+data-device-name="([^"]*)"/g)];
        return matches.map(m => {
          const rowEl = createElementStub('div', '', resolveElById);
          rowEl.parentElement = el;
          rowEl.setAttribute('data-device-id', m[1]);
          rowEl.setAttribute('data-device-name', m[2]);
          return rowEl;
        });
      }
      return [];
    }
  };
  el.classList = createClassListStub({
    get className() { return rawClassName; },
    set className(val) { el._syncClassNameFromSet(val); }
  });
  return el;
}

function createPlaybackHarness(opts = {}) {
  const trackedTimeouts = new Set();
  const trackedIntervals = new Set();
  const storageMap = new Map([
    ['sp_access_token', 'tok_initial'],
    ['sp_refresh_token', 'ref_initial'],
    ['sp_client_id', 'cid_initial'],
    ['echo_theme_mode', 'dark'],
    ['sp_lyrics_word_by_word', 'true']
  ]);

  const elementsById = new Map();
  const selectorElements = new Map();
  const documentListeners = new Map();
  const fetchCalls = [];
  const sdkActions = [];
  const toasts = [];
  let createdPlayerConfig = null;
  let createdPlayerInstance = null;
  const sdkListeners = new Map();

  const getEl = (id) => {
    if (!elementsById.has(id)) {
      const created = createElementStub('div', id, getEl);
      elementsById.set(id, created);
      if (id === 'lyricsScrollTrack') {
        created.parentElement = getEl('npRightLyrics');
      } else if (id === 'npRightLyrics' || id === 'npRightQueue') {
        created.parentElement = getEl('npRightColumn');
      }
    }
    return elementsById.get(id);
  };

  const getSelectorEl = (sel) => {
    if (!selectorElements.has(sel)) {
      selectorElements.set(sel, createElementStub('div', '', getEl));
    }
    return selectorElements.get(sel);
  };

  let mockGetCurrentStateImpl = async () => null;
  let mockFetchHandler = async () => ({ ok: true, status: 204, text: async () => '', json: async () => ({}) });

  class MockSpotifyPlayer {
    constructor(config) {
      createdPlayerConfig = config;
      createdPlayerInstance = this;
    }
    addListener(ev, cb) {
      if (!sdkListeners.has(ev)) sdkListeners.set(ev, []);
      sdkListeners.get(ev).push(cb);
    }
    async connect() {
      sdkActions.push({ type: 'connect' });
      return true;
    }
    async disconnect() {
      sdkActions.push({ type: 'disconnect' });
    }
    async activateElement() {
      sdkActions.push({ type: 'activateElement' });
    }
    async getCurrentState() {
      return mockGetCurrentStateImpl();
    }
    async pause() {
      sdkActions.push({ type: 'pause' });
    }
    async resume() {
      sdkActions.push({ type: 'resume' });
    }
    async nextTrack() {
      sdkActions.push({ type: 'nextTrack' });
    }
    async previousTrack() {
      sdkActions.push({ type: 'previousTrack' });
    }
    async seek(ms) {
      sdkActions.push({ type: 'seek', ms });
    }
  }

  class MockImage {
    constructor() {
      this.complete = true;
      this.naturalWidth = 300;
    }
    set src(val) {
      this._src = val;
    }
    get src() {
      return this._src || '';
    }
    decode() {
      return Promise.resolve();
    }
    addEventListener() {}
  }

  const bodyStub = createElementStub('body');
  const docElStub = createElementStub('html');

  const documentStub = {
    body: bodyStub,
    documentElement: docElStub,
    getElementById: (id) => getEl(id),
    querySelector: (sel) => getSelectorEl(sel),
    querySelectorAll: () => [],
    createElement: (tag) => createElementStub(tag),
    addEventListener: (type, fn) => {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(fn);
    }
  };

  const sandbox = {
    console: {
      log() {},
      warn() {},
      error() {}
    },
    Date,
    Math,
    JSON,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Promise,
    URLSearchParams,
    AbortController,
    encodeURIComponent,
    decodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    Image: MockImage,
    performance: { now: () => Date.now() },
    innerWidth: 1024,
    innerHeight: 640,
    navigator: { maxTouchPoints: 0, userAgent: 'EchoShowTestHarness' },
    location: { pathname: '/', hash: '', search: '' },
    history: { replaceState() {} },
    addEventListener(type, fn) {
      if (!documentListeners.has(`win:${type}`)) documentListeners.set(`win:${type}`, []);
      documentListeners.get(`win:${type}`).push(fn);
    },
    removeEventListener(type, fn) {
      const list = documentListeners.get(`win:${type}`);
      if (list) documentListeners.set(`win:${type}`, list.filter(f => f !== fn));
    },
    localStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => { storageMap.set(String(k), String(v)); },
      removeItem: (k) => { storageMap.delete(String(k)); }
    },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    requestAnimationFrame: (cb) => {
      const t = setTimeout(() => {
        trackedTimeouts.delete(t);
        cb(Date.now());
      }, 0);
      trackedTimeouts.add(t);
      return t;
    },
    cancelAnimationFrame: (t) => {
      trackedTimeouts.delete(t);
      clearTimeout(t);
    },
    setTimeout: (fn, ms = 0, ...args) => {
      const t = setTimeout(() => {
        trackedTimeouts.delete(t);
        fn(...args);
      }, ms);
      trackedTimeouts.add(t);
      return t;
    },
    clearTimeout: (t) => {
      trackedTimeouts.delete(t);
      clearTimeout(t);
    },
    setInterval: (fn, ms = 0, ...args) => {
      const iv = setInterval(fn, ms, ...args);
      trackedIntervals.add(iv);
      return iv;
    },
    clearInterval: (iv) => {
      trackedIntervals.delete(iv);
      clearInterval(iv);
    },
    fetch: async (url, init = {}) => {
      let bodyJson = null;
      if (init && typeof init.body === 'string' && init.body.trim().startsWith('{')) {
        try { bodyJson = JSON.parse(init.body); } catch (e) {}
      }
      fetchCalls.push({
        url: String(url),
        method: (init && init.method) ? init.method.toUpperCase() : 'GET',
        body: init ? init.body : undefined,
        bodyJson
      });
      return mockFetchHandler(String(url), init);
    },
    document: documentStub,
    EchoRadio: {
      resetSession() {},
      markHistoryId() {},
      generateRadioTracks: async () => [],
      recordPlaybackOutcome() {},
      recordLiveTransition() {},
      reRankQueueAfterSkip: (_skipped, tail) => [...tail],
      getSessionSubtitle: () => 'Radio • Autoplay'
    },
    extractDynamicPaletteFromCover() {},
    prewarmTrackPalette() {},
    showToast(msg) { toasts.push(msg); },
    openEntityDetail() {},
    openArtistDetail() {},
    navigateToArtist() {},
    renderLibrary() {},
    renderSearch() {},
    toggleLikeTrack() {},
    renderAlbumDetailArtist() {},
    updateLikeButtonsUI() {},
    loadMorePlaylistTracks() {},
    checkAndCacheLikedTracks() {},
    buildSkeletonChipsHTML: () => '',
    buildSkeletonCardsHTML: () => '',
    syncFullscreenSwitchUI() {},
    syncLyricsModeUI() {}
  };

  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  if (!opts.withoutSpotifySdk) {
    sandbox.Spotify = { Player: MockSpotifyPlayer };
  }

  const ctx = vm.createContext(sandbox);
  for (const relPath of SCRIPT_FILES) {
    const absPath = path.join(ROOT_DIR, relPath);
    const code = fs.readFileSync(absPath, 'utf8');
    vm.runInContext(code, ctx, { filename: relPath });
  }

  return {
    ctx,
    eval: (expr) => vm.runInContext(expr, ctx),
    getEl,
    getSelectorEl,
    fetchCalls,
    sdkActions,
    toasts,
    setFetchHandler(fn) {
      mockFetchHandler = fn;
    },
    setGetCurrentState(fn) {
      mockGetCurrentStateImpl = fn;
    },
    setEchoRadio(overrides) {
      Object.assign(ctx.EchoRadio, overrides);
    },
    emitSdkEvent(eventName, payload) {
      const list = sdkListeners.get(eventName) || [];
      for (const cb of list) cb(payload);
    },
    triggerElement(elOrId, type, ev = {}) {
      const targetEl = typeof elOrId === 'string' ? getEl(elOrId) : elOrId;
      if (targetEl && typeof targetEl.trigger === 'function') {
        targetEl.trigger(type, ev);
      }
    },
    triggerDocument(type, ev = {}) {
      const list = documentListeners.get(type) || [];
      const payload = {
        cancelable: true,
        stopPropagation() {},
        preventDefault() {},
        ...ev
      };
      for (const fn of list) fn(payload);
    },
    triggerWindow(type, ev = {}) {
      const list = documentListeners.get(`win:${type}`) || [];
      const payload = {
        cancelable: true,
        stopPropagation() {},
        preventDefault() {},
        ...ev
      };
      for (const fn of list) fn(payload);
    },
    getPlayerConfig: () => createdPlayerConfig,
    getPlayerInstance: () => createdPlayerInstance,
    async flushMicrotasks(ticks = 5) {
      for (let i = 0; i < ticks; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    },
    cleanup() {
      for (const t of trackedTimeouts) clearTimeout(t);
      trackedTimeouts.clear();
      for (const iv of trackedIntervals) clearInterval(iv);
      trackedIntervals.clear();
    }
  };
}

function jsonResponse(obj, status = 200) {
  const txt = JSON.stringify(obj);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => txt,
    json: async () => obj
  };
}

function emptyResponse(status = 204) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 204 ? 'No Content' : 'Error',
    text: async () => '',
    json: async () => ({})
  };
}

test('1. Cold start ignores paused "TV sala" and routes playback to SpotiEcho Web Player once ready', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  const tvDevice = { id: 'tv_sala', name: 'TV sala', type: 'TV', is_active: true };
  h.setFetchHandler(async (url, init) => {
    if (url.includes('/me/player/devices')) {
      return jsonResponse({ devices: [tvDevice] });
    }
    if (url.endsWith('/me/player') && (!init.method || init.method === 'GET')) {
      return jsonResponse({
        is_playing: false,
        progress_ms: 12000,
        device: tvDevice,
        item: {
          id: 'old_track',
          uri: 'spotify:track:old_track',
          name: 'Old Paused Song',
          duration_ms: 200000,
          artists: [{ name: 'Artist' }],
          album: { name: 'Album', images: [] }
        }
      });
    }
    if (url.endsWith('/me/player') && init.method === 'PUT') {
      return emptyResponse(204);
    }
    if (url.includes('/me/player/play')) {
      return emptyResponse(204);
    }
    return emptyResponse(204);
  });

  h.eval('initWebPlayer()');
  await h.eval('pollSpotifyCurrentPlayback()');
  await h.flushMicrotasks();

  assert.equal(h.eval('spotifyAuth.activeDeviceId'), null);
  assert.notEqual(h.getEl('npActiveDeviceName').textContent, 'TV sala');

  const playPromise = h.eval('playSpotifyTrackUri("spotify:track:t1")');
  setTimeout(() => {
    h.emitSdkEvent('ready', { device_id: 'web_dev_1' });
  }, 25);

  await playPromise;

  const transferCall = h.fetchCalls.find(c => c.url.endsWith('/me/player') && c.method === 'PUT');
  assert.ok(transferCall, 'expected silent activation transfer to local SDK');
  assert.deepEqual(transferCall.bodyJson, { device_ids: ['web_dev_1'], play: false });

  const playCall = h.fetchCalls.find(c => c.url.includes('/me/player/play'));
  assert.ok(playCall, 'expected /me/player/play request');
  assert.ok(playCall.url.includes('device_id=web_dev_1'), `expected web_dev_1, got ${playCall.url}`);
  assert.equal(h.eval('spotifyAuth.activeDeviceName'), 'SpotiEcho Web Player');
});

test('2. Fallback when SDK never connects must never auto-select TV or Alexa Speaker', async (t) => {
  const h = createPlaybackHarness({ withoutSpotifySdk: true });
  t.after(() => h.cleanup());

  h.setFetchHandler(async (url) => {
    if (url.includes('/me/player/devices')) {
      return jsonResponse({
        devices: [
          { id: 'tv_sala', name: 'TV sala', type: 'TV', is_active: true },
          { id: 'echo_spk', name: 'Echo Show', type: 'Speaker', is_active: false }
        ]
      });
    }
    return emptyResponse(204);
  });

  const resolvedId = await h.eval('resolvePlaybackDeviceId()');
  assert.equal(resolvedId, '');
  assert.equal(h.eval('spotifyAuth.activeDeviceId'), null);
});

test('3. Explicit user selection of "TV sala" in device picker is preserved when SDK reports ready', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  const devices = [
    { id: 'web_dev_1', name: 'SpotiEcho Web Player', type: 'Computer', is_active: false },
    { id: 'tv_sala', name: 'TV sala', type: 'TV', is_active: false }
  ];

  h.setFetchHandler(async (url, init) => {
    if (url.endsWith('/me/player') && init.method === 'PUT') {
      return emptyResponse(204);
    }
    if (url.includes('/me/player/devices')) {
      return jsonResponse({ devices });
    }
    return emptyResponse(204);
  });

  h.eval(`
    renderDevicesList([
      { id: 'web_dev_1', name: 'SpotiEcho Web Player', type: 'Computer', is_active: false },
      { id: 'tv_sala', name: 'TV sala', type: 'TV', is_active: false }
    ]);
  `);

  const ok = await h.eval('transferPlaybackToDevice("tv_sala", true)');
  assert.equal(ok, true);
  h.eval('state.userSelectedDeviceId = "tv_sala"');

  h.eval('initWebPlayer()');
  h.emitSdkEvent('ready', { device_id: 'web_dev_1' });

  assert.equal(h.eval('spotifyAuth.activeDeviceId'), 'tv_sala');
  const resolved = await h.eval('resolvePlaybackDeviceId()');
  assert.equal(resolved, 'tv_sala');
});

test('4. Playing an album after Radio clears Radio before UI sync, disables Shuffle, and preserves album order', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.setFetchHandler(async () => emptyResponse(204));

  h.eval(`
    spotifyAuth.activeDeviceId = 'web_dev_1';
    webPlayerDeviceId = 'web_dev_1';
    webPlayer = { activateElement() {}, getCurrentState: async () => null };
    webPlayerTransferredOnce = true;
    spotifyAuth.shuffleState = true;
    state.isAutoplayQueue = true;
    state.autoplaySessionTracks = [
      { id: 'rad1', uri: 'spotify:track:rad1', title: 'Radio 1', artist: 'R', cover: '' },
      { id: 'rad2', uri: 'spotify:track:rad2', title: 'Radio 2', artist: 'R', cover: '' }
    ];
    state.autoplaySessionIndex = 0;
    liveCatalog.entities['alb_1'] = {
      id: 'alb_1',
      spotifyId: 'alb1',
      type: 'album',
      uri: 'spotify:album:alb1',
      title: 'Album Test',
      artist: 'Album Artist',
      cover: 'https://example.com/alb.jpg',
      coverLarge: 'https://example.com/alb.jpg',
      tracks: [
        { id: 'a1', uri: 'spotify:track:a1', title: 'Track 1', artist: 'Album Artist', duration: 180 },
        { id: 'a2', uri: 'spotify:track:a2', title: 'Track 2', artist: 'Album Artist', duration: 190 },
        { id: 'a3', uri: 'spotify:track:a3', title: 'Track 3', artist: 'Album Artist', duration: 200 }
      ]
    };
    state.selectedEntityId = 'alb_1';
    startAlbumOrPlaylistPlayback(false);
  `);

  await h.flushMicrotasks();

  assert.equal(h.eval('state.isAutoplayQueue'), false);
  assert.equal(h.eval('state.autoplaySessionTracks.length'), 0);
  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.liveQueueTracks.map(x => x.id))')),
    ['a2', 'a3']
  );

  const shuffleOffIdx = h.fetchCalls.findIndex(c => c.url.includes('/me/player/shuffle?state=false') && c.method === 'PUT');
  const playIdx = h.fetchCalls.findIndex(c => c.url.includes('/me/player/play') && c.method === 'PUT');
  assert.ok(shuffleOffIdx >= 0, 'expected PUT /me/player/shuffle?state=false');
  assert.ok(playIdx > shuffleOffIdx, 'expected shuffle disable before /me/player/play');
  assert.deepEqual(h.fetchCalls[playIdx].bodyJson, {
    context_uri: 'spotify:album:alb1',
    offset: { position: 0 }
  });
});

test('5. Radio fast-skip (<10s) keeps visible Queue #1 intact and only re-ranks #2+', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.setFetchHandler(async () => emptyResponse(204));
  h.setEchoRadio({
    reRankQueueAfterSkip: (_skipped, tail) => [...tail].reverse()
  });

  h.eval(`
    spotifyAuth.activeDeviceId = 'web_dev_1';
    webPlayerDeviceId = 'web_dev_1';
    webPlayerTransferredOnce = true;
    state.isAutoplayQueue = true;
    state.autoplaySessionTracks = [
      { id: 't0', uri: 'spotify:track:t0', title: 'T0', artist: 'A0', duration: 200 },
      { id: 't1', uri: 'spotify:track:t1', title: 'T1', artist: 'A1', duration: 200 },
      { id: 't2', uri: 'spotify:track:t2', title: 'T2', artist: 'A2', duration: 200 },
      { id: 't3', uri: 'spotify:track:t3', title: 'T3', artist: 'A3', duration: 200 }
    ];
    state.autoplaySessionIndex = 0;
    state.liveQueueTracks = state.autoplaySessionTracks.slice(1);
    state.playingTrackId = 't0';
    state.playingTrackTitle = 'T0';
    state.currentTimeSec = 3;
    state.durationSec = 200;
  `);

  await h.eval('skipNextTrack()');

  assert.equal(h.eval('state.playingTrackId'), 't1');
  assert.equal(h.eval('state.isAutoplayQueue'), true);
  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.liveQueueTracks.map(x => x.id))')),
    ['t3', 't2']
  );
  const playCall = h.fetchCalls.find(c => c.url.includes('/me/player/play'));
  assert.deepEqual(playCall.bodyJson.uris, [
    'spotify:track:t1',
    'spotify:track:t3',
    'spotify:track:t2'
  ]);
});

test('6. Active Web SDK track_window.next_tracks keeps Queue #1 aligned with Next under Shuffle', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.eval('initWebPlayer()');
  h.emitSdkEvent('ready', { device_id: 'web_dev_1' });

  h.setGetCurrentState(async () => ({
    paused: false,
    position: 5000,
    shuffle: true,
    track_window: {
      current_track: {
        id: 'cur_t',
        uri: 'spotify:track:cur_t',
        name: 'Current Song',
        duration_ms: 180000,
        artists: [{ name: 'Artist' }],
        album: { name: 'Alb', images: [] }
      },
      next_tracks: [
        {
          id: 'shuf_1',
          uri: 'spotify:track:shuf_1',
          name: 'Shuffled Next',
          duration_ms: 195000,
          artists: [{ name: 'Artist' }],
          album: { name: 'Alb', images: [] }
        }
      ]
    }
  }));

  h.setFetchHandler(async (url) => {
    if (url.includes('/me/player/queue')) {
      return jsonResponse({
        queue: [
          {
            id: 'stale_api',
            uri: 'spotify:track:stale_api',
            name: 'Stale API Song',
            duration_ms: 180000,
            artists: [{ name: 'Other' }],
            album: { name: 'OtherAlb', images: [] }
          }
        ]
      });
    }
    return emptyResponse(204);
  });

  h.eval(`
    spotifyAuth.shuffleState = true;
    state.isAutoplayQueue = false;
    state.playingTrackId = 'cur_t';
    state.playingTrackTitle = 'Current Song';
    state.contextUpcomingTracks = [
      { id: 'seq_next', uri: 'spotify:track:seq_next', title: 'Sequential Next', artist: 'Artist', duration: 180 }
    ];
  `);

  await h.eval('fetchAndRenderQueueForCurrentTrack()');
  assert.equal(h.eval('state.liveQueueTracks[0].id'), 'shuf_1');

  await h.eval('skipNextTrack()');
  assert.equal(h.eval('state.playingTrackId'), 'shuf_1');
  assert.ok(h.sdkActions.some(a => a.type === 'nextTrack'), 'expected webPlayer.nextTrack()');
});

test('7. Discovery #1 plays directly on Next when real queue is empty', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.setFetchHandler(async (url) => {
    if (url.includes('/me/player')) return emptyResponse(204);
    return emptyResponse(204);
  });

  h.eval(`
    initWebPlayer();
    spotifyAuth.activeDeviceId = 'web_dev_1';
    webPlayerDeviceId = 'web_dev_1';
    webPlayerTransferredOnce = true;
    state.isAutoplayQueue = false;
    state.liveQueueTracks = [];
    state.sdkNextTracks = [];
    state.contextUpcomingTracks = [];
    state.playingTrackId = 'seed_0';
    state.playingTrackTitle = 'Seed';
    state.currentTimeSec = 15;
    state.discoveryTracks = [
      { id: 'disc_1', uri: 'spotify:track:disc_1', title: 'Discovery #1', artist: 'Disc Artist', album: 'Disc Alb', duration: 205 },
      { id: 'disc_2', uri: 'spotify:track:disc_2', title: 'Discovery #2', artist: 'Disc Artist', album: 'Disc Alb', duration: 210 }
    ];
  `);

  await h.eval('skipNextTrack()');

  assert.equal(h.eval('state.playingTrackId'), 'disc_1');
  assert.equal(h.sdkActions.some(a => a.type === 'nextTrack'), false);
  const playCall = h.fetchCalls.find(c => c.url.includes('/me/player/play'));
  assert.ok(playCall, 'expected direct play request for discovery #1');
  assert.deepEqual(playCall.bodyJson, { uris: ['spotify:track:disc_1'] });
});

test('8. Cold-start lyrics recover on Play, reset lyricsLoading, exit centered mode, and tolerate artists: []', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  let mode = 'lyricsplus_hit';
  h.setFetchHandler(async (url) => {
    if (mode === 'lyricsplus_hit' && url.includes('lyricsplus.binimum.org')) {
      return jsonResponse({
        metadata: { title: 'Song A', totalDuration: '3:05' },
        lyrics: [
          {
            time: 1000,
            duration: 2000,
            text: 'Hola mundo',
            syllabus: [
              { time: 1000, duration: 900, text: 'Hola ' },
              { time: 1900, duration: 1100, text: 'mundo' }
            ]
          },
          {
            time: 150000,
            duration: 3000,
            text: 'Final',
            syllabus: [{ time: 150000, duration: 3000, text: 'Final' }]
          }
        ]
      });
    }
    if (mode === 'cold_fail') {
      return emptyResponse(404);
    }
    if (mode === 'lrclib_recover' && url.includes('lrclib.net/api/get')) {
      return jsonResponse({
        instrumental: false,
        syncedLyrics: '[00:02.00] Linea uno\n[00:10.00] Linea dos'
      });
    }
    return emptyResponse(204);
  });

  // Sub-case A: LyricsPlus hit + empty artists: [] safety + exits 'centered'
  h.eval(`
    state.nowPlayingMode = 'centered';
    state.userForcedCentered = false;
    state.userPrefersLyrics = true;
    applyTrackToUI({
      id: 'tr_a',
      uri: 'spotify:track:tr_a',
      name: 'Song A',
      artists: [],
      artist: 'Artist A',
      duration_ms: 185000
    }, 0, true, 'user');
  `);
  await h.flushMicrotasks(10);

  assert.equal(h.eval('state.lyricsLoading'), false);
  assert.equal(h.eval('state.hasValidLyrics'), true);
  assert.equal(h.eval('state.nowPlayingMode'), 'lyrics');

  // Sub-case B: Cold start failure on paused cached track, then recovery on Play
  mode = 'cold_fail';
  h.eval(`
    applyTrackToUI({
      id: 'tr_b',
      uri: 'spotify:track:tr_b',
      name: 'Song B',
      artists: [{ name: 'Artist B' }],
      duration_ms: 210000
    }, 0, false, 'user');
  `);
  await h.flushMicrotasks(10);

  assert.equal(h.eval('state.lyricsLoading'), false);
  assert.equal(h.eval('state.hasValidLyrics'), false);
  assert.equal(h.eval('state.nowPlayingMode'), 'centered');

  mode = 'lrclib_recover';
  h.getEl('lyricsScrollTrack').classList.add('lyrics-fade-out');
  h.eval(`
    spotifyAuth.activeDeviceId = 'web_dev_1';
    webPlayerDeviceId = 'web_dev_1';
    webPlayer = {
      activateElement() {},
      getCurrentState: async () => ({ track_window: { current_track: { id: 'tr_b' } } }),
      resume: async () => {}
    };
  `);
  await h.eval('togglePlayPause()');
  await h.flushMicrotasks(10);

  assert.equal(h.eval('state.lyricsLoading'), false);
  assert.equal(h.eval('state.hasValidLyrics'), true);
  assert.equal(h.eval('state.nowPlayingMode'), 'lyrics');
  assert.equal(h.getEl('lyricsScrollTrack').classList.contains('lyrics-fade-out'), false);
});

test('9. Slow cold-start DRM (~900ms) keeps Apple Music buffering shimmer on scrubber and avoids watchdog restart', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.setFetchHandler(async () => emptyResponse(204));
  h.eval('initWebPlayer()');
  h.emitSdkEvent('ready', { device_id: 'web_dev_1' });

  let sdkCurrentState = null;
  h.setGetCurrentState(async () => sdkCurrentState);

  const playPromise = h.eval('playSpotifyTrackUri("spotify:track:slow_drm")');
  await h.flushMicrotasks();

  // While waiting for first audio frame, buffering shimmer is active on scrubber & cover (not paused)
  assert.equal(h.eval('state.isBuffering'), true);
  assert.equal(h.getEl('npScrubberTrack').classList.contains('is-buffering'), true);
  assert.equal(h.getSelectorEl('.np-scrubber-wrap').classList.contains('is-buffering'), true);
  assert.equal(h.getEl('npCoverStage').classList.contains('is-buffering'), true);
  assert.equal(h.getEl('miniPlayer').classList.contains('is-buffering'), true);

  await playPromise;

  // Simulate Widevine DRM + first chunk finishing at ~900ms (before 2200ms watchdog!)
  await new Promise(r => setTimeout(r, 900));
  sdkCurrentState = {
    paused: false,
    position: 180,
    shuffle: false,
    repeat_mode: 0,
    track_window: {
      current_track: {
        id: 'slow_drm',
        uri: 'spotify:track:slow_drm',
        name: 'Slow DRM Song',
        duration_ms: 210000,
        artists: [{ name: 'Artist' }],
        album: { name: 'Album', images: [] }
      },
      next_tracks: []
    }
  };
  h.emitSdkEvent('player_state_changed', sdkCurrentState);
  await h.flushMicrotasks();

  assert.equal(h.eval('state.isBuffering'), false);
  assert.equal(h.getEl('npScrubberTrack').classList.contains('is-buffering'), false);
  assert.equal(h.getEl('npCoverStage').classList.contains('is-buffering'), false);

  // Wait past 2200ms watchdog to prove it never re-transfers or restarts playback
  await new Promise(r => setTimeout(r, 1500));
  const playCalls = h.fetchCalls.filter(c => c.url.includes('/me/player/play'));
  const transferCalls = h.fetchCalls.filter(c => c.url.endsWith('/me/player') && c.method === 'PUT');
  assert.equal(playCalls.length, 1, 'expected exactly one /me/player/play with zero restarts');
  assert.equal(transferCalls.length, 1, 'expected exactly one initial transfer');
});

test('10. Cold togglePlayPause waits for SDK without 404, starts track cleanly, and ignores rapid double-tap while buffering', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.setFetchHandler(async () => emptyResponse(204));
  h.setGetCurrentState(async () => null);
  h.eval(`
    initWebPlayer();
    state.playingTrackId = 'cached_1';
    state.playingTrackUri = 'spotify:track:cached_1';
    state.playingTrackTitle = 'Cached Song';
    state.isPlaying = false;
  `);

  const togglePromise = h.eval('togglePlayPause()');
  assert.equal(h.eval('state.isPlaying'), true);
  assert.equal(h.eval('state.isBuffering'), true);

  // Impatient second tap 60ms later while still connecting/buffering must be ignored
  await new Promise(r => setTimeout(r, 60));
  await h.eval('togglePlayPause()');
  assert.equal(h.eval('state.isPlaying'), true);

  setTimeout(() => {
    h.emitSdkEvent('ready', { device_id: 'web_dev_1' });
  }, 40);

  await togglePromise;
  await h.flushMicrotasks();

  const playCalls = h.fetchCalls.filter(c => c.url.includes('/me/player/play'));
  assert.equal(playCalls.length, 1, 'expected single /me/player/play without initial empty 404 call');
  assert.deepEqual(playCalls[0].bodyJson, { uris: ['spotify:track:cached_1'] });
});

test('11. Cold-start token refresh deduplicates getOAuthToken and device pill shows connecting before ready', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.setFetchHandler(async (url) => {
    if (url.includes('accounts.spotify.com/api/token')) {
      return jsonResponse({ access_token: 'fresh_tok_123' });
    }
    return emptyResponse(204);
  });

  const ok = await h.eval('refreshSpotifyAccessToken()');
  assert.equal(ok, true);

  h.eval('initWebPlayer()');
  assert.equal(h.getEl('npActiveDeviceOverline').textContent, 'CONECTANDO AUDIO');
  assert.equal(h.getEl('npActiveDeviceName').textContent, 'Conectando SpotiEcho…');
  assert.equal(h.getEl('npDeviceIndicatorRow').classList.contains('is-connecting'), true);

  const cfg = h.getPlayerConfig();
  let suppliedToken = null;
  await cfg.getOAuthToken(tok => { suppliedToken = tok; });
  assert.equal(suppliedToken, 'fresh_tok_123');

  const tokenCalls = h.fetchCalls.filter(c => c.url.includes('accounts.spotify.com/api/token'));
  assert.equal(tokenCalls.length, 1, 'getOAuthToken should reuse freshly refreshed token');

  h.emitSdkEvent('ready', { device_id: 'web_dev_1' });
  assert.equal(h.getEl('npActiveDeviceOverline').textContent, 'REPRODUCIENDO EN');
  assert.equal(h.getEl('npActiveDeviceName').textContent, 'SpotiEcho Web Player');
  assert.equal(h.getEl('npDeviceIndicatorRow').classList.contains('is-connecting'), false);
  assert.equal(h.getEl('npDeviceIndicatorRow').classList.contains('has-device'), true);
});

test('12. Reload with stale cached track resumes live Spotify cloud session on cold togglePlayPause without overwriting it', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  const songB = {
    id: 'song_b',
    uri: 'spotify:track:song_b',
    name: 'Real Active Song B',
    duration_ms: 215000,
    artists: [{ name: 'Artist B' }],
    album: { name: 'Album B', images: [] }
  };

  let transferredToLocal = false;
  h.setFetchHandler(async (url, init) => {
    if (url.endsWith('/me/player') && (!init.method || init.method === 'GET')) {
      return jsonResponse({
        is_playing: false,
        progress_ms: 83000,
        device: { id: 'phone_1', name: 'Phone', type: 'Smartphone', is_active: true },
        item: songB
      });
    }
    if (url.endsWith('/me/player') && init.method === 'PUT') {
      transferredToLocal = true;
    }
    return emptyResponse(204);
  });
  h.setGetCurrentState(async () => (transferredToLocal ? {
    paused: false,
    position: 83200,
    track_window: { current_track: songB, next_tracks: [] }
  } : null));

  h.eval(`
    initWebPlayer();
    applyTrackToUI({
      id: 'song_a',
      uri: 'spotify:track:song_a',
      name: 'Old Cached Song A',
      artists: [{ name: 'Artist A' }],
      duration_ms: 190000
    }, 0, false, 'cache');
  `);

  assert.equal(h.eval('state.isCachedPlaceholderTrack'), true);
  assert.equal(h.eval('state.playingTrackId'), 'song_a');

  const togglePromise = h.eval('togglePlayPause()');
  setTimeout(() => {
    h.emitSdkEvent('ready', { device_id: 'web_dev_1' });
  }, 30);

  await togglePromise;
  await h.flushMicrotasks();

  const transferPlayCall = h.fetchCalls.find(c => c.url.endsWith('/me/player') && c.method === 'PUT');
  assert.ok(transferPlayCall, 'expected PUT /me/player transfer with play: true');
  assert.deepEqual(transferPlayCall.bodyJson, { device_ids: ['web_dev_1'], play: true });

  const stalePlayCalls = h.fetchCalls.filter(c => c.url.includes('/me/player/play'));
  assert.equal(stalePlayCalls.length, 0, 'must never overwrite cloud session with stale cached track via /me/player/play');

  assert.equal(h.eval('state.playingTrackId'), 'song_b');
  assert.equal(h.eval('state.isCachedPlaceholderTrack'), false);
  assert.equal(Math.round(h.eval('state.currentTimeSec')), 83);
});

test('13. Real track playback persists to sp_last_played_track and cache/context loads do not clobber it', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.eval(`
    applyTrackToUI({
      id: 'song_real',
      uri: 'spotify:track:song_real',
      name: 'Real Persisted Song',
      artists: [{ name: 'Real Artist' }],
      album: { name: 'Real Album', images: [] },
      duration_ms: 215000
    }, 0, true, 'user');
  `);
  await h.flushMicrotasks();

  const loaded1 = JSON.parse(h.eval('JSON.stringify(loadLastPlayedTrack())'));
  assert.equal(loaded1.id, 'song_real');
  assert.equal(loaded1.name, 'Real Persisted Song');
  assert.equal(loaded1.duration, 215);

  // Cache placeholder or context-only URI must not overwrite real saved track
  h.eval(`
    applyTrackToUI({
      id: 'song_old',
      uri: 'spotify:track:song_old',
      name: 'Stale Cache Song',
      artists: [{ name: 'Old Artist' }],
      duration_ms: 180000
    }, 0, false, 'cache');
    applyTrackToUI({
      id: 'alb_ctx',
      uri: 'spotify:album:alb_ctx',
      name: 'Album Title',
      artists: [{ name: 'Album Artist' }]
    }, 0, true, 'user');
  `);

  const loaded2 = JSON.parse(h.eval('JSON.stringify(loadLastPlayedTrack())'));
  assert.equal(loaded2.id, 'song_real');
  assert.equal(loaded2.name, 'Real Persisted Song');
});

test('14. Reload from dead SpotiEcho tab plays cloud album track directly at saved position_ms instead of silent transfer no-op', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  const songB = {
    id: 'song_b',
    uri: 'spotify:track:song_b',
    name: 'Cloud Album Song B',
    duration_ms: 215000,
    artists: [{ name: 'Artist B' }],
    album: { name: 'Album B', images: [] }
  };

  h.setFetchHandler(async (url, init) => {
    if (url.endsWith('/me/player') && (!init.method || init.method === 'GET')) {
      return jsonResponse({
        is_playing: false,
        progress_ms: 83000,
        device: { id: 'dead_old_tab', name: 'SpotiEcho Web Player', type: 'Computer', is_active: false },
        context: { uri: 'spotify:album:albB' },
        item: songB
      });
    }
    return emptyResponse(204);
  });
  h.setGetCurrentState(async () => null);

  h.eval(`
    initWebPlayer();
    applyTrackToUI({
      id: 'song_a',
      uri: 'spotify:track:song_a',
      name: 'Old Cached Song A',
      artists: [{ name: 'Artist A' }],
      duration_ms: 190000
    }, 0, false, 'cache');
  `);

  const togglePromise = h.eval('togglePlayPause()');
  setTimeout(() => {
    h.emitSdkEvent('ready', { device_id: 'web_dev_1' });
  }, 30);

  await togglePromise;
  await h.flushMicrotasks();

  const playCall = h.fetchCalls.find(c => c.url.includes('/me/player/play'));
  assert.ok(playCall, 'expected direct /me/player/play call to activate audio');
  assert.deepEqual(playCall.bodyJson, {
    context_uri: 'spotify:album:albB',
    offset: { uri: 'spotify:track:song_b' },
    position_ms: 83000
  });
  assert.equal(h.eval('state.playingTrackId'), 'song_b');
  assert.equal(h.eval('state.isCachedPlaceholderTrack'), false);
});

test('15. Silent 204 transfer no-op from external device triggers direct /me/player/play fallback at 1200ms', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  const songB = {
    id: 'song_b',
    uri: 'spotify:track:song_b',
    name: 'Cloud Song B',
    duration_ms: 215000,
    artists: [{ name: 'Artist B' }],
    album: { name: 'Album B', images: [] }
  };

  h.setFetchHandler(async (url, init) => {
    if (url.endsWith('/me/player') && (!init.method || init.method === 'GET')) {
      return jsonResponse({
        is_playing: false,
        progress_ms: 83000,
        device: { id: 'phone_1', name: 'Phone', type: 'Smartphone', is_active: true },
        item: songB
      });
    }
    return emptyResponse(204);
  });
  // Simulate transfer returning 204 while local Web SDK stays empty (silent no-op)
  h.setGetCurrentState(async () => null);

  h.eval(`
    initWebPlayer();
    applyTrackToUI({
      id: 'song_a',
      uri: 'spotify:track:song_a',
      name: 'Old Cached Song A',
      artists: [{ name: 'Artist A' }],
      duration_ms: 190000
    }, 0, false, 'cache');
  `);

  const togglePromise = h.eval('togglePlayPause()');
  setTimeout(() => {
    h.emitSdkEvent('ready', { device_id: 'web_dev_1' });
  }, 30);

  await togglePromise;
  await new Promise(r => setTimeout(r, 1300));
  await h.flushMicrotasks();

  const playCalls = h.fetchCalls.filter(c => c.url.includes('/me/player/play'));
  assert.ok(playCalls.length >= 1, 'expected fallback /me/player/play after empty SDK check');
  assert.deepEqual(playCalls[0].bodyJson, {
    uris: ['spotify:track:song_b'],
    position_ms: 83000
  });
});

test('16. Manual lyrics scroll pauses auto-follow, enables browse clarity, respects Pause, and snaps back on Play', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.eval(`
    state.isNowPlayingOpen = true;
    state.nowPlayingMode = 'lyrics';
    state.isPlaying = true;
    state.durationSec = 180;
    state.currentTimeSec = 2;
    state.hasValidLyrics = true;
    const sampleLyrics = [
      { start: 0, end: 4, lineEnd: 5, text: 'Line zero alpha' },
      { start: 5, end: 9, lineEnd: 10, text: 'Line one beta' },
      { start: 10, end: 14, lineEnd: 15, text: 'Line two gamma' },
      { start: 15, end: 19, lineEnd: 20, text: 'Line three delta' },
      { start: 20, end: 24, lineEnd: 25, text: 'Line four epsilon' },
      { start: 25, end: 29, lineEnd: 35, text: 'Line five zeta' }
    ];
    state.activeLyrics = sampleLyrics;
    buildLyricsDOM(sampleLyrics);
  `);
  await h.flushMicrotasks(5);
  h.eval('updateScrubberAndLyricsUI(true);');

  assert.equal(h.eval('state.activeLineIndex'), 0);
  assert.equal(h.eval('state.lyricDOMCache[0].targetOffset'), 10);
  assert.equal(h.getEl('lyricsScrollTrack').style.transform, 'translate3d(0, -10.00px, 0)');

  // Scroll manually while playing
  const didScroll = h.eval('scrollLyricsByDelta(160, { snapDelayMs: 80 })');
  assert.equal(didScroll, true);
  assert.equal(h.eval('state.lyricsManualScrolling'), true);
  assert.equal(h.getEl('npRightLyrics').classList.contains('is-manual-scroll'), true);
  assert.equal(h.eval('state.lyricsScrollOffset'), 170);
  assert.equal(h.getEl('lyricsScrollTrack').style.transform, 'translate3d(0, -170.00px, 0)');

  // Playback advances to line 1: active class moves cleanly, but manual scroll offset stays untouched
  h.eval('state.currentTimeSec = 6; updateScrubberAndLyricsUI(false);');
  assert.equal(h.eval('state.activeLineIndex'), 1);
  assert.equal(h.eval('state.lyricDOMCache[1].el.classList.contains("active")'), true);
  assert.equal(h.getEl('lyricsScrollTrack').style.transform, 'translate3d(0, -170.00px, 0)');

  // Pausing freezes snap-back so user can finish reading paused verses
  h.eval('state.isPlaying = false; updatePlayPauseIcons();');
  await new Promise(r => setTimeout(r, 140));
  assert.equal(h.eval('state.lyricsManualScrolling'), true);
  assert.equal(h.getEl('lyricsScrollTrack').style.transform, 'translate3d(0, -170.00px, 0)');

  // Resuming playback schedules smooth snap-back to active line (line 1 -> targetOffset 58)
  h.eval('state.isPlaying = true; updatePlayPauseIcons();');
  await new Promise(r => setTimeout(r, 2600));
  assert.equal(h.eval('state.lyricsManualScrolling'), false);
  assert.equal(h.getEl('npRightLyrics').classList.contains('is-manual-scroll'), false);
  assert.equal(h.getEl('lyricsScrollTrack').style.transform, 'translate3d(0, -58.00px, 0)');
});

test('17. Touch scroll on lyrics ignores swipe-down dismiss, guards accidental clicks after drag, and supports tap-to-seek resync', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.setFetchHandler(async () => emptyResponse(204));
  h.eval(`
    initWebPlayer();
    spotifyAuth.activeDeviceId = 'web_dev_1';
    webPlayerDeviceId = 'web_dev_1';
    state.isNowPlayingOpen = true;
    state.nowPlayingMode = 'lyrics';
    state.isPlaying = true;
    state.durationSec = 180;
    state.currentTimeSec = 2;
    state.hasValidLyrics = true;
    const sampleLyrics = [
      { start: 0, end: 4, lineEnd: 5, text: 'Zero' },
      { start: 6, end: 10, lineEnd: 12, text: 'One' },
      { start: 12, end: 16, lineEnd: 18, text: 'Two' },
      { start: 18, end: 22, lineEnd: 24, text: 'Three' },
      { start: 24, end: 28, lineEnd: 35, text: 'Four' }
    ];
    state.activeLyrics = sampleLyrics;
    buildLyricsDOM(sampleLyrics);
  `);
  await h.flushMicrotasks(5);
  h.eval('updateScrubberAndLyricsUI(true);');

  const npRightLyrics = h.getEl('npRightLyrics');
  const overlay = h.getEl('nowPlayingOverlay');
  const line3 = h.eval('state.lyricDOMCache[3].el');
  const line4 = h.eval('state.lyricDOMCache[4].el');

  // Downward swipe over #npRightLyrics must NOT initiate swipe-down dismissal
  h.triggerElement(overlay, 'touchstart', { touches: [{ clientX: 700, clientY: 200 }], target: line3 });
  h.triggerWindow('touchmove', { touches: [{ clientX: 700, clientY: 260 }] });
  assert.equal(h.eval('state.isSwipingNowPlaying'), false);
  h.triggerWindow('touchend', {});

  // Upward drag inside #npRightLyrics scrolls through upcoming lyrics
  h.triggerElement(npRightLyrics, 'touchstart', { touches: [{ clientX: 700, clientY: 320 }], target: line3 });
  h.triggerElement(npRightLyrics, 'touchmove', { touches: [{ clientX: 700, clientY: 200 }] });
  h.triggerElement(npRightLyrics, 'touchend', {});

  assert.equal(h.eval('state.lyricsManualScrolling'), true);
  assert.ok(h.eval('state.lyricsScrollOffset') > 100, 'expected downward scroll offset after upward drag');

  // Synthetic click right after drag end is blocked (no accidental seek)
  h.triggerDocument('click', { target: line3 });
  assert.equal(h.eval('state.lyricsManualScrolling'), true);
  assert.equal(h.eval('state.currentTimeSec'), 2);
  assert.equal(h.sdkActions.filter(a => a.type === 'seek').length, 0);

  // Genuine tap after drag guard expires seeks, exits manual mode, and centers line 4
  h.eval('state.lyricsLastDragEndAt = 0;');
  h.triggerDocument('click', { target: line4 });

  assert.equal(h.eval('state.lyricsManualScrolling'), false);
  assert.equal(npRightLyrics.classList.contains('is-manual-scroll'), false);
  assert.equal(h.eval('state.currentTimeSec'), 24);
  const seekAction = h.sdkActions.find(a => a.type === 'seek');
  assert.deepEqual(seekAction, { type: 'seek', ms: 24000 });
  assert.equal(h.getEl('lyricsScrollTrack').style.transform, 'translate3d(0, -202.00px, 0)');
});

test('18. Queue lyrics prefetch caches upcoming track for 0ms switch and joins in-flight prefetch without duplicate requests', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  let lpCountNext = 0;
  let lpCountInflight = 0;
  h.setFetchHandler(async (url) => {
    if (url.includes('lyricsplus.binimum.org') && url.includes('Next%20Track')) {
      lpCountNext += 1;
      return jsonResponse({
        metadata: { title: 'Next Track', totalDuration: '3:05' },
        lyrics: [
          { time: 1000, duration: 2000, text: 'Prefetched one', syllabus: [{ time: 1000, duration: 2000, text: 'Prefetched one' }] },
          { time: 150000, duration: 2000, text: 'Prefetched end', syllabus: [{ time: 150000, duration: 2000, text: 'Prefetched end' }] }
        ]
      });
    }
    if (url.includes('lyricsplus.binimum.org') && url.includes('Inflight%20Track')) {
      lpCountInflight += 1;
      await new Promise(r => setTimeout(r, 60));
      return jsonResponse({
        metadata: { title: 'Inflight Track', totalDuration: '3:10' },
        lyrics: [
          { time: 1000, duration: 2000, text: 'Joined flight', syllabus: [{ time: 1000, duration: 2000, text: 'Joined flight' }] },
          { time: 152000, duration: 2000, text: 'Joined end', syllabus: [{ time: 152000, duration: 2000, text: 'Joined end' }] }
        ]
      });
    }
    return emptyResponse(404);
  });

  // Part A: Prefetch completes ahead of track change -> 0 additional fetches on switch
  await h.eval('prefetchUpcomingLyrics([{ id: "q1", title: "Next Track", artist: "Next Artist", duration: 185 }], 2)');
  assert.equal(lpCountNext, 1);
  assert.equal(h.eval('lyricsMemoryCache.has("next artist::next track")'), true);

  const callsBeforeSwitch = h.fetchCalls.length;
  h.eval(`
    state.isNowPlayingOpen = true;
    state.nowPlayingMode = 'lyrics';
    state.playingTrackTitle = 'Next Track';
  `);
  await h.eval('fetchSyncedLyricsForTrack("Next Track", "Next Artist", "Album", 185)');
  await h.flushMicrotasks();

  assert.equal(h.fetchCalls.length, callsBeforeSwitch, 'prefetched track should switch with zero network calls');
  assert.equal(h.eval('state.hasValidLyrics'), true);
  assert.equal(h.eval('state.lyricsLoading'), false);
  assert.equal(h.getEl('lyricsScrollTrack').innerHTML.includes('lyrics-skeleton-list'), false);

  // Part B: Switching while prefetch is still in flight joins the pending prefetch promise
  const inflightPromise = h.eval('prefetchUpcomingLyrics([{ id: "q2", title: "Inflight Track", artist: "Infl Artist", duration: 190 }], 1)');
  await new Promise(r => setTimeout(r, 15));
  h.eval('state.playingTrackTitle = "Inflight Track";');
  await Promise.all([
    inflightPromise,
    h.eval('fetchSyncedLyricsForTrack("Inflight Track", "Infl Artist", "Album", 190)')
  ]);

  assert.equal(lpCountInflight, 1, 'should join existing in-flight prefetch without duplicate LyricsPlus fetch');
  assert.equal(h.eval('state.hasValidLyrics'), true);
  assert.equal(h.eval('state.loadedLyricsKey'), 'infl artist::inflight track');
});

test('19. Uncached track renders visible Apple Music translucent lyrics skeleton cleanly and replaces it once loaded', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.setFetchHandler(async (url) => {
    if (url.includes('lyricsplus.binimum.org')) {
      await new Promise(r => setTimeout(r, 70));
      return jsonResponse({
        metadata: { title: 'Slow Track', totalDuration: '3:20' },
        lyrics: [
          { time: 1000, duration: 2000, text: 'Real line one', syllabus: [{ time: 1000, duration: 2000, text: 'Real line one' }] },
          { time: 160000, duration: 2000, text: 'Real line end', syllabus: [{ time: 160000, duration: 2000, text: 'Real line end' }] }
        ]
      });
    }
    return emptyResponse(404);
  });

  h.eval(`
    state.isNowPlayingOpen = true;
    state.nowPlayingMode = 'lyrics';
    state.playingTrackTitle = 'Slow Track';
  `);

  const fetchPromise = h.eval('fetchSyncedLyricsForTrack("Slow Track", "Slow Artist", "Slow Album", 200)');
  await h.flushMicrotasks(4);

  const trackEl = h.getEl('lyricsScrollTrack');
  assert.equal(h.eval('state.lyricsLoading'), true);
  assert.equal(trackEl.innerHTML.includes('lyrics-skeleton-list'), true);
  assert.equal(trackEl.innerHTML.includes('Buscando letra'), false);
  assert.equal(trackEl.classList.contains('lyrics-fade-out'), false);

  // Calling updateNowPlayingRightPanelMode while loading must keep existing skeleton intact
  const skelSnapshot = trackEl.innerHTML;
  h.eval('updateNowPlayingRightPanelMode();');
  assert.equal(trackEl.innerHTML, skelSnapshot);

  await fetchPromise;
  await h.flushMicrotasks(5);

  assert.equal(h.eval('state.lyricsLoading'), false);
  assert.equal(h.eval('state.hasValidLyrics'), true);
  assert.equal(trackEl.innerHTML.includes('lyrics-skeleton-list'), false);
  assert.equal(trackEl.innerHTML.includes('Real'), true);
});

test('20. Reserved right scroll zone prevents dismiss collision on wheel/touch while preserving left-side and grabber dismiss', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.eval(`
    state.isNowPlayingOpen = true;
    state.nowPlayingMode = 'lyrics';
    state.isPlaying = true;
    state.durationSec = 180;
    state.currentTimeSec = 2;
    state.hasValidLyrics = true;
    const sampleLyrics = [
      { start: 0, end: 4, lineEnd: 5, text: 'Alpha line' },
      { start: 5, end: 9, lineEnd: 10, text: 'Beta line' },
      { start: 10, end: 14, lineEnd: 15, text: 'Gamma line' },
      { start: 15, end: 19, lineEnd: 20, text: 'Delta line' }
    ];
    state.activeLyrics = sampleLyrics;
    buildLyricsDOM(sampleLyrics);
    nowPlayingOverlay.classList.add('open');
  `);
  await h.flushMicrotasks(5);

  const overlay = h.getEl('nowPlayingOverlay');
  const npRightColumn = h.getEl('npRightColumn');
  const npRightLyrics = h.getEl('npRightLyrics');
  const npRightQueue = h.getEl('npRightQueue');
  const grabber = h.getEl('npGrabberZone');

  // 1. Downward wheel on #npRightLyrics scrolls lyrics without dismissing Now Playing
  h.triggerElement(npRightLyrics, 'wheel', { deltaY: 120, deltaX: 0, clientX: 700, target: npRightLyrics });
  assert.equal(h.eval('state.isNowPlayingOpen'), true);
  assert.equal(h.eval('state.lyricsManualScrolling'), true);

  // 2. Downward wheel on #npRightColumn margin and overlay right-half never dismisses Now Playing
  h.triggerElement(overlay, 'wheel', { deltaY: 120, deltaX: 0, clientX: 700, target: npRightColumn });
  h.triggerElement(overlay, 'wheel', { deltaY: 120, deltaX: 0, clientX: 700, target: overlay });
  assert.equal(h.eval('state.isNowPlayingOpen'), true);

  // 3. Downward touch swipe starting inside right-half margin on overlay never initiates swipe-down dismiss
  h.triggerElement(overlay, 'touchstart', { touches: [{ clientX: 700, clientY: 200 }], target: overlay });
  h.triggerWindow('touchmove', { touches: [{ clientX: 700, clientY: 300 }] });
  assert.equal(h.eval('state.isSwipingNowPlaying'), false);
  assert.equal(h.eval('state.isNowPlayingOpen'), true);
  h.triggerWindow('touchend', {});

  // 4. Downward wheel on queue panel at scrollTop === 0 never closes Now Playing
  h.eval('state.nowPlayingMode = "queue";');
  h.triggerElement(overlay, 'wheel', { deltaY: 120, deltaX: 0, clientX: 700, target: npRightQueue });
  assert.equal(h.eval('state.isNowPlayingOpen'), true);

  // 5. Left column swipe-down STILL initiates dismiss cleanly
  h.eval('state.nowPlayingMode = "lyrics";');
  h.triggerElement(overlay, 'touchstart', { touches: [{ clientX: 180, clientY: 200 }], target: overlay });
  h.triggerWindow('touchmove', { touches: [{ clientX: 180, clientY: 300 }] });
  assert.equal(h.eval('state.isSwipingNowPlaying'), true);
  h.triggerWindow('touchend', {});

  // 6. Top grabber pill swipe-down STILL initiates dismiss even at x = 512 (center)
  h.eval('state.isNowPlayingOpen = true; state.isSwipingNowPlaying = false;');
  h.triggerElement(overlay, 'touchstart', { touches: [{ clientX: 512, clientY: 10 }], target: grabber });
  h.triggerWindow('touchmove', { touches: [{ clientX: 512, clientY: 120 }] });
  assert.equal(h.eval('state.isSwipingNowPlaying'), true);
  h.triggerWindow('touchend', {});
});

test('21. Queue reorder moves track cleanly, protects order from poll clobber, and plays reordered queue on Next', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.setFetchHandler(async (url) => {
    if (url.includes('/me/player/queue')) {
      return jsonResponse({
        queue: [
          { id: 'orig_1', uri: 'spotify:track:orig_1', name: 'Original 1', artists: [{ name: 'A' }], album: { name: 'Alb', images: [] } },
          { id: 'orig_2', uri: 'spotify:track:orig_2', name: 'Original 2', artists: [{ name: 'A' }], album: { name: 'Alb', images: [] } },
          { id: 'orig_3', uri: 'spotify:track:orig_3', name: 'Original 3', artists: [{ name: 'A' }], album: { name: 'Alb', images: [] } }
        ]
      });
    }
    return emptyResponse(204);
  });

  h.eval(`
    initWebPlayer();
    spotifyAuth.activeDeviceId = 'web_dev_1';
    webPlayerDeviceId = 'web_dev_1';
    webPlayerTransferredOnce = true;
    state.isNowPlayingOpen = true;
    state.nowPlayingMode = 'queue';
    state.isPlaying = true;
    state.playingTrackId = 'cur_0';
    state.playingTrackTitle = 'Now';
    state.liveQueueTracks = [
      { id: 'orig_1', uri: 'spotify:track:orig_1', title: 'Original 1', artist: 'A', cover: '' },
      { id: 'orig_2', uri: 'spotify:track:orig_2', title: 'Original 2', artist: 'A', cover: '' },
      { id: 'orig_3', uri: 'spotify:track:orig_3', title: 'Original 3', artist: 'A', cover: '' }
    ];
    state.contextUpcomingTracks = [...state.liveQueueTracks];
    renderQueuePanelUI();
  `);

  const listHtml = h.getEl('npQueueListContainer').innerHTML;
  assert.equal(listHtml.includes('np-queue-drag-handle'), true);
  assert.equal(listHtml.includes('np-queue-index'), false);
  assert.equal(listHtml.includes('np-queue-duration'), false);

  const reordered = h.eval('reorderQueueTrack(2, 0)');
  assert.equal(reordered, true);
  assert.equal(h.eval('state.hasCustomReorderedQueue'), true);
  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.liveQueueTracks.map(x => x.id))')),
    ['orig_3', 'orig_1', 'orig_2']
  );

  // Queue refresh must preserve custom user order instead of overwriting with /me/player/queue
  await h.eval('fetchAndRenderQueueForCurrentTrack()');
  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.liveQueueTracks.map(x => x.id))')),
    ['orig_3', 'orig_1', 'orig_2']
  );

  await h.eval('skipNextTrack()');

  assert.equal(h.eval('state.playingTrackId'), 'orig_3');
  assert.equal(h.eval('state.hasCustomReorderedQueue'), false);
  assert.equal(h.sdkActions.some(a => a.type === 'nextTrack'), false);
  const playCall = h.fetchCalls.find(c => c.url.includes('/me/player/play'));
  assert.ok(playCall, 'expected direct /me/player/play with custom reordered uris');
  assert.deepEqual(playCall.bodyJson, {
    uris: [
      'spotify:track:orig_3',
      'spotify:track:orig_1',
      'spotify:track:orig_2'
    ]
  });
});

test('22. Custom queue reorder survives SDK player_state_changed/poll and Shuffle track switch keeps queue tail instead of shrinking to 2 tracks', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.setFetchHandler(async () => emptyResponse(204));
  h.eval('initWebPlayer();');
  h.emitSdkEvent('ready', { device_id: 'web_dev_1' });

  // Part A: Reorder "Snowman" from index 1 -> 0; stale SDK next_tracks must NOT revert visual order
  h.eval(`
    state.isNowPlayingOpen = true;
    state.nowPlayingMode = 'queue';
    state.isPlaying = true;
    state.playingTrackId = 'song_now';
    state.playingTrackTitle = 'Current Song';
    state.liveQueueTracks = [
      { id: 't_old_1', uri: 'spotify:track:t_old_1', title: 'Old First', artist: 'A', cover: '' },
      { id: 't_snow', uri: 'spotify:track:t_snow', title: 'Snowman', artist: 'Sia', cover: '' },
      { id: 't_tail', uri: 'spotify:track:t_tail', title: 'Third Song', artist: 'B', cover: '' }
    ];
    state.contextUpcomingTracks = [...state.liveQueueTracks];
    renderQueuePanelUI();
    reorderQueueTrack(1, 0);
  `);

  h.emitSdkEvent('player_state_changed', {
    paused: false,
    position: 10000,
    shuffle: false,
    repeat_mode: 0,
    track_window: {
      current_track: { id: 'song_now', uri: 'spotify:track:song_now', name: 'Current Song', duration_ms: 180000, artists: [{ name: 'Now' }], album: { name: 'Alb', images: [] } },
      next_tracks: [
        { id: 't_old_1', uri: 'spotify:track:t_old_1', name: 'Old First', duration_ms: 180000, artists: [{ name: 'A' }], album: { name: 'Alb', images: [] } },
        { id: 't_snow', uri: 'spotify:track:t_snow', name: 'Snowman', duration_ms: 165000, artists: [{ name: 'Sia' }], album: { name: 'Alb', images: [] } }
      ]
    }
  });

  assert.equal(h.eval('state.liveQueueTracks[0].title'), 'Snowman');
  const firstIdxSnow = h.getEl('npQueueListContainer').innerHTML.indexOf('Snowman');
  const firstIdxOld = h.getEl('npQueueListContainer').innerHTML.indexOf('Old First');
  assert.ok(firstIdxSnow >= 0 && firstIdxOld > firstIdxSnow, 'expected Snowman to stay #1 visually in DOM');

  // Part B: Under Shuffle, natural track change with 2 SDK next_tracks preserves remaining queue tail
  h.eval(`
    state.hasCustomReorderedQueue = false;
    spotifyAuth.shuffleState = true;
    state.liveQueueTracks = [
      { id: 's1', uri: 'spotify:track:s1', title: 'Song 1', artist: 'A', cover: '' },
      { id: 's2', uri: 'spotify:track:s2', title: 'Song 2', artist: 'A', cover: '' },
      { id: 's3', uri: 'spotify:track:s3', title: 'Song 3', artist: 'A', cover: '' },
      { id: 's4', uri: 'spotify:track:s4', title: 'Song 4', artist: 'A', cover: '' },
      { id: 's5', uri: 'spotify:track:s5', title: 'Song 5', artist: 'A', cover: '' }
    ];
  `);

  h.emitSdkEvent('player_state_changed', {
    paused: false,
    position: 200,
    shuffle: true,
    repeat_mode: 0,
    track_window: {
      current_track: { id: 's1', uri: 'spotify:track:s1', name: 'Song 1', duration_ms: 190000, artists: [{ name: 'A' }], album: { name: 'Alb', images: [] } },
      next_tracks: [
        { id: 's2', uri: 'spotify:track:s2', name: 'Song 2', duration_ms: 190000, artists: [{ name: 'A' }], album: { name: 'Alb', images: [] } },
        { id: 's3', uri: 'spotify:track:s3', name: 'Song 3', duration_ms: 190000, artists: [{ name: 'A' }], album: { name: 'Alb', images: [] } }
      ]
    }
  });

  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.liveQueueTracks.map(x => x.id))')),
    ['s2', 's3', 's4', 's5']
  );
});

test('23. Post-reorder skipNextTrack with Queue tab open never shrinks queue to 2 stale SDK tracks', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.setFetchHandler(async () => emptyResponse(204));
  h.eval('initWebPlayer();');
  h.emitSdkEvent('ready', { device_id: 'web_dev_1' });

  h.setGetCurrentState(async () => ({
    paused: false,
    position: 45000,
    shuffle: false,
    track_window: {
      current_track: {
        id: 'song_0',
        uri: 'spotify:track:song_0',
        name: 'Previous Playing Song',
        duration_ms: 180000,
        artists: [{ name: 'Prev Artist' }],
        album: { name: 'Alb', images: [] }
      },
      next_tracks: [
        { id: 'sinatra', uri: 'spotify:track:sinatra', name: 'Santa Claus Is Coming To Town', duration_ms: 165000, artists: [{ name: 'Frank Sinatra' }], album: { name: 'Alb', images: [] } },
        { id: 'mariah', uri: 'spotify:track:mariah', name: "Santa Claus Is Comin' to Town", duration_ms: 204000, artists: [{ name: 'Mariah Carey' }], album: { name: 'Alb', images: [] } }
      ]
    }
  }));

  h.eval(`
    spotifyAuth.activeDeviceId = 'web_dev_1';
    webPlayerDeviceId = 'web_dev_1';
    webPlayerTransferredOnce = true;
    spotifyAuth.shuffleState = false;
    state.isAutoplayQueue = false;
    state.isNowPlayingOpen = true;
    state.nowPlayingMode = 'queue';
    state.isPlaying = true;
    state.playingTrackId = 'song_0';
    state.playingTrackTitle = 'Previous Playing Song';
    state.liveQueueTracks = [
      { id: 'sinatra', uri: 'spotify:track:sinatra', title: 'Santa Claus Is Coming To Town', artist: 'Frank Sinatra', cover: '' },
      { id: 'snowman', uri: 'spotify:track:snowman', title: 'Snowman', artist: 'Sia', cover: '' },
      { id: 'darlene', uri: 'spotify:track:darlene', title: 'All Alone on Christmas', artist: 'Darlene Love', cover: '' },
      { id: 'shakin', uri: 'spotify:track:shakin', title: 'Merry Christmas Everyone - Extended', artist: "Shakin' Stevens", cover: '' },
      { id: 'chuck', uri: 'spotify:track:chuck', title: 'Run Rudolph Run', artist: 'Chuck Berry', cover: '' }
    ];
    state.contextUpcomingTracks = [...state.liveQueueTracks];
    renderQueuePanelUI();
    reorderQueueTrack(1, 0);
  `);

  h.emitSdkEvent('player_state_changed', {
    paused: false,
    position: 46000,
    shuffle: false,
    repeat_mode: 0,
    track_window: {
      current_track: { id: 'song_0', uri: 'spotify:track:song_0', name: 'Previous Playing Song', duration_ms: 180000, artists: [{ name: 'Prev Artist' }], album: { name: 'Alb', images: [] } },
      next_tracks: [
        { id: 'sinatra', uri: 'spotify:track:sinatra', name: 'Santa Claus Is Coming To Town', duration_ms: 165000, artists: [{ name: 'Frank Sinatra' }], album: { name: 'Alb', images: [] } },
        { id: 'mariah', uri: 'spotify:track:mariah', name: "Santa Claus Is Comin' to Town", duration_ms: 204000, artists: [{ name: 'Mariah Carey' }], album: { name: 'Alb', images: [] } }
      ]
    }
  });

  await h.eval('skipNextTrack()');
  await h.eval('fetchAndRenderQueueForCurrentTrack()');

  assert.equal(h.eval('state.playingTrackId'), 'snowman');
  const playCall = h.fetchCalls.find(c => c.url.includes('/me/player/play'));
  assert.ok(playCall, 'expected /me/player/play with all 5 reordered URIs');
  assert.deepEqual(playCall.bodyJson, {
    uris: [
      'spotify:track:snowman',
      'spotify:track:sinatra',
      'spotify:track:darlene',
      'spotify:track:shakin',
      'spotify:track:chuck'
    ]
  });
  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.liveQueueTracks.map(x => x.id))')),
    ['sinatra', 'darlene', 'shakin', 'chuck']
  );

  const queueHtml = h.getEl('npQueueListContainer').innerHTML;
  assert.equal(queueHtml.includes('Darlene Love'), true);
  assert.equal(queueHtml.includes('Chuck Berry'), true);
  assert.equal(queueHtml.includes('Mariah Carey'), false);
});

test('24. Queue panel renders translucent skeleton rows while loading and smoothly reveals newly merged tracks without popping existing rows', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  // 1. Empty + loading renders 6 skeleton placeholders and no empty state
  h.eval(`
    state.isNowPlayingOpen = true;
    state.nowPlayingMode = 'queue';
    state.queueLoading = true;
    state.liveQueueTracks = [];
    state.discoveryTracks = [];
    renderQueuePanelUI();
  `);

  const htmlEmptyLoading = h.getEl('npQueueListContainer').innerHTML;
  const emptySkelCount = (htmlEmptyLoading.match(/np-queue-skeleton-row/g) || []).length;
  assert.equal(emptySkelCount, 6);
  assert.equal(htmlEmptyLoading.includes('np-queue-empty-state'), false);

  // 2. Partial seeded queue (2 SDK tracks) + loading shows 2 real tracks + 4 trailing skeleton rows
  h.eval(`
    state.queueLoading = true;
    state.liveQueueTracks = [
      { id: 'q1', uri: 'spotify:track:q1', title: 'Track 1', artist: 'Artist 1', cover: '' },
      { id: 'q2', uri: 'spotify:track:q2', title: 'Track 2', artist: 'Artist 2', cover: '' }
    ];
    renderQueuePanelUI();
  `);

  const htmlPartial = h.getEl('npQueueListContainer').innerHTML;
  const partialRowCount = (htmlPartial.match(/class="np-queue-row/g) || []).length;
  const partialSkelCount = (htmlPartial.match(/np-queue-skeleton-row/g) || []).length;
  assert.equal(partialRowCount, 2);
  assert.equal(partialSkelCount, 4);

  // 3. Full API merge arrives: skeletons vanish cleanly and only the 4 newly revealed tracks get np-queue-row-enter
  h.eval(`
    state.queueLoading = false;
    state.liveQueueTracks = [
      { id: 'q1', uri: 'spotify:track:q1', title: 'Track 1', artist: 'Artist 1', cover: '' },
      { id: 'q2', uri: 'spotify:track:q2', title: 'Track 2', artist: 'Artist 2', cover: '' },
      { id: 'q3', uri: 'spotify:track:q3', title: 'Track 3', artist: 'Artist 3', cover: '' },
      { id: 'q4', uri: 'spotify:track:q4', title: 'Track 4', artist: 'Artist 4', cover: '' },
      { id: 'q5', uri: 'spotify:track:q5', title: 'Track 5', artist: 'Artist 5', cover: '' },
      { id: 'q6', uri: 'spotify:track:q6', title: 'Track 6', artist: 'Artist 6', cover: '' }
    ];
    renderQueuePanelUI();
  `);

  const htmlMerged = h.getEl('npQueueListContainer').innerHTML;
  assert.equal(htmlMerged.includes('np-queue-skeleton-row'), false);
  assert.equal((htmlMerged.match(/np-queue-row-enter/g) || []).length, 4);
  assert.equal(/class="np-queue-row"[\s\S]*?data-track-id="q1"/.test(htmlMerged), true);
  assert.equal(/class="np-queue-row"[\s\S]*?data-track-id="q2"/.test(htmlMerged), true);
  assert.equal(/class="np-queue-row np-queue-row-enter"[\s\S]*?data-track-id="q3"/.test(htmlMerged), true);
  assert.equal(/class="np-queue-row np-queue-row-enter"[\s\S]*?data-track-id="q6"/.test(htmlMerged), true);
});

test('25. Repeat 3-state cycle & Shuffle toggle animate, protect optimistic state against stale SDK events, show Queue skeleton, and fall back cleanly on 403', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  let failShuffleWith403 = false;
  h.setFetchHandler(async (url) => {
    if (failShuffleWith403 && url.includes('/me/player/shuffle')) {
      return jsonResponse({ error: { status: 403, message: 'Restriction violated' } }, 403);
    }
    return emptyResponse(204);
  });

  h.eval(`
    initWebPlayer();
    h_ready = true;
    spotifyAuth.activeDeviceId = 'web_dev_1';
    webPlayerDeviceId = 'web_dev_1';
    webPlayerTransferredOnce = true;
    state.isNowPlayingOpen = true;
    state.nowPlayingMode = 'queue';
    state.playingTrackId = 'cur_song';
    state.playingTrackTitle = 'Current';
    state.liveQueueTracks = [
      { id: 't1', uri: 'spotify:track:t1', title: 'Track 1', artist: 'Artist', cover: '' },
      { id: 't2', uri: 'spotify:track:t2', title: 'Track 2', artist: 'Artist', cover: '' },
      { id: 't3', uri: 'spotify:track:t3', title: 'Track 3', artist: 'Artist', cover: '' }
    ];
    renderQueuePanelUI();
  `);

  const repBtn = h.getEl('npRepeatBtn');
  const shufBtn = h.getEl('npShuffleBtn');

  // 1. Repeat cycles off -> context -> track -> off and resists stale SDK repeat_mode: 0
  repBtn.click();
  await h.flushMicrotasks(3);
  assert.equal(h.eval('spotifyAuth.repeatState'), 'context');
  assert.equal(repBtn.classList.contains('active'), true);
  assert.equal(repBtn.classList.contains('is-repeat-track'), false);
  assert.equal(repBtn.getAttribute('data-repeat-mode'), 'context');

  // Stale SDK event claiming repeat_mode: 0 must NOT revert optimistic 'context' while locked
  h.emitSdkEvent('player_state_changed', {
    paused: false,
    position: 5000,
    shuffle: false,
    repeat_mode: 0,
    track_window: {
      current_track: { id: 'cur_song', uri: 'spotify:track:cur_song', name: 'Current', duration_ms: 180000, artists: [{ name: 'A' }], album: { name: 'Alb', images: [] } },
      next_tracks: []
    }
  });
  assert.equal(h.eval('spotifyAuth.repeatState'), 'context');

  repBtn.click();
  await h.flushMicrotasks(3);
  assert.equal(h.eval('spotifyAuth.repeatState'), 'track');
  assert.equal(repBtn.classList.contains('active'), true);
  assert.equal(repBtn.classList.contains('is-repeat-track'), true);
  assert.equal(repBtn.getAttribute('data-repeat-mode'), 'track');

  repBtn.click();
  await h.flushMicrotasks(3);
  assert.equal(h.eval('spotifyAuth.repeatState'), 'off');
  assert.equal(repBtn.classList.contains('active'), false);
  assert.equal(repBtn.classList.contains('is-repeat-track'), false);
  assert.equal(repBtn.getAttribute('data-repeat-mode'), 'off');

  const repeatCalls = h.fetchCalls.filter(c => c.url.includes('/me/player/repeat'));
  assert.equal(repeatCalls.length, 3);
  assert.equal(repeatCalls[0].url.includes('state=context'), true);
  assert.equal(repeatCalls[1].url.includes('state=track'), true);
  assert.equal(repeatCalls[2].url.includes('state=off'), true);

  // 2. Shuffle displays Queue skeleton immediately on tap and resists stale SDK shuffle: false
  shufBtn.click();
  assert.equal(h.eval('spotifyAuth.shuffleState'), true);
  assert.equal(shufBtn.classList.contains('active'), true);
  assert.equal(h.eval('state.queueLoading'), true);
  assert.equal(h.getEl('npQueueListContainer').innerHTML.includes('np-queue-skeleton-row'), true);

  h.emitSdkEvent('player_state_changed', {
    paused: false,
    position: 8000,
    shuffle: false,
    repeat_mode: 0,
    track_window: {
      current_track: { id: 'cur_song', uri: 'spotify:track:cur_song', name: 'Current', duration_ms: 180000, artists: [{ name: 'A' }], album: { name: 'Alb', images: [] } },
      next_tracks: []
    }
  });
  assert.equal(h.eval('spotifyAuth.shuffleState'), true);
  await h.flushMicrotasks(4);

  // 3. Shuffle 403 restriction falls back gracefully to local Fisher-Yates shuffle without wiping queue
  h.eval(`
    spotifyAuth.shuffleState = false;
    state.shuffleToggleLockUntil = 0;
    state.liveQueueTracks = [
      { id: 'f1', uri: 'spotify:track:f1', title: 'Fall 1', artist: 'A', cover: '' },
      { id: 'f2', uri: 'spotify:track:f2', title: 'Fall 2', artist: 'A', cover: '' },
      { id: 'f3', uri: 'spotify:track:f3', title: 'Fall 3', artist: 'A', cover: '' }
    ];
    state.queueLoading = false;
  `);
  failShuffleWith403 = true;
  shufBtn.click();
  await h.flushMicrotasks(6);

  assert.equal(h.eval('spotifyAuth.shuffleState'), true);
  assert.equal(h.eval('state.queueLoading'), false);
  assert.equal(h.eval('state.hasCustomReorderedQueue'), true);
  const fallbackIds = JSON.parse(h.eval('JSON.stringify(state.liveQueueTracks.map(x => x.id))')).sort();
  assert.deepEqual(fallbackIds, ['f1', 'f2', 'f3']);
});

test('26. Context preservation across Liked Songs, Artist tracks, and Playlists prevents Autoplay hijack on Next', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  let multiUriReject403 = true;
  h.setFetchHandler(async (url, init) => {
    if (url.includes('/me/player/play') && init && typeof init.body === 'string') {
      const parsed = JSON.parse(init.body);
      if (multiUriReject403 && Array.isArray(parsed.uris) && parsed.uris.length > 1) {
        return jsonResponse({ error: { status: 403, message: 'Restriction violated' } }, 403);
      }
    }
    if (url.includes('/me/player/queue')) {
      return jsonResponse({
        queue: [
          { id: 'rec_kanye', uri: 'spotify:track:rec_kanye', name: 'Stronger', artists: [{ name: 'Kanye West' }], album: { name: 'Graduation', images: [] } }
        ]
      });
    }
    return emptyResponse(204);
  });

  h.eval(`
    initWebPlayer();
    spotifyAuth.activeDeviceId = 'web_dev_1';
    webPlayerDeviceId = 'web_dev_1';
    webPlayerTransferredOnce = true;
    state.isNowPlayingOpen = true;
    state.nowPlayingMode = 'queue';

    liveCatalog.likedTracks = [
      { id: 'lk_1', uri: 'spotify:track:lk_1', title: '120', artist: 'Bad Bunny', album: 'Liked', duration: 150, cover: '' },
      { id: 'lk_2', uri: 'spotify:track:lk_2', title: 'expectations', artist: 'Tainy', album: 'Liked', duration: 170, cover: '' },
      { id: 'lk_3', uri: 'spotify:track:lk_3', title: 'Midnight Sun', artist: 'Zara', album: 'Liked', duration: 185, cover: '' },
      { id: 'lk_4', uri: 'spotify:track:lk_4', title: 'Half Mast', artist: 'Empire', album: 'Liked', duration: 200, cover: '' }
    ];
    liveCatalog.entities['liked_songs'] = {
      id: 'liked_songs',
      type: 'liked',
      uri: null,
      title: 'Liked Songs',
      artist: 'User',
      tracks: liveCatalog.likedTracks
    };

    liveCatalog.entities['art_1234567890123456789012'] = {
      id: 'art_1234567890123456789012',
      spotifyId: '1234567890123456789012',
      name: 'Sample Artist',
      title: 'Sample Artist',
      cover: '',
      tracks: [
        { id: 'ar_1', uri: 'spotify:track:ar_1', title: 'Hit 1', artist: 'Sample Artist', album: 'Alb', duration: 180, cover: '' },
        { id: 'ar_2', uri: 'spotify:track:ar_2', title: 'Hit 2', artist: 'Sample Artist', album: 'Alb', duration: 190, cover: '' },
        { id: 'ar_3', uri: 'spotify:track:ar_3', title: 'Hit 3', artist: 'Sample Artist', album: 'Alb', duration: 200, cover: '' }
      ]
    };

    liveCatalog.entities['pl_test'] = {
      id: 'pl_test',
      type: 'playlist',
      uri: 'spotify:playlist:pl_test',
      title: 'Christmas Mix',
      artist: 'Curator',
      cover: '',
      tracks: [
        { id: 'pl_1', uri: 'spotify:track:pl_1', title: 'Snowman', artist: 'Sia', album: 'Everyday', duration: 165, cover: '' },
        { id: 'pl_2', uri: 'spotify:track:pl_2', title: 'Last Christmas', artist: 'Wham!', album: 'Wham', duration: 260, cover: '' }
      ]
    };
  `);

  // 1. Liked Songs from track #1 ("120") preserves Liked queue even after 403 multi-URI fallback & unrelated /me/player/queue
  h.eval(`state.selectedEntityId = 'liked_songs';`);
  h.triggerDocument('click', {
    target: {
      closest(sel) {
        if (sel !== '.track-row') return null;
        return {
          getAttribute(k) {
            const map = {
              'data-entity-id': 'liked_songs',
              'data-track-index': '0',
              'data-track-id': 'lk_1',
              'data-track-uri': 'spotify:track:lk_1',
              'data-track-title': '120',
              'data-track-artist': 'Bad Bunny',
              'data-track-album': 'Liked',
              'data-track-duration': '150'
            };
            return map[k] || '';
          }
        };
      }
    }
  });
  await h.flushMicrotasks(8);

  assert.equal(h.eval('state.isLocalContextQueue'), true);
  assert.equal(h.eval('state.activeContextName'), 'Tus me gusta');
  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.liveQueueTracks.map(x => x.id))')),
    ['lk_2', 'lk_3', 'lk_4']
  );

  // Even calling fetchAndRenderQueueForCurrentTrack must NOT inject Kanye West
  await h.eval('fetchAndRenderQueueForCurrentTrack()');
  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.liveQueueTracks.map(x => x.id))')),
    ['lk_2', 'lk_3', 'lk_4']
  );

  // Next from Liked Songs plays "expectations" (never Kanye West)
  await h.eval('skipNextTrack()');
  assert.equal(h.eval('state.playingTrackId'), 'lk_2');
  assert.equal(h.eval('state.playingTrackTitle'), 'expectations');
  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.liveQueueTracks.map(x => x.id))')),
    ['lk_3', 'lk_4']
  );

  // 2. Artist track select plays track #2 via URIs (not broken spotify:artist: offset) and preserves Artist context
  multiUriReject403 = false;
  h.eval(`
    state.selectedArtistId = 'art_1234567890123456789012';
    handleArtistTrackSelect({
      getAttribute(k) {
        const map = {
          'data-artist-track-index': '1',
          'data-track-id': 'ar_2',
          'data-track-uri': 'spotify:track:ar_2',
          'data-track-title': 'Hit 2',
          'data-track-artist': 'Sample Artist',
          'data-track-duration': '190'
        };
        return map[k] || '';
      }
    });
  `);
  await h.flushMicrotasks(6);

  assert.equal(h.eval('state.playingTrackId'), 'ar_2');
  assert.equal(h.eval('state.isLocalContextQueue'), true);
  assert.equal(h.eval('state.activeContextName'), 'Sample Artist');
  const artistPlayCall = [...h.fetchCalls].reverse().find(c => c.url.includes('/me/player/play'));
  assert.deepEqual(artistPlayCall.bodyJson, {
    uris: ['spotify:track:ar_2', 'spotify:track:ar_3']
  });

  await h.eval('skipNextTrack()');
  assert.equal(h.eval('state.playingTrackId'), 'ar_3');

  // 3. Playlist uses native Spotify context_uri with isLocalContextQueue = false
  h.eval(`
    state.selectedEntityId = 'pl_test';
    startAlbumOrPlaylistPlayback(false);
  `);
  await h.flushMicrotasks(6);

  assert.equal(h.eval('state.isLocalContextQueue'), false);
  assert.equal(h.eval('state.activeContextName'), 'Christmas Mix');
  const plPlayCall = [...h.fetchCalls].reverse().find(c => c.url.includes('/me/player/play'));
  assert.deepEqual(plPlayCall.bodyJson, {
    context_uri: 'spotify:playlist:pl_test',
    offset: { position: 0 }
  });
});

test('27. skipPrevTrack respects local context history, eliminates double-seek, never escapes track #1, and handles fast double-tap in playlists', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.setFetchHandler(async () => emptyResponse(204));
  h.eval(`
    initWebPlayer();
    spotifyAuth.activeDeviceId = 'web_dev_1';
    webPlayerDeviceId = 'web_dev_1';
    webPlayerTransferredOnce = true;
    state.isNowPlayingOpen = true;
    state.nowPlayingMode = 'queue';

    liveCatalog.likedTracks = [
      { id: 'lk_1', uri: 'spotify:track:lk_1', title: '120', artist: 'Bad Bunny', album: 'Liked', duration: 150, cover: '' },
      { id: 'lk_2', uri: 'spotify:track:lk_2', title: 'expectations', artist: 'Tainy', album: 'Liked', duration: 170, cover: '' },
      { id: 'lk_3', uri: 'spotify:track:lk_3', title: 'Midnight Sun', artist: 'Zara', album: 'Liked', duration: 185, cover: '' },
      { id: 'lk_4', uri: 'spotify:track:lk_4', title: 'Half Mast', artist: 'Empire', album: 'Liked', duration: 200, cover: '' }
    ];
    liveCatalog.entities['liked_songs'] = {
      id: 'liked_songs',
      type: 'liked',
      uri: null,
      title: 'Liked Songs',
      artist: 'User',
      tracks: liveCatalog.likedTracks
    };
    state.selectedEntityId = 'liked_songs';
  `);

  // 1. Start Liked Songs from track #2 ("expectations") -> playbackHistory seeded with ["120"]
  h.triggerDocument('click', {
    target: {
      closest(sel) {
        if (sel !== '.track-row') return null;
        return {
          getAttribute(k) {
            const map = {
              'data-entity-id': 'liked_songs',
              'data-track-index': '1',
              'data-track-id': 'lk_2',
              'data-track-uri': 'spotify:track:lk_2',
              'data-track-title': 'expectations',
              'data-track-artist': 'Tainy',
              'data-track-album': 'Liked',
              'data-track-duration': '170'
            };
            return map[k] || '';
          }
        };
      }
    }
  });
  await h.flushMicrotasks(6);

  assert.equal(h.eval('state.playbackHistory.length'), 1);
  assert.equal(h.eval('state.playbackHistory[0].id'), 'lk_1');

  // Advance to track #3 ("Midnight Sun")
  await h.eval('skipNextTrack()');
  assert.equal(h.eval('state.playingTrackId'), 'lk_3');
  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.playbackHistory.map(x => x.id))')),
    ['lk_1', 'lk_2']
  );

  // Tap Previous at 10s -> restarts "Midnight Sun" via webPlayer.seek(0) ONLY (no duplicate HTTP /me/player/seek)
  h.eval('state.currentTimeSec = 10;');
  await h.eval('skipPrevTrack()');
  assert.equal(h.eval('state.playingTrackId'), 'lk_3');
  assert.equal(h.eval('state.currentTimeSec'), 0);
  assert.equal(h.sdkActions.filter(a => a.type === 'seek' && a.ms === 0).length, 1);
  assert.equal(h.fetchCalls.some(c => c.url.includes('/me/player/seek')), false);

  // Tap Previous again (< 4s) -> pops "expectations", prepends "Midnight Sun" back into liveQueueTracks
  await h.eval('skipPrevTrack()');
  assert.equal(h.eval('state.playingTrackId'), 'lk_2');
  assert.equal(h.eval('state.isLocalContextQueue'), true);
  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.liveQueueTracks.map(x => x.id))')),
    ['lk_3', 'lk_4']
  );

  // Tap Previous again (< 4s) -> pops "120"
  await h.eval('skipPrevTrack()');
  assert.equal(h.eval('state.playingTrackId'), 'lk_1');
  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.liveQueueTracks.map(x => x.id))')),
    ['lk_2', 'lk_3', 'lk_4']
  );

  // Tap Previous on track #1 (empty history) -> restarts to 0:00 instead of calling webPlayer.previousTrack()
  h.eval('state.currentTimeSec = 1;');
  await h.eval('skipPrevTrack()');
  assert.equal(h.eval('state.playingTrackId'), 'lk_1');
  assert.equal(h.sdkActions.some(a => a.type === 'previousTrack'), false);

  // 2. Native Playlist: fast double-tap Previous at 15s then 0s sends POST /me/player/previous on tap 2
  h.eval(`
    state.isLocalContextQueue = false;
    state.isAutoplayQueue = false;
    state.playbackHistory = [];
    state.playingTrackId = 'pl_2';
    state.playingTrackTitle = 'Track 2';
    state.currentTimeSec = 15;
  `);
  await h.eval('skipPrevTrack()');
  assert.equal(h.eval('state.currentTimeSec'), 0);
  await h.eval('skipPrevTrack()');
  assert.equal(h.fetchCalls.some(c => c.url.includes('/me/player/previous') && c.method === 'POST'), true);
});

test('28. Cold-reload mini-player resume rehydrates persisted Liked Songs context instead of Spotify recommendations', async (t) => {
  const h = createPlaybackHarness();
  t.after(() => h.cleanup());

  h.setFetchHandler(async (url) => {
    if (url.includes('/me/player/queue')) {
      return jsonResponse({
        queue: [
          { id: 'rec_kanye', uri: 'spotify:track:rec_kanye', name: 'Stronger', artists: [{ name: 'Kanye West' }], album: { name: 'Graduation', images: [] } }
        ]
      });
    }
    if (url.includes('/me/tracks')) {
      return jsonResponse({
        total: 4,
        items: [
          { track: { id: 'lk_1', uri: 'spotify:track:lk_1', name: '120', duration_ms: 150000, artists: [{ name: 'Bad Bunny' }], album: { name: 'Liked', images: [] } } },
          { track: { id: 'lk_2', uri: 'spotify:track:lk_2', name: 'expectations', duration_ms: 170000, artists: [{ name: 'Tainy' }], album: { name: 'Liked', images: [] } } },
          { track: { id: 'lk_3', uri: 'spotify:track:lk_3', name: 'Midnight Sun', duration_ms: 185000, artists: [{ name: 'Zara' }], album: { name: 'Liked', images: [] } } },
          { track: { id: 'lk_4', uri: 'spotify:track:lk_4', name: 'Half Mast', duration_ms: 200000, artists: [{ name: 'Empire' }], album: { name: 'Liked', images: [] } } }
        ]
      });
    }
    if (url.endsWith('/me/player')) {
      return jsonResponse({
        is_playing: false,
        progress_ms: 42000,
        context: null,
        item: {
          id: 'lk_2',
          uri: 'spotify:track:lk_2',
          name: 'expectations',
          duration_ms: 170000,
          artists: [{ name: 'Tainy' }],
          album: { name: 'Liked', images: [] }
        },
        device: { id: 'web_dev_1', name: 'SpotiEcho Web Player', type: 'Computer', is_active: true }
      });
    }
    return emptyResponse(204);
  });

  h.eval(`
    initWebPlayer();
    spotifyAuth.activeDeviceId = 'web_dev_1';
    webPlayerDeviceId = 'web_dev_1';
    webPlayerTransferredOnce = true;
    saveLastPlayedTrack({
      id: 'lk_2',
      uri: 'spotify:track:lk_2',
      name: 'expectations',
      artist: 'Tainy',
      album: 'Liked',
      duration: 170,
      contextType: 'liked',
      contextName: 'Tus me gusta',
      contextId: 'liked_songs'
    });
    const cached = loadLastPlayedTrack();
    applyTrackToUI(cached, 0, false, 'cache');
    state.nowPlayingMode = 'queue';
  `);

  await h.eval('togglePlayPause()');

  assert.equal(h.eval('state.isLocalContextQueue'), true);
  assert.equal(h.eval('state.activeContextName'), 'Tus me gusta');
  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.liveQueueTracks.map(x => x.id))')),
    ['lk_3', 'lk_4']
  );
  assert.deepEqual(
    JSON.parse(h.eval('JSON.stringify(state.playbackHistory.map(x => x.id))')),
    ['lk_1']
  );

  const playCall = [...h.fetchCalls].reverse().find(c => c.url.includes('/me/player/play'));
  assert.ok(playCall, 'expected /me/player/play with restored Liked Songs uris');
  assert.deepEqual(playCall.bodyJson, {
    uris: [
      'spotify:track:lk_2',
      'spotify:track:lk_3',
      'spotify:track:lk_4'
    ],
    position_ms: 42000
  });
});








