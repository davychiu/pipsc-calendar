import * as cheerio from 'cheerio';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// Site displays zone as a bare label; map to IANA for ICS TZID use.
export const TZ_MAP = {
  PT: 'America/Vancouver',
  MT: 'America/Edmonton',
  CT: 'America/Winnipeg',
  ET: 'America/Toronto',
  AT: 'America/Halifax',
  NT: 'America/St_Johns',
  NST: 'America/St_Johns',
  PST: 'America/Vancouver', PDT: 'America/Vancouver',
  MST: 'America/Edmonton', MDT: 'America/Edmonton',
  CST: 'America/Winnipeg', CDT: 'America/Winnipeg',
  EST: 'America/Toronto', EDT: 'America/Toronto',
  AST: 'America/Halifax', ADT: 'America/Halifax',
  UTC: 'UTC', GMT: 'UTC',
};

function parseLongDate(s) {
  const m = s.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

function parseClock(s) {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'P') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// "June 4, 2027  - June 4, 2027 | 3:00 PM - 6:00 PM (MT)"
// Variants seen/anticipated: single date, no time part, no tz label.
export function parseDateLine(line) {
  const out = { startDate: null, endDate: null, startTime: null, endTime: null, tzLabel: null, raw: line.trim() };
  if (!line) return out;
  const [datePart, timePart] = line.split('|').map((s) => s?.trim());

  if (datePart) {
    const dates = datePart.split(/\s+-\s+|\s+–\s+/).map((s) => parseLongDate(s)).filter(Boolean);
    out.startDate = dates[0] ?? null;
    out.endDate = dates[1] ?? dates[0] ?? null;
  }
  if (timePart) {
    const tz = timePart.match(/\(([^)]+)\)\s*$/);
    if (tz) out.tzLabel = tz[1].trim();
    const clocks = timePart.replace(/\([^)]*\)\s*$/, '').split(/\s+-\s+|\s+–\s+/).map((s) => parseClock(s)).filter(Boolean);
    out.startTime = clocks[0] ?? null;
    out.endTime = clocks[1] ?? null;
  }
  return out;
}

export function parseEventPage(html) {
  const $ = cheerio.load(html);
  const head = $('.event-detail-head');

  const dateLine = head.find('.events-detail-left > .text-md').first().text().replace(/\s+/g, ' ').trim();
  const when = parseDateLine(dateLine);

  const locationLines = $('.events-detail-right .location-detail p')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim())
    .get()
    .filter(Boolean);

  const prose = $('.event-detail-container .prose').first();
  prose.find('script, style, form, .gform_wrapper').remove();
  prose.find('.published-date').remove();
  const description = prose.text().replace(/\s+/g, ' ').trim().slice(0, 1500);

  const links = {};
  $('.event-detail-container .link-box a[href]').each((_, el) => {
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    if (label) links[label] = $(el).attr('href');
  });

  const frLink = $('a.lang-item[data-lang="FR"]').attr('href') || null;

  return { ...when, location: locationLines, description, links, frLink };
}
