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
  outro: z.string(),
  items: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
      unit: z.string(),
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
const Footage: React.FC<{ item: Item; accent: string; emoji?: string }> = ({ item, accent, emoji }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const zoom = interpolate(frame, [0, durationInFrames], [1, 1.1]);
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
const FlagIntro: React.FC<{ flag: string; accent: string }> = ({ flag, accent }) => {
  const frame = useCurrentFrame();
  const END = 40;
  if (frame >= END) return null;
  // radius of the circular clip: hold big for ~0.5 s, then collapse onto the card's flag
  const r = interpolate(frame, [14, END], [2600, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = interpolate(frame, [0, 14], [1.15, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ clipPath: `circle(${r}px at 177px 1505px)` }}>
      <Img src={staticFile(flag)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }} />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,0) 40%, rgba(0,0,0,.45))`, boxShadow: `inset 0 0 0 14px ${accent}` }} />
    </AbsoluteFill>
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
      <Footage item={item} accent={accent} emoji={emoji} />
      <Shade />
      <Title text={title} accent={accent} />
      <RankList items={items} currentRank={rank} accent={accent} />

      {/* huge rank number */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 100,
          textAlign: "center",
          top: 880,
          fontFamily,
          fontWeight: 900,
          fontSize: 330,
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

      {item.flag && item.clip ? <FlagIntro flag={item.flag} accent={accent} /> : null}
      {rank === 1 ? <Confetti accent={accent} /> : null}
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
    </AbsoluteFill>
  );
};

/* ---------- hook: quick montage of all five locations + the question ---------- */
const Hook: React.FC<{ items: Item[]; title: string; accent: string; emoji?: string }> = ({ items, title, accent, emoji }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const cut = Math.floor(durationInFrames / items.length);
  const idx = Math.min(items.length - 1, Math.floor(frame / cut));
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
          transform: `scale(${0.6 + 0.4 * pop})`,
          opacity: pop,
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
          CAN YOU GUESS #1?
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ---------- outro: subscribe card over the winner's footage ---------- */
const Outro: React.FC<{ winner: Item; accent: string; emoji?: string; text: string }> = ({ winner, accent, emoji, text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 9 } });
  const press = 1 + Math.max(0, Math.sin((frame - 30) / 4)) * 0.08;
  return (
    <AbsoluteFill>
      <Footage item={winner} accent={accent} emoji={emoji} />
      <AbsoluteFill style={{ background: "rgba(0,0,0,0.62)" }} />
      <div style={{ position: "absolute", top: 560, width: "100%", textAlign: "center", fontFamily, fontWeight: 900, fontSize: 84, color: "#fff", lineHeight: 1.1, transform: `scale(${0.5 + 0.5 * pop})`, opacity: pop, ...outline(12) }}>
        {text}
        <div style={{ fontSize: 52, color: accent, marginTop: 18 }}>Which one surprised you? 👇</div>
      </div>
      <div style={{ position: "absolute", top: 1010, width: "100%", display: "flex", justifyContent: "center", transform: `scale(${press})` }}>
        <div style={{ display: "flex", fontFamily, fontWeight: 900, fontSize: 64, borderRadius: 18, overflow: "hidden", boxShadow: "0 10px 40px rgba(0,0,0,.6)" }}>
          <div style={{ background: "#fff", color: "#111", padding: "26px 40px" }}>SUBSCRIBE</div>
          <div style={{ background: "#ff0033", color: "#fff", padding: "26px 40px" }}>NOW</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Top5: React.FC<Top5Props> = ({ hook, emoji, accent, secondsPerItem, outro, items }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const hookFrames = Math.round(HOOK_SECONDS * fps);
  const itemFrames = Math.round(secondsPerItem * fps);
  const outroFrames = Math.round(OUTRO_SECONDS * fps);
  const countdown = [...items].reverse(); // items[0] is rank #1; show #N first
  const total = items.length;

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Sequence durationInFrames={hookFrames}>
        <Hook items={countdown} title={hook} accent={accent} emoji={emoji} />
      </Sequence>
      {countdown.map((item, i) => (
        <Sequence key={item.label} from={hookFrames + i * itemFrames} durationInFrames={itemFrames}>
          <ItemScene item={item} rank={total - i} items={items} accent={accent} emoji={emoji} title={hook} />
        </Sequence>
      ))}
      <Sequence from={hookFrames + total * itemFrames} durationInFrames={outroFrames}>
        <Outro winner={items[0]} accent={accent} emoji={emoji} text={outro} />
      </Sequence>
      <ProgressBar total={durationInFrames} />
    </AbsoluteFill>
  );
};
