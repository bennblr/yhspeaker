'use strict';

const card = document.getElementById('card');
const rowsBox = document.getElementById('rows');

const ROW_HEIGHT = 24;
const VERTICAL_PADDING = 14;

let lastState = null;

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
  if (participants.length === 0) {
    card.hidden = true;
    rowsBox.textContent = '';
    return;
  }

  card.hidden = false;

  const rowsArea = Math.max(ROW_HEIGHT, window.innerHeight - VERTICAL_PADDING);
  const capacity = Math.max(1, Math.floor(rowsArea / ROW_HEIGHT));

  rowsBox.textContent = '';
  for (const person of participants.slice(0, capacity)) rowsBox.append(renderRow(person));
}

window.overlay.onState((state) => {
  lastState = state;
  render();
});

window.addEventListener('resize', render);

render();
