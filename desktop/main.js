'use strict';

const {
  app,
  BrowserWindow,
  Menu,
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

app.setAppUserModelId('ru.yhspeak.client');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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

const configFile = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    const raw = fs.readFileSync(configFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      serverUrl: typeof parsed.serverUrl === 'string' ? parsed.serverUrl : '',
      pttKey: typeof parsed.pttKey === 'string' ? parsed.pttKey : 'V',
    };
  } catch {
    return { serverUrl: '', pttKey: 'V' };
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

function normalizeServerUrl(value) {
  if (typeof value !== 'string') return null;
  let raw = value.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
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
    title: 'YHSpeak',
    icon: iconPath(),
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
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
        message: 'Не удалось открыть сервер YHSpeak',
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
    title: 'YHSpeak — подключение',
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
      sendPtt(true);
    });

    hook.on('keyup', (event) => {
      for (const binding of broadcastBindings) {
        if (event.keycode === binding.keycode) broadcastHeld.delete(binding.target);
      }
      updateModifier(event, false);

      if (!currentAccelerator || event.keycode !== currentAccelerator.keycode) return;
      sendPtt(false);
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

ipcMain.handle('launcher:current-url', () => stored.serverUrl || '');

ipcMain.handle('launcher:connect', (_event, value) => {
  const url = normalizeServerUrl(value);
  if (!url) {
    return { ok: false, error: 'Укажите корректный адрес, например https://voice.example.com' };
  }
  stored.serverUrl = url;
  saveConfig(stored);
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
          label: 'О программе YHSpeak',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'YHSpeak',
              message: `YHSpeak ${app.getVersion()}`,
              detail: 'Клиент голосового сервера YHSpeak.\nВещание администратора во все каналы, экран, текст и модерация.',
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

    if (stored.serverUrl && normalizeServerUrl(stored.serverUrl)) {
      createMainWindow(normalizeServerUrl(stored.serverUrl));
    } else {
      openLauncher();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        if (stored.serverUrl) createMainWindow(stored.serverUrl);
        else openLauncher();
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
