import { z } from "zod";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";
import { HOOK_SECONDS, OUTRO_SECONDS } from "./timing";

const { fontFamily } = loadFont("normal", {
  weights: ["600", "700", "800", "900"],
  subsets: ["latin", "latin-ext"],
});

export const top5Schema = z.object({
  hook: z.string(),
  emoji: z.string().optional(),
  accent: z.string(),
  secondsPerItem: z.number(),
  teaser: z.string().optional(), // curiosity hook shown on the opening card
  outro: z.string(),
  items: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
      unit: z.string(),
      // short, data-derived talking points shown one by one under the number (and read aloud)
      facts: z.array(z.object({ icon: z.string(), text: z.string(), say: z.string() })).optional(),
      iso2: z.string().optional(),
      flag: z.string().optional(), // file under public/, downloaded by scripts/fetch-assets.mjs
      clip: z.string().optional(), // stock footage under public/, same script
    })
  ),
});
export type Top5Props = z.infer<typeof top5Schema>;
type Item = Top5Props["items"][number];

// Heavy black outline keeps text readable on top of any footage.
const outline = (px: number): React.CSSProperties => ({
  WebkitTextStroke: `${px}px #000`,
  paintOrder: "stroke fill",
  textShadow: "0 6px 24px rgba(0,0,0,0.55)",
});

const fmt = (v: number) => {
  const decimals = Number.isInteger(v) ? 0 : v < 10 ? 2 : 1;
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
};

/* ---------- background: stock footage, or flag/gradient when no clip is available ---------- */
const Footage: React.FC<{ item: Item; accent: string; emoji?: string; punches?: number[]; zoomOut?: boolean }> = ({
  item, accent, emoji, punches = [], zoomOut = false,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  // slow push-in (or pull-out on alternate items) + a quick punch-zoom each time new text lands:
  // a visual change every ~1.5-2 s is what keeps Shorts viewers from swiping away.
  const base = zoomOut
    ? interpolate(frame, [0, durationInFrames], [1.12, 1])
    : interpolate(frame, [0, durationInFrames], [1, 1.1]);
  const punch = punches.reduce((s, f) => (frame >= f ? s + 0.07 * Math.exp(-(frame - f) / 6) : s), 0);
  const zoom = base + punch;
  if (item.clip) {
    return (
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <OffthreadVideo
          src={staticFile(item.clip)}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
    );
  }
  // Fallback: heavily enlarged, blurred flag as a colourful backdrop + slow drifting glow.
  const drift = Math.sin(frame / 25) * 40;
  return (
    <AbsoluteFill style={{ background: "#0b0a24", overflow: "hidden" }}>
      {item.flag ? (
        <Img
          src={staticFile(item.flag)}
          style={{
            position: "absolute",
            width: "260%",
            height: "130%",
            left: "-80%",
            top: "-10%",
            objectFit: "cover",
            filter: "blur(38px) saturate(1.3)",
            opacity: 0.75,
            transform: `scale(${zoom}) translateX(${drift}px)`,
          }}
        />
      ) : (
        <AbsoluteFill
          style={{ background: `radial-gradient(circle at 50% 40%, ${accent}66, #0b0a24 70%)` }}
        />
      )}
      {!item.flag && emoji ? (
        <div style={{ position: "absolute", top: 520, width: "100%", textAlign: "center", fontSize: 420, opacity: 0.5 }}>
          {emoji}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const Shade: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(180deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.82) 100%)",
    }}
  />
);

/* ---------- persistent title (like the reference): two lines, highlighted words ---------- */
const Title: React.FC<{ text: string; accent: string }> = ({ text, accent }) => {
  const words = text.replace(/^Top 5 /i, "").split(" ");
  const mid = Math.ceil(words.length / 2);
  const line = (ws: string[]) =>
    ws.map((w, i) => (
      <span key={i} style={{ color: i % 2 === 0 ? "#fff" : accent }}>
        {w}{" "}
      </span>
    ));
  return (
    <div
      style={{
        position: "absolute",
        top: 70,
        left: 40,
        right: 40,
        textAlign: "center",
        fontFamily,
        fontWeight: 900,
        fontSize: 58,
        lineHeight: 1.12,
        ...outline(8),
      }}
    >
      <div style={{ color: accent, fontSize: 40, letterSpacing: 6 }}>TOP 5</div>
      <div>{line(words.slice(0, mid))}</div>
      <div>{line(words.slice(mid))}</div>
    </div>
  );
};

const ProgressBar: React.FC<{ total: number }> = ({ total }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", top: 0, left: 0, height: 10, width: `${(frame / total) * 100}%`, background: "#ffcc00" }} />
  );
};

