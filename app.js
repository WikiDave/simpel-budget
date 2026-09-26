// ===== CONSTANTEN =====
const STORAGE_KEY = 'budget_planner_v1';

const FREQ = {
  once: 'Eenmalig',
  weekly: 'Wekelijks',
  monthly: 'Maandelijks',
  yearly: 'Jaarlijks',
};
const FREQ_ORDER = ['monthly', 'weekly', 'daily', 'yearly', 'once'];

// Eenheden voor een eigen herhaling: "om de N dagen/weken/maanden/jaar"
const UNITS = {
  daily: ['dag', 'dagen'],
  weekly: ['week', 'weken'],
  monthly: ['maand', 'maanden'],
  yearly: ['jaar', 'jaar'],
};

// Aantal keer eenheid tussen twee herhalingen (oudere items hebben geen 'every')
const everyOf = item => Math.max(1, parseInt(item.every, 10) || 1);

function freqLabel(item) {
  const n = everyOf(item);
  if (item.freq === 'once') return FREQ.once;
  if (n === 1) return item.freq === 'daily' ? 'Dagelijks' : FREQ[item.freq];
  return `Om de ${n} ${UNITS[item.freq][1]}`;
}

// Is dit een herhaling die niet in de vaste knoppen past?
const isCustom = item => item.freq === 'daily' || everyOf(item) > 1;

// Tabbladen in een omgeving; 'list' is de sleutel van de lijst in env
const TABS = {
  costs: { list: 'costs', add: 'Voeg kost toe', title: 'Nieuwe kost', plural: 'kosten',
    emoji: '🧾', placeholder: 'bv. Huur, Netflix, Engie', done: 'betaald' },
  income: { list: 'income', add: 'Voeg inkomen toe', title: 'Nieuw inkomen', plural: 'inkomsten',
    emoji: '💶', placeholder: 'bv. Loon, Kinderbijslag' },
  savings: { list: 'savings', add: 'Voeg spaarpot toe', title: 'Nieuwe spaarpot', plural: 'spaarpotten',
    emoji: '🐷', placeholder: 'bv. Vakantie, Noodfonds, Nieuwe auto', done: 'opzij gezet' },
};

const DEFAULT_ENV_EMOJI = '💰';

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
  'augustus', 'september', 'oktober', 'november', 'december'];

const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });

// ===== STATE =====
// env: { id, name, emoji, costs: [item], income: [item], savings: [item],
//        paid: { 'itemId@YYYY-MM-DD': true } }  (betaald / opzij gezet)
// item: { id, name, emoji, amount, freq: once|daily|weekly|monthly|yearly, every: N (om de N),
//         date: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD'|'',
//         goal?: number (alleen spaarpotten) }
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
  // Oudere omgevingen hebben nog geen spaarpotten
  state.envs.forEach(env => {
    env.costs ||= [];
    env.income ||= [];
    env.savings ||= [];
    env.paid ||= {};
  });
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
  const n = everyOf(item);
  let dates = [];

  switch (item.freq) {
    case 'once':
      if (start.getFullYear() === y && start.getMonth() === m) dates = [start];
      break;
    case 'monthly': {
      const diff = (y - start.getFullYear()) * 12 + (m - start.getMonth());
      if (diff >= 0 && diff % n === 0) {
        dates = [new Date(y, m, Math.min(start.getDate(), dim))];
      }
      break;
    }
    case 'yearly': {
      const diff = y - start.getFullYear();
      if (start.getMonth() === m && diff >= 0 && diff % n === 0) {
        dates = [new Date(y, m, Math.min(start.getDate(), dim))];
      }
      break;
    }
    case 'daily':
    case 'weekly': {
      const step = item.freq === 'weekly' ? 7 * n : n;
      let d = new Date(start);
      if (d < monthStart) {
        const days = Math.round((monthStart - d) / 864e5);
        d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.ceil(days / step) * step);
      }
      while (d <= monthEnd) {
        dates.push(d);
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + step);
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
  let income = 0, count = 0, doneCount = 0;
  env.income.forEach(i => { income += occurrences(i, y, m).length * i.amount; });

  // Totaal en afgevinkt deel van kosten of spaarpotten
  const tally = items => {
    let total = 0, done = 0;
    items.forEach(it => {
      occurrences(it, y, m).forEach(d => {
        total += it.amount;
        count++;
        if (env.paid[`${it.id}@${dateKey(d)}`]) { done += it.amount; doneCount++; }
      });
    });
    return [total, done];
  };
  const [costs, paid] = tally(env.costs);
  const [savings, saved] = tally(env.savings);

  return {
    income, costs, paid, savings, saved,
    open: costs - paid,
    toSave: savings - saved,
    play: income - costs - savings,      // speelgeld
    available: income - paid - saved,    // wat nu echt nog op de rekening staat
    count, doneCount,
  };
}

