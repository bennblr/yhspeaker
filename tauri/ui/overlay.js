'use strict';

const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;
const appWindow = window.__TAURI__.window.getCurrentWindow();

const card = document.getElementById('card');
const rowsBox = document.getElementById('rows');
const editDone = document.getElementById('edit-done');

const VERTICAL_PADDING = 14;
const EDIT_BAR_HEIGHT = 24;

let lastState = null;
let editing = false;
let rowStep = 24;

function renderRow(person) {
  const row = document.createElement('div');
  row.className = 'row';
  if (person.speaking) row.classList.add('speaking');

  const activity = document.createElement('span');
  activity.className = 'activity';
  row.append(activity);

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = person.name;
  name.title = person.name;
  row.append(name);

  row.dataset.sessionId = person.sessionId;
  return row;
}

function render() {
  const participants = Array.isArray(lastState?.participants) ? lastState.participants : [];
  if (participants.length === 0 && !editing) {
    card.hidden = true;
    rowsBox.textContent = '';
    return;
  }

  card.hidden = false;

  const rowsArea = Math.max(
    rowStep,
    window.innerHeight - VERTICAL_PADDING - (editing ? EDIT_BAR_HEIGHT : 0),
  );
  const capacity = Math.max(1, Math.floor(rowsArea / rowStep));

  rowsBox.textContent = '';
  for (const person of participants.slice(0, capacity)) rowsBox.append(renderRow(person));
}

function setEditing(value) {
  editing = Boolean(value);
  document.body.classList.toggle('editing', editing);
  render();
}

function applyStyle(style) {
  const fontSize = Number(style?.fontSize);
  if (Number.isFinite(fontSize) && fontSize > 0) {
    rowStep = fontSize + 13;
    document.documentElement.style.setProperty('--overlay-font', `${fontSize}px`);
  }
  if (typeof style?.color === 'string' && /^#[0-9a-f]{6}$/i.test(style.color)) {
    document.documentElement.style.setProperty('--overlay-color', style.color);
  }
}

async function boot() {
  await listen('overlay:state', (event) => {
    lastState = event.payload ?? null;
    render();
  });
  await listen('overlay:edit', (event) => setEditing(event.payload));
  await listen('overlay:style', (event) => applyStyle(event.payload));

  try {
    const snapshot = await invoke('overlay_snapshot');
    setEditing(snapshot.editing);
    applyStyle(snapshot);
    lastState = snapshot.state ?? null;
  } catch {
    /* мост недоступен */
  }
  render();
}

card.addEventListener('pointerdown', (event) => {
  if (!editing || event.button !== 0) return;
  if (event.target.closest('button')) return;
  void appWindow.startDragging();
});

editDone.addEventListener('click', (event) => {
  event.stopPropagation();
  void invoke('overlay_end_edit');
});

window.addEventListener('resize', render);

void boot();
