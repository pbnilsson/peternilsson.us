// peternilsson.us — visit-notes collector (Cloudflare Worker + D1)
//
//   POST /p        a beacon from js/notes.js        → one row in D1
//   GET  /export   ?key=…&since=YYYY-MM-DD&prune=1  → rows since that day, as JSON
//                  (prune=1 also deletes rows older than `since`, which earlier
//                  syncs have already copied into the GitHub repo)
//
// Bindings it expects (Worker → Settings → Bindings / Variables and Secrets):
//   DB          D1 database   peternilsson-notes
//   EXPORT_KEY  secret        any long random string; the same value goes in the
//                             GitHub repo secret PN_NOTES_KEY
//
// What it never stores: IP address, full user-agent, exact screen width,
// referrer path, or network/ISP name.

const ALLOWED_ORIGINS = [
  "https://peternilsson.us",
  "https://www.peternilsson.us",
  "https://pbnilsson.github.io",
];
const OUR_HOSTS = /(^|\.)peternilsson\.us$|^pbnilsson\.github\.io$/i;
const KINDS = new Set(["view", "click", "end"]);
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|monitor|curl|wget|python|axios/i;

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|startpage|brave|kagi|perplexity|search\.)/i;
const SOCIAL = /(^|\.)(facebook|fb|instagram|linkedin|lnkd|t\.co|twitter|x\.com|threads|bsky|bluesky|mastodon|reddit|youtube|tiktok|pinterest|substack)/i;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/p") return collect(req, env);
    if (url.pathname === "/export") return exportRows(url, env);
    return new Response("visit notes collector\n", { status: 200 });
  },
};

// ---- collect --------------------------------------------------------------

async function collect(req, env) {
  const origin = req.headers.get("Origin") || "";
  const cors = ALLOWED_ORIGINS.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" }
    : {};

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" },
    });
  }
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  // Only our own pages may report. (sendBeacon always sends Origin cross-site.)
  if (!cors["Access-Control-Allow-Origin"]) return new Response(null, { status: 204 });

  const ua = req.headers.get("User-Agent") || "";
  if (BOT.test(ua)) return new Response(null, { status: 204, headers: cors });

  let d;
  try {
    const text = await req.text();
    if (text.length > 4000) return new Response(null, { status: 413, headers: cors });
    d = JSON.parse(text);
  } catch (e) {
    return new Response(null, { status: 400, headers: cors });
  }
  if (!d || !KINDS.has(d.k)) return new Response(null, { status: 400, headers: cors });

  const cf = req.cf || {};
  const refHost = hostOf(d.r);
  const campaign = clip(d.c, 80);
  const row = {
    ts: new Date().toISOString(),
    kind: d.k,
    path: clip(d.p, 200) || "/",
    target: d.k === "click" ? clip(d.t, 500) : null,
    ref: refHost,
    source: sourceOf(refHost, campaign),
    campaign,
    country: clip(cf.country, 4),
    screen: Number.isFinite(d.w) ? d.w : null,
    visit: clip(d.v, 20),
    city: clip(cf.city, 80),
    region: clip(cf.region, 80),
    device: deviceOf(ua, d.w),
    browser: browserOf(ua),
    os: osOf(ua),
    depth: d.k === "end" && Number.isFinite(d.d) ? Math.max(0, Math.min(100, Math.round(d.d))) : null,
    secs: d.k === "end" && Number.isFinite(d.s) ? Math.max(0, Math.min(86400, Math.round(d.s))) : null,
  };

  await env.DB.prepare(
    `INSERT INTO rows (ts, kind, path, target, ref, source, campaign, country, screen,
                       visit, city, region, device, browser, os, depth, secs)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`
  ).bind(
    row.ts, row.kind, row.path, row.target, row.ref, row.source, row.campaign, row.country,
    row.screen, row.visit, row.city, row.region, row.device, row.browser, row.os, row.depth, row.secs
  ).run();

  return new Response(null, { status: 204, headers: cors });
}

// ---- export ---------------------------------------------------------------

async function exportRows(url, env) {
  if (!env.EXPORT_KEY || !(await sameSecret(url.searchParams.get("key") || "", env.EXPORT_KEY))) {
    return new Response("no", { status: 403 });
  }
  const since = url.searchParams.get("since") || "1970-01-01";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) return new Response("bad since", { status: 400 });

  const { results } = await env.DB.prepare(
    `SELECT ts, kind, path, target, ref, source, campaign, country, screen,
            visit, city, region, device, browser, os, depth, secs
       FROM rows WHERE ts >= ?1 ORDER BY ts`
  ).bind(since).all();

  if (url.searchParams.get("prune") === "1") {
    await env.DB.prepare("DELETE FROM rows WHERE ts < ?1").bind(since).run();
  }

  return new Response(JSON.stringify(results || []), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// ---- helpers --------------------------------------------------------------

function clip(v, n) {
  if (v === undefined || v === null || v === "") return null;
  return String(v).slice(0, n);
}

function hostOf(ref) {
  if (!ref) return null;
  try {
    const h = new URL(ref).hostname.replace(/^www\./, "");
    return h || null;
  } catch (e) {
    // Android apps report "android-app://com.google.android.gm/" and the like
    const m = String(ref).match(/^android-app:\/\/([^/]+)/);
    return m ? m[1] : null;
  }
}

function sourceOf(host, campaign) {
  if (campaign) return "campaign";
  if (!host) return "direct";
  if (OUR_HOSTS.test(host)) return "internal";
  if (SOCIAL.test(host)) return "social";
  if (SEARCH.test(host) || /googlequicksearchbox/.test(host)) return "search";
  return "referral";
}

function deviceOf(ua, w) {
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/Mobi|iPhone|Android/i.test(ua)) return "mobile";
  if (/Macintosh/i.test(ua) && w && w <= 1024 && /Safari/i.test(ua)) return "tablet"; // iPadOS desktop mode
  return "desktop";
}

function browserOf(ua) {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS/.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS/.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}

function osOf(ua) {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}
