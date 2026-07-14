#!/usr/bin/env node
// Sync PIPSC events into data/events.json.
//
//   node src/sync.mjs                incremental (index via modified_after, fetch changed pages)
//   node src/sync.mjs --full         full index sweep (also prunes deleted events)
//   node src/sync.mjs --limit 20     cap detail-page fetches (for testing)
//
// Politeness: serialized detail fetches with a delay; incremental runs touch
// only a handful of pages per day.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { parseEventPage, parseProseEvent } from './parse-event.mjs';

const decodeEntities = (s) => cheerio.load(`<x>${s ?? ''}</x>`)('x').text().trim();

const API = 'https://pipsc.ca/wp-json/wp/v2';
const UA = 'pipsc-better-calendar (member event mirror; github.com/davychiu)';
const DATA_DIR = new URL('../data/', import.meta.url);
const EVENTS_FILE = new URL('events.json', DATA_DIR);
const TERMS_FILE = new URL('terms.json', DATA_DIR);
const STATE_FILE = new URL('state.json', DATA_DIR);
const DELAY_MS = 700;
const TAXONOMIES = ['region', 'group', 'employer', 'chapter'];

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, { asJson = true } = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return asJson ? await res.json() : await res.text();
    } catch (err) {
      if (attempt === 4) throw new Error(`${url}: ${err.message}`);
      await sleep(1500 * attempt);
    }
  }
}

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function fetchAllPages(base) {
  const items = [];
  for (let page = 1; ; page++) {
    const url = `${base}${base.includes('?') ? '&' : '?'}per_page=100&page=${page}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 400) break; // past last page
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const batch = await res.json();
    items.push(...batch);
    const totalPages = Number(res.headers.get('x-wp-totalpages') || 1);
    if (page >= totalPages) break;
    await sleep(250);
  }
  return items;
}

async function syncTerms() {
  const terms = {};
  for (const tax of TAXONOMIES) {
    const list = await fetchAllPages(`${API}/${tax}?_fields=id,name,slug`);
    terms[tax] = Object.fromEntries(list.map((t) => [t.id, { name: decodeEntities(t.name), slug: t.slug }]));
  }
  await writeFile(TERMS_FILE, JSON.stringify(terms, null, 1));
  console.log(`terms: ${TAXONOMIES.map((t) => `${t}=${Object.keys(terms[t]).length}`).join(' ')}`);
}

// Some events are announced only as news posts ("When: ... Where: ...").
// Post content comes straight from the REST index — no page scraping.
const NEWS_FILE = new URL('news-events.json', DATA_DIR);
const POSTS_SINCE = '2025-07-01T00:00:00';

async function syncNews(state) {
  const news = await loadJson(NEWS_FILE, {});
  const fields = '_fields=id,slug,link,modified,date,title,content,region,group,employer,chapter';
  let url = `${API}/posts?${fields}`;
  if (!FULL && state.lastModifiedPosts) {
    const after = new Date(new Date(state.lastModifiedPosts + 'Z').getTime() - 3600_000)
      .toISOString().replace(/\.\d+Z$/, '');
    url += `&modified_after=${after}`;
  } else {
    url += `&after=${POSTS_SINCE}`;
  }
  const index = await fetchAllPages(url);
  let found = 0;
  const liveIds = new Set();
  for (const p of index) {
    liveIds.add(String(p.id));
    const text = cheerio.load(p.content?.rendered ?? '')('body').text().replace(/\s+/g, ' ').trim();
    const prose = parseProseEvent(text);
    if (!prose || prose.startDate < p.date?.slice(0, 10)) {
      delete news[p.id]; // announcement edited away, or date precedes publication (misparse)
      continue;
    }
    news[p.id] = {
      id: p.id,
      slug: p.slug,
      link: p.link,
      title: decodeEntities(p.title?.rendered),
      published: p.date,
      modified: p.modified,
      taxonomies: Object.fromEntries(TAXONOMIES.map((t) => [t, p[t] ?? []])),
      ...prose,
      description: text.slice(0, 1500),
      source: 'news',
      scrapedAt: new Date().toISOString(),
    };
    found++;
  }
  if (FULL) {
    for (const id of Object.keys(news)) if (!liveIds.has(id)) delete news[id];
  }
  await writeFile(NEWS_FILE, JSON.stringify(news, null, 1));
  const allMod = index.map((p) => p.modified).sort();
  state.lastModifiedPosts = allMod.at(-1) ?? state.lastModifiedPosts;
  console.log(`news: ${index.length} posts checked, ${found} with event announcements, ${Object.keys(news).length} stored`);
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const events = await loadJson(EVENTS_FILE, {});
  const state = await loadJson(STATE_FILE, {});

  await syncTerms();
  await syncNews(state);

  const fields = '_fields=id,slug,link,modified,date,title,region,group,employer,chapter';
  let indexUrl = `${API}/event?${fields}&orderby=modified&order=desc`;
  if (!FULL && state.lastModified) {
    // Small overlap so a run that dies mid-write can't skip events.
    const after = new Date(new Date(state.lastModified + 'Z').getTime() - 3600_000)
      .toISOString().replace(/\.\d+Z$/, '');
    indexUrl += `&modified_after=${after}`;
  }
  const index = await fetchAllPages(indexUrl);
  console.log(`index: ${index.length} events ${FULL || !state.lastModified ? '(full sweep)' : `(modified since ${state.lastModified})`}`);

  if (FULL) {
    const liveIds = new Set(index.map((e) => String(e.id)));
    for (const id of Object.keys(events)) {
      if (!liveIds.has(id)) {
        delete events[id];
        console.log(`pruned deleted event ${id}`);
      }
    }
  }

  const queue = index.filter((e) => {
    const prev = events[e.id];
    return !prev || prev.modified !== e.modified || !prev.scrapedAt;
  }).slice(0, LIMIT);
  console.log(`detail pages to fetch: ${queue.length}`);

  let done = 0;
  for (const e of queue) {
    const html = await fetchWithRetry(e.link, { asJson: false });
    const detail = html ? parseEventPage(html) : {};
    events[e.id] = {
      id: e.id,
      slug: e.slug,
      link: e.link,
      title: decodeEntities(e.title?.rendered),
      published: e.date,
      modified: e.modified,
      taxonomies: Object.fromEntries(TAXONOMIES.map((t) => [t, e[t] ?? []])),
      ...detail,
      scrapedAt: new Date().toISOString(),
    };
    if (html === null) events[e.id].missing = true;
    done++;
    if (done % 25 === 0 || done === queue.length) {
      await writeFile(EVENTS_FILE, JSON.stringify(events, null, 1));
      console.log(`  ${done}/${queue.length} (last: ${e.slug})`);
    }
    await sleep(DELAY_MS);
  }

  const allModified = Object.values(events).map((e) => e.modified).sort();
  const newState = { ...state, lastModified: allModified.at(-1) ?? state.lastModified, lastRun: new Date().toISOString() };
  await writeFile(EVENTS_FILE, JSON.stringify(events, null, 1));
  await writeFile(STATE_FILE, JSON.stringify(newState, null, 1));

  const noDate = Object.values(events).filter((e) => e.scrapedAt && !e.startDate).length;
  console.log(`total stored: ${Object.keys(events).length}; scraped without parseable date: ${noDate}`);
}

await main();
