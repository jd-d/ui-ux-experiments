#!/usr/bin/env python3
import json, re, sys, argparse

VALID_PHASE = {"watch","elevated","critical"}
VALID_CONF = {"high","medium","low"}

ALLOWED_TAGS = {"h1","h2","h3","h4","p","ul","ol","li","strong","em","blockquote","hr","code","pre","figure","figcaption","a","small","aside"}

def slugify(text: str) -> str:
    s = (text or "").lower()
    s = re.sub(r"[^a-z0-9_\- ]+", "", s)
    s = re.sub(r"\s+", "-", s.strip())
    return s or "post"

def sanitize_html(html_str: str) -> str:
    # very light allowlist: strip disallowed tags and risky attrs
    def repl_tag(m):
        tagname = m.group(1).lower().strip("/")
        if tagname in ALLOWED_TAGS:
            tagtxt = re.sub(r"\son\w+\s*=\s*(['\"]).*?\1", "", m.group(0), flags=re.I)
            tagtxt = re.sub(r"\sstyle\s*=\s*(['\"]).*?\1", "", tagtxt, flags=re.I)
            return tagtxt
        return ""
    return re.sub(r"<\s*/?\s*([a-zA-Z0-9:_-]+)([^>]*)>", repl_tag, html_str)


def fix_packet_text(s: str) -> str:
    s = re.sub(r'("score"\s*:\s*)Fifty(\s*[,}])', r'\g<1>50\2', s, flags=re.I)
    s = re.sub(r'(:\s*)(\d+)\+(\s*[,}])', r'\1\2\3', s)
    return s

def strip_markdown_link(u: str) -> str:
    m = re.match(r'\s*\[.*?\]\((.*?)\)\s*', u)
    if m: return m.group(1)
    m = re.match(r'https?:///\s*\[.*?\]\((.*?)\)\s*', u)
    if m: return m.group(1)
    return u

def clamp_score(x):
    try:
        return max(0.0, min(100.0, float(x)))
    except Exception:
        return 50.0

def validate_and_fix(obj: dict) -> dict:
    # ensure required keys exist
    for k in ["as_of","clusters","events_update","post"]:
        if k not in obj:
            raise ValueError(f"Missing required top-level key: {k}")
    # fix events
    as_of = str(obj.get("as_of") or "").strip()
    evs = obj.get("events_update") or []
    for ev in evs:
        ph = (ev.get("phase") or "").strip().lower()
        ev["phase"] = ph if ph in VALID_PHASE else "watch"
        cf = (ev.get("confidence") or "").strip().lower()
        ev["confidence"] = cf if cf in VALID_CONF else "medium"
        ev["score"] = clamp_score(ev.get("score"))
        # uid
        if not ev.get("uid"):
            cluster = ((ev.get("fingerprint_fields") or {}).get("cluster")) or (ev.get("cluster") or "risk")
            title = ev.get("title") or "event"
            ev["uid"] = f"{str(cluster).lower()}__{slugify(title)}__{as_of}"
        if isinstance(ev.get("sources"), list):
            ev["sources"] = [strip_markdown_link(str(s)) for s in ev["sources"]]
        brief = ev.get("brief") or {}
        if brief:
            brief["slug"] = slugify(brief.get("slug") or brief.get("title") or ev.get("title") or "")
            brief["title"] = brief.get("title") or ev.get("title") or ""
            brief["format"] = "html"
            content = brief.get("content") or ""
            if re.search(r"\b(we|our)\b", content, flags=re.I):
                content = re.sub(r"\b(we|our)\b", "the analysis", content, flags=re.I)
            brief["content"] = sanitize_html(content)
            ev["brief"] = brief
        ev["score"] = clamp_score(ev.get("score"))
        if isinstance(ev.get("sources"), list):
            ev["sources"] = [strip_markdown_link(str(s)) for s in ev["sources"]]
    # fix clusters' sources (optional)
    for cl in obj.get("clusters") or []:
        if isinstance(cl.get("sources"), list):
            cl["sources"] = [strip_markdown_link(str(s)) for s in cl["sources"]]
    # post format
    post = obj.get("post") or {}
    fmt = (post.get("format") or "md").strip().lower()
    post["format"] = fmt if fmt in ("html","md","markdown") else "md"
    obj["post"] = post

    # Ensure top-level 'briefings' mirrors event briefs
    briefs = []
    for ev in obj.get("events_update") or []:
        b = ev.get("brief")
        if not b:
            continue
        briefs.append({
            "event_uid": ev.get("uid"),
            "slug": b.get("slug"),
            "title": b.get("title") or ev.get("title"),
            "cluster": (ev.get("fingerprint_fields") or {}).get("cluster") or ev.get("cluster"),
            "format": "html",
            "content": b.get("content") or ""
        })
    if briefs:
        obj["briefings"] = briefs
    return obj

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="Deep Research JSON packet")
    ap.add_argument("-o","--output", help="Where to write the fixed packet (default: stdout)")
    args = ap.parse_args()

    raw = open(args.input, encoding="utf-8").read()
    raw = fix_packet_text(raw)
    obj = json.loads(raw)
    obj = validate_and_fix(obj)

    payload = json.dumps(obj, indent=2, ensure_ascii=False)
    if args.output:
        open(args.output, "w", encoding="utf-8").write(payload + "\n")
    else:
        sys.stdout.write(payload + "\n")

if __name__ == "__main__":
    main()
