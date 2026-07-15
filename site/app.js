/* PIPSC Better Calendar — zero-dependency frontend */
(async function () {
  const $ = (sel) => document.querySelector(sel);
  const statusEl = $('#status');

  const STR = {
    en: {
      title: 'PIPSC Events Calendar',
      tagline: 'Unofficial mirror of',
      tagline2: ' — sorted by event date, filterable, subscribable.',
      sourceHref: 'https://pipsc.ca/events',
      sourceText: 'pipsc.ca/events',
      search: 'Search events…',
      allRegions: 'All regions',
      allGroups: 'All groups',
      past: 'Show past 90 days',
      list: 'List',
      month: 'Month',
      subSummary: '📆 Subscribe in your own calendar',
      subText: 'Add these feeds to Google Calendar (“Other calendars → From URL”), Outlook, or Apple Calendar. They update automatically.',
      allEvents: 'All events',
      copy: 'Copy',
      copied: 'Copied!',
      allDay: 'All day',
      noMatch: 'No events match the current filters.',
      more: (n) => `+${n} more`,
      footer: "Data from pipsc.ca; times shown in each event's local timezone.",
      synced: (d, n) => `Last synced ${d} · ${n} events in archive.`,
      dows: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      prevMonth: 'Previous month',
      nextMonth: 'Next month',
      locale: 'en-CA',
    },
    fr: {
      title: "Calendrier des activités de l'IPFPC",
      tagline: 'Miroir non officiel de',
      tagline2: ' — trié par date d’activité, avec filtres et abonnements.',
      sourceHref: 'https://pipsc.ca/fr/events',
      sourceText: 'ipfpc.ca/events',
      search: 'Rechercher des activités…',
      allRegions: 'Toutes les régions',
      allGroups: 'Tous les groupes',
      past: 'Afficher les 90 derniers jours',
      list: 'Liste',
      month: 'Mois',
      subSummary: '📆 S’abonner dans votre calendrier',
      subText: 'Ajoutez ces flux à Google Agenda (« Autres agendas → À partir de l’URL »), Outlook ou Apple Calendrier. Ils se mettent à jour automatiquement.',
      allEvents: 'Toutes les activités',
      copy: 'Copier',
      copied: 'Copié !',
      allDay: 'Toute la journée',
      noMatch: 'Aucune activité ne correspond aux filtres.',
      more: (n) => `+${n} autres`,
      footer: 'Données de pipsc.ca; heures affichées dans le fuseau horaire local de chaque activité.',
      synced: (d, n) => `Dernière synchronisation : ${d} · ${n} activités archivées.`,
      dows: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'],
      prevMonth: 'Mois précédent',
      nextMonth: 'Mois suivant',
      locale: 'fr-CA',
    },
  };
  let lang = localStorage.getItem('lang') === 'fr' ? 'fr' : 'en';
  const T = () => STR[lang];

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
  // one around midnight UTC); for all-day and wall-clock events, the stored
  // dates. Always 'en-CA' — it yields the ISO YYYY-MM-DD used as a key.
  const localDate = (iso, tz) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz || 'America/Toronto' });
  for (const e of EVENTS) {
    e.dispStart = e.startUTC ? localDate(e.startUTC, e.tz) : e.startDate;
    e.dispEnd = e.endUTC ? localDate(e.endUTC, e.tz) : (e.startUTC ? e.dispStart : e.endDate);
    if (e.dispEnd < e.dispStart) e.dispEnd = e.dispStart;
  }
  EVENTS.sort((a, b) => a.dispStart.localeCompare(b.dispStart) || (a.startUTC ?? a.startLocal ?? '').localeCompare(b.startUTC ?? b.startLocal ?? ''));

  const eventLink = (e) => (lang === 'fr' && e.frLink) ? e.frLink : e.link;

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
  const fmtClock = (hhmm) => {
    let [h, m] = hhmm.split(':').map(Number);
    if (lang === 'fr') return `${h} h ${String(m).padStart(2, '0')}`;
    const mer = h < 12 ? 'a.m.' : 'p.m.';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${mer}`;
  };
  const fmtTime = (e) => {
    if (e.startLocal) {
      // prose-sourced wall-clock time, shown as written
      const s = fmtClock(e.startLocal.slice(11));
      const label = e.tzLabel ? ` (${e.tzLabel})` : '';
      return e.endLocal ? `${s} – ${fmtClock(e.endLocal.slice(11))}${label}` : s + label;
    }
    if (!e.startUTC) return T().allDay;
    const opt = { timeZone: e.tz, hour: 'numeric', minute: '2-digit' };
    const s = new Date(e.startUTC).toLocaleTimeString(T().locale, opt);
    const label = e.tzLabel ? ` (${e.tzLabel})` : '';
    if (!e.endUTC) return s + label;
    return `${s} – ${new Date(e.endUTC).toLocaleTimeString(T().locale, opt)}${label}`;
  };
  const fmtRange = (e) => {
    if (e.dispStart === e.dispEnd) return '';
    const f = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString(T().locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${f(e.dispStart)} – ${f(e.dispEnd)}`;
  };

  // ---- list view ----
  function renderList() {
    const root = $('#list-view');
    root.innerHTML = '';
    const evs = filtered();
    statusEl.textContent = evs.length ? '' : T().noMatch;
    let curMonth = '';
    for (const e of evs) {
      const month = new Date(e.dispStart + 'T12:00:00Z').toLocaleDateString(T().locale, { year: 'numeric', month: 'long', timeZone: 'UTC' });
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
          <span class="dow">${d.toLocaleDateString(T().locale, { weekday: 'short', timeZone: 'UTC' })}</span>
          <span class="day">${d.getUTCDate()}</span>
          ${e.dispStart !== e.dispEnd ? `<span class="multi">${fmtRange(e)}</span>` : ''}
        </div>
        <div class="event-body">
          <h3 class="event-title"><a href="" target="_blank" rel="noopener"></a></h3>
          <p class="event-meta"></p>
          <div class="chips"></div>
        </div>`;
      const a = card.querySelector('.event-title a');
      a.href = eventLink(e);
      a.textContent = e.title;
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
    $('#month-title').textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(T().locale, { year: 'numeric', month: 'long', timeZone: 'UTC' });
    const grid = $('#month-grid');
    grid.innerHTML = '';
    for (const dow of T().dows) {
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
        a.href = eventLink(e);
        a.target = '_blank';
        a.rel = 'noopener';
        a.title = `${e.title} — ${fmtTime(e)}`;
        a.textContent = e.title;
        cell.appendChild(a);
      }
      if (dayEvents.length > 3) {
        const more = document.createElement('span');
        more.className = 'more';
        more.textContent = T().more(dayEvents.length - 3);
        cell.appendChild(more);
      }
      grid.appendChild(cell);
    }
  }

  // ---- subscribe feeds ----
  let feedsData = null;
  try {
    feedsData = await (await fetch('feeds.json')).json();
  } catch { /* feeds optional */ }

  function renderFeeds() {
    if (!feedsData) return;
    const base = new URL('.', location.href).href;
    const root = $('#feed-list');
    root.innerHTML = '';
    const mkRow = (label, path) => {
      const url = base + path;
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.innerHTML = `<strong></strong> <code></code> <button></button>`;
      row.querySelector('strong').textContent = label;
      row.querySelector('code').textContent = url;
      const btn = row.querySelector('button');
      btn.textContent = T().copy;
      btn.onclick = () => {
        navigator.clipboard.writeText(url);
        btn.textContent = T().copied;
        setTimeout(() => (btn.textContent = T().copy), 1500);
      };
      root.appendChild(row);
    };
    mkRow(T().allEvents, feedsData.all);
    for (const r of [...feedsData.regions].sort((a, b) => b.count - a.count)) mkRow(`${r.region} (${r.count})`, r.file);
  }

  // ---- language ----
  function applyLang() {
    const t = T();
    document.documentElement.lang = lang;
    document.title = t.title;
    $('#t-title').textContent = t.title;
    $('#t-tagline').textContent = t.tagline;
    $('#t-tagline2').textContent = t.tagline2;
    const src = $('#t-source');
    src.href = t.sourceHref;
    src.textContent = t.sourceText;
    $('#search').placeholder = t.search;
    $('#t-all-regions').textContent = t.allRegions;
    $('#t-all-groups').textContent = t.allGroups;
    $('#t-past').textContent = t.past;
    $('#view-list').textContent = t.list;
    $('#view-month').textContent = t.month;
    $('#t-sub-summary').textContent = t.subSummary;
    $('#t-sub-text').textContent = t.subText;
    $('#t-footer').textContent = t.footer;
    $('#prev-month').setAttribute('aria-label', t.prevMonth);
    $('#next-month').setAttribute('aria-label', t.nextMonth);
    $('#lang-en').classList.toggle('active', lang === 'en');
    $('#lang-fr').classList.toggle('active', lang === 'fr');
    $('#generated').textContent = DATA.generated
      ? t.synced(new Date(DATA.generated).toLocaleString(t.locale), DATA.totalStored)
      : '';
    renderFeeds();
    rerender();
  }
  for (const [btn, l] of [['#lang-en', 'en'], ['#lang-fr', 'fr']]) {
    $(btn).addEventListener('click', () => {
      lang = l;
      localStorage.setItem('lang', l);
      applyLang();
    });
  }

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

  applyLang();
})();
