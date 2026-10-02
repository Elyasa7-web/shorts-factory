"""Mixes narration + a random CC0 music bed + CC0 sound effects (assets/audio, from Freesound).

A different track is picked for every video, so no two videos share the exact same soundscape.
Returns False if the library is missing so the caller can fall back to the synthetic audio."""
import json
import random
import subprocess
from pathlib import Path

ROOT = Path("assets/audio")
MUSIC_VOL = 0.14      # the voice must stay in front
SFX_GAIN = {"riser": 0.35, "whoosh": 0.55, "ding": 0.45, "boom": 0.8}
SFX_KINDS = {"whoosh": ["whoosh", "swoosh"], "ding": ["ding", "chime"], "boom": ["boom"], "riser": ["riser"]}


def load():
    try:
        return json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    except Exception:
        return None


def mix(narration: Path, out: Path, total: float, events) -> str | None:
    lib = load()
    if not lib or not lib.get("music"):
        return None
    rnd = random.Random()
    music = rnd.choice(lib["music"])
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(narration), "-stream_loop", "-1", "-i", music["file"]]
    filters = [
        "[0:a]volume=1.0[v]",
        f"[1:a]atrim=0:{total:.2f},asetpts=PTS-STARTPTS,afade=t=in:d=0.5,afade=t=out:st={max(0.0, total - 1.5):.2f}:d=1.5,"
        f"volume={MUSIC_VOL}[m]",
    ]
    labels = ["[v]", "[m]"]
    for k, (kind, at) in enumerate(events):
        pool = [x for g in SFX_KINDS[kind] for x in lib["sfx"].get(g, [])]
        if not pool:
            continue
        cmd += ["-i", rnd.choice(pool)["file"]]
        idx = len(labels)                                  # input index of this effect
        ms = int(at * 1000)
        filters.append(f"[{idx}:a]adelay={ms}|{ms},volume={SFX_GAIN[kind]}[s{k}]")
        labels.append(f"[s{k}]")
    filters.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:duration=first,alimiter=limit=0.95[o]")
    cmd += ["-filter_complex", ";".join(filters), "-map", "[o]", "-c:a", "aac", "-b:a", "160k", str(out)]
    subprocess.run(cmd, check=True)
    return f"{music['title']} (freesound {music['id']}, CC0)"
