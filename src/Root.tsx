import { CalculateMetadataFunction, Composition } from "remotion";
import { Top5, top5Schema, Top5Props } from "./Top5";
import { FPS, HOOK_SECONDS, OUTRO_SECONDS } from "./timing";

// Duration is derived from the data, so a 3-item or 7-item list just works.
const calculateMetadata: CalculateMetadataFunction<Top5Props> = ({ props }) => ({
  durationInFrames: Math.round(
    (HOOK_SECONDS + props.items.length * props.secondsPerItem + OUTRO_SECONDS) * FPS
  ),
});

const defaultProps: Top5Props = {
  hook: "Top 5 Most Expensive Things Ever Sold",
  accent: "#ffcc00",
  secondsPerItem: 5,
  items: [
    { label: "Item E", value: 1, unit: "$M" },
    { label: "Item D", value: 2, unit: "$M" },
    { label: "Item C", value: 3, unit: "$M" },
    { label: "Item B", value: 4, unit: "$M" },
    { label: "Item A", value: 5, unit: "$M" },
  ],
  outro: "Follow for more rankings",
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Top5"
    component={Top5}
    schema={top5Schema}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={30 * FPS}
    defaultProps={defaultProps}
    calculateMetadata={calculateMetadata}
  />
);
