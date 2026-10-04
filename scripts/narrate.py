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
import asyncio, base64, json, os, re, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

LANG = os.environ.get("VOICE_LANG", "en")   # "tr" for Canlı Garaj; story_narrate.py sets it from the story props

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

_gemini_tts_models = None

def gemini_tts_models() -> list:
    """Model names are retired/renamed often: ask the API which TTS models exist (newest first)."""
    global _gemini_tts_models
    if os.environ.get("GEMINI_TTS_MODEL"):
        return [os.environ["GEMINI_TTS_MODEL"]]
    if _gemini_tts_models is None:
        found = []
        try:
            req = urllib.request.Request(
                "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
                headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]})
            with urllib.request.urlopen(req, timeout=30) as r:
                for m in json.loads(r.read()).get("models", []):
                    name = m["name"].replace("models/", "")
                    if "tts" in name and "generateContent" in m.get("supportedGenerationMethods", []):
                        found.append(name)
        except Exception as e:
            print(f"gemini tts model discovery failed: {e}", file=sys.stderr)
        def ver(n):
            mt = re.search(r"gemini-(\d+(?:\.\d+)?)", n)
            return float(mt.group(1)) if mt else 0.0
        found.sort(key=lambda n: (-ver(n), "preview" in n))
        _gemini_tts_models = (found[:3] or []) + ["gemini-2.5-flash-preview-tts"]
        print(f"gemini tts models: {_gemini_tts_models}", file=sys.stderr)
    return _gemini_tts_models

def gemini_prompt(text: str) -> str:
    if LANG == "tr":
        return ("Say the following in natural Turkish, in a clear, warm voice of a friendly garage master, at a relaxed "
                f"conversational pace (not slow, not rushed): {text}")
    return f"Say in a clear, friendly narrator voice at a natural, relaxed conversational pace, like a documentary narrator (not slow, not rushed): {text}"

def tts_gemini(text: str, path: Path):
    key = os.environ["GEMINI_API_KEY"]
    voice = os.environ.get("GEMINI_VOICE", "Kore")
    body = {
        "contents": [{"parts": [{"text": gemini_prompt(text)}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }
    part, last = None, None
    for model in gemini_tts_models():
        for attempt in range(2):   # a 200 reply without audio (safety/finish reason) is usually transient
            try:
                raw = post_json(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    body, {"x-goog-api-key": key})
                part = json.loads(raw)["candidates"][0]["content"]["parts"][0]["inlineData"]
                break
            except (KeyError, IndexError, TypeError) as e:
                last = RuntimeError(f"{model}: reply had no audio ({e!r})")
                time.sleep(3)
            except RuntimeError as e:
                last = e
                break              # HTTP error (404 retired / quota): try the next model
        if part:
            break
    if not part:
        raise last or RuntimeError("gemini tts: no model produced audio")
    pcm = path.with_suffix(".pcm")
    pcm.write_bytes(base64.b64decode(part["data"]))   # 24 kHz, 16-bit, mono PCM
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1",
         "-i", str(pcm), str(path)])
    pcm.unlink(missing_ok=True)
    tighten_speech(text, path, "gemini")
    time.sleep(6)                                     # stay under the free-tier requests/minute

def tighten_speech(text: str, path: Path, label: str = "voice"):
    """Normalise ANY provider to a natural documentary pace (~140 words/minute):
    cut leading/trailing/long inner silences, then speed a too-slow clip up (max x1.15) or slow a
    too-fast one down (min x0.85). Gemini 3.x pads and drags (8 words took 11 s); ElevenLabs flash
    reads ~215 words/minute, which sounds rushed on a Short."""
    tmp = path.with_name(path.stem + ".tight.mp3")
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-af",
         "silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.4:stop_threshold=-45dB:stop_silence=0.12",
         str(tmp)])
    d = probe(tmp)
    n = max(1, len(text.split()))
    spw = d / n                                   # seconds per word
    # natural narration: English ~0.42 s/word (143 wpm); Turkish words are longer, ~0.50 s/word (120 wpm)
    target, slow_above, fast_below = (0.50, 0.62, 0.38) if LANG == "tr" else (0.44, 0.53, 0.36)
    tempo = 1.0
    if spw > slow_above:
        tempo = min(1.15, spw / target)
    elif spw < fast_below:
        tempo = max(0.85, spw / (target - 0.02))
    if abs(tempo - 1.0) > 0.02:
        paced = path.with_name(path.stem + ".paced.mp3")
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp), "-af", f"atempo={tempo:.3f}", str(paced)])
        tmp.unlink(missing_ok=True)
        tmp = paced
        print(f"  {label} pace: {d:.1f}s for {n} words ({60 / max(spw, 0.01):.0f} wpm) -> x{tempo:.2f}", file=sys.stderr)
    tmp.replace(path)


