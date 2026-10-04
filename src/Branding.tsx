import { AbsoluteFill } from "remotion";

// "Canlı Garaj" brand: charcoal workshop background, a tachometer mark with a glowing orange needle, and a
// bold condensed wordmark. Colours are shared by the avatar, the banner and the video accent (#ff7a1a).
const font = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const ORANGE = "#ff7a1a";
const ORANGE_HOT = "#ff3d00";
const AMBER = "#ffb347";
const CHARCOAL = "#0c0e13";
const STEEL = "#8d97a8";

// Tachometer mark: a 270° dial with tick marks, a redline zone, a needle and the monogram "CG" in the hub.
const Mark: React.FC<{ size: number }> = ({ size }) => {
  const cx = 200, cy = 200, R = 160;
  const start = 135, sweep = 270;                       // dial opens at the bottom
  const pt = (deg: number, r: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  const arc = (a0: number, a1: number, r: number) => {
    const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const ticks = Array.from({ length: 28 }, (_, i) => {
    const a = start + (sweep * i) / 27;
    const major = i % 3 === 0;
    const [x0, y0] = pt(a, major ? R - 30 : R - 20), [x1, y1] = pt(a, R - 6);
    return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={i >= 22 ? ORANGE_HOT : "#d7dce6"} strokeWidth={major ? 6 : 3} strokeLinecap="round" />;
  });
  const needleA = start + sweep * 0.8;                  // pointing into the redline
  const [nx, ny] = pt(needleA, R - 26);
  return (
    <svg width={size} height={size} viewBox="0 0 400 400">
      <defs>
        <radialGradient id="face" cx="50%" cy="45%" r="60%">
          <stop offset="0" stopColor="#222733" />
          <stop offset="1" stopColor="#0a0c10" />
        </radialGradient>
        <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={AMBER} />
          <stop offset="0.5" stopColor={ORANGE} />
          <stop offset="1" stopColor={ORANGE_HOT} />
        </linearGradient>
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle cx={cx} cy={cy} r={188} fill="url(#rim)" />
      <circle cx={cx} cy={cy} r={176} fill="url(#face)" />
      <path d={arc(start + sweep * 0.8, start + sweep, R - 2)} stroke={ORANGE_HOT} strokeWidth={10} fill="none" opacity={0.9} />
      {ticks}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={ORANGE} strokeWidth={9} strokeLinecap="round" filter="url(#glow)" />
      <circle cx={cx} cy={cy} r={62} fill="#0c0e13" stroke="url(#rim)" strokeWidth={6} />
      <text x={cx} y={cy + 20} textAnchor="middle" fontFamily={font} fontWeight={900} fontSize={58} letterSpacing={-1} fill="#fff">
        C<tspan fill={ORANGE}>G</tspan>
      </text>
    </svg>
  );
};

const Backdrop: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse at 50% 42%, #1d2230 0%, #11141c 48%, ${CHARCOAL} 100%)`,
      justifyContent: "center",
      alignItems: "center",
    }}
  >
    {children}
  </AbsoluteFill>
);

// Square avatar: YouTube crops it to a circle, the dial stays well inside.
export const Avatar: React.FC = () => (
  <Backdrop>
    <Mark size={700} />
  </Backdrop>
);

// Video watermark (YouTube Studio > Customization > Branding): the tachometer on a TRANSPARENT background.
// It sits in the corner of the video player at about 40 px, so no text: just the dial, high contrast on any footage.
export const Watermark: React.FC = () => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", background: "transparent" }}>
    <Mark size={600} />
  </AbsoluteFill>
);

// Hazard-stripe band, a garage-floor detail used on the banner edges.
const Stripes: React.FC<{ side: "left" | "right" }> = ({ side }) => (
  <div
    style={{
      position: "absolute",
      bottom: 0,
      [side]: 0,
      width: 520,
      height: 36,
      opacity: 0.55,
      background: `repeating-linear-gradient(${side === "left" ? 135 : 45}deg, ${ORANGE} 0 34px, ${CHARCOAL} 34px 68px)`,
    }}
  />
);

// Banner 2560x1440. Everything that matters sits inside the 1546x423 centre "safe area" (visible on every device).
export const Banner: React.FC = () => (
  <Backdrop>
    <Stripes side="left" />
    <Stripes side="right" />
    <div style={{ display: "flex", alignItems: "center", gap: 56, fontFamily: font }}>
      <Mark size={360} />
      <div style={{ color: "white" }}>
        <div style={{ fontSize: 150, fontWeight: 900, letterSpacing: 4, lineHeight: 0.92 }}>
          CANLI <span style={{ color: ORANGE }}>GARAJ</span>
        </div>
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: 6, marginTop: 20, color: STEEL }}>
          ARABA · MOTOSİKLET · HER TÜR ARAÇ
        </div>
        <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: 4, marginTop: 10, color: AMBER }}>
          PARÇALAR ŞUNA YARAR · ARIZALAR · "YA ŞÖYLE OLURSA?"
        </div>
      </div>
    </div>
  </Backdrop>
);
