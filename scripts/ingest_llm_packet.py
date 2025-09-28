#!/usr/bin/env python3
"""Ingest the latest LLM packet and update site data."""
from __future__ import annotations

import json
import hashlib
import re
import sys
from difflib import SequenceMatcher
from datetime import date
from html import escape, unescape
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import urlsplit, urlunsplit

REQUIRED_PACKET_KEYS = {"as_of", "clusters", "events_update", "post"}
WATCH_PHASES = {"watch", "elevated", "critical"}
CONFIDENCE_ORDER = {"high": 3, "medium": 2, "low": 1}


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def load_json(path: Path, default: Any) -> Any:
    if path.exists():
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    return default


def dump_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

def slugify(text: str) -> str:
    s = (text or "").lower()
    s = re.sub(r"[^a-z0-9_\- ]+", "", s)
    s = re.sub(r"\s+", "-", s.strip())
    return s or "post"

def sanitize_html_content(html_content: str) -> str:
    """Remove unsupported helper markers from generated HTML snippets."""

    if not html_content:
        return ""
    cleaned = re.sub(r":contentReference\[[^\]]*\]\{[^}]*\}", "", html_content)
    cleaned = re.sub(r":contentReference\[[^\]]*\]", "", cleaned)
    return cleaned


def extract_text_summary(html_content: str, fallback: str = "", max_length: int = 160) -> str:
    """Convert an HTML fragment into a concise plain-text summary."""

    text = sanitize_html_content(html_content)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = " ".join(text.split())
    if not text:
        text = fallback or ""
    truncated = False
    if len(text) > max_length:
        candidate = text[:max_length].rsplit(" ", 1)[0]
        text = candidate or text[:max_length]
        truncated = True
    text = text.strip()
    if truncated and text:
        text = text.rstrip(".,;:–-") + "…"
    return text


def format_as_of_display(as_of: Optional[str]) -> str:
    if not as_of:
        return ""
    try:
        return parse_date(as_of).strftime("%d %B %Y")
    except ValueError:
        return ""