// Alles wat ooit in deze spaarpot is opzij gezet (afgevinkt)
function totalSaved(env, item) {
  const prefix = item.id + '@';
  return Object.keys(env.paid).filter(k => k.startsWith(prefix)).length * item.amount;
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
    const hasData = env.costs.length || env.income.length || env.savings.length;
    const sub = hasData
      ? `Speelgeld in ${MONTHS[m]}: <b class="${s.play < 0 ? 'neg' : 'pos'}">${euro.format(s.play)}</b>`
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
  document.getElementById('fab-item-label').textContent = TABS[currentTab].add;

  renderSummary(env);
  renderItems(env);
}

function renderSummary(env) {
  const s = monthSummary(env, viewYear, viewMonth);
  const due = s.costs + s.savings;
  const pct = due > 0 ? Math.round(((s.paid + s.saved) / due) * 100) : 0;

  document.getElementById('summary').innerHTML = `
    <div class="summary-main">
      <span class="summary-label">Speelgeld deze maand</span>
      <span class="summary-big ${s.play < 0 ? 'neg' : 'pos'}">${euro.format(s.play)}</span>
      <span class="summary-hint">inkomsten − kosten − sparen · vrij te besteden</span>
    </div>
    <div class="summary-grid">
      <div><span>Binnengekomen</span><b class="pos">${euro.format(s.income)}</b></div>
      <div><span>Totale kosten</span><b>${euro.format(s.costs)}</b></div>
      <div><span>Sparen</span><b class="save">${euro.format(s.savings)}</b></div>
      <div><span>Al betaald</span><b>${euro.format(s.paid)}</b></div>
      <div><span>Nog te betalen</span><b class="${s.open > 0 ? 'warn' : ''}">${euro.format(s.open)}</b></div>
      <div><span>Nog opzij te zetten</span><b class="${s.toSave > 0 ? 'warn' : ''}">${euro.format(s.toSave)}</b></div>
    </div>
    <div class="progress">
      <div class="progress-bar" style="width:${pct}%"></div>
    </div>
    <div class="progress-text">
      <span>${s.doneCount}/${s.count} afgevinkt</span>
      <span>Nu beschikbaar: <b class="${s.available < 0 ? 'neg' : ''}">${euro.format(s.available)}</b></span>
    </div>`;
}

function renderItems(env) {
  const list = document.getElementById('item-list');
  const tab = TABS[currentTab];
  const items = env[tab.list];

  // Items met een voorkomen in deze maand, gegroepeerd per frequentie
  const active = items
    .map(item => ({ item, dates: occurrences(item, viewYear, viewMonth) }))
    .filter(x => x.dates.length);

  // Spaarpotten: totaal dat al opzij staat, over alle maanden heen
  const potTotal = currentTab === 'savings' && items.length
    ? `<div class="pot-total"><span>🐷 Totaal in je spaarpotten</span>
        <b>${euro.format(items.reduce((sum, it) => sum + totalSaved(env, it), 0))}</b></div>`
    : '';

  if (!active.length) {
    const other = items.length
      ? `Geen ${tab.plural} in ${MONTHS[viewMonth]}.`
      : currentTab === 'savings'
        ? 'Nog geen spaarpotten. Tik op + om geld opzij te zetten, bv. elke maand € 100 voor vakantie.'
        : `Nog geen ${tab.plural}. Tik op + om er een toe te voegen.`;
    list.innerHTML = `${potTotal}<div class="empty small"><p>${other}</p></div>`;
    return;
  }

  // Groeperen per herhaling (bv. "Maandelijks", "Om de 3 dagen")
  const groups = new Map();
  active
    .sort((a, b) => FREQ_ORDER.indexOf(a.item.freq) - FREQ_ORDER.indexOf(b.item.freq)
      || everyOf(a.item) - everyOf(b.item) || a.dates[0] - b.dates[0])
    .forEach(x => {
      const label = freqLabel(x.item);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(x);
    });

  list.innerHTML = potTotal + [...groups].map(([label, group]) => {
    const total = group.reduce((sum, x) => sum + x.dates.length * x.item.amount, 0);
    return `
      <h3 class="group-title"><span>${label}</span><span>${euro.format(total)}</span></h3>
      ${group.map(x => tab.done ? checkRow(env, x.item, x.dates, tab) : incomeRow(x.item, x.dates)).join('')}`;
  }).join('');
}

