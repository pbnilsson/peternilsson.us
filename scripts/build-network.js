// Builds data/network.json for the all-sites stats page at /stats/.
//
// Reads the raw visit rows that each site's own sync has already committed to
// its repo, so nothing new is collected here:
//
//   peternilsson.us        data/days/   (this repo) — split into "home" and
//                                        "consulting" by path
//   Schooled               data/days/   (pbnilsson/SchooledTheMusical)
//   Educator's Notebook    visits/days/ (pbnilsson/TheEducatorsNotebook)
//   Childhood Recovery     data/days/   (pbnilsson/ChildhoodRecovery)
//
// Usage: node scripts/build-network.js <schooled-repo> <ednotebook-repo> <childhood-repo>
// (paths to local checkouts; .github/workflows/network-stats.yml makes them).
//
// "People" are each site's own browser sessions. A person who visits two sites
// counts once on each, so the combined total is a sum, not a de-duplicated count.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const [SCHOOLED, ENB, CHILDHOOD] = process.argv.slice(2);

const SITES = [
  // stats: each site's own stats page (home and consulting share one).
  { key: "consulting", name: "Consulting", host: "peternilsson.us/consulting", stats: "https://peternilsson.us/consulting/stats/" },
  { key: "home", name: "peternilsson.us home", host: "peternilsson.us", stats: "https://peternilsson.us/consulting/stats/" },
  { key: "schooled", name: "Schooled", host: "schooledthemusical.com", stats: "https://schooledthemusical.com/stats.html" },
  { key: "ednotebook", name: "Educator’s Notebook", host: "educatorsnotebook.com", stats: "https://educatorsnotebook.com/stats/" },
  { key: "childhood", name: "Childhood Recovery", host: "exercisesfortherecoveryofchildhood.com", stats: "https://exercisesfortherecoveryofchildhood.com/stats/" },
];

// ---- read ------------------------------------------------------------------

function readDays(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const rows = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const a = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (Array.isArray(a)) rows.push(...a);
    } catch (e) {
      console.warn("skipped " + f + ": " + e.message);
    }
  }
  return rows;
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}

function cleanPath(p, prefix) {
  let s = String(p || "/");
  if (prefix) s = s.replace(new RegExp("^/" + prefix + "(?=/|$)", "i"), "");
  s = s.replace(/index\.html?$/i, "");
  return s || "/";
}

const rows = [];
// Cloud data-center rows (dc: 1) are left out here just as each site's own
// summary leaves them out, and counted per site.
const dataCenter = {};
function add(list, site, prefix) {
  for (const r of list) {
    const p = cleanPath(r.path, prefix);
    const s = typeof site === "function" ? site(p) : site;
    if (r.dc) {
      if (r.kind === "view") dataCenter[s] = (dataCenter[s] || 0) + 1;
      continue;
    }
    rows.push(Object.assign({}, r, { path: p, site: s }));
  }
}

add(readDays(path.join(ROOT, "data", "days")), (p) => (/^\/consulting(\/|$)/.test(p) ? "consulting" : "home"));
add(readDays(SCHOOLED && path.join(SCHOOLED, "data", "days")), "schooled", "SchooledTheMusical");
add(readDays(ENB && path.join(ENB, "visits", "days")), "ednotebook", "TheEducatorsNotebook");
add(readDays(CHILDHOOD && path.join(CHILDHOOD, "data", "days")), "childhood", "ChildhoodRecovery");

const enbSummary = ENB ? readJSON(path.join(ENB, "visits", "summary.json")) : null;
const ENB_NAMES = (enbSummary && enbSummary.pageNames) || {};

// ---- helpers ---------------------------------------------------------------

const now = new Date();
const nowMs = now.getTime();
const HOUR = 3600000;
const DAY = 86400000;

function ms(r) {
  const t = Date.parse(r.ts);
  return Number.isFinite(t) ? t : null;
}

