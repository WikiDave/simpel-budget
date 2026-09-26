// ===== CONSTANTEN =====
const STORAGE_KEY = 'budget_planner_v1';

const FREQ = {
  once: 'Eenmalig',
  weekly: 'Wekelijks',
  monthly: 'Maandelijks',
  yearly: 'Jaarlijks',
};
const FREQ_ORDER = ['monthly', 'weekly', 'yearly', 'once'];

const ENV_EMOJIS = ['🏠', '💰', '👹', '🐸', '🌲', '🌆', '🌚', '🧬', '✈️', '🚗', '🎓', '🍕',
  '🛒', '💼', '🎉', '🐶', '👶', '💍', '🏖️', '🎮', '🏦', '📦', '❤️', '⭐'];
const ITEM_EMOJIS = ['🏠', '⚡', '💧', '🔥', '📱', '🌐', '🛒', '🚗', '⛽', '🚆', '🍕', '☕',
  '🎬', '🎵', '🎮', '🏋️', '💊', '🐶', '👕', '🎁', '📚', '💳', '🧾', '✈️', '💼', '💶'];

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
  'augustus', 'september', 'oktober', 'november', 'december'];

const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });

// ===== STATE =====
// env: { id, name, emoji, costs: [item], income: [item], paid: { 'itemId@YYYY-MM-DD': true } }
// item: { id, name, emoji, amount, freq, date: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD'|'' }
let state = { envs: [] };
let currentEnvId = null;
let currentTab = 'costs';
const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth();

// ===== OPSLAG =====
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = JSON.parse(raw);
  } catch (_) { /* start leeg */ }
  if (!state || !Array.isArray(state.envs)) state = { envs: [] };
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
}

// ===== HULPFUNCTIES =====
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function parseAmount(s) {
  const n = parseFloat(String(s).replace(/\s|€/g, '').replace(',', '.'));
  return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

const getEnv = () => state.envs.find(e => e.id === currentEnvId);

// Alle datums waarop een item in een bepaalde maand valt
function occurrences(item, y, m) {
  const start = parseDate(item.date);
  const monthStart = new Date(y, m, 1);
  const monthEnd = new Date(y, m + 1, 0);
  const dim = monthEnd.getDate();
  let dates = [];

  switch (item.freq) {
    case 'once':
      if (start.getFullYear() === y && start.getMonth() === m) dates = [start];
      break;
    case 'monthly':
      if (monthStart >= new Date(start.getFullYear(), start.getMonth(), 1)) {
        dates = [new Date(y, m, Math.min(start.getDate(), dim))];
      }
      break;
    case 'yearly':
      if (start.getMonth() === m && y >= start.getFullYear()) {
        dates = [new Date(y, m, Math.min(start.getDate(), dim))];
      }
      break;
    case 'weekly': {
      let d = new Date(start);
      if (d < monthStart) {
        const days = Math.round((monthStart - d) / 864e5);
        d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.ceil(days / 7) * 7);
      }
      while (d <= monthEnd) {
        dates.push(d);
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
      }
      break;
    }
  }

  if (item.endDate) {
    const end = parseDate(item.endDate);
    dates = dates.filter(d => d <= end);
  }
  return dates;
}

function monthSummary(env, y, m) {
  let income = 0, costs = 0, paid = 0, count = 0, paidCount = 0;
  env.income.forEach(i => { income += occurrences(i, y, m).length * i.amount; });
  env.costs.forEach(c => {
    occurrences(c, y, m).forEach(d => {
      costs += c.amount;
      count++;
      if (env.paid[`${c.id}@${dateKey(d)}`]) { paid += c.amount; paidCount++; }
    });
  });
  return { income, costs, paid, open: costs - paid, left: income - costs, available: income - paid, count, paidCount };
}

// ===== NAVIGATIE =====
function showView(name) {
  document.getElementById('view-home').classList.toggle('hidden', name !== 'home');
  document.getElementById('view-env').classList.toggle('hidden', name !== 'env');
  window.scrollTo(0, 0);
}

