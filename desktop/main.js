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
// Режим клавиши микрофона: voice — не используется, ptt — удержание, toggle — вкл/выкл.
let micMode = 'voice';
let micKeyHeld = false;
let micState = {
  inCall: false,
  on: false,
  muted: false,
  broadcasting: false,
  channelName: '',
};
// Оверлей канала: отдельное окно поверх всех окон, данные присылает приложение.
let overlayWindow = null;
let overlayReady = false;
let overlayState = null;
// Ручное положение: пока режим включён, окно ловит мышь и его можно перетащить.
let overlayEditing = false;
let overlayMoveGuardUntil = 0;
let overlaySaveTimer = null;
let overlayEditTimer = null;
// Источник, выбранный в окне «Показать экран»; следующий getDisplayMedia заберёт его.
let pendingDisplaySourceId = null;
const OVERLAY_WIDTH = 200;
const OVERLAY_ROW = 24;
const OVERLAY_EDIT_BAR = 30;
const OVERLAY_FONT_DEFAULT = 11;
const OVERLAY_FONT_MIN = 10;
const OVERLAY_FONT_MAX = 24;
const OVERLAY_COLOR_DEFAULT = '#dfe5f2';
const OVERLAY_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

function normalizeOverlayAnchor(value) {
  if (value === 'manual') return 'manual';
  return OVERLAY_ANCHORS.includes(value) ? value : 'top-left';
}

function sanitizeOverlayPosition(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function sanitizeOverlayFontSize(value) {
  const size = Math.round(Number(value));
  if (!Number.isFinite(size)) return OVERLAY_FONT_DEFAULT;
  return Math.min(OVERLAY_FONT_MAX, Math.max(OVERLAY_FONT_MIN, size));
}

function sanitizeOverlayColor(value) {
  const color = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^#[0-9a-f]{6}$/.test(color) ? color : OVERLAY_COLOR_DEFAULT;
}

// Окно оверлея растёт вместе со шрифтом: строки и ширина должны совпадать
// с CSS в overlay.html, иначе имена обрезаются или появляется пустое место.
function overlayMetrics() {
  const fontSize = sanitizeOverlayFontSize(stored.overlayFontSize);
  return {
    fontSize,
    width: OVERLAY_WIDTH + (fontSize - OVERLAY_FONT_DEFAULT) * 8,
    row: OVERLAY_ROW + (fontSize - OVERLAY_FONT_DEFAULT),
  };
}

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
      overlayEnabled: parsed.overlayEnabled !== false,
      overlayAnchor: normalizeOverlayAnchor(parsed.overlayAnchor),
      overlayPosition: sanitizeOverlayPosition(parsed.overlayPosition),
      overlayFontSize: sanitizeOverlayFontSize(parsed.overlayFontSize),
      overlayColor: sanitizeOverlayColor(parsed.overlayColor),
      servers: sanitizeServers(parsed.servers),
    };
  } catch {
    return {
      serverUrl: '',
      pttKey: 'V',
      overlayEnabled: true,
      overlayAnchor: 'top-left',
      overlayPosition: null,
      overlayFontSize: OVERLAY_FONT_DEFAULT,
      overlayColor: OVERLAY_COLOR_DEFAULT,
      servers: [],
    };
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

// Сервер по умолчанию не задан: без сохранённого адреса клиент сначала спрашивает сервер.
function resolveStartUrl() {
  const saved = stored.serverUrl ? normalizeServerUrl(stored.serverUrl) : null;
  if (!saved) return null;
  const localSaved = /^https?:\/\/(localhost|127\.0\.0\.1)(?::|\/|$)/i.test(saved);
  if (app.isPackaged && localSaved) return null;
  return saved;
}

function openStart() {
  const url = resolveStartUrl();
  if (url) createMainWindow(url);
  else openLauncher();
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
    overlayState = null;
    applyOverlay();
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
    destroyOverlay();
  });

  void mainWindow.loadURL(serverUrl);
}

function sanitizeOverlayState(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.participants)) return null;
  const participants = [];
  for (const item of value.participants.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 48) : '';
    if (!name) continue;
    participants.push({
      sessionId: typeof item.sessionId === 'string' ? item.sessionId.slice(0, 80) : '',
      name,
      self: Boolean(item.self),
      speaking: Boolean(item.speaking),
      muted: Boolean(item.muted),
      deafened: Boolean(item.deafened),
      broadcasting: Boolean(item.broadcasting),
      screen: Boolean(item.screen),
    });
  }
  if (participants.length === 0) return null;
  return {
    channelName:
      typeof value.channelName === 'string' ? value.channelName.trim().slice(0, 60) : '',
    participants,
  };
}

