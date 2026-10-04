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
