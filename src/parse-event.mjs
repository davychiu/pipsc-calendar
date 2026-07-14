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

// Fallback for content whose date lives only in prose, e.g.
//   "When: Friday, July 31, 2026, at 6:00 PM Where: Tony's..., Whitehorse, YT Cost: ..."
//   "When: Wednesday, May 27, 2026 – 5:30 to 9:00pm"
//   "When: May 27 2026, at 12:00 PM PT Where: 401 Burrard St."
// Unlike the structured date block (raw UTC), prose times are genuine local
// times as written, so results carry localTimes: true.
const TZ_TOKEN = /\b(PT|MT|CT|ET|AT|NT|PST|PDT|MST|MDT|CST|CDT|EST|EDT|AST|ADT|NST|NDT)\b/;

function to24h(hourStr, minStr, meridiem) {
  let h = Number(hourStr);
  if (meridiem) {
    h %= 12;
    if (/^p/i.test(meridiem)) h += 12;
  }
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${minStr ?? '00'}`;
}

export function parseProseEvent(text) {
  if (!text) return null;
  const whenM = text.match(/\bwhen\s*:\s*/i);
  if (!whenM) return null;
  const win = text.slice(whenM.index, whenM.index + 200);

  const dateM = win.match(/([A-Za-z]+)\s+(\d{1,2})(?:\s*(?:st|nd|rd|th))?,?\s+(\d{4})/);
  if (!dateM) return null;
  const startDate = parseLongDate(`${dateM[1]} ${dateM[2]}, ${dateM[3]}`);
  if (!startDate) return null;

  const timeWin = win.slice(dateM.index + dateM[0].length, dateM.index + dateM[0].length + 90);
  const MER = String.raw`(a\.?m\.?|p\.?m\.?)`;
  const range = timeWin.match(new RegExp(String.raw`(\d{1,2})(?::(\d{2}))?\s*${MER}?\s*(?:to|until|[-–—])\s*(\d{1,2})(?::(\d{2}))?\s*${MER}`, 'i'));
  const single = timeWin.match(new RegExp(String.raw`(\d{1,2})(?::(\d{2}))?\s*${MER}`, 'i'));
  let startTime = null;
  let endTime = null;
  if (range) {
    startTime = to24h(range[1], range[2], range[3] ?? range[6]); // "5:30 to 9:00pm" inherits pm
    endTime = to24h(range[4], range[5], range[6]);
    if (startTime && endTime && endTime < startTime && !range[3]) {
      // "11:30 to 1:00pm" — start was am
      startTime = to24h(range[1], range[2], 'am');
    }
  } else if (single) {
    startTime = to24h(single[1], single[2], single[3]);
  }
  if (!startTime) return null;
  const tzM = timeWin.match(TZ_TOKEN);

  let location = [];
  const whereM = text.match(/where\s*:\s*(.{3,160})/is);
  if (whereM) {
    let loc = whereM[1];
    const stop = loc.search(/\b(cost|price|no\s+rsvp|rsvp|when|registration|please|agenda)\b\s*:?/i);
    if (stop > 0) {
      loc = loc.slice(0, stop);
    } else {
      // no section label in range: cut after "..., ON" / "..., BC V6G 2T1"
      const prov = loc.match(/^(.*,\s*(?:BC|AB|SK|MB|ON|QC|NB|NS|PE|NL|YT|NT|NU)\b(?:\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d)?)/);
      if (prov) loc = prov[1];
    }
    loc = loc.replace(/\s+/g, ' ').replace(/[.,;\s]+$/, '').trim();
    if (loc.length >= 3) location = [loc];
  }

  return { startDate, endDate: startDate, startTime, endTime, tzLabel: tzM ? tzM[1] : null, localTimes: true, location };
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

  let result = { ...when, location: locationLines, description, links, frLink };
  if (!result.startDate) {
    const prose = parseProseEvent(description);
    if (prose) result = { ...result, ...prose, location: locationLines.length ? locationLines : prose.location };
  }
  return result;
}