// Rij met vinkjes: voor kosten (betaald) en spaarpotten (opzij gezet)
function checkRow(env, item, dates, tab) {
  const keys = dates.map(d => `${item.id}@${dateKey(d)}`);
  const allPaid = keys.every(k => env.paid[k]);
  const total = item.amount * dates.length;

  let checks;
  if (dates.length === 1) {
    checks = `<button class="check ${allPaid ? 'on' : ''}" aria-label="${tab.done}"
      onclick="event.stopPropagation(); togglePaid('${keys[0]}')"></button>`;
  } else {
    // Wekelijks: één vakje per week
    checks = `<div class="week-checks">${dates.map((d, i) => `
      <button class="week-check ${env.paid[keys[i]] ? 'on' : ''}" aria-label="${tab.done} ${d.getDate()} ${MONTHS[d.getMonth()]}"
        onclick="event.stopPropagation(); togglePaid('${keys[i]}')">${d.getDate()}</button>`).join('')}
    </div>`;
  }

  const sub = dates.length === 1
    ? `${dates[0].getDate()} ${MONTHS[dates[0].getMonth()].slice(0, 3)}`
    : `${dates.length}× ${euro.format(item.amount)}`;

  // Spaarpot: hoeveel er al in zit, en eventueel voortgang naar het doel
  let pot = '';
  if (currentTab === 'savings') {
    const inPot = totalSaved(env, item);
    if (item.goal > 0) {
      const pct = Math.min(100, Math.round((inPot / item.goal) * 100));
      pot = `<span class="pot-info">${euro.format(inPot)} van ${euro.format(item.goal)} · ${pct}%</span>
        <span class="pot-bar"><span style="width:${pct}%"></span></span>`;
    } else {
      pot = `<span class="pot-info">Al gespaard: ${euro.format(inPot)}</span>`;
    }
  }

  return `
    <div class="item ${allPaid ? 'paid' : ''}" onclick="openItemForm('${item.id}')">
      <span class="item-emoji">${esc(item.emoji || tab.emoji)}</span>
      <span class="item-text">
        <span class="item-name">${esc(item.name)}</span>
        <span class="item-sub">${sub}${allPaid ? ` · <b>${tab.done}</b>` : ''}</span>
        ${pot}
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
function openSheet(title, html) {
  document.getElementById('sheet-content').innerHTML = `
    <div class="sheet-header">
      <button type="button" class="back-btn" onclick="closeSheet()" aria-label="Terug">‹ Terug</button>
      <h2 class="sheet-title">${title}</h2>
    </div>
    ${html}`;
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

// Emoji kiezen via het toetsenbord van je telefoon (elke emoji kan)
function emojiField(selected) {
  return `
    <div class="emoji-row">
      <input class="emoji-input" id="f-emoji" value="${esc(selected)}" aria-label="Emoji"
        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
        onfocus="this.select()" oninput="keepLastEmoji(this)" />
      <span class="hint">Tik op het vakje en kies een emoji op je toetsenbord (😀-toets)</span>
    </div>`;
}

// Een nieuw gekozen emoji vervangt de vorige: bewaar enkel het laatste teken
function keepLastEmoji(input) {
  const text = input.value.trim();
  const chars = typeof Intl !== 'undefined' && Intl.Segmenter
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(x => x.segment)
    : Array.from(text);
  const last = chars.length ? chars[chars.length - 1] : '';
  if (input.value !== last) input.value = last;
}

// ----- Omgeving aanmaken / bewerken -----
function openEnvForm(id) {
  const env = id ? state.envs.find(e => e.id === id) : null;
  openSheet(`${env ? 'Omgeving bewerken' : 'Nieuwe omgeving'}`, `
    <form onsubmit="saveEnv(event, ${env ? `'${env.id}'` : 'null'})">
      ${emojiField(env ? env.emoji : DEFAULT_ENV_EMOJI)}
      <label class="field">
        <span>Naam</span>
        <input id="f-name" required maxlength="60" placeholder="bv. Huishouden" value="${esc(env?.name)}" />
      </label>
      <button class="primary" type="submit">${env ? 'Opslaan' : 'Aanmaken'}</button>
      <button class="ghost" type="button" onclick="closeSheet()">Annuleren</button>
    </form>`);
  if (!env) setTimeout(() => document.getElementById('f-name').focus(), 50);
}

function saveEnv(e, id) {
  e.preventDefault();
  const name = document.getElementById('f-name').value.trim();
  const emoji = document.getElementById('f-emoji').value.trim() || DEFAULT_ENV_EMOJI;
  if (!name) return;

  if (id) {
    Object.assign(state.envs.find(x => x.id === id), { name, emoji });
    save();
    closeSheet();
    renderEnv();
  } else {
    const env = { id: uid(), name, emoji, costs: [], income: [], savings: [], paid: {} };
    state.envs.push(env);
    save();
    closeSheet();
    openEnv(env.id);
  }
}

function openEnvMenu() {
  const env = getEnv();
  openSheet(`${esc(env.emoji)} ${esc(env.name)}`, `
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
  if (!confirm(`"${env.name}" en alles erin verwijderen?`)) return;
  state.envs = state.envs.filter(e => e.id !== env.id);
  save();
  closeSheet();
  goHome();
}

