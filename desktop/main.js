'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  dialog,
  ipcMain,
  session,
  shell,
  desktopCapturer,
  screen,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { DEFAULT_SERVER_DOMAIN, normalizeServerUrl } = require('./server-url');

const DEFAULT_SERVER_URL = `https://${DEFAULT_SERVER_DOMAIN}`;

// Без явного имени папка данных установленного клиента совпадает с dev-сборками,
// и сохранённый там http://127.0.0.1:4000 попадает в релиз.
if (app.isPackaged) app.setName('LA2Speak');
app.setAppUserModelId('ru.la2speak.client');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Расширенное эхоподавление: учитывает звук, воспроизводимый не только через WebRTC.
app.commandLine.appendSwitch('enable-features', 'ChromeWideEchoCancellation');

let mainWindow = null;
let launcherWindow = null;
let hook = null;
let uiohookKeys = null;
let currentAccelerator = null;
let broadcastBindings = [];
const broadcastHeld = new Set();
const heldModifierKeycodes = new Set();
const modifierKeycodes = new Map();
let pttHeld = false;
let quitting = false;
let tray = null;
// Режим клавиши микрофона: open — не используется, ptt — удержание, toggle — вкл/выкл.
let micMode = 'open';
let micKeyHeld = false;
let micState = {
  inCall: false,
  on: false,
  muted: false,
  broadcasting: false,
  channelName: '',
};

const configFile = () => path.join(app.getPath('userData'), 'config.json');

function sanitizeServers(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const url = typeof item.url === 'string' ? normalizeServerUrl(item.url) : null;
    if (!url) continue;
    if (result.some((entry) => entry.url === url)) continue;
    result.push({
      url,
      name: typeof item.name === 'string' ? item.name.slice(0, 60) : '',
      lastUsed: Number.isFinite(item.lastUsed) ? item.lastUsed : 0,
    });
  }
  return result.slice(0, 15);
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      serverUrl: typeof parsed.serverUrl === 'string' ? parsed.serverUrl : '',
      pttKey: typeof parsed.pttKey === 'string' ? parsed.pttKey : 'V',
      servers: sanitizeServers(parsed.servers),
    };
  } catch {
    return { serverUrl: '', pttKey: 'V', servers: [] };
  }
}

function saveConfig(config) {
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('[desktop] failed to save config', error);
  }
}

let stored = loadConfig();

// История серверов: в шапке показываются все, куда пользователь уже заходил.
function rememberServer(url, name) {
  const normalized = normalizeServerUrl(url);
  if (!normalized) return;
  const existing = stored.servers.find((entry) => entry.url === normalized);
  if (existing) {
    existing.lastUsed = Date.now();
    if (name) existing.name = name.slice(0, 60);
  } else {
    stored.servers.unshift({
      url: normalized,
      name: name ? name.slice(0, 60) : '',
      lastUsed: Date.now(),
    });
  }
  stored.servers.sort((a, b) => b.lastUsed - a.lastUsed);
  stored.servers = stored.servers.slice(0, 15);
  stored.serverUrl = normalized;
  saveConfig(stored);
}

function resolveStartUrl() {
  const saved = stored.serverUrl ? normalizeServerUrl(stored.serverUrl) : null;
  const localSaved = saved && /^https?:\/\/(localhost|127\.0\.0\.1)(?::|\/|$)/i.test(saved);
  if (saved && !(app.isPackaged && localSaved)) return saved;
  return DEFAULT_SERVER_URL;
}

function iconPath() {
  return path.join(__dirname, 'build', 'icon.png');
}

function createMainWindow(serverUrl) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(serverUrl);
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0d12',
    title: 'LA2Speak',
    icon: iconPath(),
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // Микрофон должен реагировать на глобальную клавишу и в свёрнутом окне.
      backgroundThrottling: false,
    },
  });

  const notifyMaximized = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', notifyMaximized);
  mainWindow.on('unmaximize', notifyMaximized);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(url).origin === new URL(serverUrl).origin;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || quitting) return;
    if (!url || url.startsWith('devtools:')) return;
    mainWindow?.hide();
    void dialog
      .showMessageBox({
        type: 'error',
        title: 'Нет связи с сервером',
        message: 'Не удалось открыть сервер LA2Speak',
        detail: `${serverUrl}\n${description || code}`,
        buttons: ['Повторить', 'Сменить сервер', 'Выход'],
        defaultId: 0,
        cancelId: 2,
      })
      .then(({ response }) => {
        if (response === 0) {
          mainWindow?.show();
          mainWindow?.loadURL(serverUrl);
        } else if (response === 1) {
          mainWindow?.hide();
          openLauncher();
        } else {
          app.quit();
        }
      });
  });

  mainWindow.webContents.on('render-process-gone', () => {
    sendPtt(false);
    if (!quitting && mainWindow) mainWindow.reload();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    sendPtt(false);
  });

  void mainWindow.loadURL(serverUrl);
}