function groupBy(list, pick) {
  const m = new Map();
  for (const r of list) {
    const k = pick(r);
    if (k === null || k === undefined || k === "") continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function people(list) {
  return new Set(list.map((r) => r.site + ":" + r.visit).filter((v) => !/:(null|undefined|)$/.test(v))).size;
}

function ranked(m, limit) {
  const out = [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
  return limit ? out.slice(0, limit) : out;
}

// Which of Peter's sites a URL belongs to, if any.
function siteOfUrl(u) {
  let x;
  try { x = new URL(String(u)); } catch (e) { return null; }
  const h = x.hostname.replace(/^www\./, "").toLowerCase();
  const p = x.pathname;
  if (h === "peternilsson.us") return /^\/consulting(\/|$)/.test(p) ? "consulting" : "home";
  if (h === "schooledthemusical.com") return "schooled";
  if (h === "educatorsnotebook.com") return "ednotebook";
  if (h === "exercisesfortherecoveryofchildhood.com") return "childhood";
  if (h === "pbnilsson.github.io") {
    if (/^\/TheEducatorsNotebook/i.test(p)) return "ednotebook";
    if (/^\/ChildhoodRecovery/i.test(p)) return "childhood";
    if (/^\/SchooledTheMusical/i.test(p)) return "schooled";
  }
  return null;
}

const OUR_HOSTS = /(^|\.)(peternilsson\.us|schooledthemusical\.com|educatorsnotebook\.com|exercisesfortherecoveryofchildhood\.com|pbnilsson\.github\.io)$/i;
const EMAIL = /(^|\.)(mail\.google\.com|com\.google\.android\.gm|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|mail\.yahoo\.com|mail\.aol\.com|webmail|deref-gmx|deref-web|mail\.proton|icloud\.com)|webmail|mail\./i;

// How a visit arrived, judged by its first page view on that site.
function arrival(r) {
  if (r.campaign) return "campaign";
  const h = String(r.ref || "");
  if (h && OUR_HOSTS.test(h)) return "yoursites";
  if (h && EMAIL.test(h)) return "email";
  const s = r.source || "direct";
  return s === "internal" ? "yoursites" : s;
}

// Friendly page names for the top-pages list.
function pageName(site, p) {
  if (site === "ednotebook") {
    if (p === "/") return "Home (current issue)";
    if (ENB_NAMES[p]) return "Issue " + ENB_NAMES[p];
    if (p === "/stats/") return "Stats";
  }
  if (site === "childhood") {
    const m = /^\/(\d+)\/$/.exec(p);
    if (m) return "Exercise " + m[1];
  }
  if (p === "/") return "Home";
  const n = p.replace(/^\/|\/$/g, "").replace(/^consulting\/?/, "").replace(/\.html?$/, "").replace(/\//g, " / ");
  if (!n) return "Home";
  return n.charAt(0).toUpperCase() + n.slice(1);
}

// ---- one window ------------------------------------------------------------

function summarize(list, granularity) {
  const views = list.filter((r) => r.kind === "view");
  const clicks = list.filter((r) => r.kind === "click" && r.target);
  const bySite = groupBy(views, (r) => r.site);

  // Per-site totals.
  const sites = SITES.map((s) => {
    const v = bySite.get(s.key) || [];
    const c = clicks.filter((r) => r.site === s.key);
    return { key: s.key, views: v.length, people: people(v), clicks: c.length };
  });

  // Per-site series: one bucket per day (or hour for the 24h view).
  const series = [];
  if (views.length) {
    let buckets;
    if (granularity === "hour") {
      const end = Math.floor(nowMs / HOUR) * HOUR;
      buckets = [];
      for (let k = 23; k >= 0; k--) buckets.push(end - k * HOUR);
      const keyOf = (r) => { const t = ms(r); return t === null ? null : Math.floor(t / HOUR) * HOUR; };
      const g = groupBy(views, keyOf);
      for (const b of buckets) {
        const l = g.get(b) || [];
        const pt = { t: new Date(b).toISOString() };
        for (const s of SITES) {
          const ls = l.filter((r) => r.site === s.key);
          pt[s.key] = [ls.length, people(ls)];
        }
        series.push(pt);
      }
    } else {
      const days = views.map((r) => r.ts.slice(0, 10)).sort();
      const g = groupBy(views, (r) => r.ts.slice(0, 10));
      for (let t = new Date(days[0] + "T00:00:00Z"); t <= new Date(days[days.length - 1] + "T00:00:00Z"); t = new Date(t.getTime() + DAY)) {
        const d = t.toISOString().slice(0, 10);
        const l = g.get(d) || [];
        const pt = { d };
        for (const s of SITES) {
          const ls = l.filter((r) => r.site === s.key);
          pt[s.key] = [ls.length, people(ls)];
        }
        series.push(pt);
      }
    }
  }

  // Geography, counted in people, for all sites and for each site.
  function geo(v) {
    const states = new Map(), countries = new Map(), cities = new Map();
    const seen = { s: new Set(), c: new Set(), t: new Set() };
    for (const r of v) {
      const who = r.site + ":" + (r.visit || r.ts);
      if (r.country === "US" && r.region && !seen.s.has(who + r.region)) {
        seen.s.add(who + r.region);
        states.set(r.region, (states.get(r.region) || 0) + 1);
      }
      if (r.country && !seen.c.has(who + r.country)) {
        seen.c.add(who + r.country);
        countries.set(r.country, (countries.get(r.country) || 0) + 1);
      }
      if (r.city) {
        const label = r.city + (r.country === "US" ? (r.region ? ", " + r.region : "") : ", " + (r.country || ""));
        if (!seen.t.has(who + label)) {
          seen.t.add(who + label);
          cities.set(label, (cities.get(label) || 0) + 1);
        }
      }
    }
    return { states: ranked(states), countries: ranked(countries, 25), cities: ranked(cities, 25) };
  }
  const geography = { all: geo(views) };
  for (const s of SITES) geography[s.key] = geo(bySite.get(s.key) || []);

  // How people arrived at each site (first view of each visit on that site).
  const arrivals = {};
  for (const s of SITES) {
    const v = bySite.get(s.key) || [];
    const first = new Map();
    for (const r of v.slice().sort((a, b) => String(a.ts).localeCompare(String(b.ts)))) {
      if (r.visit && !first.has(r.visit)) first.set(r.visit, r);
    }
    const m = new Map();
    for (const r of first.values()) {
      const a = arrival(r);
      m.set(a, (m.get(a) || 0) + 1);
    }
    arrivals[s.key] = Object.fromEntries(m);
  }

  // Links followed from one of Peter's sites to another (home → consulting included).
  const flowMap = new Map();
  for (const r of clicks) {
    const to = siteOfUrl(r.target);
    if (!to || to === r.site) continue;
    const k = r.site + ">" + to;
    flowMap.set(k, (flowMap.get(k) || 0) + 1);
  }
  const flows = [...flowMap.entries()]
    .map(([k, n]) => ({ from: k.split(">")[0], to: k.split(">")[1], n }))
    .sort((a, b) => b.n - a.n);

  // Most-viewed pages across every site.
  const pageMap = new Map();
  for (const r of views) {
    const k = r.site + "|" + r.path;
    if (!pageMap.has(k)) pageMap.set(k, { site: r.site, path: r.path, n: 0, who: new Set() });
    const e = pageMap.get(k);
    e.n++;
    if (r.visit) e.who.add(r.visit);
  }
  const pages = [...pageMap.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 25)
    .map((e) => ({ site: e.site, path: e.path, name: pageName(e.site, e.path), n: e.n, people: e.who.size }));

  return {
    granularity,
    totals: { views: views.length, people: people(views), clicks: clicks.length },
    sites,
    series,
    geography,
    arrivals,
    flows,
    pages,
  };
}

// ---- windows ---------------------------------------------------------------

const RANGES = [
  { key: "24h", label: "Last 24 hours", short: "24h", days: 1, granularity: "hour" },
  { key: "week", label: "Last week", short: "Week", days: 7, granularity: "day" },
  { key: "month", label: "Last month", short: "Month", days: 30, granularity: "day" },
  { key: "year", label: "Last year", short: "Year", days: 365, granularity: "day" },
  { key: "all", label: "All time", short: "All", days: null, granularity: "day" },
];

const stamps = rows.map(ms).filter((t) => t !== null).sort((a, b) => a - b);
const firstTs = stamps.length ? stamps[0] : null;
const spanDays = firstTs === null ? 0 : (nowMs - firstTs) / DAY;

const ranges = {};
for (const r of RANGES) {
  const from = r.days === null ? null : nowMs - r.days * DAY;
  const list = from === null ? rows : rows.filter((x) => { const t = ms(x); return t !== null && t >= from; });
  ranges[r.key] = Object.assign(
    {
      key: r.key, label: r.label, short: r.short,
      from: from === null ? (firstTs === null ? null : new Date(firstTs).toISOString()) : new Date(from).toISOString(),
      to: now.toISOString(),
      available: r.days === null || r.key === "24h" ? true : spanDays > r.days,
    },
    summarize(list, r.granularity)
  );
}

// When each site started reporting, so uneven history is visible on the page.
const since = {};
for (const s of SITES) {
  const t = rows.filter((x) => x.site === s.key).map(ms).filter((v) => v !== null).sort((a, b) => a - b)[0];
  since[s.key] = t ? new Date(t).toISOString().slice(0, 10) : null;
}

const out = {
  generated: now.toISOString(),
  defaultRange: "month",
  order: RANGES.map((r) => r.key),
  dataCenterViews: dataCenter,
  sites: SITES.map((s) => ({ key: s.key, name: s.name, host: s.host, stats: s.stats, since: since[s.key] })),
  ranges,
};

fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "network.json"), JSON.stringify(out) + "\n");
console.log(
  SITES.map((s) => s.key + " since " + since[s.key]).join(" · ") + "\n" +
  RANGES.map((r) => r.key + ": " + ranges[r.key].totals.views + "v/" + ranges[r.key].totals.people + "p").join("  ")
);