function goHome() {
  currentEnvId = null;
  if (location.hash) history.replaceState(null, '', location.pathname);
  renderHome();
  showView('home');
}

function openEnv(id) {
  currentEnvId = id;
  currentTab = 'costs';
  viewYear = today.getFullYear();
  viewMonth = today.getMonth();
  history.replaceState(null, '', '#' + id);
  renderEnv();
  showView('env');
}

function shiftMonth(delta) {
  const d = new Date(viewYear, viewMonth + delta, 1);
  viewYear = d.getFullYear();
  viewMonth = d.getMonth();
  renderEnv();
}

function goToday() {
  viewYear = today.getFullYear();
  viewMonth = today.getMonth();
  renderEnv();
}

function setTab(tab) {
  currentTab = tab;
  renderEnv();
}

// ===== RENDER: HOME =====
function renderHome() {
  const list = document.getElementById('env-list');
  const y = today.getFullYear(), m = today.getMonth();
  document.getElementById('home-empty').classList.toggle('hidden', state.envs.length > 0);

  list.innerHTML = state.envs.map(env => {
    const s = monthSummary(env, y, m);
    const hasData = env.costs.length || env.income.length;
    const sub = hasData
      ? `Over in ${MONTHS[m]}: <b class="${s.left < 0 ? 'neg' : 'pos'}">${euro.format(s.left)}</b>`
      : 'Nog leeg';
    return `
      <button class="env-card" onclick="openEnv('${env.id}')">
        <span class="env-card-emoji">${esc(env.emoji)}</span>
        <span class="env-card-text">
          <span class="env-card-name">${esc(env.name)}</span>
          <span class="env-card-sub">${sub}</span>
        </span>
        <span class="chev">›</span>
      </button>`;
  }).join('');
}

// ===== RENDER: OMGEVING =====
function renderEnv() {
  const env = getEnv();
  if (!env) return goHome();

  document.getElementById('env-emoji').textContent = env.emoji;
  document.getElementById('env-name').textContent = env.name;
  document.title = `${env.name} · Budget Planner`;

  const isNow = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  const label = document.getElementById('month-label');
  label.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
  label.classList.toggle('is-now', isNow);

  document.querySelectorAll('.seg').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
  document.getElementById('fab-item-label').textContent =
    currentTab === 'costs' ? 'Voeg kost toe' : 'Voeg inkomen toe';

  renderSummary(env);
  renderItems(env);
}

function renderSummary(env) {
  const s = monthSummary(env, viewYear, viewMonth);
  const pct = s.costs > 0 ? Math.round((s.paid / s.costs) * 100) : 0;

  document.getElementById('summary').innerHTML = `
    <div class="summary-main">
      <span class="summary-label">Over deze maand</span>
      <span class="summary-big ${s.left < 0 ? 'neg' : 'pos'}">${euro.format(s.left)}</span>
      <span class="summary-hint">inkomsten − alle kosten</span>
    </div>
    <div class="summary-grid">
      <div><span>Binnengekomen</span><b class="pos">${euro.format(s.income)}</b></div>
      <div><span>Totale kosten</span><b>${euro.format(s.costs)}</b></div>
      <div><span>Al betaald</span><b>${euro.format(s.paid)}</b></div>
      <div><span>Nog te betalen</span><b class="${s.open > 0 ? 'warn' : ''}">${euro.format(s.open)}</b></div>
    </div>
    <div class="progress">
      <div class="progress-bar" style="width:${pct}%"></div>
    </div>
    <div class="progress-text">
      <span>${s.paidCount}/${s.count} betaald</span>
      <span>Nu beschikbaar: <b class="${s.available < 0 ? 'neg' : ''}">${euro.format(s.available)}</b></span>
    </div>`;
}

