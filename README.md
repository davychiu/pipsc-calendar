# PIPSC Better Calendar

An unofficial, usable calendar for [PIPSC](https://pipsc.ca) events. The official
site lists events sorted by *publish* date across hundreds of pages with no
filters; this mirror sorts by *event* date and adds search, region/group
filters, a month view, and iCalendar feeds you can subscribe to.

**Not affiliated with or endorsed by PIPSC.** Data is mirrored from public
pages on pipsc.ca for member convenience.

## How it works

```
pipsc.ca WP REST API ──┐
                       ├── src/sync.mjs ──> data/*.json ── src/build.mjs ──> site/
pipsc.ca event pages ──┘                                    (events.json, feeds/*.ics,
                                                             static frontend)
```

- **`src/sync.mjs`** — pulls the event index from the public WordPress REST API
  (`/wp-json/wp/v2/event`, which exposes titles, links, and region/group/
  employer/chapter taxonomies), then fetches only new or modified event pages
  and scrapes the date/time/location block the API doesn't expose. Incremental
  by default via `modified_after`; `--full` re-sweeps the whole index and
  prunes deleted events. Detail fetches are serialized with a 700 ms delay.
- **`src/build.mjs`** — writes the frontend payload (`site/events.json`) and
  iCalendar feeds (`site/feeds/*.ics`): one for all upcoming events plus one
  per region.
- **`site/`** — zero-dependency static frontend (list + month views).
- **`.github/workflows/sync.yml`** — syncs twice daily, commits data, deploys
  to GitHub Pages. Monthly full sweep on the 1st.

## The timezone quirk

pipsc.ca displays raw **UTC clock times labeled with the event's local
timezone** (e.g. an Edmonton AGM shown as "11:00 PM (MT)" that actually runs
at 5:00 PM MT). Verified against known meeting times and the start-hour
distribution of scraped events. This project interprets scraped times as UTC,
so the ICS feeds and the frontend show **correct local times** — they will
intentionally disagree with the times printed on pipsc.ca. The original
display string is preserved in `data/events.json` under `raw`. If PIPSC ever
fixes their rendering, drop the UTC interpretation in `src/build.mjs`.

## Usage

```sh
npm ci
node src/sync.mjs --full     # first run: backfill (~1-2 h, polite rate limit)
node src/sync.mjs            # afterwards: incremental
node src/build.mjs           # generate site/
npx http-server site         # or any static file server
```

## Subscribe

Once deployed, feeds live at `feeds/pipsc-events.ics` (all events) and
`feeds/region-<slug>.ics` (per region). Add the URL in Google Calendar via
"Other calendars → From URL", or in Outlook/Apple Calendar via
"Subscribe to calendar".
