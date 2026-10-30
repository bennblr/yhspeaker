'use strict';

const card = document.getElementById('card');
const channelLabel = document.getElementById('channel');
const countLabel = document.getElementById('count');
const rowsBox = document.getElementById('rows');

const ROW_HEIGHT = 24;

const ICONS = {
  muted:
    '<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 11.9 5"/><path d="M12 17v4"/><path d="M3 3l18 18"/></svg>',
  deafened:
    '<svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="2"/><rect x="17" y="14" width="4" height="6" rx="2"/><path d="M3 3l18 18"/></svg>',
  broadcast:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/></svg>',
  screen:
    '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8"/></svg>',
};

let lastState = null;

function initials(name) {
  const clean = String(name || '').trim();
  return clean ? clean[0].toUpperCase() : '?';
}

function hue(name) {
  let hash = 0;
  for (const char of String(name || '')) hash = (hash * 31 + char.codePointAt(0)) % 360;
  return hash;
}

function badge(icon, title, className) {
  const span = document.createElement('span');
  span.className = className || '';
  span.title = title;
  span.innerHTML = icon;
  return span;
}

function renderRow(person) {
  const row = document.createElement('div');
  row.className = 'row';
  if (person.speaking) row.classList.add('speaking');
  if (person.muted || person.deafened) row.classList.add('off');

  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.style.background = `hsl(${hue(person.name)} 55% 42%)`;
  avatar.textContent = initials(person.name);
  row.append(avatar);

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = person.name;
  name.title = person.name;
  row.append(name);

  if (person.self) {
    const me = document.createElement('span');
    me.className = 'me';
    me.textContent = 'вы';
    row.append(me);
  }

  const badges = document.createElement('span');
  badges.className = 'badges';
  if (person.broadcasting) badges.append(badge(ICONS.broadcast, 'Вещает', 'live'));
  if (person.screen) badges.append(badge(ICONS.screen, 'Демонстрация экрана'));
  if (person.deafened) badges.append(badge(ICONS.deafened, 'Не слышит'));
  if (person.muted && !person.deafened) badges.append(badge(ICONS.muted, 'Микрофон выключен'));
  if (badges.childElementCount > 0) row.append(badges);

  row.dataset.sessionId = person.sessionId;
  return row;
}

function render() {
  const state = lastState;
  const participants = Array.isArray(state?.participants) ? state.participants : [];
  if (participants.length === 0) {
    card.hidden = true;
    rowsBox.textContent = '';
    return;
  }

  card.hidden = false;
  channelLabel.textContent = state.channelName || 'Голосовой канал';
  channelLabel.title = state.channelName || '';
  countLabel.textContent = String(participants.length);

  const rowsArea = Math.max(ROW_HEIGHT, window.innerHeight - 36);
  let capacity = Math.max(1, Math.floor(rowsArea / ROW_HEIGHT));
  if (participants.length > capacity) capacity = Math.max(1, capacity - 1);
  const visible = participants.slice(0, capacity);
  const hidden = participants.length - visible.length;

  rowsBox.textContent = '';
  for (const person of visible) rowsBox.append(renderRow(person));
  if (hidden > 0) {
    const more = document.createElement('div');
    more.className = 'more';
    more.textContent = `и ещё ${hidden}`;
    rowsBox.append(more);
  }
}

window.overlay.onState((state) => {
  lastState = state;
  render();
});

window.addEventListener('resize', render);

render();
