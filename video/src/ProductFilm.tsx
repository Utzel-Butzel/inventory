import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio, Video } from "@remotion/media";
import { loadFont } from "@remotion/fonts";
import { QrCode } from "./LabelCodes";

loadFont({
  family: "Manrope",
  url: staticFile("fonts/Manrope.ttf"),
  weight: "200 800",
});
const ink = "#090c14",
  white = "#f4f5f9",
  violet = "#a49bff",
  green = "#95e5c3";
const ease = Easing.bezier(0.22, 1, 0.36, 1);
const smooth = Easing.bezier(0.65, 0, 0.35, 1);
const tween = (
  t: number,
  a: number,
  b: number,
  from = 0,
  to = 1,
  easing = ease,
) =>
  interpolate(t, [a, b], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });
const useTime = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return f / fps;
};

function Brand({ size = 38 }: { size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 15,
        fontSize: size * 0.65,
        fontWeight: 750,
        letterSpacing: -0.6,
      }}
    >
      <Img src={staticFile("logo.svg")} style={{ width: size, height: size }} />
      Open Inventory
    </div>
  );
}
function Backdrop() {
  const t = useTime();
  return (
    <AbsoluteFill style={{ background: ink }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 65% 75% at ${63 + Math.sin(t * 0.18) * 12}% 68%,#252348 0%,transparent 78%)`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.13,
          backgroundImage:
            "linear-gradient(#7e83952e 1px,transparent 1px),linear-gradient(90deg,#7e83952e 1px,transparent 1px)",
          backgroundSize: "90px 90px",
          maskImage: "linear-gradient(transparent,black)",
        }}
      />
    </AbsoluteFill>
  );
}
function Scene({
  children,
  duration,
}: {
  children: React.ReactNode;
  duration: number;
}) {
  const t = useTime();
  return (
    <AbsoluteFill
      style={{
        opacity: tween(t, 0, 0.18) * tween(t, duration - 0.18, duration, 1, 0),
      }}
    >
      {children}
    </AbsoluteFill>
  );
}
function Heading({ title, color = violet }: { title: string; color?: string }) {
  const t = useTime();
  return (
    <div
      style={{
        position: "absolute",
        left: 108,
        top: 126,
        zIndex: 8,
        color,
        fontSize: 64,
        fontWeight: 740,
        letterSpacing: -2.8,
        opacity: tween(t, 0, 0.22),
        transform: `translateY(${tween(t, 0, 0.4, 18, 0)}px)`,
      }}
    >
      {title}
    </div>
  );
}
type Stop = [number, number, number];
function Cursor({ path, clickAt = -10 }: { path: Stop[]; clickAt?: number }) {
  const t = useTime();
  const times = path.map((p) => p[0]);
  const x = interpolate(
    t,
    times,
    path.map((p) => p[1]),
    { easing: smooth, extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const y = interpolate(
    t,
    times,
    path.map((p) => p[2]),
    { easing: smooth, extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const pulse = tween(t, clickAt, clickAt + 0.65);
  const press =
    tween(t, clickAt, clickAt + 0.12, 1, 0.82) +
    tween(t, clickAt + 0.12, clickAt + 0.32, 0, 0.18);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 15,
        opacity: tween(t, path[0][0], path[0][0] + 0.25),
        pointerEvents: "none",
      }}
    >
      {t >= clickAt && t < clickAt + 0.65 ? (
        <div
          style={{
            position: "absolute",
            width: 66,
            height: 66,
            left: -33,
            top: -33,
            border: "3px solid #9b8cff",
            borderRadius: 100,
            transform: `scale(${0.25 + pulse})`,
            opacity: 1 - pulse,
          }}
        />
      ) : null}
      <svg
        width="38"
        height="46"
        viewBox="0 0 38 46"
        style={{
          filter: "drop-shadow(0 3px 4px #0009)",
          transform: `scale(${press})`,
          transformOrigin: "0 0",
        }}
      >
        <path
          d="M3 2 L5 35 L14 27 L22 43 L29 39 L21 24 L34 23 Z"
          fill="white"
          stroke="#151925"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
function Window({
  src,
  children,
  x,
  y,
  scale = 1,
  rx = 0,
  ry = 0,
  rz = 0,
  opacity = 1,
  video = false,
  playbackRate = 1,
}: {
  src: string;
  children?: React.ReactNode;
  x: number;
  y: number;
  scale?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  opacity?: number;
  video?: boolean;
  playbackRate?: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 1440,
        height: 942,
        transformOrigin: "50% 50%",
        transform: `perspective(2600px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${scale})`,
        opacity,
        borderRadius: 19,
        background: "#1e2431",
        boxShadow: "0 48px 120px #0009,0 0 0 1px #b5b9d044",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 42,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 18px",
          background: "#1c2130",
          borderBottom: "1px solid #3a3e52",
        }}
      >
        {["#ff7f84", "#e5c777", "#94cda9"].map((c) => (
          <span
            key={c}
            style={{
              width: 9,
              height: 9,
              borderRadius: 10,
              background: c,
              opacity: 0.8,
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            left: 480,
            width: 480,
            textAlign: "center",
            fontSize: 13,
            color: "#a0a6b8",
            letterSpacing: 0.5,
          }}
        >
          Open Inventory · Werkstatt Nord
        </div>
      </div>
      <div
        style={{
          position: "relative",
          width: 1440,
          height: 900,
          overflow: "hidden",
        }}
      >
        {video ? (
          <Video
            src={staticFile(src)}
            muted
            playbackRate={playbackRate}
            style={{ width: 1440, height: 900 }}
            objectFit="cover"
          />
        ) : (
          <Img
            src={staticFile(src)}
            style={{ width: 1440, height: 900, objectFit: "cover" }}
          />
        )}
        {children}
      </div>
    </div>
  );
}
function Highlight({
  x,
  y,
  w,
  h,
  from = 1,
  to = 3,
  color = violet,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  from?: number;
  to?: number;
  color?: string;
}) {
  const t = useTime();
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 14,
        border: `3px solid ${color}`,
        boxShadow: `0 0 0 6px ${color}22,0 0 40px ${color}22`,
        background: `${color}08`,
        opacity: tween(t, from, from + 0.25) * tween(t, to, to + 0.3, 1, 0),
      }}
    />
  );
}

// One second opening. Photography remains in the actual inventory cards.
function Intro() {
  const t = useTime();
  return (
    <Scene duration={1.2}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${tween(t, 0, 0.5, 0.88, 1)})`,
          opacity: tween(t, 0, 0.14),
        }}
      >
        <Brand size={130} />
      </AbsoluteFill>
    </Scene>
  );
}
const stage: React.CSSProperties = {
  position: "absolute",
  inset: "235px 0 32px",
  overflow: "hidden",
};

function Inventory() {
  const t = useTime();
  const zoom = tween(t, 0.65, 1.55);
  const detail = tween(t, 3.25, 3.6);
  const drift = tween(t, 3.6, 5.5);
  return (
    <Scene duration={5.7}>
      <Heading title="Inventar." />
      <div style={stage}>
        <Window
          src="screens/inventory.png"
          x={240 - 105 * zoom}
          y={-65 + tween(t, 0, 0.45, 60, 0) - 195 * zoom}
          scale={0.94 + 0.28 * zoom}
          rx={5 - 4 * zoom}
          ry={-8 + 7 * zoom}
          rz={1.1 - 0.7 * zoom}
          opacity={1 - detail}
        >
          <Highlight x={658} y={306} w={367} h={515} from={1.45} to={3.25} />
          <Cursor
            path={[
              [0.15, 1270, 750],
              [0.65, 1140, 610],
              [1.6, 844, 493],
              [3.25, 844, 493],
            ]}
            clickAt={3.2}
          />
        </Window>
        <Window
          src="screens/detail.png"
          x={155 - 45 * drift + (1 - detail) * 90}
          y={-45 - 25 * drift}
          scale={1.02 + 0.06 * drift}
          ry={-4 + detail * 4}
          opacity={detail}
        />
      </div>
    </Scene>
  );
}
function Stock() {
  const t = useTime();
  const zoom = tween(t, 1.4, 2.35);
  return (
    <Scene duration={4.7}>
      <Heading title="Bestände." color={green} />
      <div style={stage}>
        <Window
          src="screens/stock.png"
          x={200 - 20 * zoom}
          y={-45 - 410 * zoom}
          scale={0.96 + 0.4 * zoom}
          ry={6 - 6 * zoom}
          rx={3 - 3 * zoom}
          rz={-0.7 + 0.7 * zoom}
        >
          <Highlight
            x={955}
            y={166}
            w={227}
            h={150}
            from={0.7}
            to={1.9}
            color="#efbf83"
          />
          <Highlight
            x={1010}
            y={737}
            w={395}
            h={104}
            from={2.4}
            to={4.3}
            color="#efbf83"
          />
          <Cursor
            path={[
              [0.12, 550, 660],
              [0.85, 1060, 235],
              [2.5, 1100, 777],
              [4.3, 1120, 782],
            ]}
          />
        </Window>
      </div>
    </Scene>
  );
}
function Labels() {
  const t = useTime();
  const appear = tween(t, 0.55, 1.2);
  const scan = tween(t, 1.45, 2.35, 5, 95);
  return (
    <Scene duration={4.2}>
      <Heading title="Ein Scan." />
      <Window
        src="screens/labels.png"
        x={480}
        y={180}
        scale={0.86}
        rx={5}
        ry={tween(t, 0, 3.8, -13, -5)}
        rz={2}
        opacity={0.76}
      />
      <div
        style={{
          position: "absolute",
          left: 260,
          top: 445 + 70 * (1 - appear),
          width: 900,
          height: 425,
          background: "#f7f8fb",
          color: "#171b26",
          borderRadius: 25,
          padding: 46,
          display: "flex",
          gap: 34,
          alignItems: "center",
          boxShadow: "0 50px 120px #000a,0 0 0 1px #ffffff55",
          transform: `perspective(1500px) rotateY(${-12 + appear * 8}deg) rotateZ(${-6 + Math.sin(t * 0.6)}deg) scale(${0.65 + 0.35 * appear})`,
          opacity: appear,
        }}
      >
        <div
          style={{
            position: "relative",
            width: 290,
            height: 290,
            flexShrink: 0,
            background: "white",
          }}
        >
          <QrCode
            value="http://127.0.0.1:3105/r/cd4AAAAAQACAAAAAAAACAQ"
            quietZoneModules={4}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${scan}%`,
              height: 3,
              boxShadow: "0 0 22px #7b69ff",
              background: "#7b69ff",
              opacity: tween(t, 1.3, 1.45) * tween(t, 2.35, 2.55, 1, 0),
            }}
          />
        </div>
        <div>
          <div
            style={{
              fontSize: 17,
              color: "#6b7080",
              letterSpacing: 2,
              marginBottom: 18,
            }}
          >
            WERKSTATT NORD
          </div>
          <div style={{ fontSize: 40, fontWeight: 760, lineHeight: 1.2 }}>
            Akku-Bohrschrauber
            <br />
            18 V
          </div>
          <div style={{ fontSize: 18, marginTop: 18, color: "#777d8b" }}>
            WERK-ABS-18V
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 25,
              color: "#6758d7",
              fontWeight: 650,
            }}
          >
            ↳ Regal A2
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: -25,
            top: -25,
            width: 72,
            height: 72,
            borderRadius: 50,
            display: "grid",
            placeItems: "center",
            background: green,
            color: ink,
            fontSize: 40,
            fontWeight: 750,
            boxShadow: "0 8px 35px #0005",
            opacity: tween(t, 2.45, 2.65),
            transform: `scale(${tween(t, 2.45, 2.8, 0.65, 1)})`,
          }}
        >
          ✓
        </div>
      </div>
    </Scene>
  );
}
function Rooms() {
  const t = useTime();
  return (
    <Scene duration={5.7}>
      <Heading title="Räume in 3D." color={green} />
      <div style={stage}>
        <Window
          src="screens/room.mp4"
          x={235}
          y={-95}
          scale={0.96 + tween(t, 0.4, 5.4, 0, 0.06)}
          rx={tween(t, 0, 5.4, 5, -1)}
          ry={tween(t, 0, 5.4, -10, 8)}
          rz={tween(t, 0, 5.4, -1, 1)}
          video
          playbackRate={1.45}
        >
          <Cursor
            path={[
              [0.15, 1060, 615],
              [1.2, 950, 565],
              [2.7, 700, 530],
              [4.6, 815, 480],
            ]}
          />
        </Window>
      </div>
    </Scene>
  );
}
function Outro() {
  const t = useTime();
  return (
    <Scene duration={1.5}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          transform: `translateY(${tween(t, 0, 0.45, 24, 0)}px)`,
        }}
      >
        <Brand size={112} />
        <div
          style={{ fontSize: 25, color: green, opacity: tween(t, 0.15, 0.4) }}
        >
          github.com/Utzel-Butzel/inventory
        </div>
      </AbsoluteFill>
    </Scene>
  );
}