function openLauncher() {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.show();
    launcherWindow.focus();
    return;
  }

  launcherWindow = new BrowserWindow({
    width: 560,
    height: 640,
    resizable: false,
    maximizable: false,
    minimizable: true,
    backgroundColor: '#0b0d12',
    title: 'LA2Speak — подключение',
    icon: iconPath(),
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  launcherWindow.once('ready-to-show', () => launcherWindow.show());
  launcherWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  launcherWindow.on('closed', () => {
    launcherWindow = null;
    if (!mainWindow && !quitting) app.quit();
  });

  void launcherWindow.loadFile(path.join(__dirname, 'launcher.html'));
}

function sendPtt(down) {
  if (pttHeld === down) return;
  pttHeld = down;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ptt', down);
  }
}

function sendMicToggle() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mic:toggle');
  }
}

function trayImage(name) {
  const image = nativeImage.createFromPath(path.join(__dirname, 'build', 'tray', `${name}.png`));
  return image.isEmpty() ? nativeImage.createFromPath(iconPath()) : image;
}

function trayTooltip() {
  const parts = ['LA2Speak'];
  if (!micState.inCall) {
    parts.push('не в голосовом канале');
  } else {
    if (micState.channelName) parts.push(`«${micState.channelName}»`);
    parts.push(micState.on ? 'микрофон включён' : 'микрофон выключен');
  }
  if (micState.broadcasting) parts.push('эфир');
  return parts.join(' · ');
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  createMainWindow(resolveStartUrl());
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: micState.inCall
          ? `Микрофон: ${micState.on ? 'включён' : 'выключен'}`
          : 'Микрофон: не в канале',
        enabled: micState.inCall,
        click: () => sendMicToggle(),
      },
      { type: 'separator' },
      { label: 'Показать LA2Speak', click: () => showMainWindow() },
      { label: 'Сменить сервер…', click: () => openLauncher() },
      { type: 'separator' },
      { label: 'Выход', click: () => app.quit() },
    ]),
  );
}

function updateTray() {
  if (!tray) return;
  tray.setImage(trayImage(micState.inCall ? (micState.on ? 'mic-on' : 'mic-off') : 'mic-idle'));
  tray.setToolTip(trayTooltip());
  buildTrayMenu();
  updateOverlay();
}

// Значок на кнопке приложения в панели задач: видно, передаёт ли микрофон.
function updateOverlay() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!micState.inCall) {
    mainWindow.setOverlayIcon(null, '');
    return;
  }
  mainWindow.setOverlayIcon(
    trayImage(micState.on ? 'overlay-on' : 'overlay-off'),
    micState.on ? 'Микрофон включён' : 'Микрофон выключен',
  );
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayImage('mic-idle'));
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
  updateTray();
}

function parseAccelerator(accelerator) {
  if (!accelerator || !uiohookKeys) return null;
  const parts = String(accelerator).split('+');
  const key = parts.pop();
  if (!key) return null;
  const keycode = uiohookKeys[key];
  if (typeof keycode !== 'number') return null;
  return {
    keycode,
    alt: parts.includes('Alt'),
    ctrl: parts.includes('Control') || parts.includes('CommandOrControl'),
    shift: parts.includes('Shift'),
    meta: parts.includes('Meta'),
  };
}

function setAccelerator(accelerator) {
  sendPtt(false);
  micKeyHeld = false;
  currentAccelerator = parseAccelerator(accelerator);
  return Boolean(currentAccelerator);
}

function loadUiohook() {
  try {
    return require('uiohook-napi');
  } catch {
    return require(path.join(process.resourcesPath, 'ptt', 'node_modules', 'uiohook-napi'));
  }
}

function modifierHeld(name) {
  for (const keycode of heldModifierKeycodes) {
    if (modifierKeycodes.get(keycode) === name) return true;
  }
  return false;
}