// ----- Kost / inkomen / spaarpot aanmaken / bewerken -----
function openItemForm(id) {
  const env = getEnv();
  const tab = TABS[currentTab];
  const items = env[tab.list];
  const item = id ? items.find(x => x.id === id) : null;

  const isNow = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  const defaultDate = isNow ? dateKey(today) : dateKey(new Date(viewYear, viewMonth, 1));
  const freq = !item ? 'monthly' : isCustom(item) ? 'custom' : item.freq;
  const customUnit = item && isCustom(item) ? item.freq : 'daily';
  const customEvery = item && isCustom(item) ? everyOf(item) : 3;

  openSheet(`${item ? 'Bewerken' : tab.title}`, `
    <form onsubmit="saveItem(event, ${item ? `'${item.id}'` : 'null'})">
      ${emojiField(item ? item.emoji : tab.emoji)}
      <label class="field">
        <span>Omschrijving</span>
        <input id="f-name" required maxlength="80" placeholder="${tab.placeholder}" value="${esc(item?.name)}" />
      </label>
      <label class="field">
        <span>${currentTab === 'savings' ? 'Hoeveel opzij zetten? (€)' : 'Bedrag (€)'}</span>
        <input id="f-amount" required inputmode="decimal" placeholder="0,00"
          value="${item ? String(item.amount).replace('.', ',') : ''}" />
      </label>
      <div class="field">
        <span>Hoe vaak?</span>
        <div class="freq-picker">
          ${['once', 'weekly', 'monthly', 'yearly', 'custom'].map(f => `
            <label><input type="radio" name="f-freq" value="${f}" ${f === freq ? 'checked' : ''}
              onchange="updateFreqFields()" /><span>${FREQ[f] || 'Aangepast…'}</span></label>`).join('')}
        </div>
        <div class="custom-freq" id="f-custom">
          <span>Om de</span>
          <input id="f-every" type="number" inputmode="numeric" min="1" max="999" value="${customEvery}" aria-label="Aantal" />
          <select id="f-unit" aria-label="Eenheid">
            ${Object.entries(UNITS).map(([u, [, plural]]) =>
              `<option value="${u}" ${u === customUnit ? 'selected' : ''}>${plural}</option>`).join('')}
          </select>
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
      ${currentTab === 'savings' ? `
      <label class="field">
        <span>Spaardoel (€) <small>(optioneel)</small></span>
        <input id="f-goal" inputmode="decimal" placeholder="bv. 1500"
          value="${item?.goal ? String(item.goal).replace('.', ',') : ''}" />
      </label>` : ''}
      <button class="primary" type="submit">${item ? 'Opslaan' : 'Toevoegen'}</button>
      <button class="ghost" type="button" onclick="closeSheet()">Annuleren</button>
      ${item ? `<button class="ghost danger" type="button" onclick="deleteItem('${item.id}')">Verwijderen</button>` : ''}
    </form>`);
  updateFreqFields();
  if (!item) setTimeout(() => document.getElementById('f-name').focus(), 50);
}

function updateFreqFields() {
  const freq = document.querySelector('input[name="f-freq"]:checked').value;
  document.getElementById('f-date-label').textContent = freq === 'once' ? 'Datum' : 'Startdatum';
  document.getElementById('f-end-wrap').classList.toggle('hidden', freq === 'once');
  document.getElementById('f-custom').classList.toggle('hidden', freq !== 'custom');
}

function saveItem(e, id) {
  e.preventDefault();
  const env = getEnv();
  const items = env[TABS[currentTab].list];

  const amount = parseAmount(document.getElementById('f-amount').value);
  if (!(amount >= 0)) {
    alert('Vul een geldig bedrag in.');
    return;
  }
  let freq = document.querySelector('input[name="f-freq"]:checked').value;
  let every = 1;
  if (freq === 'custom') {
    freq = document.getElementById('f-unit').value;
    every = parseInt(document.getElementById('f-every').value, 10);
    if (!(every >= 1)) {
      alert('Vul in om de hoeveel ' + UNITS[freq][1] + ' het terugkomt.');
      return;
    }
  }
  const data = {
    name: document.getElementById('f-name').value.trim(),
    emoji: document.getElementById('f-emoji').value.trim() || TABS[currentTab].emoji,
    amount,
    freq,
    every,
    date: document.getElementById('f-date').value,
    endDate: freq === 'once' ? '' : document.getElementById('f-end').value,
  };
  if (currentTab === 'savings') {
    const goal = parseAmount(document.getElementById('f-goal').value);
    data.goal = goal > 0 ? goal : null;
  }

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
  env.savings = env.savings.filter(x => x.id !== id);
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