# ---- Gemini: the WHOLE script in one call (natural flow, 1 request instead of 8), split at the pauses ----
def _silences(wav: Path, noise: str = "-36dB", dur: float = 0.25):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(wav), "-af", f"silencedetect=noise={noise}:d={dur}", "-f", "null", "-"],
                       capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    return [(a, b) for a, b in zip(starts, ends)]

def split_at_pauses(wav: Path, texts: list, out_dir: Path) -> list:
    """Cut one long recording into len(texts) pieces at the natural pauses nearest to where each scene should end
    (estimated from character counts). Falls back to the estimate itself when the voice did not pause."""
    total = probe(wav)
    sil = _silences(wav)
    lead = sil[0][1] if sil and sil[0][0] < 0.05 else 0.0
    trail = sil[-1][0] if sil and sil[-1][1] >= total - 0.05 else total
    speech = max(0.5, trail - lead)
    weights = [len(re.sub(r"\s+", "", t)) + 6 for t in texts]
    cum, acc = [], 0
    for w in weights:
        acc += w
        cum.append(acc / sum(weights))
    cuts, prev = [], lead
    for k in range(len(texts) - 1):
        expect = lead + cum[k] * speech
        window = 0.14 * speech
        cand = [(b - a, (a + b) / 2) for a, b in sil if abs((a + b) / 2 - expect) <= window and (a + b) / 2 > prev + 0.8]
        cut = max(cand)[1] if cand else expect       # the longest pause near the expected spot
        cut = max(cut, prev + 0.8)
        cuts.append(cut)
        prev = cut
    edges = [0.0] + cuts + [total]
    paths = []
    for k, text in enumerate(texts):
        seg = out_dir / f"seg{k}.mp3"
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-ss", f"{edges[k]:.3f}", "-to", f"{edges[k + 1]:.3f}",
             "-c:a", "libmp3lame", "-q:a", "3", str(seg)])
        tighten_speech(text, seg, "gemini")
        paths.append(seg)
    return paths

def tts_gemini_script(texts: list, out_dir: Path) -> list:
    key = os.environ["GEMINI_API_KEY"]
    voice = os.environ.get("GEMINI_VOICE", "Charon" if LANG == "tr" else "Kore")
    lang_name = "Turkish" if LANG == "tr" else "English"
    script = "\n\n".join(texts)
    prompt = (f"Read the following {lang_name} script aloud like a warm, expressive, knowledgeable garage master telling a story to a friend: "
              "natural human rhythm, relaxed conversational pace, gentle emphasis on the key words, a short pause of about one second "
              f"between paragraphs. Read only the script, add nothing:\n\n{script}")
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}},
    }
    part, last = None, None
    for model in gemini_tts_models():
        for attempt in range(2):
            try:
                raw = post_json(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", body, {"x-goog-api-key": key})
                part = json.loads(raw)["candidates"][0]["content"]["parts"][0]["inlineData"]
                break
            except (KeyError, IndexError, TypeError) as e:
                last = RuntimeError(f"{model}: reply had no audio ({e!r})")
                time.sleep(3)
            except RuntimeError as e:
                last = e
                break
        if part:
            print(f"  gemini voice model: {model}, voice {voice}", file=sys.stderr)
            break
    if not part:
        raise last or RuntimeError("gemini tts: no model produced audio")
    pcm = out_dir / "script.pcm"
    wav = out_dir / "script.wav"
    pcm.write_bytes(base64.b64decode(part["data"]))
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", str(pcm), str(wav)])
    pcm.unlink(missing_ok=True)
    try:
        return split_at_pauses(wav, texts, out_dir)
    finally:
        wav.unlink(missing_ok=True)

# ---- Google Cloud Text-to-Speech: Chirp 3 HD voices are the most natural; generous free monthly allowance ----
def tts_gcloud(text: str, path: Path):
    key = os.environ.get("GOOGLE_TTS_API_KEY") or os.environ["GEMINI_API_KEY"]
    code = "tr-TR" if LANG == "tr" else "en-US"
    voices = ([os.environ["GCLOUD_VOICE"]] if os.environ.get("GCLOUD_VOICE") else
              [f"{code}-Chirp3-HD-Charon", f"{code}-Chirp3-HD-Orus", f"{code}-Wavenet-E" if LANG == "tr" else f"{code}-Neural2-D"])
    last = None
    for v in voices:
        try:
            raw = post_json(f"https://texttospeech.googleapis.com/v1/text:synthesize?key={key}",
                            {"input": {"text": text}, "voice": {"languageCode": code, "name": v},
                             "audioConfig": {"audioEncoding": "MP3", "speakingRate": 1.0}}, {})
            path.write_bytes(base64.b64decode(json.loads(raw)["audioContent"]))
            tighten_speech(text, path, "gcloud")
            return
        except RuntimeError as e:
            last = e
            if "403" in str(e) or "PERMISSION" in str(e).upper():
                break                      # the API is not enabled for this key: no point trying other voices
    raise last or RuntimeError("gcloud tts failed")

def tts_elevenlabs(text: str, path: Path):
    key = os.environ["ELEVENLABS_API_KEY"]
    voice = os.environ.get("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128"
    body = {"text": text, "model_id": os.environ.get("ELEVENLABS_MODEL") or ("eleven_multilingual_v2" if LANG != "en" else "eleven_flash_v2_5"),
            "voice_settings": {"speed": 0.8 if LANG == "en" else 0.92}}
    if LANG != "en":
        body["language_code"] = LANG
    try:
        audio = post_json(url, body, {"xi-api-key": key})
    except RuntimeError:
        body.pop("voice_settings", None)          # a model/voice that rejects "speed" must still produce audio
        audio = post_json(url, body, {"xi-api-key": key})
    path.write_bytes(audio)
    tighten_speech(text, path, "elevenlabs")

def tts_espeak(text: str, path: Path):
    # Fully offline last resort (apt install espeak-ng): robotic, but it cannot fail on network.
    wav = path.with_suffix(".wav")
    run(["espeak-ng", "-v", "tr" if LANG == "tr" else "en-us", "-s", "150", "-w", str(wav), text])
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), str(path)])
    wav.unlink(missing_ok=True)