/* ---------- left-hand ranking list that fills up as the countdown proceeds ---------- */
const RankList: React.FC<{ items: Item[]; currentRank: number; accent: string }> = ({ items, currentRank, accent }) => (
  <div style={{ position: "absolute", left: 36, top: 430, width: 700, fontFamily, fontWeight: 800 }}>
    {items.map((it, idx) => {
      const rank = idx + 1;
      const revealed = rank >= currentRank; // countdown: 5 first, 1 last
      const isCurrent = rank === currentRank;
      return (
        <div
          key={rank}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            height: 96,
            fontSize: isCurrent ? 50 : 42,
            color: isCurrent ? accent : "#fff",
            opacity: revealed ? 1 : 0.55,
            ...outline(7),
          }}
        >
          <span style={{ width: 62 }}>{rank}.</span>
          {revealed ? (
            <>
              {it.flag ? (
                <Img src={staticFile(it.flag)} style={{ height: 46, width: 69, borderRadius: 6, objectFit: "cover", boxShadow: "0 3px 10px rgba(0,0,0,.6)" }} />
              ) : null}
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 480 }}>{it.label}</span>
            </>
          ) : (
            <span style={{ letterSpacing: 6 }}>• • •</span>
          )}
        </div>
      );
    })}
  </div>
);

