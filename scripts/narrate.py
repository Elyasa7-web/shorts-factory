"""Builds out/narration.m4a from data/current.json.

Voice providers are tried in order (env TTS_ORDER, default "gemini,elevenlabs,edge,espeak"):
  gemini      GEMINI_API_KEY        free tier at aistudio.google.com  (model: GEMINI_TTS_MODEL)
  elevenlabs  ELEVENLABS_API_KEY    free tier ~10k credits/month       (voice: ELEVENLABS_VOICE_ID)
  edge        (no key)              Microsoft Edge voices, free, unofficial
  espeak      (no key, offline)     espeak-ng, robotic but cannot fail on network
The whole video uses ONE provider (no voice switching mid-video). If every provider
fails this script exits non-zero so the pipeline never publishes a silent video.

Each spoken segment is placed at the start of its on-screen slot so the voice stays in
sync with the Remotion timeline (hook 2.5s, items 5s each, outro 3s)."""
import asyncio, base64, json, os, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

HOOK_S, OUTRO_S = 2.5, 2.0
MAX_SPEEDUP = 1.1  # never speed the voice up more than 10% to fit a slot

UNIT_SPEECH = {
    "people": "people", "km": "kilometers", "m": "meters", "km²": "square kilometers",
    "people/km²": "people per square kilometer", "$ billion": "billion dollars",
    "$ per person": "dollars per person", "years": "years", "seats": "seats",
    "births per woman": "births per woman", "% per year": "percent per year",
    "deaths per 1,000 births": "deaths per thousand births",
    "phones per 100": "per hundred people", "% growth": "percent growth",
}

def unit_speech(u: str) -> str:
    if u in UNIT_SPEECH:
        return UNIT_SPEECH[u]
    if u.startswith("%"):
        return "percent" + (" " + u[1:].strip() if u[1:].strip() else "")
    return u

def fmt(v: float) -> str:
    return f"{v:,.2f}".rstrip("0").rstrip(".") if v != int(v) else f"{int(v):,}"

def run(cmd):
    subprocess.check_call(cmd)

def probe(path: Path) -> float:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)])
    return float(out.strip())

def post_json(url, payload, headers, retries=4):
    data = json.dumps(payload).encode()
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **headers})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            # A quota error means "no free quota left", retrying only wastes minutes: fail fast
            # so the next provider takes over. Transient 5xx errors are worth a short retry.
            transient = e.code in (500, 503) or (e.code == 429 and "quota" not in body.lower())
            if transient and attempt < retries - 1:
                time.sleep(8 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {e.code}: {body}")

# ---- providers: each takes (text, out_path_mp3) ------------------------------------

def tts_gemini(text: str, path: Path):
    key = os.environ["GEMINI_API_KEY"]
    model = os.environ.get("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")
    voice = os.environ.get("GEMINI_VOICE", "Kore")
    raw = post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        {
            "contents": [{"parts": [{"text": f"Say in a clear, friendly narrator voice at a calm, measured pace (never rushed): {text}"}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
            },
        },
        {"x-goog-api-key": key},
    )
    part = json.loads(raw)["candidates"][0]["content"]["parts"][0]["inlineData"]
    pcm = path.with_suffix(".pcm")
    pcm.write_bytes(base64.b64decode(part["data"]))   # 24 kHz, 16-bit, mono PCM
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1",
         "-i", str(pcm), str(path)])
    pcm.unlink(missing_ok=True)
    time.sleep(6)                                     # stay under the free-tier requests/minute

def tts_elevenlabs(text: str, path: Path):
    key = os.environ["ELEVENLABS_API_KEY"]
    voice = os.environ.get("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
    audio = post_json(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
        {"text": text, "model_id": "eleven_flash_v2_5"},
        {"xi-api-key": key},
    )
    path.write_bytes(audio)

def tts_espeak(text: str, path: Path):
    # Fully offline last resort (apt install espeak-ng): robotic, but it cannot fail on network.
    wav = path.with_suffix(".wav")
    run(["espeak-ng", "-v", "en-us", "-s", "155", "-w", str(wav), text])
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), str(path)])
    wav.unlink(missing_ok=True)

def tts_edge(text: str, path: Path):
    import edge_tts
    asyncio.run(edge_tts.Communicate(text, "en-US-AndrewNeural", rate=os.environ.get("VOICE_RATE", "-2%")).save(str(path)))

PROVIDERS = {
    "gemini": ("GEMINI_API_KEY", tts_gemini),
    "elevenlabs": ("ELEVENLABS_API_KEY", tts_elevenlabs),
    "edge": (None, tts_edge),
    "espeak": (None, tts_espeak),
}

# The voice sets the pace: every scene lasts as long as its narration needs, spoken at natural speed.
HOOK_MAX, OUTRO_MAX, ITEM_MAX_VOICE = 4.6, 3.6, 8.8     # longest narration we accept (seconds)
HOOK_MIN, OUTRO_MIN = 2.5, 2.0                           # shortest scene
ITEM_MIN_SLOT, ITEM_MAX_SLOT, PAD = 5.0, 10.5, 1.3        # per-country scene length bounds / breathing room

def candidates(props):
    """Narration texts per scene, richest first. The first one that fits is used, so a long
    sentence is shortened instead of being sped up."""
    items = props["items"]
    n = len(items)
    title = props["hook"]
    short_title = title.rsplit(" in ", 1)[0] if " in " in title else title
    hook = [title + ".", short_title + ".", "Top 5 countries. Number one might surprise you."]
    per_item = []
    for i, it in enumerate(items[::-1]):              # countdown: #N first
        rank = n - i
        value = f"{fmt(it['value'])} {unit_speech(it['unit'])}."
        facts = [f["say"].capitalize() + "." for f in (it.get("facts") or [])]
        head = f"Number {rank}. {it['label']}. {value}"
        c = []
        if facts:
            c.append(f"{head} {facts[0]}")
        c.append(head)
        c.append(f"{it['label']}. {value}")
        per_item.append(c)
    outro = [props["outro"] + " Tell us in the comments!", props["outro"]]
    return hook, per_item, outro

