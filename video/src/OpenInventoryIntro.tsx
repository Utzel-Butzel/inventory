import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
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

const UI_WIDTH = 1600;
const UI_HEIGHT = 900;

const colors = {
  background: "#0d0f14",
  panel: "#ffffff",
  canvas: "#f5f6f8",
  surfaceSoft: "#f8f9fb",
  ink: "#17191c",
  muted: "#69717e",
  faint: "#9ca4af",
  border: "#e2e5e9",
  darkBorder: "rgba(255,255,255,0.12)",
  violet: "#6258ee",
  violetDark: "#4e43d8",
  violetSoft: "#eeedff",
  mint: "#8ff0cc",
  mintDark: "#11734d",
  mintSoft: "#e8f7f0",
  amber: "#f2b86b",
};

const fontFamily =
  "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const monoFamily =
  "'SFMono-Regular', Consolas, 'Liberation Mono', ui-monospace, monospace";
const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const easeInOut = Easing.bezier(0.45, 0, 0.55, 1);

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

const rangeOpacity = (
  frame: number,
  start: number,
  end: number,
  edge = 10,
) =>
  progress(frame, start, start + edge) *
  (1 - progress(frame, end - edge, end, Easing.in(Easing.cubic)));

const cameraValue = (
  frame: number,
  frames: number[],
  values: number[],
) =>
  interpolate(frame, frames, values, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeInOut,
  });

const Icon = ({
  name,
  size = 20,
  stroke = "currentColor",
  strokeWidth = 2,
}: {
  name: "box" | "camera" | "check" | "plus" | "search" | "sparkles";
  size?: number;
  stroke?: string;
  strokeWidth?: number;
}) => {
  const paths = {
    box: (
      <>
        <path d="m4 7 8-4 8 4-8 4-8-4Z" />
        <path d="M4 7v10l8 4 8-4V7M12 11v10" />
      </>
    ),
    camera: (
      <>
        <path d="M4 7h3l1.5-2h7L17 7h3v11H4V7Z" />
        <circle cx="12" cy="12.5" r="3.3" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    sparkles: (
      <>
        <path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3L12 3Z" />
        <path d="m18.5 13 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
        <path d="m5 14 1 2.8L9 18l-3 1.2L5 22l-1-2.8L1 18l3-1.2L5 14Z" />
      </>
    ),
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
};

const PackageMark = ({ size = 46 }: { size?: number }) => (
  <div
    style={{
      width: size,
      height: size,
      display: "grid",
      placeItems: "center",
      borderRadius: size * 0.28,
      color: "white",
      background: `linear-gradient(145deg, #8177ff, ${colors.violetDark})`,
      boxShadow:
        "0 14px 34px rgba(98,88,238,0.32), inset 0 1px 0 rgba(255,255,255,0.28)",
    }}
  >
    <Icon name="box" size={size * 0.54} strokeWidth={2.1} />
  </div>
);

const AmbientBackground = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const drift = interpolate(frame, [0, durationInFrames], [0, 50], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: colors.background }}>
      <AbsoluteFill
        style={{
          opacity: 0.28,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "68px 68px",
          backgroundPosition: `${drift}px ${drift * 0.55}px`,
          maskImage:
            "radial-gradient(ellipse at center, black 28%, transparent 84%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 980,
          height: 720,
          left: -290,
          top: -390,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(98,88,238,0.28), transparent 68%)",
          filter: "blur(28px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 820,
          height: 720,
          right: -280,
          bottom: -410,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(143,240,204,0.18), transparent 70%)",
          filter: "blur(30px)",
        }}
      />
    </AbsoluteFill>
  );
};