def tts_edge(text: str, path: Path):
    import edge_tts
    voice = os.environ.get("EDGE_VOICE") or ("tr-TR-AhmetNeural" if LANG == "tr" else "en-US-AndrewNeural")
    asyncio.run(edge_tts.Communicate(text, voice, rate=os.environ.get("VOICE_RATE", "-2%")).save(str(path)))
    tighten_speech(text, path, "edge")

PROVIDERS = {
    "gemini": ("GEMINI_API_KEY", tts_gemini),
    "gcloud": (None, tts_gcloud),
    "elevenlabs": ("ELEVENLABS_API_KEY", tts_elevenlabs),
    "edge": (None, tts_edge),
    "espeak": (None, tts_espeak),
}

# The voice sets the pace: every scene lasts as long as its narration needs, spoken at natural speed.
HOOK_MAX, OUTRO_MAX, ITEM_MAX_VOICE = 4.6, 3.6, 7.6     # longest narration we accept (seconds)
HOOK_MIN, OUTRO_MIN = 2.5, 2.0                           # shortest scene
ITEM_MIN_SLOT, ITEM_MAX_SLOT, PAD = 5.0, 9.5, 0.9        # per-country scene length bounds / breathing room

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
    outro_s = max(OUTRO_MIN, outro_d + 0.3)
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
    n_items = len(slots)
    events = [("riser", 0.0)]
    for i in range(n_items):
        events += [("whoosh", item_starts[i]), ("ding", item_starts[i] + 0.9)]
        if i == n_items - 1:                              # last reveal = rank #1
            events.append(("boom", item_starts[i]))
    events.append(("ding", outro_start))
    mixed = out / "mixed.m4a"
    used_music = None
    try:
        from audio_library import mix as library_mix      # real CC0 music/effects (Freesound)
        used_music = library_mix(out / "narration.m4a", mixed, total, events)
    except Exception as e:                                # never lose a video over the sound bed
        print(f"library mix failed ({e}); using synthetic music", file=sys.stderr)
    if used_music is None:
        from audio_fx import make_music, make_sfx, save_wav
        save_wav(out / "music.wav", make_music(total))
        save_wav(out / "sfx.wav", make_sfx(total, events))
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(out / "narration.m4a"),
             "-i", str(out / "music.wav"), "-i", str(out / "sfx.wav"),
             "-filter_complex",
             "[0:a]volume=1.0[v];[1:a]volume=0.20[m];[2:a]volume=0.5[s];"
             "[v][m][s]amix=inputs=3:normalize=0:duration=first,alimiter=limit=0.95[o]",
             "-map", "[o]", "-c:a", "aac", "-b:a", "160k", str(mixed)])
        for f in ("music.wav", "sfx.wav"):
            (out / f).unlink(missing_ok=True)
        used_music = "synthetic"
    mixed.replace(out / "narration.m4a")
    print(f"narration ok (voice + music: {used_music})")

if __name__ == "__main__":
    main()
