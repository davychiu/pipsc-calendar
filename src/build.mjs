#!/usr/bin/env node
// Build the static site from data/: site/events.json + site/feeds/*.ics
//
//   node src/build.mjs
//
// Time semantics: pipsc.ca displays raw UTC clock times but labels them with
// the event's local timezone (verified against known meeting times and the
// start-hour distribution of ~100 events). We therefore interpret scraped
// date+time as UTC, emit UTC in ICS, and let the frontend render the event's
// labeled timezone. The scraped display string is kept in data/ as `raw`.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { TZ_MAP } from './parse-event.mjs';

const DATA_DIR = new URL('../data/', import.meta.url);
const SITE_DIR = new URL('../site/', import.meta.url);
const FEEDS_DIR = new URL('feeds/', SITE_DIR);

const events = Object.values(JSON.parse(await readFile(new URL('events.json', DATA_DIR), 'utf8')));
const news = Object.values(JSON.parse(await readFile(new URL('news-events.json', DATA_DIR), 'utf8').catch(() => '{}')));
const terms = JSON.parse(await readFile(new URL('terms.json', DATA_DIR), 'utf8'));
const state = JSON.parse(await readFile(new URL('state.json', DATA_DIR), 'utf8'));

// The same event can exist as an `event` post and a news announcement; keep
// the event version.
const dedupeKey = (e) => `${(e.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${e.startDate}`;
const eventKeys = new Set(events.filter((e) => e.startDate).map(dedupeKey));
const allSources = [...events, ...news.filter((n) => !eventKeys.has(dedupeKey(n)))];

const termNames = (tax, ids) => (ids ?? []).map((id) => terms[tax]?.[id]?.name).filter(Boolean);

const today = new Date().toISOString().slice(0, 10);
const cutoffPast = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

const enriched = allSources
  .filter((e) => e.startDate && !e.missing)
  .map((e) => {
    // Structured times are raw UTC (site display bug); prose times
    // (localTimes) are genuine local wall-clock times.
    const startUTC = e.startTime && !e.localTimes ? `${e.startDate}T${e.startTime}:00Z` : null;
    let endUTC = e.endTime && !e.localTimes ? `${e.endDate ?? e.startDate}T${e.endTime}:00Z` : null;
    if (startUTC && endUTC && endUTC <= startUTC) endUTC = null;
    return {
      id: `${e.source === 'news' ? 'news-' : ''}${e.id}`,
      title: e.title,
      link: e.link,
      startDate: e.startDate,
      endDate: e.endDate ?? e.startDate,
      startUTC,
      endUTC,
      startLocal: e.localTimes && e.startTime ? `${e.startDate}T${e.startTime}` : null,
      endLocal: e.localTimes && e.endTime ? `${e.endDate ?? e.startDate}T${e.endTime}` : null,
      tz: TZ_MAP[e.tzLabel] ?? (e.startTime && !e.localTimes ? 'America/Toronto' : null),
      tzLabel: e.tzLabel ?? null,
      location: e.location ?? [],
      region: termNames('region', e.taxonomies?.region),
      group: termNames('group', e.taxonomies?.group),
      employer: termNames('employer', e.taxonomies?.employer),
      chapter: termNames('chapter', e.taxonomies?.chapter),
    };
  })
  .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startUTC ?? '').localeCompare(b.startUTC ?? ''));

await mkdir(FEEDS_DIR, { recursive: true });
const frontendEvents = enriched.filter((e) => e.endDate >= cutoffPast);
await writeFile(new URL('events.json', SITE_DIR), JSON.stringify({
  generated: state.lastRun,
  totalStored: events.length,
  events: frontendEvents,
}));

// ---- ICS ----

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 73) return line;
  const out = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + 73, bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--; // don't split UTF-8
    out.push((start ? ' ' : '') + bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return out.join('\r\n');
}

const icsUTC = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z?$/, '').replace(/Z?$/, 'Z');

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function vevent(e, dtstamp) {
  const lines = ['BEGIN:VEVENT', `UID:pipsc-event-${e.id}@davychiu.github.io`, `DTSTAMP:${dtstamp}`];
  if (e.startUTC) {
    lines.push(`DTSTART:${icsUTC(e.startUTC)}`);
    if (e.endUTC) lines.push(`DTEND:${icsUTC(e.endUTC)}`);
  } else if (e.startLocal) {
    // Prose-sourced wall-clock time; emit floating so clients show it as
    // written (venue-local dinners etc. — tz label usually absent).
    const flat = (s) => s.replace(/[-:]/g, '') + '00';
    lines.push(`DTSTART:${flat(e.startLocal)}`);
    if (e.endLocal && e.endLocal > e.startLocal) lines.push(`DTEND:${flat(e.endLocal)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${e.startDate.replaceAll('-', '')}`);
    lines.push(`DTEND;VALUE=DATE:${addDays(e.endDate, 1).replaceAll('-', '')}`);
  }
  lines.push(fold(`SUMMARY:${esc(e.title)}`));
  if (e.location.length) lines.push(fold(`LOCATION:${esc(e.location.join(', '))}`));
  const descParts = [
    e.region.length ? `Region: ${e.region.join(', ')}` : '',
    e.group.length ? `Group: ${e.group.join(', ')}` : '',
    e.link,
  ].filter(Boolean);
  lines.push(fold(`DESCRIPTION:${esc(descParts.join('\n'))}`));
  lines.push(fold(`URL:${e.link}`));
  lines.push('END:VEVENT');
  return lines;
}

function calendar(name, evs, dtstamp) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//pipsc-better-calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${esc(name)}`),
    'X-PUBLISHED-TTL:PT12H',
    ...evs.flatMap((e) => vevent(e, dtstamp)),
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

const dtstamp = icsUTC(state.lastRun ?? new Date().toISOString());
const upcoming = enriched.filter((e) => e.endDate >= today);

await writeFile(new URL('pipsc-events.ics', FEEDS_DIR), calendar('PIPSC Events', upcoming, dtstamp));

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const regionsInUse = new Map();
for (const e of upcoming) for (const r of e.region) {
  if (!regionsInUse.has(r)) regionsInUse.set(r, []);
  regionsInUse.get(r).push(e);
}
const regionFeeds = [];
for (const [region, evs] of regionsInUse) {
  const slug = `region-${slugify(region)}`;
  await writeFile(new URL(`${slug}.ics`, FEEDS_DIR), calendar(`PIPSC Events — ${region}`, evs, dtstamp));
  regionFeeds.push({ region, file: `feeds/${slug}.ics`, count: evs.length });
}
await writeFile(new URL('feeds.json', SITE_DIR), JSON.stringify({ all: 'feeds/pipsc-events.ics', regions: regionFeeds }, null, 1));

console.log(`site: ${frontendEvents.length} events in events.json; ICS: ${upcoming.length} upcoming, ${regionFeeds.length} region feeds`);
