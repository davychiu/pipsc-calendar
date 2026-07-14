/* PIPSC Better Calendar — zero-dependency frontend */
(async function () {
  const $ = (sel) => document.querySelector(sel);
  const statusEl = $('#status');

  let DATA;
  try {
    DATA = await (await fetch('events.json')).json();
  } catch {
    statusEl.textContent = 'Could not load events.json';
    return;
  }
  const EVENTS = DATA.events;
  const todayISO = new Date().toLocaleDateString('en-CA'); // viewer-local YYYY-MM-DD

  // Display dates: for timed events, the calendar day in the event's own
  // timezone (the stored startDate/endDate are UTC dates and can be off by
  // one around midnight UTC); for all-day events, the stored dates.
  const localDate = (iso, tz) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz || 'America/Toronto' });
  for (const e of EVENTS) {
    e.dispStart = e.startUTC ? localDate(e.startUTC, e.tz) : e.startDate;
    e.dispEnd = e.endUTC ? localDate(e.endUTC, e.tz) : (e.startUTC ? e.dispStart : e.endDate);
    if (e.dispEnd < e.dispStart) e.dispEnd = e.dispStart;
  }
  EVENTS.sort((a, b) => a.dispStart.localeCompare(b.dispStart) || (a.startUTC ?? '').localeCompare(b.startUTC ?? ''));

  $('#generated').textContent = DATA.generated
    ? `Last synced ${new Date(DATA.generated).toLocaleString()} · ${DATA.totalStored} events in archive.`
    : '';

  // ---- filters ----
  const counts = (key) => {
    const m = new Map();
    for (const e of EVENTS) for (const v of e[key]) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  for (const [sel, key] of [['#region', 'region'], ['#group', 'group']]) {
    const el = $(sel);
    for (const [name, n] of counts(key)) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = `${name} (${n})`;
      el.appendChild(o);
    }
  }

  const state = { q: '', region: '', group: '', past: false, view: 'list' };

  function filtered() {
    const q = state.q.toLowerCase();
    return EVENTS.filter((e) =>
      (state.past || e.dispEnd >= todayISO) &&
      (!state.region || e.region.includes(state.region)) &&
      (!state.group || e.group.includes(state.group)) &&
      (!q || (e.title + ' ' + e.location.join(' ') + ' ' + e.group.join(' ') + ' ' + e.region.join(' ')).toLowerCase().includes(q))
    );
  }

  // ---- formatting ----
  const fmtTime = (e) => {
    if (!e.startUTC) return 'All day';
    const opt = { timeZone: e.tz, hour: 'numeric', minute: '2-digit' };
    const s = new Date(e.startUTC).toLocaleTimeString('en-CA', opt);
    const label = e.tzLabel ? ` (${e.tzLabel})` : '';
    if (!e.endUTC) return s + label;
    return `${s} – ${new Date(e.endUTC).toLocaleTimeString('en-CA', opt)}${label}`;
  };
  const fmtRange = (e) => {
    if (e.dispStart === e.dispEnd) return '';
    const f = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${f(e.dispStart)} – ${f(e.dispEnd)}`;
  };

  // ---- list view ----
  function renderList() {
    const root = $('#list-view');
    root.innerHTML = '';
    const evs = filtered();
    statusEl.textContent = evs.length ? '' : 'No events match the current filters.';
    let curMonth = '';
    for (const e of evs) {
      const month = new Date(e.dispStart + 'T12:00:00Z').toLocaleDateString('en-CA', { year: 'numeric', month: 'long', timeZone: 'UTC' });
      if (month !== curMonth) {
        curMonth = month;
        const h = document.createElement('h2');
        h.className = 'month-h';
        h.textContent = month;
        root.appendChild(h);
      }
      const d = new Date(e.dispStart + 'T12:00:00Z');
      const card = document.createElement('article');
      card.className = 'event' + (e.dispEnd < todayISO ? ' past' : '');
      const loc = e.location.length ? ` · ${e.location.join(', ')}` : '';
      card.innerHTML = `
        <div class="datebadge">
          <span class="dow">${d.toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'UTC' })}</span>
          <span class="day">${d.getUTCDate()}</span>
          ${e.dispStart !== e.dispEnd ? `<span class="multi">${fmtRange(e)}</span>` : ''}
        </div>
        <div class="event-body">
          <h3 class="event-title"><a href="${e.link}" target="_blank" rel="noopener"></a></h3>
          <p class="event-meta"></p>
          <div class="chips"></div>
        </div>`;
      card.querySelector('.event-title a').textContent = e.title;
      card.querySelector('.event-meta').textContent = fmtTime(e) + loc;
      const chips = card.querySelector('.chips');
      for (const [cls, vals] of [['region', e.region], ['', e.group], ['', e.employer]]) {
        for (const v of vals) {
          const c = document.createElement('span');
          c.className = 'chip ' + cls;
          c.textContent = v;
          chips.appendChild(c);
        }
      }
      root.appendChild(card);
    }
  }

  // ---- month view ----
  let monthCursor = todayISO.slice(0, 7);
  function shiftMonth(n) {
    let [y, m] = monthCursor.split('-').map(Number);
    m += n;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    monthCursor = `${y}-${String(m).padStart(2, '0')}`;
    renderMonth();
  }
  function renderMonth() {
    const [y, m] = monthCursor.split('-').map(Number);
    $('#month-title').textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', timeZone: 'UTC' });
    const grid = $('#month-grid');
    grid.innerHTML = '';
    for (const dow of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      const h = document.createElement('div');
      h.className = 'dowh';
      h.textContent = dow;
      grid.appendChild(h);
    }
    const first = new Date(Date.UTC(y, m - 1, 1));
    const start = new Date(first);
    start.setUTCDate(1 - first.getUTCDay());
    const evs = filtered();
    const byDay = new Map();
    for (const e of evs) {
      // span multi-day events across their days
      let d = e.dispStart;
      let guard = 0;
      while (d <= e.dispEnd && guard++ < 60) {
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(e);
        const nd = new Date(d + 'T12:00:00Z');
        nd.setUTCDate(nd.getUTCDate() + 1);
        d = nd.toISOString().slice(0, 10);
      }
    }
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const cell = document.createElement('div');
      cell.className = 'cell' + (iso.slice(0, 7) !== monthCursor ? ' out' : '') + (iso === todayISO ? ' today' : '');
      const dn = document.createElement('div');
      dn.className = 'dnum';
      dn.textContent = d.getUTCDate();
      cell.appendChild(dn);
      const dayEvents = byDay.get(iso) ?? [];
      for (const e of dayEvents.slice(0, 3)) {
        const a = document.createElement('a');
        a.className = 'ev';
        a.href = e.link;
        a.target = '_blank';
        a.rel = 'noopener';
        a.title = `${e.title} — ${fmtTime(e)}`;
        a.textContent = e.title;
        cell.appendChild(a);
      }
      if (dayEvents.length > 3) {
        const more = document.createElement('span');
        more.className = 'more';
        more.textContent = `+${dayEvents.length - 3} more`;
        cell.appendChild(more);
      }
      grid.appendChild(cell);
    }
  }

  // ---- subscribe feeds ----
  try {
    const feeds = await (await fetch('feeds.json')).json();
    const base = new URL('.', location.href).href;
    const root = $('#feed-list');
    const mkRow = (label, path) => {
      const url = base + path;
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.innerHTML = `<strong></strong> <code></code> <button>Copy</button>`;
      row.querySelector('strong').textContent = label;
      row.querySelector('code').textContent = url;
      row.querySelector('button').onclick = (ev) => {
        navigator.clipboard.writeText(url);
        ev.target.textContent = 'Copied!';
        setTimeout(() => (ev.target.textContent = 'Copy'), 1500);
      };
      root.appendChild(row);
    };
    mkRow('All events', feeds.all);
    for (const r of feeds.regions.sort((a, b) => b.count - a.count)) mkRow(`${r.region} (${r.count})`, r.file);
  } catch { /* feeds optional */ }

  // ---- wiring ----
  const rerender = () => { state.view === 'list' ? renderList() : renderMonth(); };
  $('#search').addEventListener('input', (e) => { state.q = e.target.value; rerender(); });
  $('#region').addEventListener('change', (e) => { state.region = e.target.value; rerender(); });
  $('#group').addEventListener('change', (e) => { state.group = e.target.value; rerender(); });
  $('#past').addEventListener('change', (e) => { state.past = e.target.checked; rerender(); });
  $('#prev-month').addEventListener('click', () => shiftMonth(-1));
  $('#next-month').addEventListener('click', () => shiftMonth(1));
  for (const [btn, view] of [['#view-list', 'list'], ['#view-month', 'month']]) {
    $(btn).addEventListener('click', () => {
      state.view = view;
      $('#view-list').classList.toggle('active', view === 'list');
      $('#view-month').classList.toggle('active', view === 'month');
      $('#view-list').setAttribute('aria-selected', view === 'list');
      $('#view-month').setAttribute('aria-selected', view === 'month');
      $('#list-view').hidden = view !== 'list';
      $('#month-view').hidden = view !== 'month';
      rerender();
    });
  }

  renderList();
})();
