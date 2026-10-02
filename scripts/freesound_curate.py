"""One-off curation tool: picks CC0 sounds from freesound.org and stores them in the repo.

Why a snapshot instead of calling Freesound while rendering?
  * the Freesound API needs an account/API key, the public website does not;
  * a fixed, license-checked library cannot break an unattended pipeline at 3 a.m.

Only sounds whose own page says "Creative Commons 0" are kept (no attribution needed,
commercial use allowed). Re-run this script to refresh the library.
usage: python scripts/freesound_curate.py
"""
import html, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path("assets/audio")
UA = {"User-Agent": "Mozilla/5.0 (shorts-factory curation, personal project)"}

MUSIC_QUERIES = [
    "upbeat background", "corporate background", "documentary background", "electronic loop",
    "lofi beat", "tech background", "energetic", "ambient uplifting", "cinematic background", "news background",
]
SFX_QUERIES = {
    "whoosh": ("whoosh", 0.3, 2.5, 6),
    "swoosh": ("swoosh transition", 0.3, 2.5, 4),
    "ding": ("ding notification", 0.3, 3.0, 5),
    "chime": ("success chime", 0.5, 3.0, 4),
    "boom": ("boom impact", 0.5, 4.0, 5),
    "riser": ("riser", 1.5, 6.0, 3),
}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read()


def search(query, lo, hi):
    f = f'duration:[{lo} TO {hi}] license:"Creative Commons 0"'
    url = "https://freesound.org/search/?" + urllib.parse.urlencode({"q": query, "f": f, "s": "downloads desc", "g": 1})
    page = get(url).decode("utf-8", "replace")
    out = []
    for block in re.split(r'<div[^>]*class="[^"]*bw-search__result[^"]*"[^>]*>', page)[1:]:
        m = re.search(r'data-sound-id="(\d+)"\s+data-username="([^"]+)".*?data-mp3="([^"]+)".*?data-title="([^"]*)"\s+data-duration="([\d.]+)".*?data-num-downloads="(\d+)"', block, re.S)
        if m:
            sid, user, mp3, title, dur, dl = m.groups()
            out.append({"id": int(sid), "user": user, "title": html.unescape(title), "duration": float(dur),
                        "downloads": int(dl), "mp3": mp3.replace("-lq.mp3", "-hq.mp3")})
    return out


def verify_cc0(item):
    """The search filter is trusted, but the license is re-read from the sound's own page."""
    page = get(f"https://freesound.org/people/{item['user']}/sounds/{item['id']}/").decode("utf-8", "replace")
    return "Creative Commons 0" in page or "creativecommons.org/publicdomain/zero" in page


def collect(queries, lo, hi, per_query):
    chosen, seen = [], set()
    for q in queries:
        n = 0
        for it in search(q, lo, hi):
            if it["id"] in seen:
                continue
            time.sleep(0.8)
            if not verify_cc0(it):
                continue
            seen.add(it["id"])
            it["query"] = q
            chosen.append(it)
            n += 1
            if n >= per_query:
                break
        time.sleep(0.8)
    return chosen


def download(items, folder):
    folder.mkdir(parents=True, exist_ok=True)
    kept = []
    for it in items:
        dest = folder / f"{it['id']}.mp3"
        try:
            if not dest.exists():
                dest.write_bytes(get(it["mp3"]))
            it["file"] = str(dest).replace("\\", "/")
            kept.append(it)
            print(f"  ok {it['id']:>8} {it['duration']:6.1f}s {it['downloads']:>6} dl  {it['title'][:50]}")
        except Exception as e:                       # a missing HQ preview is not fatal
            print(f"  skip {it['id']}: {e}")
        time.sleep(0.5)
    return kept


def main():
    manifest = {"license": "Creative Commons 0 (CC0), verified per sound page", "music": [], "sfx": {}}
    print("music:")
    music = collect(MUSIC_QUERIES, 25, 90, 2)
    manifest["music"] = download(music[:16], ROOT / "music")
    for kind, (q, lo, hi, n) in SFX_QUERIES.items():
        print(f"sfx {kind}:")
        manifest["sfx"][kind] = download(collect([q], lo, hi, n), ROOT / "sfx" / kind)
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    total = len(manifest["music"]) + sum(len(v) for v in manifest["sfx"].values())
    print(f"saved {total} sounds -> {ROOT / 'manifest.json'}")


if __name__ == "__main__":
    sys.exit(main())
