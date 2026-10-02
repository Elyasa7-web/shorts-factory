"""Story Shorts, step 3: narrate every scene, build the timeline, mix voice + music + effects.

Reads data/story-props.json (scenes with text), writes out/narration.m4a and updates
data/story-props.json with per-scene `seconds` and per-word timings used for the captions.
Voice providers and their fallbacks are shared with scripts/narrate.py.
"""
import json
import os
import re
import sys
from pathlib import Path

import narrate as N            # PROVIDERS, probe(), run() ...


def word_timings(text: str, duration: float):
    """Spread the words over the audio, weighting by length and pausing after punctuation.
    Natural voices follow this closely enough for 3-4 word caption chunks."""
    words = text.split()
    weights = []
    for w in words:
        wt = len(re.sub(r"\W", "", w)) + 1.5
        if w.endswith((".", "!", "?")):
            wt += 4
        elif w.endswith((",", ";", ":")):
            wt += 2
        weights.append(wt)
    total = sum(weights) or 1.0
    t, out = 0.0, []
    for w, wt in zip(words, weights):
        span = duration * wt / total
        out.append({"w": w, "s": round(t, 3), "e": round(t + span, 3)})
        t += span
    return out


def main():
    pp = Path("data/story-props.json")
    props = json.loads(pp.read_text(encoding="utf-8"))
    scenes = props["scenes"]
    out = Path("out")
    out.mkdir(exist_ok=True)

    voices, used, errors = [], None, []
    for name in os.environ.get("TTS_ORDER", "gemini,elevenlabs,edge,espeak").split(","):
        env_key, fn = N.PROVIDERS[name.strip()]
        if env_key and not os.environ.get(env_key):
            errors.append(f"{name}: no {env_key}")
            continue
        try:
            voices = []
            for k, sc in enumerate(scenes):
                p = out / f"seg{k}.mp3"
                fn(sc["text"], p)
                voices.append((p, N.probe(p)))
                print(f"  voice {sc['kind']}: {voices[-1][1]:.1f}s <- {sc['text'][:60]}")
            spoken = sum(d for _, d in voices)
            if spoken > 52 and name.strip() != os.environ.get("TTS_ORDER", "gemini,elevenlabs,edge,espeak").split(",")[-1].strip():
                raise RuntimeError(f"voice too slow ({spoken:.0f}s of speech for a Short)")
            used = name
            break
        except Exception as e:
            errors.append(f"{name}: {e}")
            for f in out.glob("seg*"):
                f.unlink(missing_ok=True)
    if not used:
        print("All voice providers failed:\n  " + "\n  ".join(errors), file=sys.stderr)
        sys.exit(1)
    for e in errors:
        print(f"voice fallback reason -> {e}", file=sys.stderr)
    print(f"voice provider: {used}")

    # scene length follows the voice: tight cuts keep the pace high
    pad = {"hook": 0.25, "beat": 0.35, "payoff": 0.45, "cta": 0.7}
    floor = {"hook": 2.4, "beat": 3.4, "payoff": 2.8, "cta": 2.2}
    seconds = [max(floor[sc["kind"]], d + pad[sc["kind"]]) for sc, (_, d) in zip(scenes, voices)]
    starts = [sum(seconds[:i]) for i in range(len(seconds))]
    total = sum(seconds)

    for sc, (p, d), sec in zip(scenes, voices, seconds):
        sc["seconds"] = round(sec, 2)
        sc["words"] = word_timings(sc["text"], d)
    props["totalSeconds"] = round(total, 2)
    pp.write_text(json.dumps(props), encoding="utf-8")
    print(f"timeline: {[round(x, 1) for x in seconds]} = {total:.1f}s")

    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    filt, labels = [], []
    for k, ((p, d), st) in enumerate(zip(voices, starts)):
        cmd += ["-i", str(p)]
        ms = int((st + 0.05) * 1000)
        filt.append(f"[{k}:a]adelay={ms}|{ms}[a{k}]")
        labels.append(f"[a{k}]")
    filt.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0,apad=whole_dur={total:.2f},atrim=0:{total:.2f}[out]")
    cmd += ["-filter_complex", ";".join(filt), "-map", "[out]", "-c:a", "aac", "-b:a", "128k", str(out / "narration.m4a")]
    N.run(cmd)
    for p, _ in voices:
        p.unlink(missing_ok=True)

    # music + effects: a cut sound on every scene change, an impact on the payoff
    events = [("whoosh", starts[i]) for i in range(1, len(scenes))]
    for i, sc in enumerate(scenes):
        if sc["kind"] == "payoff":
            events.append(("boom", starts[i]))
        if sc["kind"] == "cta":
            events.append(("ding", starts[i]))
    mixed = out / "mixed.m4a"
    used_music = None
    try:
        from audio_library import mix
        used_music = mix(out / "narration.m4a", mixed, total, events)
    except Exception as e:
        print(f"library mix failed ({e}); keeping the plain voice track", file=sys.stderr)
    if used_music:
        mixed.replace(out / "narration.m4a")
    print(f"narration ok (music: {used_music})")


if __name__ == "__main__":
    main()
