import { z } from "zod";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { HOOK_SECONDS, OUTRO_SECONDS } from "./timing";

export const top5Schema = z.object({
  hook: z.string(),
  accent: z.string(),
  secondsPerItem: z.number(),
  outro: z.string(),
  items: z.array(
    z.object({ label: z.string(), value: z.number(), unit: z.string() })
  ),
});
export type Top5Props = z.infer<typeof top5Schema>;

const font = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const Hook: React.FC<{ text: string; accent: string }> = ({ text, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill
      style={{ justifyContent: "center", alignItems: "center", padding: 80 }}
    >
      <div
        style={{
          fontFamily: font,
          fontSize: 120,
          fontWeight: 900,
          lineHeight: 1.1,
          textAlign: "center",
          color: "white",
          textTransform: "uppercase",
          transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})`,
          opacity: pop,
          textShadow: `0 0 40px ${accent}`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const Entry: React.FC<{
  rank: number;
  label: string;
  value: number;
  unit: string;
  max: number;
  accent: string;
}> = ({ rank, label, value, unit, max, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14 } });
  const grow = spring({ frame: frame - 10, fps, durationInFrames: 40 });
  const shown = Math.round(value * grow * 10) / 10;
  return (
    <AbsoluteFill style={{ padding: 70, justifyContent: "center" }}>
      <div
        style={{
          fontFamily: font,
          fontSize: 420,
          fontWeight: 900,
          color: accent,
          lineHeight: 1,
          opacity: enter,
          transform: `translateX(${interpolate(enter, [0, 1], [-300, 0])}px)`,
        }}
      >
        #{rank}
      </div>
      <div
        style={{
          fontFamily: font,
          fontSize: 110,
          fontWeight: 800,
          color: "white",
          margin: "30px 0",
          opacity: enter,
        }}
      >
        {label}
      </div>
      <div
        style={{
          height: 70,
          borderRadius: 35,
          background: "#ffffff22",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${(value / max) * 100 * grow}%`,
            background: accent,
            borderRadius: 35,
          }}
        />
      </div>
      <div
        style={{
          fontFamily: font,
          fontSize: 130,
          fontWeight: 900,
          color: "white",
          marginTop: 30,
        }}
      >
        {shown.toLocaleString("en-US")}{" "}
        <span style={{ fontSize: 64, fontWeight: 700, opacity: 0.85 }}>{unit}</span>
      </div>
    </AbsoluteFill>
  );
};

export const Top5: React.FC<Top5Props> = ({
  hook,
  accent,
  secondsPerItem,
  outro,
  items,
}) => {
  const { fps } = useVideoConfig();
  const hookFrames = Math.round(HOOK_SECONDS * fps);
  const itemFrames = Math.round(secondsPerItem * fps);
  const outroFrames = Math.round(OUTRO_SECONDS * fps);
  // items[0] is rank #1. Shown as a countdown: #N first, #1 is the finale.
  const sorted = [...items].reverse();
  const max = Math.max(...items.map((i) => i.value));
  const total = sorted.length;

  return (
    <AbsoluteFill
      style={{ background: "linear-gradient(160deg, #0f0c29, #302b63, #24243e)" }}
    >
      <Sequence durationInFrames={hookFrames}>
        <Hook text={hook} accent={accent} />
      </Sequence>
      {sorted.map((item, i) => (
        <Sequence
          key={item.label}
          from={hookFrames + i * itemFrames}
          durationInFrames={itemFrames}
        >
          <Entry
            rank={total - i}
            label={item.label}
            value={item.value}
            unit={item.unit}
            max={max}
            accent={accent}
          />
        </Sequence>
      ))}
      <Sequence from={hookFrames + total * itemFrames} durationInFrames={outroFrames}>
        <Hook text={outro} accent={accent} />
      </Sequence>
    </AbsoluteFill>
  );
};