function renderItems(env) {
  const list = document.getElementById('item-list');
  const items = currentTab === 'costs' ? env.costs : env.income;
  const isCost = currentTab === 'costs';

  // Items met een voorkomen in deze maand, gegroepeerd per frequentie
  const active = items
    .map(item => ({ item, dates: occurrences(item, viewYear, viewMonth) }))
    .filter(x => x.dates.length);

  if (!active.length) {
    const other = items.length
      ? `Geen ${isCost ? 'kosten' : 'inkomsten'} in ${MONTHS[viewMonth]}.`
      : `Nog geen ${isCost ? 'kosten' : 'inkomsten'}. Tik op + om er een toe te voegen.`;
    list.innerHTML = `<div class="empty small"><p>${other}</p></div>`;
    return;
  }

  list.innerHTML = FREQ_ORDER.map(freq => {
    const group = active
      .filter(x => x.item.freq === freq)
      .sort((a, b) => a.dates[0] - b.dates[0]);
    if (!group.length) return '';
    const total = group.reduce((sum, x) => sum + x.dates.length * x.item.amount, 0);
    return `
      <h3 class="group-title"><span>${FREQ[freq]}</span><span>${euro.format(total)}</span></h3>
      ${group.map(x => isCost ? costRow(env, x.item, x.dates) : incomeRow(x.item, x.dates)).join('')}`;
  }).join('');
}

function costRow(env, item, dates) {
  const keys = dates.map(d => `${item.id}@${dateKey(d)}`);
  const allPaid = keys.every(k => env.paid[k]);
  const total = item.amount * dates.length;

  let checks;
  if (dates.length === 1) {
    checks = `<button class="check ${allPaid ? 'on' : ''}" aria-label="Betaald"
      onclick="event.stopPropagation(); togglePaid('${keys[0]}')"></button>`;
  } else {
    // Wekelijks: één vakje per week
    checks = `<div class="week-checks">${dates.map((d, i) => `
      <button class="week-check ${env.paid[keys[i]] ? 'on' : ''}" aria-label="Betaald ${d.getDate()} ${MONTHS[d.getMonth()]}"
        onclick="event.stopPropagation(); togglePaid('${keys[i]}')">${d.getDate()}</button>`).join('')}
    </div>`;
  }

  const sub = dates.length === 1
    ? `${dates[0].getDate()} ${MONTHS[dates[0].getMonth()].slice(0, 3)}`
    : `${dates.length}× ${euro.format(item.amount)}`;

  return `
    <div class="item ${allPaid ? 'paid' : ''}" onclick="openItemForm('${item.id}')">
      <span class="item-emoji">${esc(item.emoji || '🧾')}</span>
      <span class="item-text">
        <span class="item-name">${esc(item.name)}</span>
        <span class="item-sub">${sub}${allPaid ? ' · <b>betaald</b>' : ''}</span>
        ${dates.length > 1 ? checks : ''}
      </span>
      <span class="item-amount">${euro.format(total)}</span>
      ${dates.length === 1 ? checks : ''}
    </div>`;
}

function incomeRow(item, dates) {
  const sub = dates.length === 1
    ? `${dates[0].getDate()} ${MONTHS[dates[0].getMonth()].slice(0, 3)}`
    : `${dates.length}× ${euro.format(item.amount)}`;
  return `
    <div class="item" onclick="openItemForm('${item.id}')">
      <span class="item-emoji">${esc(item.emoji || '💶')}</span>
      <span class="item-text">
        <span class="item-name">${esc(item.name)}</span>
        <span class="item-sub">${sub}</span>
      </span>
      <span class="item-amount pos">+ ${euro.format(item.amount * dates.length)}</span>
    </div>`;
}

// ===== ACTIES =====
function togglePaid(key) {
  const env = getEnv();
  if (env.paid[key]) delete env.paid[key];
  else env.paid[key] = true;
  save();
  renderEnv();
}