const PhaseChip = () => {
  const frame = useCurrentFrame();
  const hudOpacity = 1 - progress(frame, 414, 430, Easing.in(Easing.cubic));
  const phases = [
    { start: 0, end: 72, index: "01", label: "Eintrag anlegen" },
    { start: 70, end: 164, index: "02", label: "Foto hinzufügen" },
    { start: 162, end: 274, index: "03", label: "KI-Vorschlag prüfen" },
    { start: 272, end: 334, index: "04", label: "Speichern" },
    { start: 332, end: 423, index: "05", label: "Wiederfinden" },
  ];

  return (
    <div
      style={{
        position: "absolute",
        top: 38,
        left: 80,
        right: 80,
        height: 48,
        zIndex: 100,
        fontFamily,
        opacity: hudOpacity,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          display: "flex",
          alignItems: "center",
          gap: 14,
          color: "white",
        }}
      >
        <PackageMark size={42} />
        <div
          style={{
            fontSize: 20,
            fontWeight: 680,
            letterSpacing: "-0.035em",
          }}
        >
          Open Inventory
        </div>
      </div>

      {phases.map((phase) => {
        const opacity = rangeOpacity(frame, phase.start, phase.end, 8);
        const enter = progress(frame, phase.start, phase.start + 12);
        return (
          <div
            key={phase.index}
            style={{
              position: "absolute",
              right: 0,
              top: -5,
              height: 56,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "0 22px",
              borderRadius: 999,
              border: `1px solid ${colors.darkBorder}`,
              color: "rgba(255,255,255,0.78)",
              background: "rgba(255,255,255,0.055)",
              backdropFilter: "blur(18px)",
              opacity,
              transform: `translateY(${(1 - enter) * 10}px)`,
              fontSize: 26,
              fontWeight: 650,
            }}
          >
            <span
              style={{
                fontFamily: monoFamily,
                color: colors.mint,
                fontSize: 18,
                letterSpacing: "0.08em",
              }}
            >
              {phase.index}
            </span>
            {phase.label}
          </div>
        );
      })}
    </div>
  );
};

const SidebarItem = ({
  label,
  active = false,
}: {
  label: string;
  active?: boolean;
}) => (
  <div
    style={{
      height: 42,
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "0 14px",
      borderRadius: 12,
      color: active ? colors.violetDark : "#68707c",
      background: active ? colors.violetSoft : "transparent",
      fontSize: 14,
      fontWeight: active ? 650 : 520,
    }}
  >
    <span
      style={{
        width: 17,
        height: 17,
        border: `1.8px solid ${active ? colors.violet : "#a5abb4"}`,
        borderRadius: label === "Overview" ? 5 : 4,
      }}
    />
    {label}
  </div>
);

const InventoryCard = ({
  title,
  description,
  location,
  status,
  tint,
  style,
  image,
  highlighted = false,
}: {
  title: string;
  description: string;
  location: string;
  status: string;
  tint: string;
  style?: CSSProperties;
  image?: boolean;
  highlighted?: boolean;
}) => (
  <div
    style={{
      position: "absolute",
      width: 392,
      height: 286,
      overflow: "hidden",
      borderRadius: 20,
      border: highlighted
        ? `2px solid ${colors.violet}`
        : `1px solid ${colors.border}`,
      background: "white",
      boxShadow: highlighted
        ? "0 24px 60px rgba(98,88,238,0.2)"
        : "0 10px 30px rgba(20,25,38,0.055)",
      ...style,
    }}
  >
    <div
      style={{
        position: "relative",
        height: 166,
        overflow: "hidden",
        background: tint,
      }}
    >
      {image ? (
        <Img
          src={staticFile("marketing/usecase-makerspace.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "25% 68%",
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "#99a4b2",
          }}
        >
          <Icon name="box" size={44} strokeWidth={1.5} />
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: 14,
          top: 14,
          padding: "6px 10px",
          borderRadius: 999,
          color: status === "Wartung" ? "#94520a" : colors.mintDark,
          background: status === "Wartung" ? "#fff2e2" : colors.mintSoft,
          fontSize: 11,
          fontWeight: 750,
        }}
      >
        {status}
      </div>
    </div>
    <div style={{ padding: "17px 18px" }}>
      <div
        style={{
          color: colors.ink,
          fontSize: 17,
          fontWeight: 700,
          letterSpacing: "-0.025em",
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 7,
          overflow: "hidden",
          color: colors.muted,
          fontSize: 12,
          lineHeight: 1.4,
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        {description}
      </div>
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: `1px solid #eff1f3`,
          color: "#7d8590",
          fontSize: 11,
        }}
      >
        ◎&nbsp; {location}
      </div>
    </div>
  </div>
);

