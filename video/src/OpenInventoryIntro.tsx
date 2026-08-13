import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const INTRO_FPS = 30;
export const INTRO_DURATION_IN_FRAMES = 15 * INTRO_FPS;

export type OpenInventoryIntroProps = {
  brandName: string;
  tagline: string;
  badges: string[];
};

const colors = {
  background: "#101217",
  panel: "#17191f",
  panelSoft: "#1d2027",
  foreground: "#f6f7f9",
  muted: "#9ba2ae",
  border: "rgba(255, 255, 255, 0.11)",
  violet: "#675ee5",
  violetBright: "#9b94ff",
  mint: "#8ff0cc",
  mintInk: "#17382d",
};

const fontFamily =
  "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const monoFamily =
  "'SFMono-Regular', Consolas, 'Liberation Mono', ui-monospace, monospace";
const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const easeIn = Easing.bezier(0.7, 0, 0.84, 0);

const progress = (
  frame: number,
  from: number,
  to: number,
  easing = easeOut,
) =>
  interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

const sceneOpacity = (
  frame: number,
  enterEnd: number,
  exitStart?: number,
  exitEnd?: number,
) => {
  const enter = progress(frame, 0, enterEnd);
  if (exitStart === undefined || exitEnd === undefined) return enter;
  return enter * (1 - progress(frame, exitStart, exitEnd, easeIn));
};

const Scene = ({
  children,
  opacity,
  style,
}: {
  children: ReactNode;
  opacity: number;
  style?: CSSProperties;
}) => (
  <AbsoluteFill
    style={{
      opacity,
      fontFamily,
      color: colors.foreground,
      ...style,
    }}
  >
    {children}
  </AbsoluteFill>
);

const AmbientBackground = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const drift = interpolate(frame, [0, durationInFrames], [0, 54], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glow = interpolate(frame, [0, durationInFrames], [-30, 70], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <AbsoluteFill
        style={{
          opacity: 0.38,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          backgroundPosition: `${drift}px ${drift * 0.55}px`,
          maskImage:
            "radial-gradient(ellipse at center, black 20%, transparent 84%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 780,
          height: 780,
          left: -260 + glow,
          top: -330,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(103,94,229,0.32), rgba(103,94,229,0) 68%)",
          filter: "blur(20px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 700,
          height: 700,
          right: -210 - glow * 0.35,
          bottom: -360,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(143,240,204,0.22), rgba(143,240,204,0) 70%)",
          filter: "blur(24px)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 38%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

const PackageMark = ({
  size = 88,
  draw = 1,
}: {
  size?: number;
  draw?: number;
}) => {
  const dashOffset = 150 * (1 - draw);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.27,
        display: "grid",
        placeItems: "center",
        background: `linear-gradient(145deg, ${colors.violetBright}, ${colors.violet})`,
        boxShadow:
          "0 20px 60px rgba(103,94,229,0.34), inset 0 1px 0 rgba(255,255,255,0.28)",
      }}
    >
      <svg
        width={size * 0.61}
        height={size * 0.61}
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M9 19 25 10l16 9-16 9L9 19Z"
          stroke="white"
          strokeWidth="4"
          strokeLinejoin="round"
          strokeDasharray="150"
          strokeDashoffset={dashOffset}
        />
        <path
          d="M9 19v19l16 9V28M41 19v19l-16 9"
          stroke="white"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="150"
          strokeDashoffset={dashOffset}
        />
        <path
          d="m31 34 10-6 14 8-14 8-10-6v-4Z"
          fill={colors.mint}
          stroke={colors.mint}
          strokeWidth="2"
          strokeLinejoin="round"
          opacity={draw}
        />
      </svg>
    </div>
  );
};

const Eyebrow = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      fontFamily: monoFamily,
      fontSize: 18,
      fontWeight: 700,
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      color: colors.mint,
    }}
  >
    {children}
  </div>
);