function updateModifier(event, down) {
  if (!modifierKeycodes.has(event.keycode)) return;
  if (down) heldModifierKeycodes.add(event.keycode);
  else heldModifierKeycodes.delete(event.keycode);
}

// libuiohook не всегда выставляет модификаторы в событии (особенно при
// синтетическом вводе), поэтому дополнительно отслеживаем нажатые клавиши.
function eventMatches(event, match) {
  if (!match) return false;
  if (event.keycode !== match.keycode) return false;
  if ((Boolean(event.altKey) || modifierHeld('alt')) !== match.alt) return false;
  if ((Boolean(event.ctrlKey) || modifierHeld('ctrl')) !== match.ctrl) return false;
  if ((Boolean(event.shiftKey) || modifierHeld('shift')) !== match.shift) return false;
  if ((Boolean(event.metaKey) || modifierHeld('meta')) !== match.meta) return false;
  return true;
}

function registerModifierKeys(keys) {
  modifierKeycodes.clear();
  for (const [name, names] of Object.entries({
    alt: ['Alt', 'AltRight'],
    ctrl: ['Ctrl', 'CtrlRight'],
    shift: ['Shift', 'ShiftRight'],
    meta: ['Meta', 'MetaRight'],
  })) {
    for (const key of names) {
      const keycode = keys[key];
      if (typeof keycode === 'number') modifierKeycodes.set(keycode, name);
    }
  }
}

function startKeyboardHook() {
  try {
    const api = loadUiohook();
    uiohookKeys = api.UiohookKey;
    hook = api.uIOhook;
    registerModifierKeys(uiohookKeys);

    hook.on('keydown', (event) => {
      updateModifier(event, true);

      for (const binding of broadcastBindings) {
        if (!eventMatches(event, binding)) continue;
        if (broadcastHeld.has(binding.target)) return;
        broadcastHeld.add(binding.target);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('broadcast:toggle', binding.target);
        }
        return;
      }

      if (!eventMatches(event, currentAccelerator)) return;
      if (micMode === 'toggle') {
        if (micKeyHeld) return;
        micKeyHeld = true;
        sendMicToggle();
        return;
      }
      if (micMode === 'ptt') sendPtt(true);
    });

    hook.on('keyup', (event) => {
      for (const binding of broadcastBindings) {
        if (event.keycode === binding.keycode) broadcastHeld.delete(binding.target);
      }
      updateModifier(event, false);

      if (!currentAccelerator || event.keycode !== currentAccelerator.keycode) return;
      micKeyHeld = false;
      if (micMode === 'ptt') sendPtt(false);
    });

    hook.start();
  } catch (error) {
    console.error('[desktop] global keyboard hook unavailable', error);
    hook = null;
  }
}

ipcMain.handle('ptt:set-key', (_event, accelerator) => {
  stored.pttKey = typeof accelerator === 'string' ? accelerator : 'V';
  saveConfig(stored);
  return setAccelerator(stored.pttKey);
});

ipcMain.handle('mic:set-mode', (_event, mode) => {
  micMode = mode === 'ptt' || mode === 'toggle' ? mode : 'open';
  micKeyHeld = false;
  sendPtt(false);
  return micMode;
});

ipcMain.on('mic:state', (_event, state) => {
  if (!state || typeof state !== 'object') return;
  micState = {
    inCall: Boolean(state.inCall),
    on: Boolean(state.on),
    muted: Boolean(state.muted),
    broadcasting: Boolean(state.broadcasting),
    channelName: typeof state.channelName === 'string' ? state.channelName : '',
  };
  updateTray();
});

ipcMain.handle('broadcast:set-keys', (_event, bindings) => {
  const next = [];
  if (Array.isArray(bindings)) {
    for (const item of bindings) {
      if (!item || typeof item.target !== 'string') continue;
      const parsed = parseAccelerator(item.accelerator);
      if (parsed) next.push({ target: item.target, ...parsed });
    }
  }
  broadcastBindings = next;
  broadcastHeld.clear();
  return next.length;
});

ipcMain.handle('hotkeys:available', () => Boolean(hook));

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle('window:toggle-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
  return window.isMaximized();
});

