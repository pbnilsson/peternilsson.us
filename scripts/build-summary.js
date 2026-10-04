// Reads every day file and writes one small data/summary.json that the
// stats page (/consulting/stats/) can load in a single request.
// Adapted from the Schooled site's builder. The one real change: this site
// has no signup form, so the conversion that matters is someone clicking an
// email link — counted here as a "contact."
//
// The file holds five pre-computed windows — last 24 hours, week, month,
// year, and all time — because the page never sees individual rows. The
// windows close at build time, not at page-load time; that costs nothing,
// since the underlying data only moves when the sync runs.
const fs = require("fs");
const path = require("path");

const dir = path.join("data", "days");
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
  : [];

const allRows = [];
for (const f of files) {
  const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if (Array.isArray(parsed)) allRows.push(...parsed);
}

// "/consulting/index.html" and "/consulting/" are the same page; so are
// "/consulting/schools" and "/consulting/schools/". Count each as one.
function normPath(p) {
  let s = String(p || "/").split(/[?#]/)[0].replace(/index\.html?$/, "");
  if (!/\.[a-z0-9]{2,5}$/i.test(s) && !s.endsWith("/")) s += "/";
  return s;
}
for (const r of allRows) r.path = normPath(r.path);

const now = new Date();
const nowMs = now.getTime();
const HOUR = 3600000;
const DAY = 86400000;

function ms(r) {
  const t = Date.parse(r.ts);
  return Number.isFinite(t) ? t : null;
}

// ---- helpers ---------------------------------------------------------------

function tally(list, pick, limit) {
  const m = new Map();
  for (const r of list) {
    const k = pick(r);
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  const out = [...m.entries()]
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => b.n - a.n);
  return limit ? out.slice(0, limit) : out;
}

// Distinct tab-sessions, our closest honest stand-in for "people"
function visitors(list) {
  return new Set(list.map((r) => r.visit).filter(Boolean)).size;
}

// Median, not mean — one tab left open overnight would wreck an average
function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

function groupBy(list, pick) {
  const m = new Map();
  for (const r of list) {
    const k = pick(r);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

// ---- one window ------------------------------------------------------------

function summarize(rows, granularity) {
  const views = rows.filter((r) => r.kind === "view");
  const clicks = rows.filter((r) => r.kind === "click");
  const ends = rows.filter((r) => r.kind === "end");
  const isMail = (r) => /^mailto:/i.test(String(r.target || ""));
  const contacts = clicks.filter(isMail);

  // ---- the pulse -----------------------------------------------------------
  // Day buckets stay on UTC calendar days, as they always have. Hour buckets
  // carry a full timestamp so the page can label them in Eastern without the
  // data itself having to pick a timezone.
  const series = [];
  if (views.length && granularity === "hour") {
    const end = Math.floor(nowMs / HOUR) * HOUR;
    const byHour = groupBy(views, (r) => {
      const t = ms(r);
      return t === null ? null : String(Math.floor(t / HOUR) * HOUR);
    });
    for (let k = 23; k >= 0; k--) {
      const bucket = end - k * HOUR;
      const list = byHour.get(String(bucket)) || [];
      series.push({
        t: new Date(bucket).toISOString(),
        views: list.length,
        visitors: visitors(list),
      });
    }
  } else if (views.length) {
    const days = views.map((r) => r.ts.slice(0, 10)).sort();
    const first = new Date(days[0] + "T00:00:00Z");
    const last = new Date(days[days.length - 1] + "T00:00:00Z");
    const byDay = groupBy(views, (r) => r.ts.slice(0, 10));
    for (let t = first; t <= last; t = new Date(t.getTime() + DAY)) {
      const d = t.toISOString().slice(0, 10);
      const list = byDay.get(d) || [];
      series.push({ d, views: list.length, visitors: visitors(list) });
    }
  }

  // ---- pages, with how far people got and how long they stayed -------------

  const endsByPage = groupBy(ends, (r) => r.path);
  const pages = [...groupBy(views, (r) => r.path || "/").entries()]
    .map(([key, list]) => {
      const e = endsByPage.get(key) || [];
      return {
        key,
        n: list.length,
        visitors: visitors(list),
        depth: median(e.map((r) => r.depth)),
        secs: median(e.map((r) => r.secs)),
        measured: e.length,
      };
    })
    .sort((a, b) => b.n - a.n);

  // ---- journeys ------------------------------------------------------------

  const byVisit = groupBy(views, (r) => r.visit);
  const trails = [];
  for (const [, list] of byVisit) {
    list.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    const seq = [];
    for (const r of list) {
      if (seq[seq.length - 1] !== r.path) seq.push(r.path); // collapse reloads
    }
    if (seq.length) trails.push(seq);
  }

  const journeys = tally(
    trails.filter((t) => t.length > 1).map((t) => ({ s: t.join(" → ") })),
    (r) => r.s,
    15
  );
  const entries = tally(trails.map((t) => ({ p: t[0] })), (r) => r.p, 10);
  const exits = tally(
    trails.map((t) => ({ p: t[t.length - 1] })),
    (r) => r.p,
    10
  );
  const trailLengths = trails.map((t) => t.length);

  // ---- contacts (email-link clicks) ----------------------------------------

  // A contact's real source is the source of the visit it belongs to, not the
  // referrer at the moment of clicking — so look it up by visit id.
  const visitSource = new Map();
  const visitEntry = new Map();
  for (const [visit, list] of byVisit) {
    const firstView = list[0];
    if (!firstView) continue;
    visitSource.set(visit, firstView.campaign || firstView.source || "direct");
    visitEntry.set(visit, firstView.path);
  }

  const contactDetail = contacts.map((r) => ({
    page: r.path,
    source: visitSource.get(r.visit) || "unknown",
    entry: visitEntry.get(r.visit) || r.path,
  }));

  // ---- clicks --------------------------------------------------------------

  const OURS = /^https?:\/\/(www\.)?peternilsson\.us/i;

  function isNav(target) {
    const t = String(target || "");
    if (!t) return true;
    if (!OURS.test(t)) return false;
    const p = t.replace(OURS, "").split(/[?#]/)[0];
    if (p === "" || p === "/") return true;
    return /\.html?$/i.test(p) || !/\.[a-z0-9]{2,5}$/i.test(p);
  }

  // Email clicks are reported as contacts, so leave them out of "followed".
  const followed = clicks.filter((r) => r.target && !isNav(r.target) && !isMail(r));
  const navigated = clicks.filter((r) => r.target && isNav(r.target));

  // ---- assemble ------------------------------------------------------------

  const dayCount = granularity === "hour"
    ? new Set(views.map((r) => r.ts.slice(0, 10))).size
    : series.length;

  return {
    granularity,
    totals: {
      views: views.length,
      clicks: clicks.length,
      links: followed.length,
      visitors: visitors(views),
      contacts: contacts.length,
      contactVisitors: visitors(contacts),
      days: dayCount,
      medianPagesPerVisit: median(trailLengths),
      medianDepth: median(ends.map((r) => r.depth)),
      medianSecs: median(ends.map((r) => r.secs)),
    },
    series,
    pages,
    journeys,
    entries,
    exits,
    sources: tally(views, (r) => r.source),
    referrers: tally(views, (r) => r.ref, 20),
    campaigns: tally(views, (r) => r.campaign, 20),
    countries: tally(views, (r) => r.country, 20),
    cities: tally(
      views,
      (r) => (r.city ? r.city + (r.region ? ", " + r.region : "") : null),
      20
    ),
    devices: tally(views, (r) => r.device),
    browsers: tally(views, (r) => r.browser, 10),
    systems: tally(views, (r) => r.os, 10),
    contactsBySource: tally(contactDetail, (r) => r.source, 10),
    contactsByPage: tally(contactDetail, (r) => r.page, 10),
    contactsByEntry: tally(contactDetail, (r) => r.entry, 10),
    links: tally(followed, (r) => r.target, 25),
    internalLinks: tally(navigated, (r) => r.target, 25),
  };
}

// ---- the five windows ------------------------------------------------------

const RANGES = [
  { key: "24h", label: "Last 24 hours", short: "24h", days: 1, granularity: "hour" },
  { key: "week", label: "Last week", short: "Week", days: 7, granularity: "day" },
  { key: "month", label: "Last month", short: "Month", days: 30, granularity: "day" },
  { key: "year", label: "Last year", short: "Year", days: 365, granularity: "day" },
  { key: "all", label: "All time", short: "All", days: null, granularity: "day" },
];

const stamps = allRows.map(ms).filter((t) => t !== null).sort((a, b) => a - b);
const firstTs = stamps.length ? stamps[0] : null;
const spanDays = firstTs === null ? 0 : (nowMs - firstTs) / DAY;

const ranges = {};
for (const r of RANGES) {
  const from = r.days === null ? null : nowMs - r.days * DAY;
  const rows = from === null
    ? allRows
    : allRows.filter((row) => {
        const t = ms(row);
        return t !== null && t >= from;
      });

  // A fixed window longer than the data we hold would just be "all time"
  // wearing a different name. Mark it so the page can gray the pill out.
  const available = r.days === null || r.key === "24h" ? true : spanDays > r.days;

  ranges[r.key] = Object.assign(
    {
      key: r.key,
      label: r.label,
      short: r.short,
      from:
        from === null
          ? firstTs === null
            ? null
            : new Date(firstTs).toISOString()
          : new Date(from).toISOString(),
      to: now.toISOString(),
      available,
    },
    summarize(rows, r.granularity)
  );
}

const summary = {
  generated: now.toISOString(),
  defaultRange: "all",
  order: RANGES.map((r) => r.key),
  span: {
    first: firstTs === null ? null : new Date(firstTs).toISOString(),
    days: Math.max(1, Math.ceil(spanDays)),
  },
  ranges,
};

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/summary.json", JSON.stringify(summary, null, 2) + "\n");
console.log(
  RANGES.map((r) => {
    const t = ranges[r.key].totals;
    return (
      r.key + ": " + t.views + "v/" + t.visitors + "p" +
      (ranges[r.key].available ? "" : " (grayed)")
    );
  }).join("  ")
);
