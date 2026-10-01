import { AbsoluteFill } from "remotion";

const font = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const GOLD_1 = "#ffe27a";
const GOLD_2 = "#ffb300";
const GOLD_3 = "#e07a00";
const NAVY = "#0b0a24";

// The mark: a ringed planet carrying the numeral 5. The ring is drawn twice
// (whole ring behind, front half over the planet) so it reads as 3D.
const Mark: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 400 400">
    <defs>
      <linearGradient id="planet" x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0" stopColor={GOLD_1} />
        <stop offset="0.55" stopColor={GOLD_2} />
        <stop offset="1" stopColor={GOLD_3} />
      </linearGradient>
      <linearGradient id="ring" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#7be0ff" />
        <stop offset="1" stopColor="#c8a2ff" />
      </linearGradient>
      <clipPath id="front">
        <rect x="0" y="200" width="400" height="200" />
      </clipPath>
    </defs>
    <g transform="rotate(-22 200 200)">
      <ellipse cx="200" cy="200" rx="185" ry="52" fill="none" stroke="url(#ring)" strokeWidth="14" opacity="0.55" />
    </g>
    <circle cx="200" cy="200" r="118" fill="url(#planet)" />
    <circle cx="200" cy="200" r="118" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="3" />
    <text x="200" y="258" textAnchor="middle" fontFamily={font} fontWeight={900} fontSize="190" fill={NAVY}>
      5
    </text>
    <g transform="rotate(-22 200 200)" clipPath="url(#front)">
      <ellipse cx="200" cy="200" rx="185" ry="52" fill="none" stroke="url(#ring)" strokeWidth="14" />
    </g>
  </svg>
);

const Backdrop: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      background:
        "radial-gradient(ellipse at 50% 40%, #2b2670 0%, #15123f 45%, #07061a 100%)",
      justifyContent: "center",
      alignItems: "center",
    }}
  >
    {children}
  </AbsoluteFill>
);

// Square avatar: YouTube crops to a circle, the mark stays well inside it.
export const Avatar: React.FC = () => (
  <Backdrop>
    <Mark size={640} />
  </Backdrop>
);

// Banner 2560x1440. Everything that matters sits inside the 1546x423 centre
// "safe area"; the sides carry faint podium bars so the wide shot is not empty.
const Bars: React.FC<{ side: "left" | "right" }> = ({ side }) => {
  const heights = side === "left" ? [140, 230, 320, 410, 500] : [500, 410, 320, 230, 140];
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        [side]: 0,
        display: "flex",
        alignItems: "flex-end",
        gap: 20,
        padding: "0 40px",
        opacity: 0.22,
      }}
    >
      {heights.map((h, i) => (
        <div
          key={i}
          style={{
            width: 56,
            height: h,
            borderRadius: "14px 14px 0 0",
            background: `linear-gradient(180deg, ${GOLD_1}, ${GOLD_3})`,
          }}
        />
      ))}
    </div>
  );
};

export const Banner: React.FC = () => (
  <Backdrop>
    <Bars side="left" />
    <Bars side="right" />
    <div style={{ display: "flex", alignItems: "center", gap: 20, fontFamily: font }}>
      <div style={{ marginLeft: -40, marginRight: -30 }}><Mark size={560} /></div>
      <div style={{ color: "white" }}>
        <div style={{ fontSize: 168, fontWeight: 900, letterSpacing: 5, lineHeight: 0.95 }}>
          TOP<span style={{ color: GOLD_2 }}>5</span>
        </div>
        <div style={{ fontSize: 168, fontWeight: 900, letterSpacing: 5, lineHeight: 0.95 }}>
          PLANET
        </div>
        <div
          style={{
            fontSize: 38,
            fontWeight: 600,
            letterSpacing: 8,
            marginTop: 20,
            color: "#a9b3ff",
          }}
        >
          COUNTRIES RANKED BY REAL DATA
        </div>
      </div>
    </div>
  </Backdrop>
);
