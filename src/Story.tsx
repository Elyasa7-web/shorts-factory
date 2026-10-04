import { z } from "zod";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Poppins";

const { fontFamily } = loadFont("normal", { weights: ["700", "800", "900"], subsets: ["latin", "latin-ext"] });

const wordSchema = z.object({ w: z.string(), s: z.number(), e: z.number() });
export const storySchema = z.object({
  title: z.string(),
  credits: z.array(z.string()).optional(),
  lang: z.string().optional(),       // "tr": captions are upper-cased with Turkish rules (i -> İ)
  ctaLabel: z.string().optional(),
  brand: z.string().optional(),
  accent: z.string().optional(),
  totalSeconds: z.number().optional(),
  scenes: z.array(
    z.object({
      kind: z.enum(["hook", "beat", "payoff", "cta"]),
      text: z.string(),
      visual: z.string().optional(),
      clip: z.string().optional(),
      image: z.string().optional(), // a still: animated with a slow camera move
      seconds: z.number(),
      words: z.array(wordSchema),
    })
  ),
});
export type StoryProps = z.infer<typeof storySchema>;
type Scene = StoryProps["scenes"][number];
type Word = z.infer<typeof wordSchema>;

const outline = (px: number): React.CSSProperties => ({
  WebkitTextStroke: `${px}px #000`,
  paintOrder: "stroke fill",
  textShadow: "0 8px 30px rgba(0,0,0,0.6)",
});

// 3-4 words per caption chunk, broken at punctuation: readable on a phone, matches the speaking rhythm
function chunkWords(words: Word[]): Word[][] {
  const out: Word[][] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const last = i === words.length - 1;
    const punct = /[.,;:!?]$/.test(w.w);
    if (cur.length >= 4 || (punct && cur.length >= 2) || last) {
      out.push(cur);
      cur = [];
    }
  });
  if (cur.length) out.push(cur);
  return out;
}

const Backdrop: React.FC<{ scene: Scene; accent: string; punches: number[]; zoomOut: boolean }> = ({ scene, accent, punches, zoomOut }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const base = zoomOut
    ? interpolate(frame, [0, durationInFrames], [1.14, 1.0])
    : interpolate(frame, [0, durationInFrames], [1.0, 1.14]);
  const punch = punches.reduce((s, f) => (frame >= f ? s + 0.06 * Math.exp(-(frame - f) / 5) : s), 0);
  const drift = Math.sin(frame / 38) * 16;
  if (scene.image) {
    // still image: stronger push-in/pull-out + drift so it never feels like a slideshow
    const kb = zoomOut
      ? interpolate(frame, [0, durationInFrames], [1.28, 1.0])
      : interpolate(frame, [0, durationInFrames], [1.0, 1.28]);
    const panX = interpolate(frame, [0, durationInFrames], [zoomOut ? 40 : -40, zoomOut ? -40 : 40]);
    return (
      <AbsoluteFill style={{ transform: `translateX(${panX}px) scale(${kb + punch})` }}>
        <Img
          src={staticFile(scene.image)}
          style={{ width: "100%", height: "100%", objectFit: "cover", filter: "saturate(1.15) contrast(1.05) brightness(0.92)" }}
        />
      </AbsoluteFill>
    );
  }
  if (scene.clip) {
    return (
      <AbsoluteFill style={{ transform: `translateX(${drift}px) scale(${base + punch})` }}>
        <OffthreadVideo
          src={staticFile(scene.clip)}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", filter: "saturate(1.18) contrast(1.06) brightness(0.95)" }}
        />
      </AbsoluteFill>
    );
  }
  // no footage available: a moving colour field so the video still looks intentional
  const a = Math.sin(frame / 45) * 25;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at ${50 + a}% ${40 - a / 2}%, ${accent}88, #0b0a24 62%)`, transform: `scale(${base + punch})` }} />
  );
};

const Shade: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.62) 100%)",
    }}
  />
);