export function ProductFilm() {
  const { fps } = useVideoConfig();
  const t = useTime();
  const scenes = [
    { from: 0, duration: 1.2, content: <Intro /> },
    { from: 1, duration: 5.7, content: <Inventory /> },
    { from: 6.5, duration: 4.7, content: <Stock /> },
    { from: 11, duration: 4.2, content: <Labels /> },
    { from: 15, duration: 5.7, content: <Rooms /> },
    { from: 20.5, duration: 1.5, content: <Outro /> },
  ];
  return (
    <AbsoluteFill
      style={{
        fontFamily: "Manrope, sans-serif",
        color: white,
        background: ink,
      }}
    >
      <Backdrop />
      <Audio src={staticFile("audio/product-score-fast.wav")} volume={0.7} />
      {scenes.map(({ from, duration, content }) => (
        <Sequence
          key={from}
          from={Math.round(from * fps)}
          durationInFrames={Math.round(duration * fps)}
          premountFor={fps}
        >
          {content}
        </Sequence>
      ))}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 85,
          background: `linear-gradient(transparent,${ink})`,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 108,
          top: 52,
          zIndex: 40,
          opacity: tween(t, 1, 1.2) * tween(t, 20.5, 20.65, 1, 0),
        }}
      >
        <Brand />
      </div>
    </AbsoluteFill>
  );
}