ipcMain.handle('window:is-maximized', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('app:change-server', () => {
  openLauncher();
});

ipcMain.handle('app:list-servers', () => {
  const current = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getURL() : '';
  let currentUrl = stored.serverUrl;
  try {
    if (current) currentUrl = new URL(current).origin;
  } catch {
    /* ignore */
  }
  return stored.servers
    .slice()
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .map((entry) => ({
      ...entry,
      current: entry.url === normalizeServerUrl(currentUrl),
    }));
});

ipcMain.handle('app:switch-server', async (_event, value) => {
  const url = normalizeServerUrl(value);
  if (!url) return { ok: false, error: 'Некорректный адрес сервера' };
  rememberServer(url);
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(url);
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow(url);
  }
  return { ok: true, url };
});

ipcMain.handle('app:set-server-name', (_event, name) => {
  if (typeof name !== 'string') return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const current = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getURL() : '';
  let url = stored.serverUrl;
  try {
    if (current) url = new URL(current).origin;
  } catch {
    /* ignore */
  }
  const normalized = normalizeServerUrl(url);
  if (!normalized) return;
  const entry = stored.servers.find((item) => item.url === normalized);
  if (!entry) {
    stored.servers.unshift({ url: normalized, name: trimmed.slice(0, 60), lastUsed: Date.now() });
  } else if (entry.name !== trimmed.slice(0, 60)) {
    entry.name = trimmed.slice(0, 60);
  } else {
    return;
  }
  saveConfig(stored);
});

ipcMain.handle('launcher:servers', () => {
  return stored.servers
    .slice()
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .map((entry) => ({ ...entry, current: entry.url === stored.serverUrl }));
});

ipcMain.handle('launcher:current-url', () => stored.serverUrl || '');

ipcMain.handle('launcher:default-domain', () => DEFAULT_SERVER_DOMAIN);

ipcMain.handle('launcher:connect', (_event, value) => {
  const url = normalizeServerUrl(value);
  if (!url) {
    return { ok: false, error: 'Укажите адрес сервера, например chat или chat.la2speak.com' };
  }
  rememberServer(url);
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.close();
  }
  createMainWindow(url);
  return { ok: true, url };
});

ipcMain.handle('launcher:quit', () => {
  app.quit();
});

function buildMenu() {
  const template = [
    {
      label: 'Сервер',
      submenu: [
        {
          label: 'Сменить сервер…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => openLauncher(),
        },
        { type: 'separator' },
        {
          label: 'Перезагрузить',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.reload(),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Выход' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'resetZoom', label: 'Масштаб 100%' },
        { role: 'zoomIn', label: 'Увеличить' },
        { role: 'zoomOut', label: 'Уменьшить' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полный экран' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'О программе LA2Speak',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'LA2Speak',
              message: `LA2Speak ${app.getVersion()}`,
              detail: 'Клиент голосового сервера LA2Speak.\nВещание администратора во все каналы, экран, текст и модерация.',
              buttons: ['ОК'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function configureSession() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission === 'media' || permission === 'display-capture') {
      callback(true);
      return;
    }
    if (permission === 'clipboard-sanitized-write' || permission === 'clipboard-read') {
      callback(true);
      return;
    }
    if (permission === 'fullscreen' || permission === 'notifications') {
      callback(true);
      return;
    }
    callback(false);
  });

  ses.setPermissionCheckHandler((_webContents, permission) => {
    return [
      'media',
      'display-capture',
      'clipboard-sanitized-write',
      'fullscreen',
      'notifications',
    ].includes(permission);
  });

  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          if (sources.length === 0) {
            callback({});
            return;
          }
          const primaryDisplay = screen.getPrimaryDisplay();
          const sourceId = `screen:${primaryDisplay.id}:`;
          const source =
            sources.find((item) => item.id.startsWith(sourceId)) ??
            sources.find((item) => item.id.startsWith('screen:')) ??
            sources[0];
          callback({ video: source });
        })
        .catch((error) => {
          console.error('[desktop] display media failed', error);
          callback({});
        });
    },
    { useSystemPicker: true },
  );
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = launcherWindow ?? mainWindow;
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });

  app.whenReady().then(() => {
    stored = loadConfig();
    configureSession();
    buildMenu();
    startKeyboardHook();
    setAccelerator(stored.pttKey);

    createMainWindow(resolveStartUrl());
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow(resolveStartUrl());
      }
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    if (hook) {
      try {
        hook.stop();
      } catch {
        /* ignore */
      }
      hook = null;
    }
  });
}
