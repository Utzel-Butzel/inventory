import "./index.css";
import { Composition } from "remotion";
import { ProductFilm } from "./ProductFilm";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="OpenInventory"
        component={ProductFilm}
        durationInFrames={660}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
