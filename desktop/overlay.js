'use strict';

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
  const state = lastState;
  const participants = Array.isArray(state?.participants) ? state.participants : [];
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

window.overlay.onState((state) => {
  lastState = state;
  render();
});

window.overlay.onEdit((value) => {
  editing = Boolean(value);
  document.body.classList.toggle('editing', editing);
  render();
});

window.overlay.onStyle((style) => {
  const fontSize = Number(style?.fontSize);
  if (Number.isFinite(fontSize) && fontSize > 0) {
    rowStep = fontSize + 13;
    document.documentElement.style.setProperty('--overlay-font', `${fontSize}px`);
  }
  if (typeof style?.color === 'string' && /^#[0-9a-f]{6}$/i.test(style.color)) {
    document.documentElement.style.setProperty('--overlay-color', style.color);
  }
  render();
});

editDone.addEventListener('click', () => {
  window.overlay.endEdit();
});

window.addEventListener('resize', render);

render();