// ===== BOTTOM SHEET =====
function openSheet(html) {
  document.getElementById('sheet-content').innerHTML = html;
  document.getElementById('sheet').classList.remove('hidden');
  document.getElementById('sheet-backdrop').classList.remove('hidden');
  document.body.classList.add('no-scroll');
}

function closeSheet() {
  document.getElementById('sheet').classList.add('hidden');
  document.getElementById('sheet-backdrop').classList.add('hidden');
  document.body.classList.remove('no-scroll');
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

function emojiPicker(emojis, selected) {
  return `
    <div class="emoji-row">
      <input class="emoji-input" id="f-emoji" maxlength="8" value="${esc(selected)}" aria-label="Emoji" />
      <span class="hint">Kies of typ je eigen emoji</span>
    </div>
    <div class="emoji-grid">
      ${emojis.map(e => `<button type="button" class="emoji-opt ${e === selected ? 'sel' : ''}"
        onclick="pickEmoji(this)">${e}</button>`).join('')}
    </div>`;
}

function pickEmoji(btn) {
  document.getElementById('f-emoji').value = btn.textContent;
  document.querySelectorAll('.emoji-opt').forEach(b => b.classList.toggle('sel', b === btn));
}

// ----- Omgeving aanmaken / bewerken -----
function openEnvForm(id) {
  const env = id ? state.envs.find(e => e.id === id) : null;
  openSheet(`
    <h2 class="sheet-title">${env ? 'Omgeving bewerken' : 'Nieuwe omgeving'}</h2>
    <form onsubmit="saveEnv(event, ${env ? `'${env.id}'` : 'null'})">
      ${emojiPicker(ENV_EMOJIS, env ? env.emoji : ENV_EMOJIS[0])}
      <label class="field">
        <span>Naam</span>
        <input id="f-name" required maxlength="60" placeholder="bv. Huishouden" value="${esc(env?.name)}" />
      </label>
      <button class="primary" type="submit">${env ? 'Opslaan' : 'Aanmaken'}</button>
    </form>`);
  if (!env) setTimeout(() => document.getElementById('f-name').focus(), 50);
}

function saveEnv(e, id) {
  e.preventDefault();
  const name = document.getElementById('f-name').value.trim();
  const emoji = document.getElementById('f-emoji').value.trim() || '💰';
  if (!name) return;

  if (id) {
    Object.assign(state.envs.find(x => x.id === id), { name, emoji });
    save();
    closeSheet();
    renderEnv();
  } else {
    const env = { id: uid(), name, emoji, costs: [], income: [], paid: {} };
    state.envs.push(env);
    save();
    closeSheet();
    openEnv(env.id);
  }
}

function openEnvMenu() {
  const env = getEnv();
  openSheet(`
    <h2 class="sheet-title">${esc(env.emoji)} ${esc(env.name)}</h2>
    <div class="menu">
      <button onclick="openEnvForm('${env.id}')">✏️ Naam & emoji wijzigen</button>
      <button onclick="duplicateEnv()">📄 Dupliceren</button>
      <button class="danger" onclick="deleteEnv()">🗑 Omgeving verwijderen</button>
    </div>`);
}

function duplicateEnv() {
  const env = getEnv();
  const copy = JSON.parse(JSON.stringify(env));
  copy.id = uid();
  copy.name = env.name + ' (kopie)';
  copy.paid = {};
  state.envs.push(copy);
  save();
  closeSheet();
  openEnv(copy.id);
}

function deleteEnv() {
  const env = getEnv();
  if (!confirm(`"${env.name}" en alle kosten erin verwijderen?`)) return;
  state.envs = state.envs.filter(e => e.id !== env.id);
  save();
  closeSheet();
  goHome();
}

// ----- Kost / inkomen aanmaken / bewerken -----
function openItemForm(id) {
  const env = getEnv();
  const isCost = currentTab === 'costs';
  const items = isCost ? env.costs : env.income;
  const item = id ? items.find(x => x.id === id) : null;

  const isNow = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  const defaultDate = isNow ? dateKey(today) : dateKey(new Date(viewYear, viewMonth, 1));
  const freq = item ? item.freq : 'monthly';

  openSheet(`
    <h2 class="sheet-title">${item ? 'Bewerken' : (isCost ? 'Nieuwe kost' : 'Nieuw inkomen')}</h2>
    <form onsubmit="saveItem(event, ${item ? `'${item.id}'` : 'null'})">
      ${emojiPicker(ITEM_EMOJIS, item ? item.emoji : (isCost ? '🧾' : '💶'))}
      <label class="field">
        <span>Omschrijving</span>
        <input id="f-name" required maxlength="80" placeholder="${isCost ? 'bv. Huur, Netflix, Engie' : 'bv. Loon, Kinderbijslag'}" value="${esc(item?.name)}" />
      </label>
      <label class="field">
        <span>Bedrag (€)</span>
        <input id="f-amount" required inputmode="decimal" placeholder="0,00"
          value="${item ? String(item.amount).replace('.', ',') : ''}" />
      </label>
      <div class="field">
        <span>Hoe vaak?</span>
        <div class="freq-picker">
          ${['once', 'weekly', 'monthly', 'yearly'].map(f => `
            <label><input type="radio" name="f-freq" value="${f}" ${f === freq ? 'checked' : ''}
              onchange="updateFreqFields()" /><span>${FREQ[f]}</span></label>`).join('')}
        </div>
      </div>
      <label class="field">
        <span id="f-date-label">Datum</span>
        <input id="f-date" type="date" required value="${item ? item.date : defaultDate}" />
      </label>
      <label class="field" id="f-end-wrap">
        <span>Einddatum <small>(optioneel)</small></span>
        <input id="f-end" type="date" value="${item?.endDate || ''}" />
      </label>
      <button class="primary" type="submit">${item ? 'Opslaan' : 'Toevoegen'}</button>
      ${item ? `<button class="ghost danger" type="button" onclick="deleteItem('${item.id}')">Verwijderen</button>` : ''}
    </form>`);
  updateFreqFields();
  if (!item) setTimeout(() => document.getElementById('f-name').focus(), 50);
}

function updateFreqFields() {
  const freq = document.querySelector('input[name="f-freq"]:checked').value;
  document.getElementById('f-date-label').textContent = freq === 'once' ? 'Datum' : 'Startdatum';
  document.getElementById('f-end-wrap').classList.toggle('hidden', freq === 'once');
}

function saveItem(e, id) {
  e.preventDefault();
  const env = getEnv();
  const items = currentTab === 'costs' ? env.costs : env.income;

  const amount = parseAmount(document.getElementById('f-amount').value);
  if (!(amount >= 0)) {
    alert('Vul een geldig bedrag in.');
    return;
  }
  const freq = document.querySelector('input[name="f-freq"]:checked').value;
  const data = {
    name: document.getElementById('f-name').value.trim(),
    emoji: document.getElementById('f-emoji').value.trim(),
    amount,
    freq,
    date: document.getElementById('f-date').value,
    endDate: freq === 'once' ? '' : document.getElementById('f-end').value,
  };

  if (id) Object.assign(items.find(x => x.id === id), data);
  else items.push({ id: uid(), ...data });

  save();
  closeSheet();
  renderEnv();
}

function deleteItem(id) {
  const env = getEnv();
  if (!confirm('Dit item verwijderen?')) return;
  env.costs = env.costs.filter(x => x.id !== id);
  env.income = env.income.filter(x => x.id !== id);
  Object.keys(env.paid).forEach(k => { if (k.startsWith(id + '@')) delete env.paid[k]; });
  save();
  closeSheet();
  renderEnv();
}

// ===== INIT =====
load();
const startId = location.hash.slice(1);
if (startId && state.envs.some(e => e.id === startId)) openEnv(startId);
else goHome();
