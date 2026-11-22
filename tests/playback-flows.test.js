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

function createElementStub(tagName = 'div', id = '') {
  const listeners = new Map();
  const attrs = new Map();
  if (id) attrs.set('id', id);

  const el = {
    tagName: String(tagName).toUpperCase(),
    id,
    className: '',
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
        el.classList._set.clear();
        String(v).split(/\s+/).filter(Boolean).forEach(c => el.classList._set.add(c));
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
    click() {
      const list = listeners.get('click') || [];
      for (const fn of list) {
        fn({
          target: el,
          currentTarget: el,
          stopPropagation() {},
          preventDefault() {}
        });
      }
    },
    dispatchEvent() {
      return true;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1024, height: 640, right: 1024, bottom: 640 };
    },
    closest() {
      return null;
    },
    remove() {},
    replaceWith() {},
    querySelector(sel) {
      const all = el.querySelectorAll(sel);
      return all.length > 0 ? all[0] : null;
    },
    querySelectorAll(sel) {
      if (sel === '.lyric-line' && el.id === 'lyricsScrollTrack' && el._innerHTML) {
        const matches = [...el._innerHTML.matchAll(/class="(lyric-line[^"]*)"\s+data-line-idx="(\d+)"\s+data-start="([^"]+)"\s+data-end="([^"]+)"/g)];
        return matches.map((m, i) => {
          const lineEl = createElementStub('div');
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
          const rowEl = createElementStub('div');
          rowEl.setAttribute('data-device-id', m[1]);
          rowEl.setAttribute('data-device-name', m[2]);
          return rowEl;
        });
      }
      return [];
    }
  };
  el.classList = createClassListStub(el);
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
      elementsById.set(id, createElementStub('div', id));
    }
    return elementsById.get(id);
  };

  const getSelectorEl = (sel) => {
    if (!selectorElements.has(sel)) {
      selectorElements.set(sel, createElementStub('div'));
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
  assert.equal(h.getEl('npActiveDeviceName').textContent, 'Conectando SpotiEcho…');
  assert.equal(h.getEl('npDeviceIndicatorRow').classList.contains('is-connecting'), true);

  const cfg = h.getPlayerConfig();
  let suppliedToken = null;
  await cfg.getOAuthToken(tok => { suppliedToken = tok; });
  assert.equal(suppliedToken, 'fresh_tok_123');

  const tokenCalls = h.fetchCalls.filter(c => c.url.includes('accounts.spotify.com/api/token'));
  assert.equal(tokenCalls.length, 1, 'getOAuthToken should reuse freshly refreshed token');

  h.emitSdkEvent('ready', { device_id: 'web_dev_1' });
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


