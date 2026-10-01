import { AbsoluteFill } from "remotion";

const font = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const bg = "linear-gradient(160deg, #0f0c29, #302b63, #24243e)";
const gold = "#ffcc00";

// Square avatar: YouTube crops it to a circle, so keep everything inside the middle ~70%.
export const Avatar: React.FC = () => (
  <AbsoluteFill style={{ background: bg, justifyContent: "center", alignItems: "center" }}>
    <div style={{ fontFamily: font, fontWeight: 900, color: "white", textAlign: "center", lineHeight: 0.9 }}>
      <div style={{ fontSize: 330, color: gold }}>5</div>
      <div style={{ fontSize: 78, letterSpacing: 6, marginTop: 8 }}>TOP5</div>
    </div>
  </AbsoluteFill>
);

// Banner 2560x1440. Text must sit inside the 1546x423 "safe area" at the centre
// so it shows on TV, desktop and phone.
export const Banner: React.FC = () => (
  <AbsoluteFill style={{ background: bg, justifyContent: "center", alignItems: "center" }}>
    <div style={{ fontFamily: font, textAlign: "center", color: "white" }}>
      <div style={{ fontSize: 190, fontWeight: 900, letterSpacing: 4 }}>
        TOP<span style={{ color: gold }}>5</span> PLANET
      </div>
      <div style={{ fontSize: 64, fontWeight: 600, opacity: 0.9, marginTop: 10 }}>
        Countries ranked by real data
      </div>
    </div>
  </AbsoluteFill>
);
