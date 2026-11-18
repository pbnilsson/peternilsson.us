# peternilsson.us

Static site served by GitHub Pages.

- `/` — root page linking to the consulting site, *Schooled*, and the newsletter.
- `/consulting/` — consulting site: home, `schools/`, `speaking/`, `writing/`, `about/`.
- `consulting/` pages are generated from the Design-canvas mockups by `build/convert.py`.
- Workshop pages (`/consulting/go/<school>/`, unlisted) will be added later.

No build step on GitHub: the files here are what gets served.

## Visit notes (stats)

Private stats page at `/consulting/stats/` (noindex, not linked), modeled on the Schooled site's `stats.html`.

- `js/notes.js` — the tracker, loaded by every page. **Off** until `EP` is set to a collector address.
- `.github/workflows/visit-notes.yml` — pulls rows from the collector twice a day. Manual-only until the collector exists.
- `scripts/split-days.js` → `data/days/*.json`; `scripts/build-summary.js` → `data/summary.json`, which the stats page reads.
- Silence your own browsers by loading any page once with `?notrack=1` (Chrome, Safari, phone).

## All-sites stats

Private page at `/stats/` (noindex, not linked) that puts all of Peter's sites side by side:
Consulting, the peternilsson.us home page, Schooled, the Educator's Notebook, and Childhood Recovery.
Each site's tile links to that site's own stats page.

- `.github/workflows/network-stats.yml` — twice a day, after the four "Visit notes" syncs, reads each
  site's committed visit rows from its public repo and runs `scripts/build-network.js`.
- `scripts/build-network.js` → `data/network.json`: per-site visitors and a daily (or hourly) series,
  people by US state / country / city, how visits arrived, links between the sites, and top pages.
  peternilsson.us rows are split into "home" and "consulting" by path.
- `stats/index.html` — the page. The US map outlines are embedded (us-atlas, Albers USA, simplified).