const Captions: React.FC<{ scene: Scene; accent: string; big: boolean; lang: string }> = ({ scene, accent, big, lang }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const chunks = chunkWords(scene.words);
  // current chunk = the last one that has started (the first is visible from frame 0)
  let ci = 0;
  chunks.forEach((c, i) => { if (t >= c[0].s - 0.02) ci = i; });
  const chunk = chunks[ci];
  if (!chunk) return null;
  const since = (t - chunk[0].s) * fps;
  const pop = spring({ frame: Math.max(0, since), fps, config: { damping: 12, stiffness: 220 } });
  const size = big ? 118 : 100;
  return (
    <div
      lang={lang}
      style={{
        position: "absolute",
        left: 50,
        right: 110,
        top: 880,
        textAlign: "center",
        fontFamily,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 1.08,
        textTransform: "uppercase",
        transform: `scale(${0.88 + 0.12 * pop})`,
        ...outline(14),
      }}
    >
      {chunk.map((w, i) => {
        const active = t >= w.s - 0.02 && t < w.e + 0.02;
        return (
          <span key={i} style={{ color: active ? accent : "#fff", display: "inline-block", margin: "0 18px", transform: active ? "scale(1.07)" : "scale(1)" }}>
            {w.w}
          </span>
        );
      })}
    </div>
  );
};

const SceneView: React.FC<{ scene: Scene; index: number; total: number; accent: string; lang: string; ctaLabel: string; brand?: string }> = ({ scene, index, total, accent, lang, ctaLabel, brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const chunks = chunkWords(scene.words);
  const punches = [0, ...chunks.map((c) => Math.round(c[0].s * fps))];
  const isPayoff = scene.kind === "payoff";
  const shake = isPayoff && frame < 8 ? Math.sin(frame * 3.2) * 12 : 0;
  const flash = interpolate(frame, [0, 5], [isPayoff ? 0.5 : 0.28, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ transform: `translateX(${shake}px)` }}>
      <Backdrop scene={scene} accent={accent} punches={punches} zoomOut={index % 2 === 1} />
      <Shade />
      {/* scene dots: shows progress through the story */}
      <div style={{ position: "absolute", top: 80, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 14 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ width: i === index ? 44 : 16, height: 16, borderRadius: 8, background: i <= index ? accent : "rgba(255,255,255,.35)" }} />
        ))}
      </div>
      {brand ? (
        <div style={{ position: "absolute", top: 118, left: 0, right: 0, textAlign: "center", fontFamily, fontWeight: 800, fontSize: 30, letterSpacing: 8, color: "#fff", opacity: 0.8, textShadow: "0 2px 12px rgba(0,0,0,.7)" }}>
          {brand}
        </div>
      ) : null}
      <Captions scene={scene} accent={accent} big={scene.kind === "hook" || isPayoff} lang={lang} />
      {scene.kind === "cta" ? (
        <div lang={lang} style={{ position: "absolute", top: 1330, width: "100%", display: "flex", justifyContent: "center" }}>
          <div style={{ fontFamily, fontWeight: 900, fontSize: 54, padding: "20px 48px", borderRadius: 60, background: accent, color: "#111" }}>
            {ctaLabel}
          </div>
        </div>
      ) : null}
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
    </AbsoluteFill>
  );
};

const FadeIn: React.FC<{ frames: number; children: React.ReactNode }> = ({ frames, children }) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ opacity: interpolate(frame, [0, frames], [0, 1], { extrapolateRight: "clamp" }) }}>{children}</AbsoluteFill>;
};

export const Story: React.FC<StoryProps> = ({ accent = "#ffcc00", scenes, lang = "en", ctaLabel = "COMMENT YOUR ANSWER 👇", brand }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const lens = scenes.map((s) => Math.max(1, Math.round(s.seconds * fps)));
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  const LOOP = 18; // last 0.6 s dissolve back into the opening frame
  const last = scenes.length - 1;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {scenes.map((sc, i) => (
        <Sequence key={i} from={starts[i]} durationInFrames={lens[i]}>
          <SceneView scene={sc} index={i} total={scenes.length} accent={accent} lang={lang} ctaLabel={ctaLabel} brand={brand} />
        </Sequence>
      ))}
      {/* seamless loop: the Short's last frames fade into its first frame */}
      <Sequence from={starts[last] + lens[last] - LOOP} durationInFrames={LOOP}>
        <FadeIn frames={LOOP - 3}>
          <SceneView scene={scenes[0]} index={0} total={scenes.length} accent={accent} lang={lang} ctaLabel={ctaLabel} brand={brand} />
        </FadeIn>
      </Sequence>
      <div style={{ position: "absolute", top: 0, left: 0, height: 10, width: `${(frame / durationInFrames) * 100}%`, background: accent }} />
    </AbsoluteFill>
  );
};