const Confetti: React.FC<{ accent: string }> = ({ accent }) => {
  const frame = useCurrentFrame();
  const colors = [accent, "#ffffff", "#ff4d8d", "#00e0ff", "#7CFF6B"];
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: 46 }).map((_, i) => {
        const x = random(`x${i}`) * 1080;
        const vx = (random(`vx${i}`) - 0.5) * 6;
        const speed = 7 + random(`s${i}`) * 9;
        const t = Math.max(0, frame - random(`d${i}`) * 14);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x + vx * t,
              top: -60 + speed * t,
              width: 18,
              height: 30,
              background: colors[i % colors.length],
              borderRadius: 4,
              transform: `rotate(${t * (6 + (i % 5))}deg)`,
              opacity: t > 0 ? 1 : 0,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/* ---------- flag intro: full-screen flag that shrinks into the info card, revealing the footage ---------- */
const FlagIntro: React.FC<{ flag: string; accent: string; label: string }> = ({ flag, accent, label }) => {
  const frame = useCurrentFrame();
  const END = 38;
  if (frame >= END) return null;
  // The whole flag is shown (never cropped) on a blurred copy of itself, with the country name;
  // after ~0.8 s the circle collapses onto the card's flag and reveals the footage.
  const r = interpolate(frame, [18, END], [2600, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pop = interpolate(frame, [0, 12], [0.8, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ clipPath: `circle(${r}px at 177px 1505px)`, background: "#0b0a24", overflow: "hidden" }}>
      <Img
        src={staticFile(flag)}
        style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", filter: "blur(46px) brightness(0.55)", transform: "scale(1.3)" }}
      />
      <div style={{ position: "absolute", left: 60, right: 60, top: 520, display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${pop})` }}>
        <Img
          src={staticFile(flag)}
          style={{ width: 960, maxHeight: 700, objectFit: "contain", borderRadius: 24, border: "10px solid #fff", boxShadow: `0 20px 80px rgba(0,0,0,.7), 0 0 90px ${accent}88` }}
        />
        <div style={{ marginTop: 50, fontFamily, fontWeight: 900, fontSize: 110, color: "#fff", textAlign: "center", lineHeight: 1.05, ...outline(12) }}>{label}</div>
      </div>
    </AbsoluteFill>
  );
};

/* ---------- data-derived talking points, revealed one by one under the number ---------- */
const Facts: React.FC<{ facts: NonNullable<Item["facts"]>; accent: string }> = ({ facts, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ position: "absolute", left: 40, right: 140, top: 930, display: "flex", flexDirection: "column", gap: 18, fontFamily }}>
      {facts.map((f, i) => {
        const p = spring({ frame: frame - (52 + i * 28), fps, config: { damping: 15 } });
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              padding: "16px 26px",
              borderRadius: 26,
              background: "rgba(8,8,28,0.78)",
              borderLeft: `10px solid ${accent}`,
              color: "#fff",
              fontWeight: 800,
              fontSize: 46,
              lineHeight: 1.15,
              transform: `translateX(${(1 - p) * -420}px)`,
              opacity: p,
              boxShadow: "0 10px 30px rgba(0,0,0,.45)",
            }}
          >
            <span style={{ fontSize: 56 }}>{f.icon}</span>
            <span>{f.text}</span>
          </div>
        );
      })}
    </div>
  );
};

/* ---------- one ranked entry ---------- */
const ItemScene: React.FC<{
  item: Item;
  rank: number;
  items: Item[];
  accent: string;
  emoji?: string;
  title: string;
}> = ({ item, rank, items, accent, emoji, title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 11, stiffness: 140 } });
  const card = spring({ frame: frame - 12, fps, config: { damping: 14 } });
  const count = spring({ frame: frame - 22, fps, durationInFrames: 42 });
  const flash = interpolate(frame, [0, 6], [0.55, 0], { extrapolateRight: "clamp" });
  const shake = rank === 1 && frame < 10 ? Math.sin(frame * 3) * 14 : 0;
  const shown = Math.round(item.value * count * 100) / 100;

  return (
    <AbsoluteFill style={{ transform: `translateX(${shake}px)` }}>
      <Footage item={item} accent={accent} emoji={emoji} punches={[16, ...(item.facts ?? []).map((_, i) => 52 + i * 28)]} zoomOut={rank % 2 === 0} />
      <Shade />
      <Title text={title} accent={accent} />
      <RankList items={items} currentRank={rank} accent={accent} />

      {/* huge rank number */}
      <div
        style={{
          position: "absolute",
          right: 60,
          textAlign: "right",
          top: 430,
          fontFamily,
          fontWeight: 900,
          fontSize: 250,
          lineHeight: 1,
          color: rank === 1 ? "#ffd34d" : accent,
          transform: `scale(${0.4 + 0.6 * pop}) rotate(${(1 - pop) * -12}deg)`,
          opacity: pop,
          ...outline(14),
        }}
      >
        {rank === 1 ? "👑" : `#${rank}`}
      </div>

      {/* bottom info card: flag + name + counting value (kept above Shorts' bottom UI) */}
      <div
        style={{
          position: "absolute",
          left: 40,
          right: 140,
          bottom: 300,
          display: "flex",
          alignItems: "center",
          gap: 28,
          padding: "28px 32px",
          borderRadius: 36,
          background: "rgba(8,8,28,0.72)",
          border: `4px solid ${accent}`,
          boxShadow: `0 0 50px ${accent}77`,
          transform: `translateY(${(1 - card) * 260}px)`,
          opacity: card,
          fontFamily,
        }}
      >
        {item.flag ? (
          <Img src={staticFile(item.flag)} style={{ width: 210, height: 140, borderRadius: 16, objectFit: "cover", boxShadow: "0 6px 20px rgba(0,0,0,.6)" }} />
        ) : (
          <div style={{ fontSize: 120 }}>{emoji ?? "🌍"}</div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: 70, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {item.label}
          </div>
          <div style={{ color: accent, fontWeight: 900, fontSize: 64, lineHeight: 1.1 }}>
            {fmt(shown)} <span style={{ fontSize: 34, color: "#d6d9ff", fontWeight: 700 }}>{item.unit}</span>
          </div>
        </div>
      </div>

      {item.facts && item.facts.length ? <Facts facts={item.facts} accent={accent} /> : null}
      {item.flag ? <FlagIntro flag={item.flag} accent={accent} label={item.label} /> : null}
      {rank === 1 ? <Confetti accent={accent} /> : null}
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
    </AbsoluteFill>
  );
};

/* ---------- hook: quick montage of all five locations + the question ---------- */
const Hook: React.FC<{ items: Item[]; title: string; accent: string; emoji?: string; teaser: string; frozen?: boolean }> = ({ items, title, accent, emoji, teaser, frozen = false }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const cut = Math.floor(durationInFrames / items.length);
  const idx = frozen ? 0 : Math.min(items.length - 1, Math.floor(frame / cut));
  const pop = spring({ frame, fps, config: { damping: 10 } });
  const pulse = 1 + Math.sin(frame / 3) * 0.04;
  const text = title.replace(/^Top 5 /i, "");
  return (
    <AbsoluteFill>
      <Sequence from={idx * cut} durationInFrames={cut + 2} key={idx}>
        <Footage item={items[idx]} accent={accent} emoji={emoji} />
      </Sequence>
      <Shade />
      <div
        style={{
          position: "absolute",
          top: 420,
          left: 50,
          right: 50,
          textAlign: "center",
          fontFamily,
          fontWeight: 900,
          fontSize: 100,
          lineHeight: 1.08,
          color: "#fff",
          transform: `scale(${0.85 + 0.15 * pop})`,
          ...outline(14),
        }}
      >
        <div style={{ color: accent, fontSize: 70, letterSpacing: 8 }}>TOP 5</div>
        {text}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 340,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          transform: `scale(${pulse})`,
        }}
      >
        <div style={{ fontFamily, fontWeight: 900, fontSize: 56, padding: "20px 48px", borderRadius: 60, background: accent, color: "#111" }}>
          {teaser}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* fades its children in over `frames`, measured from the start of the surrounding Sequence */
const FadeIn: React.FC<{ frames: number; children: React.ReactNode }> = ({ frames, children }) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ opacity: interpolate(frame, [0, frames], [0, 1], { extrapolateRight: "clamp" }) }}>{children}</AbsoluteFill>;
};

/* ---------- outro: subscribe card over the winner's footage ---------- */
const Outro: React.FC<{ winner: Item; accent: string; emoji?: string; text: string; loopItems: Item[]; title: string; teaser: string }> = ({ winner, accent, emoji, text, loopItems, title, teaser }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const LOOP = 24; // last 0.8 s dissolve into the opening frame
  const fade = interpolate(frame, [durationInFrames - LOOP, durationInFrames - LOOP + 8], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pop = spring({ frame, fps, config: { damping: 9 } });
  const press = 1 + Math.max(0, Math.sin((frame - 30) / 4)) * 0.08;
  return (
    <AbsoluteFill>
      <Footage item={winner} accent={accent} emoji={emoji} />
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.62)" }} />
      <div style={{ position: "absolute", top: 560, width: "100%", textAlign: "center", fontFamily, fontWeight: 900, fontSize: 84, color: "#fff", lineHeight: 1.1, transform: `scale(${0.5 + 0.5 * pop})`, opacity: pop * fade, ...outline(12) }}>
        {text}
        <div style={{ fontSize: 52, color: accent, marginTop: 18 }}>Comment your country's rank 👇</div>
      </div>
      <div style={{ position: "absolute", top: 1010, width: "100%", display: "flex", justifyContent: "center", transform: `scale(${press})`, opacity: fade }}>
        <div style={{ display: "flex", fontFamily, fontWeight: 900, fontSize: 64, borderRadius: 18, overflow: "hidden", boxShadow: "0 10px 40px rgba(0,0,0,.6)" }}>
          <div style={{ background: "#fff", color: "#111", padding: "26px 40px" }}>SUBSCRIBE</div>
          <div style={{ background: "#ff0033", color: "#fff", padding: "26px 40px" }}>NOW</div>
        </div>
      </div>
      <Sequence from={durationInFrames - LOOP} durationInFrames={LOOP}>
        <FadeIn frames={LOOP - 4}>
          <Hook items={loopItems} title={title} accent={accent} emoji={emoji} teaser={teaser} frozen />
        </FadeIn>
      </Sequence>
    </AbsoluteFill>
  );
};

export const Top5: React.FC<Top5Props> = ({ hook, emoji, accent, secondsPerItem, teaser, outro, items }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const hookFrames = Math.round(HOOK_SECONDS * fps);
  const itemFrames = Math.round(secondsPerItem * fps);
  const outroFrames = Math.round(OUTRO_SECONDS * fps);
  const countdown = [...items].reverse(); // items[0] is rank #1; show #N first
  const total = items.length;

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Sequence durationInFrames={hookFrames}>
        <Hook items={countdown} title={hook} accent={accent} emoji={emoji} teaser={teaser ?? "Can you guess #1?"} />
      </Sequence>
      {countdown.map((item, i) => (
        <Sequence key={item.label} from={hookFrames + i * itemFrames} durationInFrames={itemFrames}>
          <ItemScene item={item} rank={total - i} items={items} accent={accent} emoji={emoji} title={hook} />
        </Sequence>
      ))}
      <Sequence from={hookFrames + total * itemFrames} durationInFrames={outroFrames}>
        <Outro winner={items[0]} accent={accent} emoji={emoji} text={outro} loopItems={countdown} title={hook} teaser={teaser ?? "Can you guess #1?"} />
      </Sequence>
      <ProgressBar total={durationInFrames} />
    </AbsoluteFill>
  );
};
