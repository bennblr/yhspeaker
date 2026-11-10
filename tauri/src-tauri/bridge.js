(function () {
  // Мост между веб-клиентом и Rust-ядром. Окно загружает удалённый сервер,
  // поэтому Tauri IPC недоступен: общаемся с локальным HTTP-сервером,
  // который слушает только 127.0.0.1 и проверяет случайный токен.
  if (window.la2speak && window.la2speak.isDesktop) return;

  const ENDPOINT = 'http://127.0.0.1:__BRIDGE_PORT__/rpc';
  const TOKEN = '__BRIDGE_TOKEN__';
  const listeners = new Map();
  let counter = 0;

  function on(name, callback) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
    return function () {
      const set = listeners.get(name);
      if (set) set.delete(callback);
    };
  }

  function fire(name, payload) {
    const set = listeners.get(name);
    if (!set) return;
    for (const callback of set) {
      try {
        callback(payload);
      } catch (_) {
        /* подписчик не должен ломать опрос событий */
      }
    }
  }

  async function rpc(method, params) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bridge-token': TOKEN,
      },
      body: JSON.stringify({ id: ++counter, method, params: params || {} }),
    });
    if (!response.ok) throw new Error('bridge ' + response.status);
    const data = await response.json();
    if (data && data.error) throw new Error(data.error);
    return data ? data.result : null;
  }

  async function pollLoop() {
    for (;;) {
      try {
        const events = await rpc('poll', {});
        for (const event of events || []) {
          if (!event || typeof event.type !== 'string') continue;
          fire(event.type, event);
        }
      } catch (_) {
        // Ядро могло перезапуститься или ещё не подняло сервер.
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }
  }

  const overlayDefaults = {
    enabled: false,
    anchor: 'middle-right',
    fontSize: 12,
    color: '#e8eaf2',
    editing: false,
  };

  window.la2speak = {
    isDesktop: true,
    platform: '__BRIDGE_PLATFORM__',
    __startDragging: () => {
      void rpc('window.startDragging').catch(() => undefined);
    },
    setPttKey: (accelerator) =>
      rpc('setPttKey', { accelerator })
        .then((result) => Boolean(result && result.ok))
        .catch(() => false),
    setMicMode: (mode) =>
      rpc('setMicMode', { mode }).then((result) => result.mode).catch(() => mode),
    setMicState: (state) => {
      void rpc('setMicState', { state }).catch(() => undefined);
    },
    setOverlayState: (state) => {
      void rpc('setOverlayState', { state }).catch(() => undefined);
    },
    getOverlayConfig: () => rpc('getOverlayConfig', {}).catch(() => overlayDefaults),
    setOverlayConfig: (patch) => rpc('setOverlayConfig', { patch }).catch(() => overlayDefaults),
    setOverlayEditMode: (editing) =>
      rpc('setOverlayEditMode', { editing }).catch(() => overlayDefaults),
    onOverlayConfig: (callback) => on('overlay-config', (event) => callback(event.config || event)),
    onPtt: (callback) => on('ptt', (event) => callback(Boolean(event.down))),
    onMicToggle: (callback) => on('mic-toggle', () => callback()),
    setBroadcastKeys: (bindings) =>
      rpc('setBroadcastKeys', { bindings }).then((result) => result.count || 0).catch(() => 0),
    onBroadcastToggle: (callback) =>
      on('broadcast-toggle', (event) => callback(String(event.target || ''))),
    onBroadcastState: (callback) =>
      on('broadcast-state', (event) =>
        callback({ target: String(event.target || ''), active: Boolean(event.active) }),
      ),
    hotkeysAvailable: () =>
      rpc('hotkeysAvailable', {}).then((result) => Boolean(result.available)).catch(() => false),
    changeServer: () => {
      void rpc('changeServer', {}).catch(() => undefined);
    },
    listServers: () =>
      rpc('listServers', {}).then((result) => result.servers || []).catch(() => []),
    switchServer: (url) =>
      rpc('switchServer', { url })
        .then((result) => ({ ok: true, url: result.url }))
        .catch((error) => ({ ok: false, error: String((error && error.message) || error) })),
    setServerName: (name) =>
      rpc('setServerName', { name }).then(() => undefined).catch(() => undefined),
    getVersion: () =>
      rpc('getVersion', {}).then((result) => String(result.version || '')).catch(() => ''),
    windowControls: {
      minimize: () => rpc('window.minimize', {}).then(() => undefined).catch(() => undefined),
      toggleMaximize: () =>
        rpc('window.toggleMaximize', {}).then((result) => Boolean(result.maximized)).catch(() => false),
      close: () => {
        void rpc('window.close', {}).catch(() => undefined);
      },
      isMaximized: () =>
        rpc('window.isMaximized', {}).then((result) => Boolean(result.maximized)).catch(() => false),
      onMaximizeChange: (callback) =>
        on('maximize-changed', (event) => callback(Boolean(event.maximized))),
    },
  };

  pollLoop();
})();
