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

HOOK_S, OUTRO_S = 2.5, 3.0

UNIT_SPEECH = {
    "people": "people", "km": "kilometers", "m": "meters", "km²": "square kilometers",
    "people/km²": "people per square kilometer", "$ billion": "billion dollars",
    "$ per person": "dollars per person", "years": "years", "seats": "seats",
    "births per woman": "births per woman", "% per year": "percent per year",
    "deaths per 1,000 births": "deaths per thousand births",
    "phones per 100": "subscriptions per hundred people", "% growth": "percent growth",
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
            "contents": [{"parts": [{"text": f"Say in a clear, upbeat, energetic narrator voice: {text}"}]}],
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
    asyncio.run(edge_tts.Communicate(text, "en-US-AndrewNeural", rate="+8%").save(str(path)))

PROVIDERS = {
    "gemini": ("GEMINI_API_KEY", tts_gemini),
    "elevenlabs": ("ELEVENLABS_API_KEY", tts_elevenlabs),
    "edge": (None, tts_edge),
    "espeak": (None, tts_espeak),
}

def segments(props):
    items, slot = props["items"], props["secondsPerItem"]
    n = len(items)
    segs = [(0.0, HOOK_S, props["hook"] + ".")]
    for i, it in enumerate(items[::-1]):              # countdown: #N first
        rank = n - i
        text = f"Number {rank}. {it['label']}. {fmt(it['value'])} {unit_speech(it['unit'])}."
        segs.append((HOOK_S + i * slot + 0.3, slot - 0.4, text))
    segs.append((HOOK_S + n * slot, OUTRO_S, props["outro"] + "."))
    return segs, HOOK_S + n * slot + OUTRO_S

def main():
    props = json.load(open("data/current.json", encoding="utf-8"))["props"]
    segs, total = segments(props)
    out = Path("out"); out.mkdir(exist_ok=True)

    files, used, errors = [], None, []
    for name in os.environ.get("TTS_ORDER", "gemini,elevenlabs,edge,espeak").split(","):
        env_key, fn = PROVIDERS[name.strip()]
        if env_key and not os.environ.get(env_key):
            errors.append(f"{name}: no {env_key}")
            continue
        try:
            files = []
            for k, (start, maxlen, text) in enumerate(segs):
                p = out / f"seg{k}.mp3"
                fn(text, p)
                files.append((start, maxlen, p))
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

    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    filt, labels = [], []
    for k, (start, maxlen, p) in enumerate(files):
        cmd += ["-i", str(p)]
        tempo = min(max(1.0, probe(p) / maxlen), 1.6)  # squeeze long lines into their slot
        ms = int(start * 1000)
        filt.append(f"[{k}:a]atempo={tempo:.3f},adelay={ms}|{ms}[a{k}]")
        labels.append(f"[a{k}]")
    filt.append("".join(labels) + f"amix=inputs={len(files)}:normalize=0,apad=whole_dur={total},atrim=0:{total}[out]")
    cmd += ["-filter_complex", ";".join(filt), "-map", "[out]", "-c:a", "aac", "-b:a", "128k",
            str(out / "narration.m4a")]
    run(cmd)
    for _, _, p in files:
        p.unlink(missing_ok=True)
    print("narration ok")

if __name__ == "__main__":
    main()