def normalize_label(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = text.replace("_", " ")
    if text.isupper():
        return text
    return text.title()


def glossary_slug_from_value(value: str) -> str:
    """Create a fragment identifier slug for glossary anchors."""

    slug_source = (value or "").strip().lower()
    slug_source = slug_source.replace("_", " ")
    slug = re.sub(r"[^a-z0-9]+", "-", slug_source)
    return slug.strip("-")


def render_glossary_link(
    text: str,
    slug: Optional[str],
    *,
    classes: Iterable[str] = (),
    preview_label: Optional[str] = None,
) -> str:
    """Render a hyperlink that requires confirmation before navigation."""

    safe_text = escape(text)
    if not slug:
        return f"<span>{safe_text}</span>"

    class_tokens: List[str] = []
    for cls in classes:
        if not cls:
            continue
        class_tokens.append(cls)
    class_tokens.append("glossary-link")
    class_attr = " ".join(dict.fromkeys(class_tokens))

    preview = preview_label or f"Glossary → {text}"
    attributes = [
        f'href="../glossary.html#{escape(slug, quote=True)}"',
        f'class="{escape(class_attr, quote=True)}"' if class_attr else 'class="glossary-link"',
        'data-confirm-link="true"',
        f'data-preview-label="{escape(preview, quote=True)}"',
    ]
    return f"<a {' '.join(attributes)}>{safe_text}</a>"


def render_phase_badge(phase: Optional[str]) -> Optional[str]:
    if not phase:
        return None
    label = str(phase).strip()
    if not label:
        return None
    normalized = label.lower()
    mapping = {
        "critical": (
            "risk-badge--high",
            "Trigger risk: Critical",
            "trigger-risk-critical",
            "Trigger risk badge · Critical",
        ),
        "elevated": (
            "risk-badge--medium",
            "Trigger risk: Elevated",
            "trigger-risk-elevated",
            "Trigger risk badge · Elevated",
        ),
        "watch": (
            "risk-badge--watch",
            "Trigger risk: Watch",
            "trigger-risk-watch",
            "Trigger risk badge · Watch",
        ),
    }
    if normalized in mapping:
        class_name, text, slug, preview = mapping[normalized]
    else:
        class_name, text, slug, preview = (
            "risk-badge--watch",
            f"Phase: {label.title()}",
            None,
            f"Trigger risk badge · {label.title()}",
        )
    return render_glossary_link(
        text,
        slug,
        classes=("risk-badge", class_name),
        preview_label=preview,
    )


def render_event_type_chip(event_type: Optional[str]) -> Optional[str]:
    label = normalize_label(event_type)
    if not label:
        return None
    slug = glossary_slug_from_value(str(event_type or label))
    preview = f"Glossary → Event type · {label}"
    return render_glossary_link(label, slug, preview_label=preview)


def render_cluster_chip(cluster: Optional[str]) -> Optional[str]:
    raw_cluster = str(cluster or "").strip()
    if not raw_cluster:
        return None
    label = normalize_label(raw_cluster)
    slug = glossary_slug_from_value(raw_cluster)
    preview = f"Glossary → Cluster · {label}"
    return render_glossary_link(label, slug, preview_label=preview)


def render_confidence_chip(confidence: Optional[str]) -> Optional[str]:
    confidence_label = str(confidence or "").strip()
    if not confidence_label:
        return None
    text = f"Confidence: {confidence_label.capitalize()}"
    return render_glossary_link(
        text,
        "glossary-confidence",
        preview_label="Glossary → Confidence scale",
    )


def render_score_chip(score: Optional[Any]) -> Optional[str]:
    if score is None:
        return None
    score_value = clamp_score(score)
    text = f"Score: {int(round(score_value))}"
    return render_glossary_link(
        text,
        "glossary-score",
        preview_label="Glossary → Score methodology",
    )


def render_post_page(
    title: str,
    content: str,
    *,
    as_of: Optional[str],
    description: Optional[str] = None,
    subtitle: Optional[str] = None,
    phase: Optional[str] = None,
    cluster: Optional[str] = None,
    event_type: Optional[str] = None,
    confidence: Optional[str] = None,
    score: Optional[Any] = None,
) -> str:
    """Wrap briefing content in the site layout template."""

    safe_title = title.strip() or "Trigger Risk Monitor briefing"
    meta_description = (description or extract_text_summary(content, fallback=safe_title)).strip()
    subtitle_text = str(subtitle or "").strip()

    date_display = format_as_of_display(as_of)
    phase_badge = render_phase_badge(phase)

    meta_items: List[str] = []
    if phase_badge:
        meta_items.append(phase_badge)

    event_type_chip = render_event_type_chip(event_type)
    if event_type_chip:
        meta_items.append(event_type_chip)

    cluster_chip = render_cluster_chip(cluster)
    if cluster_chip:
        meta_items.append(cluster_chip)

    confidence_chip = render_confidence_chip(confidence)
    if confidence_chip:
        meta_items.append(confidence_chip)

    score_chip = render_score_chip(score)
    if score_chip:
        meta_items.append(score_chip)

    meta_html = ""
    if meta_items:
        meta_html = "\n            <div class=\"post-meta\">\n              " + "\n              ".join(meta_items) + "\n            </div>"

    subtitle_html = ""
    if subtitle_text:
        subtitle_html = f"\n            <p class=\"post-subtitle\">{escape(subtitle_text)}</p>"

    date_html = ""
    if date_display:
        date_html = f"\n            <p class=\"post-date\">{escape(date_display)}</p>"

    sanitized_content = sanitize_html_content(content)

    html_page = f"""<!DOCTYPE html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>{escape(safe_title)}</title>
    <meta
      name=\"description\"
      content=\"{escape(meta_description)}\"
    />
    <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\" crossorigin />
    <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin />
    <link
      href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap\"
      rel=\"stylesheet\"
    />
    <link rel=\"stylesheet\" href=\"../assets/css/style.css\" />
    <link rel=\"icon\" href=\"../assets/favicon.png\" type=\"image/png\" />
    <link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"../assets/favicon.png\" />
  </head>
  <body>
    <header class=\"site-header\" id=\"top\">
      <div class=\"container header-inner\">
        <a class=\"logo\" href=\"../index.html\">Trigger Risk Monitor</a>
        <button class=\"nav-toggle\" aria-expanded=\"false\" aria-controls=\"site-nav\">
          <span class=\"sr-only\">Toggle navigation</span>
          <span class=\"nav-toggle__bar\"></span>
          <span class=\"nav-toggle__bar\"></span>
          <span class=\"nav-toggle__bar\"></span>
        </button>
        <nav id=\"site-nav\" class=\"site-nav\" aria-label=\"Primary\">
          <ul>
            <li><a href=\"../index.html#leaderboard\">Leaderboard</a></li>
            <li><a href=\"../index.html#latest\">Latest briefings</a></li>
            <li><a href=\"index.html\">All briefings</a></li>
            <li><a href=\"../methodology.html\">Methodology</a></li>
            <li><a href=\"../glossary.html\">Glossary</a></li>
            <li><a href=\"../index.html#dashboard\">Trigger dashboard</a></li>
            <li><a href=\"../index.html#playbook\">Playbook</a></li>
          </ul>
        </nav>
      </div>
    </header>

    <main class=\"post-main\">
      <div class=\"container post-layout\">
        <article class=\"post\">
          <header class=\"post-header\">{date_html}
            <h1>{escape(safe_title)}</h1>{subtitle_html}{meta_html}
          </header>

          <div class=\"post-content\">
            {sanitized_content}
          </div>

          <footer class=\"post-footer\">
            <a href=\"../index.html#latest\">&#8592; Back to briefings</a>
          </footer>
        </article>

        <aside class=\"post-sidebar\" aria-label=\"Related content\">
          <div class=\"sidebar-card\">
            <h2>More briefings</h2>
            <p>Explore the archive for additional trigger risk updates.</p>
            <a class=\"btn btn-secondary\" href=\"index.html\">Browse all briefings</a>
          </div>
          <div class=\"sidebar-card\">
            <h2>Stay informed</h2>
            <p>Track cross-market stress signals with the Trigger dashboard.</p>
            <a class=\"btn btn-secondary\" href=\"../index.html#dashboard\">View dashboard</a>
          </div>
        </aside>
      </div>
    </main>

    <footer class=\"site-footer\">
      <div class=\"container footer-inner\">
        <div>
          <a class=\"logo\" href=\"#top\">Trigger Risk Monitor</a>
          <p class=\"footer-note\">
            Independent research on the 18.6-year land cycle. Built for investors who want to see turning points before the crowd.
          </p>
        </div>
        <div class=\"footer-links\">
          <a href=\"index.html\">All briefings</a>
          <a href=\"../methodology.html\">Methodology</a>
          <a href=\"../glossary.html\">Glossary</a>
          <a href=\"mailto:research@triggerrisk.blog\">Contact</a>
          <a href=\"../index.html#timeline\">Trigger timeline</a>
        </div>
        <p class=\"footer-copy\">&copy; 2024 Trigger Risk Monitor. All rights reserved.</p>
      </div>
    </footer>

    <script src=\"../assets/js/main.js\" defer></script>
  </body>
</html>
"""

    return html_page


def render_article_history_section(event: Dict[str, Any]) -> str:
    entries = event.get("article_history") or []
    if not entries:
        return ""

    sorted_entries = sorted(
        entries,
        key=lambda item: (item.get("date") or "", item.get("title") or ""),
        reverse=True,
    )

    rows: List[str] = []
    for entry in sorted_entries:
        date_value = str(entry.get("date") or "").strip()
        date_text = format_as_of_display(date_value) or date_value or "—"
        title_text = str(entry.get("title") or "").strip() or "—"
        score_value = entry.get("score")
        score_text = "—"
        if score_value is not None:
            score_text = str(int(round(clamp_score(score_value))))

        sources_list = dedupe_list(
            (entry.get("sources") or [])
            + ([entry.get("source")] if entry.get("source") else [])
        )
        if sources_list:
            links = []
            for url in sources_list:
                if not url:
                    continue
                label = source_label(url)
                safe_url = escape(str(url), quote=True)
                links.append(f'<a href="{safe_url}">{escape(label or url)}</a>')
            sources_html = "<br />".join(links) if links else "—"
        else:
            sources_html = "—"

        rows.append(
            "\n              <tr>"
            f"\n                <td>{escape(date_text)}</td>"
            f"\n                <td>{escape(title_text)}</td>"
            f"\n                <td>{sources_html}</td>"
            f"\n                <td>{escape(score_text)}</td>"
            "\n              </tr>"
        )

    if not rows:
        return ""

    return (
        "<section class=\"article-history\">\n"
        "  <h2>Update history</h2>\n"
        "  <p>How this event's assessment has evolved over recent briefings.</p>\n"
        "  <div class=\"table-wrapper\">\n"
        "    <table class=\"article-history__table\">\n"
        "      <thead>\n"
        "        <tr>\n"
        "          <th scope=\"col\">Date</th>\n"
        "          <th scope=\"col\">Briefing title</th>\n"
        "          <th scope=\"col\">Sources</th>\n"
        "          <th scope=\"col\">Score</th>\n"
        "        </tr>\n"
        "      </thead>\n"
        "      <tbody>"
        + "".join(rows)
        + "\n      </tbody>\n"
        "    </table>\n"
        "  </div>\n"
        "</section>"
    )


def write_brief(
    brief: Dict[str, Any],
    slug_hint: Optional[str],
    as_of: Optional[str],
    event: Optional[Dict[str, Any]] = None,
) -> Optional[Tuple[str, Path]]:
    """Write a per-event briefing HTML file from a brief payload."""

    if not brief:
        return None

    slug = slugify(str(slug_hint or brief.get("slug") or brief.get("title") or "post"))
    if not slug:
        return None

    title = str(brief.get("title") or slug.replace("-", " ").title())
    content = brief.get("content") or ""

    cluster = None
    event_type = None
    confidence = None
    score: Optional[Any] = None

    if event:
        cluster = event.get("cluster") or (event.get("fingerprint_fields") or {}).get("cluster")
        event_type = event.get("event_type") or (event.get("fingerprint_fields") or {}).get("event_type")
        confidence = event.get("confidence")
        if event.get("score") is not None:
            score = event.get("score")
    else:
        cluster = brief.get("cluster")

    if event:
        history_section = render_article_history_section(event)
        if history_section:
            if content and not content.endswith("\n"):
                content = f"{content}\n"
            content = f"{content}\n{history_section}"

    page = render_post_page(
        title,
        content,
        as_of=as_of,
        description=extract_text_summary(content, fallback=title),
        phase=(event or {}).get("phase"),
        cluster=cluster,
        event_type=event_type,
        confidence=confidence,
        score=score,
    )

    dest = repo_root() / "posts" / f"{slug}.html"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", encoding="utf-8") as fh:
        fh.write(page)
    return slug, dest

def collect_and_write_briefings(
    packet: Dict[str, Any],
    events_by_fp: Optional[Dict[str, Dict[str, Any]]] = None,
    resolved_by_uid: Optional[Dict[str, Dict[str, Any]]] = None,
    resolved_by_slug: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Write all available per-event briefings and return an index for Latest briefings."""

    written: List[Dict[str, Any]] = []
    as_of = packet.get("as_of")

    packet_updates = packet.get("events_update") or []
    update_by_slug: Dict[str, Dict[str, Any]] = {}
    update_by_uid: Dict[str, Dict[str, Any]] = {}
    for ev in packet_updates:
        brief = ev.get("brief") or {}
        slug = slugify(brief.get("slug") or brief.get("title") or ev.get("title") or "")
        if slug:
            update_by_slug[slug] = ev
        uid = str(ev.get("uid") or "").strip()
        if uid:
            update_by_uid[uid] = ev

    aggregated_by_uid: Dict[str, Dict[str, Any]] = {}
    aggregated_by_slug: Dict[str, Dict[str, Any]] = {}

    if resolved_by_uid:
        for uid_key, event in resolved_by_uid.items():
            if uid_key:
                aggregated_by_uid[uid_key] = event

    for event in (events_by_fp or {}).values() if events_by_fp else []:
        uid_key = str(event.get("uid") or "").strip()
        if uid_key and uid_key not in aggregated_by_uid:
            aggregated_by_uid[uid_key] = event

    if resolved_by_slug:
        for slug, event in resolved_by_slug.items():
            if slug:
                aggregated_by_slug[slug] = event

    for event in (events_by_fp or {}).values() if events_by_fp else []:
        slug_candidate = slugify(str(event.get("uid") or event.get("title") or ""))
        if slug_candidate and slug_candidate not in aggregated_by_slug:
            aggregated_by_slug[slug_candidate] = event

    for slug, update in update_by_slug.items():
        if slug in aggregated_by_slug:
            continue
        uid_key = str(update.get("uid") or "").strip()
        candidate = aggregated_by_uid.get(uid_key)
        if candidate:
            aggregated_by_slug[slug] = candidate

    seen_slugs: set[str] = set()

    for b in packet.get("briefings") or []:
        slug_hint = slugify(b.get("slug") or b.get("title") or "")
        if slug_hint and slug_hint in seen_slugs:
            continue
        event_uid = str(b.get("event_uid") or "").strip()
        event = aggregated_by_uid.get(event_uid) if event_uid else None
        if not event and slug_hint:
            event = aggregated_by_slug.get(slug_hint)
        if not event and slug_hint:
            update = update_by_slug.get(slug_hint)
            if update:
                event = aggregated_by_uid.get(str(update.get("uid") or "").strip())
        result = write_brief(b, slug_hint, as_of, event)
        if result:
            slug, _ = result
            seen_slugs.add(slug)
            written.append(
                {
                    "event_uid": b.get("event_uid"),
                    "slug": slug,
                    "title": b.get("title"),
                    "cluster": (event or {}).get("cluster") or b.get("cluster"),
                    "as_of": packet.get("as_of"),
                }
            )

    for ev in packet_updates:
        brief = ev.get("brief")
        if not brief:
            continue
        slug_hint = slugify(brief.get("slug") or brief.get("title") or ev.get("title") or "")
        if slug_hint and slug_hint in seen_slugs:
            continue
        uid_key = str(ev.get("uid") or "").strip()
        event = aggregated_by_uid.get(uid_key) if uid_key else None
        if not event and slug_hint:
            event = aggregated_by_slug.get(slug_hint)
        result = write_brief(brief, slug_hint, as_of, event)
        if result:
            slug, _ = result
            if slug in seen_slugs:
                continue
            seen_slugs.add(slug)
            written.append(
                {
                    "event_uid": uid_key or ev.get("uid"),
                    "slug": slug,
                    "title": brief.get("title") or ev.get("title"),
                    "cluster": (event or {}).get("cluster")
                    or ev.get("cluster")
                    or (ev.get("fingerprint_fields") or {}).get("cluster"),
                    "as_of": packet.get("as_of"),
                }
            )
    if written:
        latest = {"as_of": packet.get("as_of"), "items": written[:20]}
        dump_json(repo_root() / "data" / "latest_briefings.json", latest)
    update_briefings_archive(written, packet.get("as_of"))
    return written


def update_briefings_archive(entries: List[Dict[str, Any]], generated_as_of: Optional[str]) -> None:
    """Merge new briefing metadata into the persistent archive index."""

    archive_path = repo_root() / "data" / "briefings_archive.json"
    payload = load_json(archive_path, {"items": []})
    existing_items = payload.get("items") or []

    merged: Dict[str, Dict[str, Any]] = {}
    for item in existing_items:
        slug = str((item or {}).get("slug") or "").strip()
        if not slug:
            continue
        merged[slug] = {
            "slug": slug,
            "title": item.get("title"),
            "as_of": item.get("as_of"),
            "cluster": item.get("cluster"),
            "event_uid": item.get("event_uid"),
        }

    for entry in entries:
        slug = str((entry or {}).get("slug") or "").strip()
        if not slug:
            continue
        current = merged.get(slug, {})
        merged[slug] = {
            "slug": slug,
            "title": entry.get("title") or current.get("title"),
            "as_of": entry.get("as_of") or current.get("as_of"),
            "cluster": entry.get("cluster") or current.get("cluster"),
            "event_uid": entry.get("event_uid") or current.get("event_uid"),
        }

    def sort_key(item: Dict[str, Any]) -> Tuple[int, str, str]:
        as_of_value = item.get("as_of") or ""
        try:
            as_of_ord = parse_date(as_of_value).toordinal()
        except Exception:
            as_of_ord = -1
        title = str(item.get("title") or "").lower()
        slug = str(item.get("slug") or "")
        return (as_of_ord, title, slug)

    ordered = sorted(merged.values(), key=sort_key, reverse=True)

    generated = generated_as_of or payload.get("generated_at") or date.today().isoformat()
    dump_json(
        archive_path,
        {
            "generated_at": generated,
            "items": ordered,
        },
    )


def canonicalize_url(url: str) -> str:
    if not url:
        return ""
    split = urlsplit(url.strip())
    scheme = split.scheme.lower() or "https"
    netloc = split.netloc.lower()
    path = split.path or ""
    if not netloc and path:
        candidate = path.lstrip("/")
        if candidate and "." in candidate and "/" not in candidate:
            netloc = candidate.lower()
            path = ""
    if path.endswith("/") and path != "/":
        path = path.rstrip("/")
    return urlunsplit((scheme, netloc, path, "", ""))


def source_label(url: str) -> str:
    if not url:
        return ""
    split = urlsplit(url)
    if split.netloc:
        label = split.netloc
        if label.startswith("www."):
            label = label[4:]
        return label
    if split.path:
        return split.path
    return url


def normalize_token(value: Any, *, case: str, collapse_delimiters: bool = True) -> str:
    token = str(value or "").strip()
    if not token:
        return ""
    if collapse_delimiters:
        token = re.sub(r"[\s\/_-]+", " ", token)
    else:
        token = re.sub(r"\s+", " ", token)
    if case == "upper":
        return token.upper()
    return token.lower()


def canonicalize_fingerprint_fields(fields: Dict[str, Any]) -> Dict[str, Any]:
    primary_entities: List[str] = []
    for item in fields.get("primary_entities", []):
        normalized = normalize_token(item, case="lower")
        if normalized:
            primary_entities.append(normalized)

    geography: List[str] = []
    for item in fields.get("geography", []):
        normalized = normalize_token(item, case="upper")
        if normalized:
            geography.append(normalized)

    instruments: List[str] = []
    for item in fields.get("instruments", []):
        normalized = normalize_token(item, case="upper")
        if normalized:
            instruments.append(normalized)

    canonical_source = canonicalize_url(str(fields.get("canonical_source", "")))
    canonical = {
        "cluster": normalize_token(
            fields.get("cluster", ""), case="lower", collapse_delimiters=False
        ),
        "event_type": normalize_token(fields.get("event_type", ""), case="lower"),
        "primary_entities": sorted(set(primary_entities)),
        "geography": sorted(set(geography)),
        "instruments": sorted(set(instruments)),
        "mechanism": normalize_token(fields.get("mechanism", ""), case="lower"),
    }
    if canonical_source:
        canonical["canonical_source"] = canonical_source
    return canonical


def compute_fingerprint(canonical_fields: Dict[str, Any]) -> str:
    hashed_fields = {
        key: value
        for key, value in canonical_fields.items()
        if key != "canonical_source"
    }
    canonical_json = json.dumps(hashed_fields, separators=(",", ":"), sort_keys=True)
    digest = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def merge_canonical_field_sets(
    base: Dict[str, Any], incoming: Dict[str, Any]
) -> Dict[str, Any]:
    """Combine two canonical field payloads while preserving normalization."""

    merged: Dict[str, Any] = {
        "cluster": base.get("cluster") or incoming.get("cluster") or "",
        "event_type": base.get("event_type") or incoming.get("event_type") or "",
        "mechanism": base.get("mechanism") or incoming.get("mechanism") or "",
        "primary_entities": sorted(
            set((base.get("primary_entities") or []) + (incoming.get("primary_entities") or []))
        ),
        "geography": sorted(
            set((base.get("geography") or []) + (incoming.get("geography") or []))
        ),
        "instruments": sorted(
            set((base.get("instruments") or []) + (incoming.get("instruments") or []))
        ),
    }

    if incoming.get("cluster"):
        merged["cluster"] = incoming["cluster"]
    if incoming.get("event_type"):
        merged["event_type"] = incoming["event_type"]
    if incoming.get("mechanism"):
        merged["mechanism"] = incoming["mechanism"]

    canonical_source = incoming.get("canonical_source") or base.get("canonical_source")
    if canonical_source:
        merged["canonical_source"] = canonical_source

    return merged


def _jaccard_similarity(left: Iterable[str], right: Iterable[str]) -> float:
    left_set = {item for item in left if item}
    right_set = {item for item in right if item}
    if not left_set or not right_set:
        return 0.0
    intersection = len(left_set & right_set)
    union = len(left_set | right_set)
    if union == 0:
        return 0.0
    return intersection / union


def _sequence_similarity(first: Optional[str], second: Optional[str]) -> float:
    left = (first or "").strip()
    right = (second or "").strip()
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, left, right).ratio()


def find_similar_event(
    canonical_fields: Dict[str, Any],
    events_by_fp: Dict[str, Dict[str, Any]],
    *,
    title: Optional[str] = None,
    threshold: float = 0.7,
) -> Optional[Tuple[Dict[str, Any], float]]:
    """Return the closest matching event when an exact fingerprint miss occurs."""

    if not events_by_fp:
        return None

    best_match: Optional[Tuple[Dict[str, Any], float]] = None
    normalized_title = (title or "").strip().lower()

    for event in events_by_fp.values():
        event_fields = event.get("fingerprint_fields") or {}

        score = 0.0
        if event_fields.get("cluster") and event_fields.get("cluster") == canonical_fields.get("cluster"):
            score += 0.15
        if event_fields.get("event_type") and event_fields.get("event_type") == canonical_fields.get("event_type"):
            score += 0.15

        score += 0.2 * _jaccard_similarity(
            event_fields.get("primary_entities") or [],
            canonical_fields.get("primary_entities") or [],
        )
        score += 0.1 * _jaccard_similarity(
            event_fields.get("instruments") or [],
            canonical_fields.get("instruments") or [],
        )
        score += 0.15 * _jaccard_similarity(
            event_fields.get("geography") or [],
            canonical_fields.get("geography") or [],
        )
        score += 0.15 * _sequence_similarity(
            event_fields.get("mechanism"), canonical_fields.get("mechanism")
        )

        event_title = str(event.get("title") or "").strip().lower()
        if normalized_title and event_title:
            score += 0.1 * _sequence_similarity(event_title, normalized_title)

        if score >= threshold and (best_match is None or score > best_match[1]):
            best_match = (event, score)

    return best_match
def clamp_score(raw_score: Any) -> float:
    try:
        score = float(raw_score)
    except (TypeError, ValueError):
        score = 0.0
    return max(0.0, min(100.0, score))


def parse_date(value: str) -> date:
    return date.fromisoformat(value)


PACKET_SUFFIX = ".packet.json"


def extract_packet_time_bucket(filename: str) -> int:
    """Return a sortable time bucket derived from the packet filename.

    Filenames follow ``YYYY-MM-DD.packet.json`` or ``YYYY-MM-DD-HHMM.packet.json``.
    When a time suffix is present we convert it to seconds so that later updates on
    the same ``as_of`` date win. Files without a suffix sort first (bucket ``-1``).
    """

    if not filename.endswith(PACKET_SUFFIX):
        return -1
    stem = filename[: -len(PACKET_SUFFIX)]
    parts = stem.split("-")
    if len(parts) <= 3:
        return -1
    candidate = "".join(parts[3:])
    if not candidate.isdigit():
        return -1

    try:
        if len(candidate) == 4:
            hours = int(candidate[:2])
            minutes = int(candidate[2:])
            seconds = 0
        elif len(candidate) == 6:
            hours = int(candidate[:2])
            minutes = int(candidate[2:4])
            seconds = int(candidate[4:])
        else:
            return -1
    except ValueError:
        return -1

    if not (0 <= hours < 24 and 0 <= minutes < 60 and 0 <= seconds < 60):
        return -1
    return hours * 3600 + minutes * 60 + seconds


def packet_selection_key(path: Path, as_of_ord: int) -> Tuple[int, int, int, str]:
    try:
        mtime_ns = path.stat().st_mtime_ns
    except OSError:
        mtime_ns = -1
    time_bucket = extract_packet_time_bucket(path.name)
    return (as_of_ord, time_bucket, mtime_ns, path.name)


def select_latest_packet(packets: Iterable[Path]) -> Tuple[Path, Dict[str, Any]]:
    best: Optional[Tuple[Tuple[int, int, int, str], Path, Dict[str, Any]]] = None
    errors: List[str] = []
    for path in sorted(packets):
        try:
            with path.open("r", encoding="utf-8") as fh:
                packet = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{path.name}: {exc}")
            print(f"Skipping {path.name}: {exc}", file=sys.stderr)
            continue

        as_of = str(packet.get("as_of", "")).strip()
        if not as_of:
            errors.append(f"{path.name}: missing as_of")
            print(f"Skipping {path.name}: missing as_of", file=sys.stderr)
            continue

        try:
            as_of_ord = parse_date(as_of).toordinal()
        except ValueError:
            errors.append(f"{path.name}: invalid as_of '{as_of}'")
            print(f"Skipping {path.name}: invalid as_of '{as_of}'", file=sys.stderr)
            continue

        key = packet_selection_key(path, as_of_ord)
        if best is None or key > best[0]:
            best = (key, path, packet)

    if best is None:
        if errors:
            raise RuntimeError(
                "No usable packet found; encountered errors: " + "; ".join(errors)
            )
        raise RuntimeError("No usable packet found")

    _, latest_path, latest_packet = best
    return latest_path, latest_packet


def ensure_registry_structure(registry: Dict[str, Any]) -> None:
    registry.setdefault("version", 1)
    registry.setdefault("last_rebuild", None)
    registry.setdefault("events", [])


def dedupe_list(values: Iterable[str]) -> List[str]:
    seen = set()
    result: List[str] = []
    for item in values:
        key = str(item).strip()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(key)
    return result


def _event_date_value(value: Optional[str]) -> int:
    if not value:
        return -1
    try:
        return parse_date(value).toordinal()
    except ValueError:
        return -1


def dedupe_registry_events(
    events: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    events_by_fp: Dict[str, Dict[str, Any]] = {}
    deduped: List[Dict[str, Any]] = []

    def sort_key(event: Dict[str, Any]) -> Tuple[int, int, str]:
        first_seen = _event_date_value(event.get("first_seen"))
        last_updated = _event_date_value(event.get("last_updated"))
        uid = str(event.get("uid") or "")
        return (first_seen, last_updated, uid)

    for event in sorted(events, key=sort_key):
        canonical_fields = canonicalize_fingerprint_fields(event.get("fingerprint_fields") or {})
        fingerprint = compute_fingerprint(canonical_fields)
        event["fingerprint_fields"] = canonical_fields
        event["fingerprint"] = fingerprint

        existing = events_by_fp.get(fingerprint)
        if existing is None:
            events_by_fp[fingerprint] = event
            deduped.append(event)
            continue

        first_seen = event.get("first_seen")
        if first_seen and (
            not existing.get("first_seen") or first_seen < existing["first_seen"]
        ):
            existing["first_seen"] = first_seen

        history_entries: Dict[str, Dict[str, Any]] = {
            entry.get("date"): entry
            for entry in existing.get("history") or []
            if entry.get("date")
        }
        for entry in event.get("history") or []:
            date_key = entry.get("date")
            if not date_key:
                continue
            history_entries[date_key] = entry
        existing["history"] = sorted(
            history_entries.values(),
            key=lambda item: item.get("date"),
        )

        article_history_entries: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
        for entry in existing.get("article_history") or []:
            key = (
                str(entry.get("date") or ""),
                str(entry.get("title") or ""),
                str(entry.get("source") or ""),
            )
            article_history_entries[key] = entry
        for entry in event.get("article_history") or []:
            key = (
                str(entry.get("date") or ""),
                str(entry.get("title") or ""),
                str(entry.get("source") or ""),
            )
            article_history_entries[key] = entry
        existing["article_history"] = sorted(
            article_history_entries.values(),
            key=lambda item: (item.get("date"), item.get("title") or ""),
        )

        incoming_last = _event_date_value(event.get("last_updated"))
        existing_last = _event_date_value(existing.get("last_updated"))
        is_newer = incoming_last > existing_last or not existing.get("last_updated")
        as_of = (
            (event.get("last_updated") if is_newer and event.get("last_updated") else None)
            or existing.get("last_updated")
            or event.get("last_updated")
            or event.get("first_seen")
            or existing.get("first_seen")
            or ""
        )
        payload = {
            "cluster": event.get("cluster") or existing.get("cluster"),
            "event_type": event.get("event_type") or existing.get("event_type"),
            "title": event.get("title") or existing.get("title"),
            "phase": (event.get("phase") if is_newer and event.get("phase") else existing.get("phase")),
            "score": (
                event.get("score")
                if is_newer and event.get("score") is not None
                else existing.get("score")
            ),
            "confidence": (
                event.get("confidence")
                if is_newer and event.get("confidence")
                else existing.get("confidence")
            ),
            "indicators": event.get("indicators"),
            "tripwires": event.get("tripwires"),
            "rationale": event.get("rationale"),
            "sources": event.get("sources"),
        }
        merge_event(existing, payload, canonical_fields, fingerprint, as_of)

    deduped.sort(key=lambda item: _event_date_value(item.get("last_updated")), reverse=True)
    return deduped, events_by_fp


def merge_event(
    registry_event: Dict[str, Any],
    update: Dict[str, Any],
    canonical_fields: Dict[str, Any],
    fingerprint: str,
    as_of: str,
) -> None:
    registry_event["fingerprint"] = fingerprint
    registry_event["fingerprint_fields"] = canonical_fields
    registry_event["cluster"] = update.get("cluster") or canonical_fields.get("cluster")
    registry_event["event_type"] = update.get("event_type") or canonical_fields.get("event_type")
    registry_event["title"] = str(update.get("title", "")).strip()
    registry_event["phase"] = str(update.get("phase", "")).strip()
    registry_event["confidence"] = str(update.get("confidence", "")).strip()
    registry_event["score"] = clamp_score(update.get("score"))

    canonical_source = canonical_fields.get("canonical_source")
    if canonical_source:
        registry_event["canonical_source"] = canonical_source

    indicators = registry_event.get("indicators", {}) or {}
    indicators.update(update.get("indicators") or {})
    registry_event["indicators"] = indicators

    existing_tripwires = registry_event.get("tripwires", []) or []
    combined_tripwires = existing_tripwires + list(update.get("tripwires") or [])
    registry_event["tripwires"] = dedupe_list(combined_tripwires)

    existing_rationale = registry_event.get("rationale", []) or []
    combined_rationale = existing_rationale + [str(item).strip() for item in update.get("rationale") or []]
    registry_event["rationale"] = dedupe_list(filter(None, combined_rationale))

    new_sources = [canonicalize_url(str(item)) for item in update.get("sources") or []]
    if canonical_source:
        new_sources.append(canonical_source)
    existing_sources = [canonicalize_url(str(item)) for item in registry_event.get("sources", [])]
    registry_event["sources"] = dedupe_list(existing_sources + new_sources)

    registry_event["last_updated"] = as_of

    history = registry_event.get("history") or []
    entry = {"date": as_of, "score": registry_event["score"]}
    if history and history[-1].get("date") == as_of:
        history[-1] = entry
    else:
        history.append(entry)
    registry_event["history"] = history

    article_history = registry_event.get("article_history") or []
    article_entry = {
        "date": as_of,
        "title": registry_event.get("title"),
        "score": registry_event["score"],
        "source": canonical_source,
        "sources": dedupe_list(new_sources),
    }
    if article_history and article_history[-1].get("date") == as_of:
        article_history[-1] = article_entry
    else:
        article_history.append(article_entry)
    registry_event["article_history"] = article_history


def create_event(
    canonical_fields: Dict[str, Any],
    fingerprint: str,
    update: Dict[str, Any],
    as_of: str,
) -> Dict[str, Any]:
    cluster_key = canonical_fields.get("cluster") or "event"
    uid_suffix = fingerprint.split(":", 1)[-1][-12:]
    uid = f"{cluster_key or 'event'}-{uid_suffix}".replace(" ", "-")
    event = {
        "uid": uid,
        "fingerprint": fingerprint,
        "fingerprint_fields": canonical_fields,
        "cluster": update.get("cluster") or canonical_fields.get("cluster"),
        "event_type": update.get("event_type") or canonical_fields.get("event_type"),
        "title": str(update.get("title", "")).strip(),
        "phase": str(update.get("phase", "")).strip(),
        "score": clamp_score(update.get("score")),
        "confidence": str(update.get("confidence", "")).strip(),
        "indicators": update.get("indicators") or {},
        "tripwires": dedupe_list(update.get("tripwires") or []),
        "rationale": dedupe_list([str(item).strip() for item in update.get("rationale") or []]),
        "sources": dedupe_list(
            [
                canonicalize_url(str(item))
                for item in (update.get("sources") or [])
            ]
            + ([canonical_fields.get("canonical_source")] if canonical_fields.get("canonical_source") else [])
        ),
        "first_seen": as_of,
        "last_updated": as_of,
        "history": [{"date": as_of, "score": clamp_score(update.get("score"))}],
    }
    if canonical_fields.get("canonical_source"):
        event["canonical_source"] = canonical_fields["canonical_source"]

    event["article_history"] = [
        {
            "date": as_of,
            "title": event["title"],
            "score": event["score"],
            "source": canonical_fields.get("canonical_source"),
            "sources": event["sources"],
        }
    ]
    return event


def apply_decay(events: List[Dict[str, Any]], as_of: str) -> None:
    as_of_date = parse_date(as_of)
    for event in events:
        phase = (event.get("phase") or "").strip().lower()
        if phase not in WATCH_PHASES:
            continue
        last_updated = event.get("last_updated")
        if not last_updated:
            continue
        try:
            last_date = parse_date(last_updated)
        except ValueError:
            continue
        delta = (as_of_date - last_date).days
        if delta <= 7:
            continue
        old_score = clamp_score(event.get("score"))
        new_score = max(0.0, min(100.0, old_score - (delta - 7) * 3))
        if new_score == old_score:
            continue
        event["score"] = new_score
        history = event.get("history") or []
        decay_entry = {"date": as_of, "score": new_score}
        if history and history[-1].get("date") == as_of:
            history[-1] = decay_entry
        else:
            history.append(decay_entry)
        event["history"] = history


def build_leaderboard(events: List[Dict[str, Any]], as_of: str) -> Dict[str, Any]:
    candidates = []
    for event in events:
        if (event.get("phase") or "").strip().lower() not in WATCH_PHASES:
            continue
        candidates.append(event)

    def sort_key(item: Dict[str, Any]) -> Any:
        score = clamp_score(item.get("score"))
        confidence = (item.get("confidence") or "").strip().lower()
        confidence_rank = CONFIDENCE_ORDER.get(confidence, 0)
        last_updated = item.get("last_updated")
        try:
            last_date = parse_date(last_updated) if last_updated else date.min
        except ValueError:
            last_date = date.min
        return (-score, -confidence_rank, -last_date.toordinal())

    top_events: List[Dict[str, Any]] = []
    seen_fingerprints: Set[str] = set()
    seen_titles: Set[str] = set()
    for event in sorted(candidates, key=sort_key):
        fingerprint = event.get("fingerprint")
        if fingerprint and fingerprint in seen_fingerprints:
            continue

        title = normalize_token(event.get("title"), case="lower") if event.get("title") else ""
        cluster = normalize_token(
            event.get("cluster"), case="lower", collapse_delimiters=False
        )
        title_key = f"{cluster}:{title}" if title else ""
        if title_key and title_key in seen_titles:
            continue

        top_events.append(event)
        if fingerprint:
            seen_fingerprints.add(fingerprint)
        elif event.get("uid"):
            seen_fingerprints.add(str(event.get("uid")))
        elif event:
            seen_fingerprints.add(json.dumps(event, sort_keys=True))
        if title_key:
            seen_titles.add(title_key)
        if len(top_events) >= 10:
            break
    risks = []
    for event in top_events:
        sources = event.get("sources") or []
        risks.append(
            {
                "id": event.get("uid"),
                "name": event.get("title"),
                "score": clamp_score(event.get("score")),
                "phase": event.get("phase"),
                "last_updated": event.get("last_updated"),
                "cluster": event.get("cluster"),
                "sources": sources[:4],
            }
        )
    return {
        "as_of": as_of,
        "note": "Scores 0–100; 50 baseline",
        "risks": risks,
    }


def write_post(post_payload: Dict[str, Any], as_of: Optional[str]) -> Optional[Path]:
    slug = slugify(str(post_payload.get("slug") or post_payload.get("title") or "post"))
    if not slug:
        return None
    fmt = (post_payload.get("format") or "md").strip().lower()
    content = post_payload.get("content") or ""

    if fmt != "html":
        dest = repo_root() / "posts" / f"{slug}.md"
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open("w", encoding="utf-8") as fh:
            fh.write(str(content))
        return dest

    title = str(post_payload.get("title") or slug.replace("-", " ").title())
    summary = extract_text_summary(str(content), fallback=title)
    page = render_post_page(
        title,
        str(content),
        as_of=as_of,
        description=summary,
        phase=None,
        cluster=None,
        event_type=None,
        confidence=None,
        score=None,
    )

    dest = repo_root() / "posts" / f"{slug}.html"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", encoding="utf-8") as fh:
        fh.write(page)
    return dest


def ingest_latest_packet() -> None:
    root = repo_root()
    llm_dir = root / "data" / "llm"
    if not llm_dir.exists():
        return
    packets = list(llm_dir.glob("*.packet.json"))
    if not packets:
        return
    latest_packet_path, packet = select_latest_packet(packets)

    missing = REQUIRED_PACKET_KEYS - packet.keys()
    if missing:
        raise ValueError(f"Packet is missing required keys: {', '.join(sorted(missing))}")

    as_of = str(packet["as_of"]).strip()
    if not as_of:
        raise ValueError("Packet as_of is required")

    events_path = root / "data" / "events.json"
    registry = load_json(events_path, {"version": 1, "last_rebuild": None, "events": []})
    ensure_registry_structure(registry)

    events = registry["events"]
    deduped_events, events_by_fp = dedupe_registry_events(events)
    registry["events"] = deduped_events
    events = deduped_events

    resolved_by_uid: Dict[str, Dict[str, Any]] = {}
    resolved_by_slug: Dict[str, Dict[str, Any]] = {}

    for update in packet.get("events_update") or []:
        fields = update.get("fingerprint_fields") or {}
        canonical_fields = canonicalize_fingerprint_fields(fields)
        fingerprint = compute_fingerprint(canonical_fields)
        existing = events_by_fp.get(fingerprint)

        if existing is None:
            similar = find_similar_event(
                canonical_fields,
                events_by_fp,
                title=update.get("title"),
            )
            if similar:
                candidate, score = similar
                merged_fields = merge_canonical_field_sets(
                    candidate.get("fingerprint_fields") or {}, canonical_fields
                )
                new_fingerprint = compute_fingerprint(merged_fields)
                old_fingerprint = candidate.get("fingerprint")
                if (
                    old_fingerprint
                    and old_fingerprint in events_by_fp
                    and events_by_fp[old_fingerprint] is candidate
                    and old_fingerprint != new_fingerprint
                ):
                    del events_by_fp[old_fingerprint]
                canonical_fields = merged_fields
                fingerprint = new_fingerprint
                existing = candidate
                events_by_fp[fingerprint] = existing
                print(
                    "Fuzzy-matched update '{title}' to existing event {uid} (score {score:.2f})".format(
                        title=str(update.get("title") or "").strip() or "(untitled)",
                        uid=candidate.get("uid") or candidate.get("fingerprint") or "unknown",
                        score=score,
                    ),
                    file=sys.stderr,
                )

        payload = {
            "cluster": fields.get("cluster"),
            "event_type": fields.get("event_type"),
            "title": update.get("title"),
            "phase": update.get("phase"),
            "score": update.get("score"),
            "confidence": update.get("confidence"),
            "indicators": update.get("indicators"),
            "tripwires": update.get("tripwires"),
            "rationale": update.get("rationale"),
            "sources": update.get("sources"),
        }
        if existing:
            merge_event(existing, payload, canonical_fields, fingerprint, as_of)
            target_event = existing
        else:
            new_event = create_event(canonical_fields, fingerprint, payload, as_of)
            events.append(new_event)
            events_by_fp[fingerprint] = new_event
            target_event = new_event

        uid_key = str(update.get("uid") or "").strip()
        if uid_key and target_event:
            resolved_by_uid[uid_key] = target_event

        brief = update.get("brief") or {}
        slug_hint = slugify(brief.get("slug") or brief.get("title") or update.get("title") or "")
        if slug_hint and target_event:
            resolved_by_slug[slug_hint] = target_event

    apply_decay(events, as_of)

    leaderboard = build_leaderboard(events, as_of)
    dump_json(root / "data" / "leaderboard.json", leaderboard)

    write_post(packet.get("post") or {}, as_of)

    collect_and_write_briefings(
        packet,
        events_by_fp,
        resolved_by_uid=resolved_by_uid,
        resolved_by_slug=resolved_by_slug,
    )

    registry["last_rebuild"] = as_of
    dump_json(events_path, registry)


if __name__ == "__main__":
    try:
        ingest_latest_packet()
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        raise
