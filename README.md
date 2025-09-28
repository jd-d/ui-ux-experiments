# Trigger Risk Monitor

A static research log that tracks catalysts capable of puncturing the late stage of the 18.6-year land and credit cycle. The site combines a daily AI research brief with a deterministic ingestion script so that every update, score change, and briefing note is auditable.

## Repository layout

| Path | Purpose |
| --- | --- |
| `index.html` | Homepage with the Top-10 leaderboard, latest briefings, dashboard gauges, and playbook cards fed by the JSON data registry. |
| `methodology.html` | Public-facing explanation of the research workflow and scoring framework mirrored by this README. |
| `glossary.html` | Glossary of cycle-stage language, dashboard states, and scoring fields, including update provenance. |
| `posts/` | Rendered HTML briefings for individual trigger events and daily posts. Files are regenerated each run by the ingest script. |
| `data/events.json` | Full trigger registry with every tracked event, including scores, phase, rationale, sources, and history. |
| `data/leaderboard.json` | Snapshot of the Top-10 highest-risk events served on the homepage leaderboard. |
| `data/latest_briefings.json` | Lightweight index of the most recent briefing cards displayed in the "Latest briefing notes" section. |
| `data/briefings_archive.json` | Complete catalogue powering the "All briefings" page with every published write-up. |
| `data/llm/` | Drop zone for raw ChatGPT Deep Research packets (`YYYY-MM-DD[(-HHMM)].packet.json`). The latest packet for a date drives each ingest cycle. |
| `assets/` | Site stylesheets, fonts, and the small JavaScript bundle that powers navigation and the newsletter stub. |
| `scripts/` | Python utilities that validate Deep Research packets and update the JSON registries and posts. |

## Daily research pipeline

Every publication cycle moves from prompt to production in three repeatable stages.

### 1. Prompted deep research

* Each run begins with the "Bootstrap & Rebase — 18.6-Year Cycle Trigger Monitor" Deep Research brief.
* The agent scans six standing trigger clusters and focuses on catalysts likely to break in the next one to eight months—think Jay Cooke-style funding shocks, OPEC-like supply squeezes, or Lehman analogues.
* The prompt locks the researcher to the Europe/Amsterdam timezone, requiring the ISO date in the `as_of` field and preserving event continuity via `fingerprint_fields` (cluster, event type, canonical source, etc.).
* Analysts must re-score any trigger already present in `data/leaderboard.json`, introduce credible new candidates, favour primary sources, and document rationale, indicators, tripwires, and links.

### 2. Structured LLM packet

* The agent replies with a deterministic JSON payload saved to `data/llm/`.
* Required top-level keys are `as_of`, `clusters`, `events_update`, and `post`, with optional `briefings` mirroring the per-event write-ups.
* Each `events_update` entry includes:
  * A stable `uid` derived from the fingerprint fields.
  * Scores (0–100), phases (`watch`, `elevated`, `critical`), confidence, indicators, tripwires, rationale, and canonical sources.
  * A `brief` object containing a sanitized HTML fragment, title, slug, and optional subtitle for publication.
* A simplified example:

  ```json
  {
    "as_of": "2024-05-11",
    "events_update": [
      {
        "uid": "us_cre__liquidity-fractures__2024-05-11",
        "fingerprint_fields": {
          "cluster": "US_CRE",
          "event_type": "funding/liquidity",
          "canonical_source": "https://trepp.com"
        },
        "score": 62,
        "phase": "elevated",
        "confidence": "high",
        "brief": {
          "slug": "liquidity-fractures",
          "title": "Liquidity fractures widen in U.S. CRE",
          "content": "<h2>What changed</h2><p>...</p>"
        },
        "sources": ["https://trepp.com/report"]
      }
    ],
    "post": {
      "slug": "2024-05-11-brief",
      "title": "Daily Risk Brief — 2024-05-11",
      "format": "html",
      "content": "<h2>Top movers</h2><p>...</p>"
    }
  }
  ```

### 3. Automated ingestion & scoring

`scripts/ingest_llm_packet.py` connects the packet to the published site. When executed, it:

1. Loads the latest packet for each `as_of` date and performs schema validation.
2. Normalizes URLs, clamps scores, and standardizes phase and confidence labels.
3. Builds a SHA-256 fingerprint from `fingerprint_fields` to keep event identities stable between runs.
4. Merges the update into `data/events.json`, appending score histories, indicators, tripwires, rationale, and source links.
5. Applies the decay rule (three points per day after a seven-day grace period for watch/elevated/critical events) and rebuilds the Top-10 snapshot in `data/leaderboard.json` using score, confidence, and recency sorting logic.
6. Writes sanitized HTML briefings to `posts/<slug>.html`, refreshes `data/latest_briefings.json`, expands `data/briefings_archive.json`, and emits the daily post referenced on the homepage.

The script is deliberately deterministic: running it twice with the same packet produces identical data outputs and briefing files.

## Data lifecycle & reuse

* **Event registry:** `data/events.json` is the canonical record of every trigger, including cumulative score history, rationale, tripwires, confidence, and sources. Analysts can lift this file directly into their own tooling or dashboards.
* **Leaderboard:** `data/leaderboard.json` contains the current Top-10 used by the homepage table and displays rank, score, phase badge, and last update timestamp.
* **Latest briefing feed:** `data/latest_briefings.json` is the index for the "Latest briefing notes" cards, making it easy to syndicate the freshest write-ups elsewhere.
* **Briefings archive:** `data/briefings_archive.json` stores the complete publication history surfaced on the "All briefings" page and can be reused for research timelines.
* **Published posts:** `posts/` holds both daily summaries and per-event briefings, each wrapped in the shared site chrome with metadata (phase badge, score, cluster, event type, and confidence).

All JSON outputs are UTF-8 encoded, newline-terminated, and suitable for ingestion by other systems.

## Working locally

The project is a static site and needs no build step. To preview it locally:

1. Install Python 3.9+ (only the standard library is required).
2. From the repository root, start a simple web server:

   ```bash
   python -m http.server 8000
   ```

3. Visit `http://localhost:8000/index.html` to browse the leaderboard, briefings, and methodology pages.

## Updating data manually

1. Save the latest Deep Research packet into `data/llm/` using the `YYYY-MM-DD.packet.json` naming scheme (append `-HHMM` if multiple runs share a date).
2. Optionally run `python scripts/check_and_fix_packet.py <path> -o data/llm/<date>.packet.json` to auto-correct minor JSON issues using the sanitizer in `validate_and_fix_llm_packet.py`.
3. Execute the ingest script:

   ```bash
   python scripts/ingest_llm_packet.py
   ```

4. Commit the regenerated JSON files and posts to publish the update.

`scripts/ci_acceptance_checks.py` can be used in CI or pre-commit hooks to ensure packets contain required keys, mirrored briefings, and third-person tone before ingestion.

## Contributing & extension ideas

* Extend the `assets/js/main.js` bundle if you need richer interactivity; it currently handles only the responsive navigation toggle and newsletter stub.
* Add new sections or visualizations by editing the HTML templates directly—everything is static and self-contained.
* When adding new automation, prefer deterministic transformations so the audit trail remains intact between runs.

For a narrative description of the scoring philosophy and decay mechanics, see `methodology.html`—this README mirrors those principles while giving a practical operator's guide to the repository.
