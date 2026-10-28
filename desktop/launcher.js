'use strict';

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

function showError(text) {
  error.textContent = text;
  error.classList.add('show');
}

function clearError() {
  error.textContent = '';
  error.classList.remove('show');
}

async function init() {
  try {
    const current = await window.launcher.currentUrl();
    if (current) input.value = current;
    const version = await window.yhspeak.getVersion();
    if (version) versionLabel.textContent = version;
    const domain = await window.launcher.defaultDomain();
    if (domain) {
      hint.textContent =
        `Можно ввести короткое имя — например «chat», и приложение подключится к chat.${domain}. ` +
        'Для микрофона и демонстрации экрана нужен HTTPS.';
    }
  } catch {
    /* preload unavailable */
  }
  input.focus();
  input.select();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  const value = input.value.trim();
  if (!value) {
    showError('Введите адрес сервера.');
    input.focus();
    return;
  }

  connectButton.disabled = true;
  connectLabel.textContent = 'Подключаемся…';
  connectButton.insertAdjacentHTML('afterbegin', '<span class="spinner"></span>');

  try {
    const result = await window.launcher.connect(value);
    if (!result.ok) {
      document.querySelector('.spinner')?.remove();
      connectButton.disabled = false;
      connectLabel.textContent = 'Подключиться';
      showError(result.error || 'Не удалось подключиться к серверу.');
    }
  } catch (err) {
    document.querySelector('.spinner')?.remove();
    connectButton.disabled = false;
    connectLabel.textContent = 'Подключиться';
    showError(err instanceof Error ? err.message : 'Не удалось подключиться к серверу.');
  }
});

input.addEventListener('input', clearError);

quitButton.addEventListener('click', () => {
  void window.launcher.quit();
});

minimizeButton.addEventListener('click', () => {
  void window.yhspeak.windowControls.minimize();
});

closeButton.addEventListener('click', () => {
  void window.yhspeak.windowControls.close();
});

void init();