def synth_best(fn, cands, limit, path):
    """Synthesise candidates until one fits `limit` seconds; returns (text, seconds)."""
    text, dur = cands[0], 0.0
    for text in cands:
        fn(text, path)
        dur = probe(path)
        if dur <= limit:
            break
    return text, dur

def main():
    props = json.load(open("data/current.json", encoding="utf-8"))["props"]
    out = Path("out"); out.mkdir(exist_ok=True)
    hook_c, item_c, outro_c = candidates(props)

    voices, used, errors = [], None, []
    for name in os.environ.get("TTS_ORDER", "gemini,elevenlabs,edge,espeak").split(","):
        env_key, fn = PROVIDERS[name.strip()]
        if env_key and not os.environ.get(env_key):
            errors.append(f"{name}: no {env_key}")
            continue
        try:
            voices = []
            plan = [("hook", hook_c, HOOK_MAX)] + [(f"item{i}", c, ITEM_MAX_VOICE) for i, c in enumerate(item_c)] + [("outro", outro_c, OUTRO_MAX)]
            for k, (label, cands, limit) in enumerate(plan):
                p = out / f"seg{k}.mp3"
                text, dur = synth_best(fn, cands, limit, p)
                print(f"  voice {label}: {dur:.1f}s <- {text[:70]}")
                voices.append((p, dur))
            used = name
            break
        except Exception as e:                        # try the next provider for the WHOLE video
            errors.append(f"{name}: {e}")
            for f in out.glob("seg*"):
                f.unlink(missing_ok=True)
    if not used:
        print("All voice providers failed:\n  " + "\n  ".join(errors), file=sys.stderr)
        sys.exit(1)
    for e in errors:                                  # surface why earlier providers were skipped
        print(f"voice fallback reason -> {e}", file=sys.stderr)
    print(f"voice provider: {used}")

    # ---- timeline: scene lengths follow the narration ----
    hook_d, item_d, outro_d = voices[0][1], [v[1] for v in voices[1:-1]], voices[-1][1]
    hook_s = max(HOOK_MIN, hook_d + 0.3)
    slots = [min(ITEM_MAX_SLOT, max(ITEM_MIN_SLOT, d + PAD)) for d in item_d]
    outro_s = max(OUTRO_MIN, outro_d + 0.5)
    item_starts = [hook_s + sum(slots[:i]) for i in range(len(slots))]
    outro_start = hook_s + sum(slots)
    total = outro_start + outro_s

    # tell Remotion the same timeline
    pp = Path("data/props.json")
    pj = json.loads(pp.read_text(encoding="utf-8"))
    pj["durations"] = [round(x, 2) for x in slots]
    pj["hookSeconds"] = round(hook_s, 2)
    pj["outroSeconds"] = round(outro_s, 2)
    pp.write_text(json.dumps(pj), encoding="utf-8")
    print(f"timeline: hook {hook_s:.1f}s + items {[round(x, 1) for x in slots]} + outro {outro_s:.1f}s = {total:.1f}s")

    layout = [(0.0, hook_s, voices[0])] +              [(item_starts[i] + 0.3, slots[i] - 0.3, voices[i + 1]) for i in range(len(slots))] +              [(outro_start + 0.1, outro_s - 0.1, voices[-1])]
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    filt, labels = [], []
    for k, (start, room, (p, dur)) in enumerate(layout):
        cmd += ["-i", str(p)]
        tempo = min(max(1.0, dur / room), 1.15)       # only if a scene hit its maximum length
        ms = int(start * 1000)
        filt.append(f"[{k}:a]atempo={tempo:.3f},adelay={ms}|{ms}[a{k}]")
        labels.append(f"[a{k}]")
    filt.append("".join(labels) + f"amix=inputs={len(layout)}:normalize=0,apad=whole_dur={total},atrim=0:{total}[out]")
    cmd += ["-filter_complex", ";".join(filt), "-map", "[out]", "-c:a", "aac", "-b:a", "128k",
            str(out / "narration.m4a")]
    run(cmd)
    for p, _ in voices:
        p.unlink(missing_ok=True)

    # Music bed + sound effects timed to the on-screen reveals, mixed under the voice.
    from audio_fx import make_music, make_sfx, save_wav
    n_items = len(slots)
    events = [("riser", 0.0)]
    for i in range(n_items):
        events += [("whoosh", item_starts[i]), ("ding", item_starts[i] + 0.9)]
        if i == n_items - 1:                              # last reveal = rank #1
            events.append(("boom", item_starts[i]))
    events.append(("ding", outro_start))
    save_wav(out / "music.wav", make_music(total))
    save_wav(out / "sfx.wav", make_sfx(total, events))
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(out / "narration.m4a"),
         "-i", str(out / "music.wav"), "-i", str(out / "sfx.wav"),
         "-filter_complex",
         "[0:a]volume=1.0[v];[1:a]volume=0.20[m];[2:a]volume=0.5[s];"
         "[v][m][s]amix=inputs=3:normalize=0:duration=first,alimiter=limit=0.95[o]",
         "-map", "[o]", "-c:a", "aac", "-b:a", "160k", str(out / "mixed.m4a")])
    (out / "mixed.m4a").replace(out / "narration.m4a")
    for f in ("music.wav", "sfx.wav"):
        (out / f).unlink(missing_ok=True)
    print("narration ok (voice + music + sfx)")

if __name__ == "__main__":
    main()