function overlayBounds(count) {
  const area = screen.getPrimaryDisplay().workArea;
  const rows = Math.min(Math.max(count, 1), 30);
  const metrics = overlayMetrics();
  const width = metrics.width;
  const heightLimit = Math.round(area.height * 0.7);
  const height = Math.min(
    14 + rows * metrics.row + (overlayEditing ? OVERLAY_EDIT_BAR : 0),
    heightLimit,
  );
  const margin = 12;
  const anchor = normalizeOverlayAnchor(stored.overlayAnchor);
  if (anchor === 'manual' && stored.overlayPosition) {
    const { x, y } = stored.overlayPosition;
    const target = screen.getDisplayNearestPoint({
      x: x + Math.round(width / 2),
      y: y + Math.round(height / 2),
    }).workArea;
    return {
      x: Math.min(Math.max(x, target.x), target.x + target.width - width),
      y: Math.min(Math.max(y, target.y), target.y + target.height - height),
      width,
      height,
    };
  }
  const [vertical, horizontal] = anchor.split('-');
  const x =
    horizontal === 'left'
      ? area.x + margin
      : horizontal === 'right'
        ? area.x + area.width - width - margin
        : area.x + Math.round((area.width - width) / 2);
  const y =
    vertical === 'top'
      ? area.y + margin
      : vertical === 'bottom'
        ? area.y + area.height - height - margin
        : area.y + Math.round((area.height - height) / 2);
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(y, area.y), area.y + area.height - height),
    width,
    height,
  };
}

function sendOverlayEdit() {
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayReady) {
    overlayWindow.webContents.send('overlay:edit', overlayEditing);
  }
}

function sendOverlayStyle() {
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayReady) {
    overlayWindow.webContents.send('overlay:style', {
      fontSize: sanitizeOverlayFontSize(stored.overlayFontSize),
      color: sanitizeOverlayColor(stored.overlayColor),
    });
  }
}

function rememberOverlayPosition() {
  if (!overlayEditing || !overlayWindow || overlayWindow.isDestroyed()) return;
  if (Date.now() < overlayMoveGuardUntil) return;
  const [x, y] = overlayWindow.getPosition();
  stored.overlayAnchor = 'manual';
  stored.overlayPosition = { x, y };
  if (overlaySaveTimer) return;
  overlaySaveTimer = setTimeout(() => {
    overlaySaveTimer = null;
    saveConfig(stored);
    sendOverlayConfig();
  }, 300);
}

function setOverlayEditing(value) {
  const next = Boolean(value);
  if (overlayEditing === next) return;
  overlayEditing = next;
  if (overlayEditTimer) {
    clearTimeout(overlayEditTimer);
    overlayEditTimer = null;
  }
  if (next) {
    ensureOverlayWindow();
    // Режим настройки не должен остаться включённым навсегда: оверлей иначе
    // продолжал бы перехватывать мышь поверх чужих окон.
    overlayEditTimer = setTimeout(() => finishOverlayEditing(), 120_000);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setFocusable(next);
    overlayWindow.setMovable(next);
    overlayWindow.setIgnoreMouseEvents(!next);
  }
  // Режим настройки показывается даже вне голосового канала и добавляет
  // полосу «Готово»: без пересчёта окно осталось бы скрытым и старой высоты.
  applyOverlay();
  if (next && overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.focus();
  sendOverlayEdit();
}

function finishOverlayEditing() {
  if (!overlayEditing) return;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    const [x, y] = overlayWindow.getPosition();
    if (stored.overlayAnchor === 'manual') stored.overlayPosition = { x, y };
  }
  setOverlayEditing(false);
  saveConfig(stored);
  applyOverlay();
  sendOverlayConfig();
}

function ensureOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  overlayReady = false;
  overlayWindow = new BrowserWindow({
    ...overlayBounds(1),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: overlayEditing,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    focusable: overlayEditing,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  // Уровень screen-saver держит окно над панелью задач и безрамочным
  // полноэкранным режимом игр; клики проходят сквозь оверлей.
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(!overlayEditing);
  overlayWindow.on('move', rememberOverlayPosition);
  overlayWindow.on('closed', () => {
    overlayWindow = null;
    overlayReady = false;
  });
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayReady = true;
    if (overlayState) overlayWindow?.webContents.send('overlay:state', overlayState);
    sendOverlayEdit();
    sendOverlayStyle();
  });
  void overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  return overlayWindow;
}

function applyOverlay() {
  const visible = overlayEditing || Boolean(stored.overlayEnabled && overlayState);
  if (!visible) {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
      overlayWindow.hide();
    }
    return;
  }
  const win = ensureOverlayWindow();
  overlayMoveGuardUntil = Date.now() + 250;
  win.setBounds(overlayBounds(overlayState ? overlayState.participants.length : 1));
  if (overlayReady) win.webContents.send('overlay:state', overlayState);
  sendOverlayStyle();
  if (!win.isVisible()) win.showInactive();
}

