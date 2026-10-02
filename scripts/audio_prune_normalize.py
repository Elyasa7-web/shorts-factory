"""Prunes the curated Freesound library to hand-picked sounds and normalises levels.
Music is loudness-normalised (consistent bed under the voice); effects are peak-normalised.
usage: python scripts/audio_prune_normalize.py
"""
import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path("assets/audio")
# Chosen from the titles/popularity of the CC0 candidates; anything that is not clearly
# usable background music or a clean effect (water, sweeping, choir, cow bells, drawers...) is dropped.
KEEP_MUSIC = {410520, 561190, 333795, 659705, 223442, 475870, 529624}
DROP_SFX = {481151, 481433, 648960, 464422, 826212, 535615, 541985}


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def peak_gain(path):
    r = run(["ffmpeg", "-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"])
    m = re.search(r"max_volume: (-?[\d.]+) dB", r.stderr)
    return (-3.0 - float(m.group(1))) if m else 0.0


def main():
    m = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    m["music"] = [x for x in m["music"] if x["id"] in KEEP_MUSIC]
    for k, v in m["sfx"].items():
        m["sfx"][k] = [x for x in v if x["id"] not in DROP_SFX]
    keep = {x["file"] for x in m["music"]} | {x["file"] for v in m["sfx"].values() for x in v}
    for f in ROOT.rglob("*.mp3"):
        if f.as_posix() not in keep:
            f.unlink()

    for x in m["music"]:
        tmp = x["file"] + ".tmp.mp3"
        r = run(["ffmpeg", "-y", "-loglevel", "error", "-i", x["file"], "-af", "loudnorm=I=-18:TP=-2:LRA=9",
                 "-ar", "44100", "-ac", "2", "-b:a", "160k", tmp])
        if r.returncode == 0:
            os.replace(tmp, x["file"])
    for v in m["sfx"].values():
        for x in v:
            g = peak_gain(x["file"])
            tmp = x["file"] + ".tmp.mp3"
            r = run(["ffmpeg", "-y", "-loglevel", "error", "-i", x["file"], "-af", f"volume={g:.1f}dB",
                     "-ar", "44100", "-ac", "2", "-b:a", "160k", tmp])
            if r.returncode == 0:
                os.replace(tmp, x["file"])

    (ROOT / "manifest.json").write_text(json.dumps(m, indent=1), encoding="utf-8")
    print("music", len(m["music"]), "sfx", {k: len(v) for k, v in m["sfx"].items()})


if __name__ == "__main__":
    main()
