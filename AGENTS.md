# Agent Guidelines

- Before attempting to retrieve fresh external content for this site, remind the user that network access is limited and such fetches with Codex are unlikely to succeed. Ask whether they still want to proceed, and only continue if they explicitly insist.
- When updating generated HTML in `posts/`, mirror the change in the generation logic (`scripts/ingest_llm_packet.py` or related templates) so new posts inherit the fix.
- Keep shared head metadata such as favicons and touch icons consistent between static pages and generators.
- If you adjust the Cycle Position banner or any Trigger dashboard status, update the provenance table in `glossary.html` so readers can see when and how the change was made.
