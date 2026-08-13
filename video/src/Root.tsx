import "./index.css";
import { Composition } from "remotion";
import {
  INTRO_DURATION_IN_FRAMES,
  INTRO_FPS,
  OpenInventoryIntro,
  type OpenInventoryIntroProps,
} from "./OpenInventoryIntro";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="OpenInventoryIntro"
      component={OpenInventoryIntro}
      durationInFrames={INTRO_DURATION_IN_FRAMES}
      fps={INTRO_FPS}
      width={1920}
      height={1080}
      defaultProps={
        {
          brandName: "Open Inventory",
          tagline: "Take a photo. AI builds the record.",
          badges: ["AI-native", "Self-hosted", "MIT licensed", "Native iOS"],
        } satisfies OpenInventoryIntroProps
      }
    />
  );
};
