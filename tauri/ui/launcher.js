'use strict';

const invoke = window.__TAURI__.core.invoke;
const appWindow = window.__TAURI__.window.getCurrentWindow();

const form = document.getElementById('form');
const input = document.getElementById('server');
const error = document.getElementById('error');
const connectButton = document.getElementById('connect');
const connectLabel = document.getElementById('connect-label');
const hint = document.getElementById('hint');
const quitButton = document.getElementById('quit');
const minimizeButton = document.getElementById('minimize');
const closeButton = document.getElementById('close');
const versionLabel = document.getElementById('version');
const recentBlock = document.getElementById('recent');
const recentList = document.getElementById('recent-list');

function showError(text) {
  error.textContent = text;
  error.classList.add('show');
}

function clearError() {
  error.textContent = '';
  error.classList.remove('show');
}

function setBusy(busy) {
  document.querySelector('.spinner')?.remove();
  connectButton.disabled = busy;
  connectLabel.textContent = busy ? 'Подключаемся…' : 'Подключиться';
  if (busy) connectButton.insertAdjacentHTML('afterbegin', '<span class="spinner"></span>');
  recentList
    .querySelectorAll('button')
    .forEach((button) => button.toggleAttribute('disabled', busy));
}

async function connectTo(value) {
  clearError();
  setBusy(true);
  try {
    await invoke('launcher_connect', { url: value });
  } catch (err) {
    setBusy(false);
    showError(typeof err === 'string' ? err : 'Не удалось подключиться к серверу.');
  }
}

function serverHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function renderRecent(servers) {
  recentList.textContent = '';
  recentBlock.hidden = servers.length === 0;
  for (const server of servers) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'recent-item';
    item.title = server.url;

    const dot = document.createElement('span');
    dot.className = server.current ? 'dot current' : 'dot';

    const text = document.createElement('span');
    text.className = 'text';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = server.name || serverHost(server.url);
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = server.name ? serverHost(server.url) : server.url;
    text.append(name, host);

    item.append(dot, text);

    if (server.current) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'текущий';
      item.append(badge);
    }

    item.addEventListener('click', () => {
      void connectTo(server.url);
    });
    recentList.append(item);
  }
}

async function init() {
  try {
    const current = await invoke('launcher_current_url');
    if (current) input.value = current;
    const version = await invoke('app_version');
    if (version) versionLabel.textContent = version;
    const domain = await invoke('launcher_default_domain');
    if (domain) {
      hint.textContent =
        `Можно ввести короткое имя — например «chat», и приложение подключится к chat.${domain}. ` +
        'Для микрофона и демонстрации экрана нужен HTTPS.';
    }
    renderRecent(await invoke('launcher_servers'));
  } catch {
    /* мост недоступен */
  }
  input.focus();
  input.select();
}

document.querySelector('.titlebar').addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  if (event.target.closest('button')) return;
  void appWindow.startDragging();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (!value) {
    showError('Введите адрес сервера.');
    input.focus();
    return;
  }
  void connectTo(value);
});

input.addEventListener('input', clearError);

quitButton.addEventListener('click', () => {
  void invoke('launcher_quit');
});

minimizeButton.addEventListener('click', () => {
  void invoke('window_minimize');
});

closeButton.addEventListener('click', () => {
  void invoke('window_close');
});

void init();
