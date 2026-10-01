"""Procedural background music + sound effects (pure stdlib, so royalty-free by construction)."""
import math
import random
import struct
import wave

SR = 44100
TWO_PI = 2 * math.pi


def save_wav(path, samples):
    peak = max(1e-9, max(abs(x) for x in samples))
    scale = 0.92 / peak if peak > 0.92 else 1.0
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x * scale)) * 32767)) for x in samples))


def make_music(total):
    """118 bpm loop: Am-F-C-G pad, bass, kick, off-beat hat and an eighth-note arpeggio."""
    rnd = random.Random(7)
    n = int(total * SR)
    beat = 60 / 118
    chords = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (261.63, 329.63, 392.0), (196.0, 246.94, 293.66)]
    bass = [55.0, 43.65, 65.41, 49.0]
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        bar = int(t / (beat * 4))
        ch = chords[bar % 4]
        tb = t % beat
        env_bar = min(1.0, (t % (beat * 4)) / 0.6)
        v = sum(math.sin(TWO_PI * f * t) for f in ch) * 0.045 * env_bar
        v += math.sin(TWO_PI * bass[bar % 4] * t) * 0.20 * math.exp(-tb * 3.0)
        v += math.sin(TWO_PI * (48 * tb + 90 * (1 - math.exp(-28 * tb)) / 28)) * 0.55 * math.exp(-tb * 9)
        th = (t + beat / 2) % beat
        if th < 0.05:
            v += (rnd.random() * 2 - 1) * 0.09 * math.exp(-th * 90)
        te = t % (beat / 2)
        step = int(t / (beat / 2))
        note = ch[step % 3] * (2 if (step // 3) % 2 else 1)
        v += math.sin(TWO_PI * note * t) * 0.07 * math.exp(-te * 11)
        out[i] = v
    fade = int(SR * 0.6)
    for i in range(fade):
        out[i] *= i / fade
        out[n - 1 - i] *= i / fade
    return out


def make_sfx(total, events):
    """events: list of (kind, start_seconds); kinds: riser, whoosh, ding, boom."""
    n = int(total * SR)
    out = [0.0] * n
    rnd = random.Random(11)

    def add(start, samples, gain):
        s0 = int(start * SR)
        for k, x in enumerate(samples):
            if 0 <= s0 + k < n:
                out[s0 + k] += x * gain

    def whoosh(dur=0.45):
        lp, res, m = 0.0, [], int(dur * SR)
        for k in range(m):
            u = k / m
            lp += (0.03 + 0.5 * u) * ((rnd.random() * 2 - 1) - lp)
            res.append(lp * math.sin(math.pi * u) * 3.0)
        return res

    def ding(f=1046.5, dur=0.7):
        return [
            (math.sin(TWO_PI * f * k / SR) + 0.5 * math.sin(TWO_PI * f * 1.5 * k / SR)) * math.exp(-k / SR * 6)
            for k in range(int(dur * SR))
        ]

    def boom(dur=1.3):
        return [
            math.sin(TWO_PI * 52 * k / SR) * math.exp(-k / SR * 3.2)
            + (rnd.random() * 2 - 1) * 0.5 * math.exp(-k / SR * 7)
            for k in range(int(dur * SR))
        ]

    def riser(dur=2.3):
        m, lp, res = int(dur * SR), 0.0, []
        for k in range(m):
            u = k / m
            lp += (0.02 + 0.6 * u * u) * ((rnd.random() * 2 - 1) - lp)
            res.append(lp * u * 3.2)
        return res

    gains = {"riser": (riser, 0.35), "whoosh": (whoosh, 0.55), "ding": (ding, 0.30), "boom": (boom, 0.9)}
    for kind, at in events:
        fn, gain = gains[kind]
        add(at, fn(), gain)
    return out