function destroyOverlay() {
  overlayState = null;
  overlayReady = false;
  overlayEditing = false;
  if (overlayEditTimer) {
    clearTimeout(overlayEditTimer);
    overlayEditTimer = null;
  }
  if (overlaySaveTimer) {
    clearTimeout(overlaySaveTimer);
    overlaySaveTimer = null;
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
  overlayWindow = null;
}

function overlayConfig() {
  return {
    enabled: Boolean(stored.overlayEnabled),
    anchor: normalizeOverlayAnchor(stored.overlayAnchor),
    position: stored.overlayPosition ?? null,
    editing: overlayEditing,
    fontSize: sanitizeOverlayFontSize(stored.overlayFontSize),
    color: sanitizeOverlayColor(stored.overlayColor),
  };
}

function syncOverlayMenu() {
  const item = Menu.getApplicationMenu()?.getMenuItemById('overlay-toggle');
  if (item) item.checked = Boolean(stored.overlayEnabled);
}

function sendOverlayConfig() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('overlay:config', overlayConfig());
  }
}

// Меню «Вид» и окно настроек меняют одно состояние, поэтому рендерер получает копию.
function applyOverlayConfig(patch) {
  if (patch && typeof patch === 'object') {
    if (typeof patch.enabled === 'boolean') stored.overlayEnabled = patch.enabled;
    if (typeof patch.anchor === 'string' && normalizeOverlayAnchor(patch.anchor) === patch.anchor) {
      stored.overlayAnchor = patch.anchor;
    }
    if (patch.fontSize !== undefined) {
      stored.overlayFontSize = sanitizeOverlayFontSize(patch.fontSize);
    }
    if (patch.color !== undefined) stored.overlayColor = sanitizeOverlayColor(patch.color);
    if (typeof patch.editing === 'boolean') setOverlayEditing(patch.editing);
    saveConfig(stored);
  }
  syncOverlayMenu();
  applyOverlay();
  sendOverlayConfig();
  return overlayConfig();
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

// Режим переключения шлёт одно событие на нажатие, режим удержания —
// отдельные сигналы включения и выключения, чтобы окно могло вести эфир
// ровно пока клавиша или кнопка мыши зажата.
function sendBroadcast(binding, active) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (binding.mode === 'ptt') {
    mainWindow.webContents.send('broadcast:state', { target: binding.target, active });
    return;
  }
  if (active) mainWindow.webContents.send('broadcast:toggle', binding.target);
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
  openStart();
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

const MOUSE_TOKENS = { Mouse3: 3, Mouse4: 4, Mouse5: 5 };

// Модификатор может быть назначен сам по себе: ловим обе его физические клавиши.
const MODIFIER_KEY_TOKENS = {
  Control: ['Ctrl', 'CtrlRight'],
  Alt: ['Alt', 'AltRight'],
  Shift: ['Shift', 'ShiftRight'],
  Meta: ['Meta', 'MetaRight'],
};

function parseAccelerator(accelerator) {
  if (!accelerator) return null;
  const parts = String(accelerator).split('+');
  const key = parts.pop();
  if (!key) return null;
  const modifiers = {
    alt: parts.includes('Alt'),
    ctrl: parts.includes('Control') || parts.includes('CommandOrControl'),
    shift: parts.includes('Shift'),
    meta: parts.includes('Meta'),
  };
  if (Object.prototype.hasOwnProperty.call(MOUSE_TOKENS, key)) {
    return { mouse: MOUSE_TOKENS[key], ...modifiers };
  }
  if (!uiohookKeys) return null;
  if (Object.prototype.hasOwnProperty.call(MODIFIER_KEY_TOKENS, key)) {
    const keycodes = MODIFIER_KEY_TOKENS[key]
      .map((name) => uiohookKeys[name])
      .filter((code) => typeof code === 'number');
    if (keycodes.length === 0) return null;
    return { keycodes, ...modifiers };
  }
  const keycode = uiohookKeys[key];
  if (typeof keycode !== 'number') return null;
  return { keycode, ...modifiers };
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

function keycodeMatches(match, keycode) {
  if (Array.isArray(match.keycodes)) return match.keycodes.includes(keycode);
  return match.keycode === keycode;
}

// libuiohook не всегда выставляет модификаторы в событии (особенно при
// синтетическом вводе), поэтому дополнительно отслеживаем нажатые клавиши.
// Лишние зажатые модификаторы не мешают: в игре можно держать Shift или Ctrl.
function eventMatches(event, match) {
  if (!match || (match.keycode === undefined && !Array.isArray(match.keycodes))) return false;
  if (!keycodeMatches(match, event.keycode)) return false;
  if (match.alt && !(event.altKey || modifierHeld('alt'))) return false;
  if (match.ctrl && !(event.ctrlKey || modifierHeld('ctrl'))) return false;
  if (match.shift && !(event.shiftKey || modifierHeld('shift'))) return false;
  if (match.meta && !(event.metaKey || modifierHeld('meta'))) return false;
  return true;
}

function mouseMatches(event, match) {
  if (!match || match.mouse === undefined) return false;
  if (event.button !== match.mouse) return false;
  if (match.alt && !(event.altKey || modifierHeld('alt'))) return false;
  if (match.ctrl && !(event.ctrlKey || modifierHeld('ctrl'))) return false;
  if (match.shift && !(event.shiftKey || modifierHeld('shift'))) return false;
  if (match.meta && !(event.metaKey || modifierHeld('meta'))) return false;
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
        if (binding.mouse !== undefined) continue;
        if (!eventMatches(event, binding)) continue;
        if (broadcastHeld.has(binding.target)) return;
        broadcastHeld.add(binding.target);
        sendBroadcast(binding, true);
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
        if (binding.mouse !== undefined) continue;
        if (!keycodeMatches(binding, event.keycode)) continue;
        if (!broadcastHeld.delete(binding.target)) continue;
        if (binding.mode === 'ptt') sendBroadcast(binding, false);
      }
      updateModifier(event, false);

      if (!currentAccelerator || currentAccelerator.mouse !== undefined) return;
      if (!keycodeMatches(currentAccelerator, event.keycode)) return;
      micKeyHeld = false;
      if (micMode === 'ptt') sendPtt(false);
    });

    hook.on('mousedown', (event) => {
      for (const binding of broadcastBindings) {
        if (binding.mouse === undefined) continue;
        if (!mouseMatches(event, binding)) continue;
        if (broadcastHeld.has(binding.target)) return;
        broadcastHeld.add(binding.target);
        sendBroadcast(binding, true);
        return;
      }

      if (!mouseMatches(event, currentAccelerator)) return;
      if (micMode === 'toggle') {
        if (micKeyHeld) return;
        micKeyHeld = true;
        sendMicToggle();
        return;
      }
      if (micMode === 'ptt') sendPtt(true);
    });

    hook.on('mouseup', (event) => {
      for (const binding of broadcastBindings) {
        if (binding.mouse === undefined) continue;
        if (event.button !== binding.mouse) continue;
        if (!broadcastHeld.delete(binding.target)) continue;
        if (binding.mode === 'ptt') sendBroadcast(binding, false);
      }

      if (!currentAccelerator || currentAccelerator.mouse === undefined) return;
      if (event.button !== currentAccelerator.mouse) return;
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
  micMode = mode === 'ptt' || mode === 'toggle' ? mode : 'voice';
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
      if (parsed) {
        next.push({
          target: item.target,
          mode: item.mode === 'ptt' ? 'ptt' : 'toggle',
          ...parsed,
        });
      }
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

ipcMain.handle('overlay:get-config', () => overlayConfig());

ipcMain.handle('overlay:set-config', (_event, patch) => applyOverlayConfig(patch));

ipcMain.handle('overlay:set-edit', (_event, editing) => {
  setOverlayEditing(Boolean(editing));
  applyOverlay();
  sendOverlayConfig();
  return overlayConfig();
});

// Кнопка «Готово» на самом оверлее: закрывает режим перетаскивания.
ipcMain.on('overlay:end-edit', () => finishOverlayEditing());

ipcMain.on('overlay:set-state', (_event, value) => {
  overlayState = sanitizeOverlayState(value);
  applyOverlay();
});

ipcMain.handle('screen:get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    kind: source.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : '',
    appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : '',
  }));
});

ipcMain.handle('screen:select-source', (_event, sourceId) => {
  pendingDisplaySourceId = typeof sourceId === 'string' ? sourceId.slice(0, 200) : null;
  return Boolean(pendingDisplaySourceId);
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
        {
          id: 'overlay-toggle',
          label: 'Оверлей канала',
          type: 'checkbox',
          checked: stored.overlayEnabled,
          click: (item) => applyOverlayConfig({ enabled: item.checked }),
        },
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

  ses.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const pending = pendingDisplaySourceId;
        pendingDisplaySourceId = null;
        const source =
          (pending && sources.find((item) => item.id === pending)) ||
          sources.find((item) => item.id.startsWith(`screen:${screen.getPrimaryDisplay().id}:`)) ||
          sources.find((item) => item.id.startsWith('screen:')) ||
          sources[0];
        callback(source ? { video: source } : {});
      })
      .catch((error) => {
        console.error('[desktop] display media failed', error);
        callback({});
      });
  });
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

    openStart();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        openStart();
      }
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    destroyOverlay();
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