const Field = ({
  label,
  children,
  opacity,
}: {
  label: string;
  children: ReactNode;
  opacity: number;
}) => (
  <div
    style={{
      opacity,
      transform: `translateY(${(1 - opacity) * 14}px)`,
    }}
  >
    <div
      style={{
        marginBottom: 7,
        color: "#747c88",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {label}
    </div>
    <div
      style={{
        minHeight: 48,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 14px",
        border: `1px solid ${colors.border}`,
        borderRadius: 13,
        color: colors.ink,
        background: colors.surfaceSoft,
        fontSize: 14,
        fontWeight: 620,
      }}
    >
      {children}
    </div>
  </div>
);

const EditorSheet = ({ sheetOpen }: { sheetOpen: number }) => {
  const frame = useCurrentFrame();
  const uploaded = progress(frame, 113, 138);
  const analyzing = progress(frame, 165, 177) * (1 - progress(frame, 201, 215));
  const ready = progress(frame, 201, 219);
  const title = progress(frame, 205, 221);
  const type = progress(frame, 216, 232);
  const tags = progress(frame, 227, 243);
  const saveReady = progress(frame, 236, 250);
  const saveClick = progress(frame, 269, 274) * (1 - progress(frame, 274, 281));

  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 20,
          opacity: sheetOpen * 0.48,
          background: "#11131a",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          zIndex: 21,
          width: 640,
          height: "100%",
          padding: "30px 34px",
          borderLeft: `1px solid ${colors.border}`,
          background: "white",
          boxShadow: "-36px 0 90px rgba(19,24,38,0.18)",
          transform: `translateX(${(1 - sheetOpen) * 660}px)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div>
            <div
              style={{
                color: colors.violet,
                fontFamily: monoFamily,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              Neuer Eintrag
            </div>
            <div
              style={{
                marginTop: 8,
                color: colors.ink,
                fontSize: 27,
                fontWeight: 720,
                letterSpacing: "-0.04em",
              }}
            >
              Foto hinzufügen
            </div>
          </div>
          <div
            style={{
              marginLeft: "auto",
              color: colors.faint,
              fontSize: 18,
            }}
          >
            ×
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            left: 34,
            right: 34,
            top: 116,
            height: 298,
            overflow: "hidden",
            border: uploaded
              ? `1px solid ${colors.border}`
              : "1.5px dashed #c9ced6",
            borderRadius: 20,
            background: uploaded ? "#17191c" : colors.surfaceSoft,
          }}
        >
          <Img
            src={staticFile("marketing/usecase-makerspace.png")}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "31% 64%",
              opacity: uploaded,
              transform: `scale(${1.08 - uploaded * 0.08})`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              opacity: 1 - uploaded,
            }}
          >
            <div
              style={{
                width: 58,
                height: 58,
                display: "grid",
                placeItems: "center",
                borderRadius: 17,
                color: colors.violet,
                background: colors.violetSoft,
              }}
            >
              <Icon name="camera" size={26} />
            </div>
            <div
              style={{
                marginTop: 18,
                color: colors.ink,
                fontSize: 16,
                fontWeight: 680,
              }}
            >
              Foto auswählen
            </div>
            <div style={{ marginTop: 7, color: colors.faint, fontSize: 12 }}>
              JPG, PNG oder HEIC
            </div>
          </div>
          <div
            style={{
              position: "absolute",
              left: 14,
              right: 14,
              bottom: 14,
              height: 44,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 13px",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 12,
              color: "white",
              background: "rgba(10,12,16,0.7)",
              backdropFilter: "blur(14px)",
              opacity: uploaded,
              fontSize: 12,
              fontWeight: 620,
            }}
          >
            <Icon name="camera" size={16} stroke={colors.mint} />
            werkzeugkoffer.jpg
            <span style={{ marginLeft: "auto", color: colors.mint }}>
              Hochgeladen
            </span>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            left: 34,
            right: 34,
            top: 438,
            height: 58,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 11,
            borderRadius: 15,
            color: ready ? colors.mintDark : "white",
            background: ready ? colors.mintSoft : colors.violet,
            boxShadow: ready
              ? "none"
              : "0 14px 30px rgba(98,88,238,0.22)",
            opacity: uploaded,
            transform: `scale(${1 - analyzing * 0.015})`,
            fontSize: 14,
            fontWeight: 720,
          }}
        >
          <div
            style={{
              transform: analyzing ? `rotate(${frame * 9}deg)` : undefined,
            }}
          >
            <Icon
              name={ready ? "check" : "sparkles"}
              size={19}
              stroke={ready ? colors.mintDark : "white"}
            />
          </div>
          {analyzing
            ? "Foto wird analysiert …"
            : ready
              ? "Vorschlag bereit"
              : "Mit KI analysieren"}
        </div>

        <div
          style={{
            position: "absolute",
            left: 34,
            right: 34,
            top: 522,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
          }}
        >
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Name" opacity={title}>
              Werkzeugkoffer
              <span style={{ marginLeft: "auto", color: colors.mintDark }}>
                <Icon name="check" size={16} strokeWidth={2.4} />
              </span>
            </Field>
          </div>
          <Field label="Typ" opacity={type}>
            Werkzeug
          </Field>
          <Field label="Status" opacity={type}>
            Verfügbar
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Tags" opacity={tags}>
              {["Werkstatt", "mobil", "Koffer"].map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: "5px 8px",
                    borderRadius: 999,
                    color: colors.violetDark,
                    background: colors.violetSoft,
                    fontSize: 11,
                    fontWeight: 720,
                  }}
                >
                  {tag}
                </span>
              ))}
            </Field>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            left: 34,
            right: 34,
            bottom: 30,
            height: 58,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            borderRadius: 15,
            color: "white",
            background: colors.ink,
            opacity: saveReady,
            transform: `translateY(${(1 - saveReady) * 18}px) scale(${1 - saveClick * 0.025})`,
            fontSize: 14,
            fontWeight: 720,
          }}
        >
          <Icon name="check" size={18} />
          Eintrag speichern
        </div>
      </div>
    </>
  );
};

const ClickPulse = ({
  at,
  x,
  y,
}: {
  at: number;
  x: number;
  y: number;
}) => {
  const frame = useCurrentFrame();
  const pulse = progress(frame, at, at + 16, Easing.out(Easing.cubic));
  const visible = frame >= at && frame <= at + 16;
  if (!visible) return null;
  return (
    <div
      style={{
        position: "absolute",
        zIndex: 54,
        left: x,
        top: y,
        width: 36,
        height: 36,
        border: `3px solid ${colors.violet}`,
        borderRadius: "50%",
        opacity: 1 - pulse,
        transform: `translate(-50%, -50%) scale(${0.28 + pulse * 1.9})`,
        boxShadow: `0 0 0 8px rgba(98,88,238,${0.15 * (1 - pulse)})`,
      }}
    />
  );
};

const Cursor = () => {
  const frame = useCurrentFrame();
  const keyframes = [
    0, 18, 59, 71, 100, 114, 145, 164, 196, 214, 230, 246, 263, 272,
    304, 330, 344, 370, 401, 411, 432, 449,
  ];
  const x = cameraValue(frame, keyframes, [
    1520, 1520, 1460, 1460, 1280, 1280, 1280, 1280, 1420, 1140, 1140,
    1140, 1320, 1320, 1120, 380, 380, 380, 600, 600, 1510, 1510,
  ]);
  const y = cameraValue(frame, keyframes, [
    830, 830, 39, 39, 360, 360, 468, 468, 474, 560, 645, 730, 834, 834,
    580, 246, 246, 246, 520, 520, 810, 810,
  ]);
  const clickTimes = [67, 113, 164, 271, 335, 410];
  const pressed = Math.max(
    ...clickTimes.map((at) =>
      progress(frame, at - 2, at + 2) * (1 - progress(frame, at + 2, at + 7)),
    ),
  );
  const analysisPassive =
    progress(frame, 176, 185) * (1 - progress(frame, 205, 215));
  const typingPassive =
    progress(frame, 340, 348) * (1 - progress(frame, 367, 376));
  const opacity =
    progress(frame, 12, 25) *
    (1 - progress(frame, 426, 443)) *
    (1 - analysisPassive * 0.48) *
    (1 - typingPassive * 0.5);

  return (
    <div
      style={{
        position: "absolute",
        zIndex: 55,
        left: x,
        top: y,
        opacity,
        transform: `translate(-4px, -3px) scale(${1 - pressed * 0.12})`,
        transformOrigin: "4px 3px",
        filter: "drop-shadow(0 8px 8px rgba(0,0,0,0.28))",
      }}
    >
      <svg width="38" height="48" viewBox="0 0 38 48" aria-hidden="true">
        <path
          d="M4 3.5v31.2l8.5-8.1 6.8 16 6.8-3-6.9-15.6h12L4 3.5Z"
          fill="white"
          stroke="#151820"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

const InventoryApp = () => {
  const frame = useCurrentFrame();
  const sheetIn = progress(frame, 70, 94);
  const sheetOut = progress(frame, 273, 296, Easing.in(Easing.cubic));
  const sheetOpen = sheetIn * (1 - sheetOut);
  const saved = progress(frame, 287, 310);
  const toast = progress(frame, 291, 307) * (1 - progress(frame, 352, 366));
  const filter = progress(frame, 360, 385);
  const resultHover = progress(frame, 382, 402);
  const fullQuery = "Werkzeugkoffer";
  const letters = Math.floor(
    interpolate(frame, [338, 369], [0, fullQuery.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const query = fullQuery.slice(0, letters);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.16)",
        borderRadius: 30,
        background: colors.canvas,
        boxShadow:
          "0 60px 160px rgba(0,0,0,0.48), 0 0 0 8px rgba(255,255,255,0.025)",
      }}
    >
      <aside
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 240,
          padding: "22px 18px",
          borderRight: `1px solid ${colors.border}`,
          background: "#fbfbfc",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 4px",
          }}
        >
          <PackageMark size={38} />
          <span
            style={{
              color: colors.ink,
              fontSize: 15,
              fontWeight: 720,
              letterSpacing: "-0.025em",
            }}
          >
            Open Inventory
          </span>
        </div>
        <div style={{ marginTop: 32 }}>
          <div
            style={{
              padding: "0 12px 9px",
              color: "#a0a7b1",
              fontFamily: monoFamily,
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            Workspace
          </div>
          <SidebarItem label="Übersicht" />
          <SidebarItem label="Inventar" active />
          <SidebarItem label="Bestand" />
          <SidebarItem label="Standorte" />
          <SidebarItem label="Batch Studio" />
        </div>
        <div style={{ marginTop: 30 }}>
          <div
            style={{
              padding: "0 12px 9px",
              color: "#a0a7b1",
              fontFamily: monoFamily,
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            Verwalten
          </div>
          <SidebarItem label="Einstellungen" />
        </div>
      </aside>

      <header
        style={{
          position: "absolute",
          left: 240,
          right: 0,
          top: 0,
          height: 76,
          display: "flex",
          alignItems: "center",
          padding: "0 32px",
          borderBottom: `1px solid ${colors.border}`,
          background: "rgba(255,255,255,0.96)",
        }}
      >
        <span style={{ color: "#a0a7b0", fontSize: 13 }}>Workspace</span>
        <span style={{ margin: "0 10px", color: "#c2c7ce" }}>›</span>
        <span style={{ color: colors.ink, fontSize: 13, fontWeight: 680 }}>
          Inventar
        </span>
        <div
          style={{
            marginLeft: "auto",
            width: 230,
            height: 40,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 13px",
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            color: "#9ba2ad",
            background: colors.surfaceSoft,
            fontSize: 12,
          }}
        >
          <Icon name="search" size={16} />
          Suchen …
        </div>
        <div
          style={{
            width: 134,
            height: 44,
            marginLeft: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            borderRadius: 13,
            color: "white",
            background: colors.violet,
            boxShadow: "0 12px 26px rgba(98,88,238,0.24)",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          <Icon name="plus" size={17} />
          Eintrag
        </div>
      </header>

      <main
        style={{
          position: "absolute",
          left: 240,
          right: 0,
          top: 76,
          bottom: 0,
          overflow: "hidden",
          padding: "34px 36px",
          background: colors.canvas,
        }}
      >
        <div
          style={{
            color: colors.mintDark,
            fontFamily: monoFamily,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
          }}
        >
          Inventarbibliothek
        </div>
        <div
          style={{
            marginTop: 10,
            color: colors.ink,
            fontSize: 34,
            fontWeight: 740,
            letterSpacing: "-0.055em",
          }}
        >
          Alles wiederfindbar.
        </div>
        <div style={{ marginTop: 10, color: colors.muted, fontSize: 14 }}>
          Werkzeuge, Objekte und Orte zentral erfassen und organisieren.
        </div>

        <div
          style={{
            position: "absolute",
            left: 36,
            right: 36,
            top: 164,
            height: 72,
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            border: `1px solid ${
              frame >= 330 && frame <= 388 ? "#ada7ff" : colors.border
            }`,
            borderRadius: 17,
            background: "white",
            boxShadow:
              frame >= 330 && frame <= 388
                ? "0 0 0 4px rgba(98,88,238,0.10)"
                : "0 8px 26px rgba(20,25,38,0.045)",
          }}
        >
          <Icon name="search" size={20} stroke="#9199a4" />
          <span
            style={{
              marginLeft: 12,
              color: query ? colors.ink : "#a1a8b2",
              fontSize: 15,
              fontWeight: query ? 620 : 480,
            }}
          >
            {query || "Name, Beschreibung, SKU, Tag oder Standort suchen …"}
          </span>
          {frame >= 338 && frame < 372 ? (
            <span
              style={{
                width: 2,
                height: 22,
                marginLeft: 2,
                background: colors.violet,
                opacity: frame % 16 < 11 ? 1 : 0,
              }}
            />
          ) : null}
          <span
            style={{
              marginLeft: "auto",
              color: colors.muted,
              fontSize: 12,
            }}
          >
            {filter > 0.55 ? "1 Treffer" : saved > 0.5 ? "4 Einträge" : "3 Einträge"}
          </span>
        </div>

        <div style={{ opacity: 1 - filter }}>
          <InventoryCard
            title="Sony FX30 Kamera-Kit"
            description="Cinema-Kamera mit Cage, Akkus und Ladegerät."
            location="Medienraum · Schrank 4"
            status="Wartung"
            tint="linear-gradient(145deg,#edf3f3,#f6f3ec)"
            style={{
              left: 36,
              top: 268,
              opacity: 1 - saved,
              transform: `translateY(${saved * 16}px) scale(${1 - saved * 0.025})`,
            }}
          />
          <InventoryCard
            title="USM Haller Sideboard"
            description="Modulares Stauraumelement mit Klapptüren."
            location="Studio · Ostwand"
            status="Verfügbar"
            tint="linear-gradient(145deg,#edf7f3,#f7f5eb)"
            style={{ left: 448, top: 268 }}
          />
          <InventoryCard
            title="Prusa MK4S"
            description="FDM-Drucker für Prototypen und Werkstattteile."
            location="Print Lab · Werkbank 2"
            status="Verfügbar"
            tint="linear-gradient(145deg,#f0f7f2,#eef2f7)"
            style={{ left: 860, top: 268 }}
          />
        </div>

        <InventoryCard
          title="Werkzeugkoffer"
          description="Mobiler Koffer für Handwerkzeuge und Zubehör."
          location="Werkstatt · Werkbank 1"
          status="Verfügbar"
          tint="#eceff1"
          image
          highlighted={resultHover > 0.4}
          style={{
            left: 36,
            top: 268,
            opacity: saved,
            transform: `translateY(${(1 - saved) * 28 - resultHover * 8}px) scale(${0.96 + saved * 0.04})`,
          }}
        />

        <div
          style={{
            position: "absolute",
            right: 34,
            top: 28,
            height: 48,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 16px",
            border: "1px solid #ccebdd",
            borderRadius: 14,
            color: colors.mintDark,
            background: colors.mintSoft,
            boxShadow: "0 18px 40px rgba(17,115,77,0.12)",
            opacity: toast,
            transform: `translateY(${(1 - toast) * -16}px)`,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          <Icon name="check" size={17} strokeWidth={2.5} />
          Werkzeugkoffer gespeichert
        </div>
      </main>

      <EditorSheet sheetOpen={sheetOpen} />

      {[
        { at: 67, x: 1460, y: 39 },
        { at: 113, x: 1280, y: 360 },
        { at: 164, x: 1280, y: 468 },
        { at: 271, x: 1320, y: 834 },
        { at: 335, x: 380, y: 246 },
        { at: 410, x: 600, y: 520 },
      ].map((click) => (
        <ClickPulse key={click.at} {...click} />
      ))}
      <Cursor />
    </div>
  );
};

const CameraStage = () => {
  const frame = useCurrentFrame();
  const cameraFrames = [
    0, 28, 54, 72, 95, 116, 145, 170, 205, 244, 276, 306, 330, 348, 380,
    410, 428, 449,
  ];
  const scale = cameraValue(frame, cameraFrames, [
    0.84, 0.92, 1, 1.08, 1.06, 1.15, 1.14, 1.18, 1.18, 1.2, 1.12,
    0.95, 0.99, 1.12, 1.08, 1.15, 1.06, 0.9,
  ]);
  const x = cameraValue(frame, cameraFrames, [
    0, 0, -100, -170, -280, -340, -300, -330, -330, -350, -300, 0, 20,
    -70, 0, 190, 120, 0,
  ]);
  const y = cameraValue(frame, cameraFrames, [
    32, 20, 100, 150, 20, 48, 0, -5, -45, -150, -160, 0, -85, 135, 40,
    -75, -50, 18,
  ]);
  const enter = progress(frame, 0, 25);
  const exit = progress(frame, 416, 441, Easing.in(Easing.cubic));

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "54%",
        width: UI_WIDTH,
        height: UI_HEIGHT,
        opacity: enter * (1 - exit * 0.92),
        transform: `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0) scale(${scale})`,
        transformOrigin: "center center",
        willChange: "transform",
      }}
    >
      <InventoryApp />
    </div>
  );
};

const EndLockup = ({
  brandName,
  tagline,
}: Pick<OpenInventoryIntroProps, "brandName" | "tagline">) => {
  const frame = useCurrentFrame();
  const enter = progress(frame, 422, 440);
  const exit = progress(frame, 444, 449, Easing.in(Easing.cubic));
  const opacity = enter * (1 - exit);
  return (
    <AbsoluteFill
      style={{
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        background: `rgba(13,15,20,${enter * 0.97})`,
        fontFamily,
        opacity,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          transform: `translateY(${(1 - enter) * 28}px) scale(${0.96 + enter * 0.04})`,
        }}
      >
        <PackageMark size={82} />
        <div>
          <div
            style={{
              fontSize: 52,
              fontWeight: 700,
              letterSpacing: "-0.055em",
            }}
          >
            {brandName}
          </div>
          <div
            style={{
              marginTop: 8,
              color: colors.mint,
              fontSize: 32,
              fontWeight: 620,
              letterSpacing: "-0.02em",
            }}
          >
            {tagline}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const OpenInventoryIntro: React.FC<OpenInventoryIntroProps> = (props) => {
  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        background: colors.background,
        fontFamily,
      }}
    >
      <AmbientBackground />
      <PhaseChip />
      <CameraStage />
      <EndLockup brandName={props.brandName} tagline={props.tagline} />
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          boxShadow: "inset 0 0 180px rgba(0,0,0,0.32)",
        }}
      />
    </AbsoluteFill>
  );
};