const Reveal = ({
  children,
  frame,
  from,
  distance = 48,
  style,
}: {
  children: ReactNode;
  frame: number;
  from: number;
  distance?: number;
  style?: CSSProperties;
}) => {
  const reveal = progress(frame, from, from + 20);
  return (
    <div style={{ overflow: "hidden", ...style }}>
      <div
        style={{
          opacity: reveal,
          transform: `translateY(${(1 - reveal) * distance}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
};

const Pill = ({
  label,
  accent = colors.mint,
  delay,
  frame,
}: {
  label: string;
  accent?: string;
  delay: number;
  frame: number;
}) => {
  const enter = progress(frame, delay, delay + 16);
  return (
    <div
      style={{
        opacity: enter,
        transform: `translateY(${(1 - enter) * 22}px) scale(${0.94 + enter * 0.06})`,
        height: 50,
        padding: "0 20px",
        borderRadius: 999,
        display: "flex",
        alignItems: "center",
        gap: 11,
        border: `1px solid ${colors.border}`,
        background: "rgba(255,255,255,0.065)",
        boxShadow: "0 14px 36px rgba(0,0,0,0.22)",
        backdropFilter: "blur(16px)",
        fontSize: 18,
        fontWeight: 650,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: accent,
          boxShadow: `0 0 0 6px ${accent}20`,
        }}
      />
      {label}
    </div>
  );
};

const BrandHook = ({ brandName }: Pick<OpenInventoryIntroProps, "brandName">) => {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, 18, 76, 104);
  const mark = progress(frame, 0, 26);
  const word = progress(frame, 15, 42);
  const focus = progress(frame, 0, 32);

  return (
    <Scene
      opacity={opacity}
      style={{ alignItems: "center", justifyContent: "center" }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          transform: `scale(${0.92 + mark * 0.08})`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: -66,
            opacity: focus,
            transform: `scale(${1.1 - focus * 0.1})`,
          }}
        >
          {[
            [0, 0, "0deg"],
            [1, 0, "90deg"],
            [1, 1, "180deg"],
            [0, 1, "270deg"],
          ].map(([x, y, rotate], index) => (
            <div
              key={index}
              style={{
                position: "absolute",
                left: x === 0 ? 0 : undefined,
                right: x === 1 ? 0 : undefined,
                top: y === 0 ? 0 : undefined,
                bottom: y === 1 ? 0 : undefined,
                width: 34,
                height: 34,
                borderLeft: `3px solid ${colors.mint}`,
                borderTop: `3px solid ${colors.mint}`,
                borderTopLeftRadius: 7,
                transform: `rotate(${rotate})`,
              }}
            />
          ))}
        </div>

        <PackageMark size={116} draw={mark} />
        <div
          style={{
            marginTop: 34,
            opacity: word,
            transform: `translateY(${(1 - word) * 30}px)`,
            fontSize: 72,
            fontWeight: 650,
            letterSpacing: "-0.055em",
          }}
        >
          {brandName}
        </div>
        <div
          style={{
            marginTop: 18,
            opacity: progress(frame, 34, 56),
            fontFamily: monoFamily,
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: colors.muted,
          }}
        >
          Inventar in Sekunden · MIT Open Source
        </div>
      </div>
    </Scene>
  );
};

const CaptureScene = () => {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, 22, 145, 179);
  const panel = progress(frame, 8, 34);
  const shutter = interpolate(frame, [44, 48, 53], [0, 0.82, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scanLine = interpolate(frame, [34, 110], [70, 560], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  return (
    <Scene opacity={opacity} style={{ backgroundColor: colors.background }}>
      <div
        style={{
          position: "absolute",
          left: 112,
          top: 192,
          width: 720,
          zIndex: 2,
        }}
      >
        <Reveal frame={frame} from={0}>
          <Eyebrow>Ein Foto · ein prüfbarer Eintrag</Eyebrow>
        </Reveal>
        <Reveal frame={frame} from={10} distance={70}>
          <div
            style={{
              marginTop: 32,
              fontSize: 92,
              lineHeight: 0.98,
              letterSpacing: "-0.065em",
              fontWeight: 650,
            }}
          >
            Foto aufnehmen.
            <span
              style={{
                display: "block",
                marginTop: 9,
                color: colors.violetBright,
              }}
            >
              Vorschlag prüfen.
            </span>
          </div>
        </Reveal>
        <Reveal frame={frame} from={30}>
          <div
            style={{
              marginTop: 30,
              maxWidth: 610,
              color: colors.muted,
              fontSize: 23,
              lineHeight: 1.48,
              letterSpacing: "-0.018em",
            }}
          >
            Name, Typ, Tags und Details entstehen als Entwurf. Du entscheidest,
            was gespeichert wird.
          </div>
        </Reveal>
        <div style={{ display: "flex", gap: 12, marginTop: 38 }}>
          <Pill label="Erfassen" frame={frame} delay={50} />
          <Pill
            label="Prüfen"
            frame={frame}
            delay={59}
            accent={colors.violetBright}
          />
          <Pill label="Speichern" frame={frame} delay={68} accent="#f2b86b" />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 92,
          top: 140,
          width: 850,
          height: 720,
          opacity: panel,
          transform: `perspective(1400px) translateX(${(1 - panel) * 160}px) rotateY(${-7 + panel * 7}deg) scale(${0.95 + panel * 0.05})`,
          transformOrigin: "right center",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 34,
            overflow: "hidden",
            border: `1px solid ${colors.border}`,
            background: "#07080a",
            boxShadow:
              "0 46px 120px rgba(0,0,0,0.46), 0 0 0 8px rgba(255,255,255,0.025)",
          }}
        >
          <Img
            src={staticFile("marketing/usecase-makerspace.png")}
            style={{
              position: "absolute",
              inset: 0,
              height: "100%",
              width: "100%",
              objectFit: "cover",
              objectPosition: "51% center",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(90deg, #07080a 0%, rgba(7,8,10,0.75) 9%, transparent 28%, transparent 100%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 32,
              right: 32,
              top: scanLine,
              height: 2,
              opacity: progress(frame, 34, 44) * (1 - progress(frame, 105, 116)),
              background: `linear-gradient(90deg, transparent, ${colors.mint}, transparent)`,
              boxShadow: `0 0 22px ${colors.mint}`,
            }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            top: -18,
            left: 30,
            padding: "12px 16px",
            borderRadius: 13,
            background: colors.mint,
            color: colors.mintInk,
            fontFamily: monoFamily,
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            boxShadow: "0 14px 36px rgba(0,0,0,0.26)",
          }}
        >
          Bereit zur Prüfung
        </div>
      </div>
      <AbsoluteFill
        style={{
          opacity: shutter,
          background: "white",
          mixBlendMode: "screen",
        }}
      />
    </Scene>
  );
};

const ProductProofScene = () => {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, 20, 116, 149);
  const desktop = progress(frame, 0, 28);
  const phone = progress(frame, 19, 48);
  const headline = progress(frame, 8, 32);
  const float = interpolate(frame, [0, 150], [0, -18], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Scene
      opacity={opacity}
      style={{
        backgroundColor: colors.background,
        backgroundImage:
          "linear-gradient(180deg, rgba(103,94,229,0.06), rgba(16,18,23,0.98) 92%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 104,
          top: 68,
          opacity: headline,
          transform: `translateY(${(1 - headline) * 32}px)`,
          zIndex: 5,
        }}
      >
        <Eyebrow>Konkrete Daten · jede Bewegung nachvollziehbar</Eyebrow>
        <div
          style={{
            marginTop: 16,
            fontSize: 63,
            fontWeight: 650,
            letterSpacing: "-0.06em",
          }}
        >
          Scannen. Buchen. <span style={{ color: colors.mint }}>Wiederfinden.</span>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 104,
          top: 238 + float,
          width: 1390,
          height: 740,
          opacity: desktop,
          transform: `perspective(1500px) translateX(${(1 - desktop) * -170}px) rotateY(${(1 - desktop) * 8}deg) scale(${0.96 + desktop * 0.04})`,
          transformOrigin: "left center",
          borderRadius: 31,
          border: `1px solid ${colors.border}`,
          background: colors.panel,
          boxShadow: "0 48px 120px rgba(0,0,0,0.5)",
          padding: 13,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 13,
            borderRadius: 20,
            overflow: "hidden",
            background: "#f4f5f7",
          }}
        >
          <Img
            src={staticFile("marketing/inventory-mock-data.jpg")}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
            }}
          />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 96,
          top: 188 + float * 0.45,
          width: 360,
          height: 778,
          opacity: phone,
          transform: `perspective(1200px) translateX(${(1 - phone) * 160}px) rotateY(${(1 - phone) * -9}deg) scale(${0.94 + phone * 0.06})`,
          transformOrigin: "right center",
          padding: 11,
          borderRadius: 46,
          border: "1px solid rgba(255,255,255,0.18)",
          background: "#12141a",
          boxShadow:
            "0 50px 120px rgba(0,0,0,0.58), 0 0 0 8px rgba(255,255,255,0.025)",
          overflow: "hidden",
          zIndex: 4,
        }}
      >
        <div
          style={{
            height: "100%",
            overflow: "hidden",
            borderRadius: 36,
            background: "white",
          }}
        >
          <Img
            src={staticFile("marketing/mobile-inventory.jpg")}
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            top: 18,
            left: "50%",
            width: 92,
            height: 22,
            transform: "translateX(-50%)",
            borderRadius: 999,
            background: "#101217",
          }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          right: 110,
          top: 94,
          opacity: progress(frame, 38, 58),
          display: "flex",
          gap: 10,
          zIndex: 6,
        }}
      >
        {[
          ["Bulk + serialisiert", colors.violetBright],
          ["Web + mobil", colors.mint],
        ].map(([label, accent]) => (
          <div
            key={label}
            style={{
              padding: "12px 16px",
              borderRadius: 999,
              border: `1px solid ${colors.border}`,
              background: "rgba(23,25,31,0.82)",
              color: accent,
              fontFamily: monoFamily,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              backdropFilter: "blur(14px)",
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </Scene>
  );
};

const EndCard = ({
  brandName,
  tagline,
  badges,
}: OpenInventoryIntroProps) => {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, 22, 86, 104);
  const card = progress(frame, 0, 28);
  const text = progress(frame, 12, 38);
  const badgeProgress = progress(frame, 28, 60);
  const iconFloat = interpolate(frame, [0, 105], [10, -8], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.sin),
  });
  const emphasizedTagline = "in Sekunden.";
  const taglineLead = tagline.endsWith(emphasizedTagline)
    ? tagline.slice(0, -emphasizedTagline.length).trim()
    : tagline;

  return (
    <Scene
      opacity={opacity}
      style={{
        background:
          "radial-gradient(circle at 73% 48%, rgba(103,94,229,0.24), transparent 29%), rgba(16,18,23,0.97)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 190,
          top: 222,
          width: 920,
          opacity: text,
          transform: `translateY(${(1 - text) * 50}px)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <PackageMark size={102} draw={card} />
          <div
            style={{
              fontSize: 76,
              fontWeight: 650,
              letterSpacing: "-0.058em",
            }}
          >
            {brandName}
          </div>
        </div>
        <div
          style={{
            marginTop: 54,
            maxWidth: 900,
            fontSize: 82,
            fontWeight: 650,
            letterSpacing: "-0.065em",
            lineHeight: 1.02,
          }}
        >
          {taglineLead}
          <span style={{ display: "block", color: colors.violetBright }}>
            {tagline.endsWith(emphasizedTagline) ? emphasizedTagline : ""}
          </span>
        </div>
        <div
          style={{
            marginTop: 44,
            display: "flex",
            gap: 12,
            opacity: badgeProgress,
            transform: `translateY(${(1 - badgeProgress) * 24}px)`,
          }}
        >
          {badges.map((badge, index) => (
            <div
              key={badge}
              style={{
                padding: "12px 16px",
                borderRadius: 999,
                border: `1px solid ${colors.border}`,
                background:
                  index === 0
                    ? "rgba(143,240,204,0.12)"
                    : "rgba(255,255,255,0.055)",
                color: index === 0 ? colors.mint : "#c8cdd5",
                fontFamily: monoFamily,
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {badge}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 194,
          top: 210 + iconFloat,
          width: 440,
          height: 440,
          opacity: card,
          transform: `perspective(1200px) rotateY(${(1 - card) * -12}deg) rotateZ(${(1 - card) * 3}deg) scale(${0.9 + card * 0.1})`,
          transformOrigin: "right center",
          borderRadius: 78,
          padding: 13,
          border: `1px solid ${colors.border}`,
          background: "rgba(255,255,255,0.055)",
          boxShadow:
            "0 50px 140px rgba(0,0,0,0.54), 0 0 90px rgba(103,94,229,0.16)",
        }}
      >
        <Img
          src={staticFile("marketing/ios-app-icon-current.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: 66,
          }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          left: 190,
          right: 190,
          bottom: 62,
          height: 1,
          background:
            "linear-gradient(90deg, rgba(143,240,204,0.55), rgba(103,94,229,0.45), transparent)",
          transformOrigin: "left center",
          transform: `scaleX(${progress(frame, 20, 72)})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 190,
          bottom: 38,
          opacity: progress(frame, 45, 70),
          color: colors.muted,
          fontFamily: monoFamily,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.13em",
          textTransform: "uppercase",
        }}
      >
        Alles wiederfindbar.
      </div>
    </Scene>
  );
};

export const OpenInventoryIntro: React.FC<OpenInventoryIntroProps> = (props) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.background,
        fontFamily,
        overflow: "hidden",
      }}
    >
      <AmbientBackground />

      <Sequence durationInFrames={105} premountFor={fps}>
        <BrandHook brandName={props.brandName} />
      </Sequence>
      <Sequence from={75} durationInFrames={180} premountFor={fps}>
        <CaptureScene />
      </Sequence>
      <Sequence from={225} durationInFrames={150} premountFor={fps}>
        <ProductProofScene />
      </Sequence>
      <Sequence from={345} durationInFrames={105} premountFor={fps}>
        <EndCard {...props} />
      </Sequence>

      <AbsoluteFill
        style={{
          pointerEvents: "none",
          boxShadow: "inset 0 0 180px rgba(0,0,0,0.32)",
        }}
      />
    </AbsoluteFill>
  );
};
