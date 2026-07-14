import { loadFont } from "@remotion/fonts";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import type { FC, ReactNode } from "react";
import {
  AbsoluteFill,
  Composition,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1350;
const TRANSITION_FRAMES = 15;
const SCENE_DURATIONS = [135, 165, 180, 180, 165, 165] as const;
const TOTAL_FRAMES =
  SCENE_DURATIONS.reduce((total, duration) => total + duration, 0) -
  TRANSITION_FRAMES * (SCENE_DURATIONS.length - 1);

const FONT_FAMILY = "Geist";
const FONT_WEIGHTS = ["400", "500", "600", "700", "800"] as const;

void Promise.all(
  FONT_WEIGHTS.map((weight) =>
    loadFont({
      family: FONT_FAMILY,
      url: staticFile("fonts/geist-variable.woff2"),
      format: "woff2",
      weight,
      display: "block",
    }),
  ),
);

const COLORS = {
  background: "#070a0f",
  surface: "#0d121a",
  surfaceRaised: "#121924",
  border: "#253142",
  borderSoft: "rgba(112, 139, 174, 0.20)",
  text: "#f6f8fb",
  muted: "#9da9b8",
  accent: "#2f91ff",
  accentSoft: "rgba(47, 145, 255, 0.14)",
  success: "#43d17d",
  warning: "#f4b860",
};

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

type FilmProps = {
  repository: string;
};

type SceneProps = {
  index: number;
};

const CheckIcon: FC<{ size?: number; color?: string }> = ({
  size = 30,
  color = COLORS.success,
}) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <path
      d="m7 16.5 5.6 5.6L25 9.8"
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="3.2"
    />
  </svg>
);

const FileIcon: FC<{ size?: number }> = ({ size = 46 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <path
      d="M11 5h17l9 9v29H11z"
      fill="rgba(47,145,255,0.12)"
      stroke={COLORS.accent}
      strokeLinejoin="round"
      strokeWidth="2.4"
    />
    <path d="M28 5v10h9" fill="none" stroke={COLORS.accent} strokeWidth="2.4" />
    <path
      d="M17 24h14M17 30h14M17 36h9"
      fill="none"
      stroke={COLORS.muted}
      strokeLinecap="round"
      strokeWidth="2.2"
    />
  </svg>
);

const Background: FC<{ tint?: "blue" | "green" | "amber" }> = ({
  tint = "blue",
}) => {
  const frame = useCurrentFrame();
  const glows = {
    blue: "rgba(47, 145, 255, 0.17)",
    green: "rgba(67, 209, 125, 0.14)",
    amber: "rgba(244, 184, 96, 0.13)",
  };

  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        backgroundColor: COLORS.background,
        backgroundImage: `radial-gradient(circle at 82% 10%, ${glows[tint]}, transparent 34%), radial-gradient(circle at 10% 80%, rgba(47,145,255,0.07), transparent 36%), linear-gradient(150deg, #070a0f 0%, #0a0f17 100%)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.2,
          backgroundImage:
            "linear-gradient(rgba(98,125,158,0.075) 1px, transparent 1px), linear-gradient(90deg, rgba(98,125,158,0.075) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "linear-gradient(to bottom, black 0%, transparent 86%)",
          translate: `0 ${interpolate(frame, [0, 240], [0, -18], clamp)}px`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 610,
          height: 610,
          right: -365,
          top: -290,
          border: `1px solid ${COLORS.borderSoft}`,
          borderRadius: 999,
          scale: interpolate(frame, [0, 240], [0.96, 1.05], clamp),
        }}
      />
    </AbsoluteFill>
  );
};

const BrandBar: FC = () => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        top: 52,
        left: 82,
        right: 82,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        opacity: interpolate(frame, [0, 16], [0, 1], {
          ...clamp,
          easing: easeOut,
        }),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Img
          src={staticFile("tawreed-logo.png")}
          style={{ width: 48, height: 48, objectFit: "contain" }}
        />
        <span
          style={{
            color: COLORS.text,
            fontSize: 31,
            fontWeight: 700,
            letterSpacing: -0.9,
          }}
        >
          Tawreed
        </span>
      </div>
      <span
        style={{
          color: COLORS.muted,
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: 1.8,
        }}
      >
        PORTABLE DESKTOP APP
      </span>
    </div>
  );
};

const Progress: FC<{ active: number }> = ({ active }) => (
  <div
    style={{
      position: "absolute",
      left: 82,
      right: 82,
      bottom: 58,
      zIndex: 20,
      display: "flex",
      alignItems: "center",
      gap: 12,
    }}
  >
    {SCENE_DURATIONS.map((duration, index) => (
      <div
        key={`${duration}-${index}`}
        style={{
          height: 5,
          flex: 1,
          borderRadius: 999,
          backgroundColor: index <= active ? COLORS.accent : COLORS.border,
          opacity: index === active ? 1 : 0.55,
        }}
      />
    ))}
  </div>
);

const SceneLayout: FC<{
  index: number;
  children: ReactNode;
  tint?: "blue" | "green" | "amber";
  showBrand?: boolean;
}> = ({ index, children, tint, showBrand = true }) => (
  <AbsoluteFill
    style={{
      backgroundColor: COLORS.background,
      color: COLORS.text,
      fontFamily: FONT_FAMILY,
    }}
  >
    <Background tint={tint} />
    {showBrand ? <BrandBar /> : null}
    {children}
    <Progress active={index} />
  </AbsoluteFill>
);

const Headline: FC<{
  kicker: string;
  title: string;
  copy: string;
  top?: number;
  align?: "left" | "center";
}> = ({ kicker, title, copy, top = 150, align = "left" }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 82,
        right: 82,
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: 18,
        textAlign: align,
        opacity: interpolate(frame, [0, 18], [0, 1], {
          ...clamp,
          easing: easeOut,
        }),
        translate: `0 ${interpolate(frame, [0, 18], [34, 0], {
          ...clamp,
          easing: easeOut,
        })}px`,
      }}
    >
      <span
        style={{
          color: COLORS.accent,
          fontSize: 25,
          fontWeight: 700,
          letterSpacing: 3.4,
        }}
      >
        {kicker}
      </span>
      <h1
        style={{
          maxWidth: align === "center" ? 920 : 900,
          margin: 0,
          color: COLORS.text,
          fontSize: 88,
          fontWeight: 700,
          letterSpacing: -4.5,
          lineHeight: 0.98,
          whiteSpace: "pre-line",
        }}
      >
        {title}
      </h1>
      <p
        style={{
          maxWidth: 880,
          margin: 0,
          color: COLORS.muted,
          fontSize: 38,
          fontWeight: 450,
          letterSpacing: -1,
          lineHeight: 1.25,
        }}
      >
        {copy}
      </p>
    </div>
  );
};

const ProductWindow: FC<{
  screenshot: string;
  label: string;
  top?: number;
  cursor?: { left: number; top: number; clickFrame: number };
}> = ({ screenshot, label, top = 525, cursor }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 80,
        width: 920,
        height: 560,
        overflow: "hidden",
        border: "1px solid rgba(105, 151, 207, 0.34)",
        borderRadius: 24,
        backgroundColor: COLORS.surface,
        boxShadow: "0 36px 110px rgba(0,0,0,0.52)",
        opacity: interpolate(frame, [12, 30], [0, 1], {
          ...clamp,
          easing: easeOut,
        }),
        translate: `0 ${interpolate(frame, [12, 30], [42, 0], {
          ...clamp,
          easing: easeOut,
        })}px`,
      }}
    >
      <div
        style={{
          height: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 18px",
          borderBottom: `1px solid ${COLORS.border}`,
          backgroundColor: COLORS.surfaceRaised,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          {[COLORS.warning, COLORS.accent, COLORS.success].map((color) => (
            <span
              key={color}
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                backgroundColor: color,
              }}
            />
          ))}
        </div>
        <span
          style={{
            color: COLORS.muted,
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: 1.3,
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ position: "relative", height: 516, overflow: "hidden" }}>
        <Img
          src={staticFile(screenshot)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            scale: interpolate(frame, [15, 165], [1.005, 1.025], clamp),
          }}
        />
        {cursor ? (
          <div
            style={{
              position: "absolute",
              left: cursor.left,
              top: cursor.top,
              width: 52,
              height: 60,
              opacity: interpolate(frame, [24, 40], [0, 1], {
                ...clamp,
                easing: easeOut,
              }),
              translate: `${interpolate(frame, [24, 55], [46, 0], {
                ...clamp,
                easing: easeOut,
              })}px ${interpolate(frame, [24, 55], [32, 0], {
                ...clamp,
                easing: easeOut,
              })}px`,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: -15,
                top: -15,
                width: 54,
                height: 54,
                border: `3px solid ${COLORS.accent}`,
                borderRadius: 999,
                opacity: interpolate(
                  frame,
                  [cursor.clickFrame - 2, cursor.clickFrame + 18],
                  [0.9, 0],
                  clamp,
                ),
                scale: interpolate(
                  frame,
                  [cursor.clickFrame - 2, cursor.clickFrame + 18],
                  [0.5, 1.7],
                  clamp,
                ),
              }}
            />
            <svg width="45" height="54" viewBox="0 0 46 54" aria-hidden="true">
              <path
                d="M4 3L40 29L24 32L17 49L4 3Z"
                fill={COLORS.text}
                stroke={COLORS.background}
                strokeLinejoin="round"
                strokeWidth="4"
              />
            </svg>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const IntroScene: FC<SceneProps> = ({ index }) => {
  const frame = useCurrentFrame();
  return (
    <SceneLayout index={index} showBrand={false}>
      <div
        style={{
          position: "absolute",
          inset: "0 82px 88px",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: 28,
        }}
      >
        <div
          style={{
            width: 116,
            height: 116,
            display: "grid",
            placeItems: "center",
            border: "1px solid rgba(47,145,255,0.34)",
            borderRadius: 28,
            backgroundColor: COLORS.accentSoft,
            boxShadow: "0 28px 100px rgba(47,145,255,0.18)",
            opacity: interpolate(frame, [0, 18], [0, 1], {
              ...clamp,
              easing: easeOut,
            }),
            scale: interpolate(frame, [0, 22], [0.82, 1], {
              ...clamp,
              easing: easeOut,
            }),
          }}
        >
          <Img
            src={staticFile("tawreed-logo.png")}
            style={{ width: 84, height: 84, objectFit: "contain" }}
          />
        </div>
        <span
          style={{
            color: COLORS.accent,
            fontSize: 27,
            fontWeight: 700,
            letterSpacing: 4.1,
            opacity: interpolate(frame, [8, 25], [0, 1], {
              ...clamp,
              easing: easeOut,
            }),
          }}
        >
          MEET TAWREED
        </span>
        <h1
          style={{
            margin: 0,
            color: COLORS.text,
            fontSize: 108,
            fontWeight: 700,
            letterSpacing: -6.2,
            lineHeight: 0.94,
            whiteSpace: "pre-line",
            opacity: interpolate(frame, [10, 30], [0, 1], {
              ...clamp,
              easing: easeOut,
            }),
            translate: `0 ${interpolate(frame, [10, 30], [42, 0], {
              ...clamp,
              easing: easeOut,
            })}px`,
          }}
        >
          {"BOQs are dense.\nDecisions shouldn't be."}
        </h1>
        <p
          style={{
            maxWidth: 860,
            margin: 0,
            color: COLORS.muted,
            fontSize: 42,
            fontWeight: 450,
            lineHeight: 1.24,
            letterSpacing: -1.2,
            opacity: interpolate(frame, [20, 40], [0, 1], {
              ...clamp,
              easing: easeOut,
            }),
          }}
        >
          Turn an Excel bill of quantities into clear, validated work packages.
        </p>
      </div>
    </SceneLayout>
  );
};

const InputScene: FC<SceneProps> = ({ index }) => (
  <SceneLayout index={index}>
    <Headline
      kicker="ONE FOCUSED START"
      title={"Choose one\nworkbook."}
      copy="Tawreed inspects the BOQ before anything can be exported."
      top={145}
    />
    <ProductWindow
      screenshot="product/workbench.png"
      label="TAWREED / WORKBENCH"
      top={520}
      cursor={{ left: 735, top: 365, clickFrame: 92 }}
    />
  </SceneLayout>
);

const ProcessScene: FC<SceneProps> = ({ index }) => {
  const frame = useCurrentFrame();
  const stages = [
    { title: "Inspect", copy: "Read structure and quantities" },
    { title: "Classify", copy: "Assign practical work packages" },
    { title: "Validate", copy: "Confirm complete item coverage" },
  ];

  return (
    <SceneLayout index={index}>
      <Headline
        kicker="CONTROLLED PROCESS"
        title={"Structure every\nline of work."}
        copy="Three clear phases. No black-box dashboard."
        top={145}
      />
      <div
        style={{
          position: "absolute",
          top: 565,
          left: 82,
          right: 82,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {stages.map((stage, stageIndex) => {
          const start = 30 + stageIndex * 28;
          const completeAt = start + 24;
          const complete = frame >= completeAt;
          return (
            <div
              key={stage.title}
              style={{
                minHeight: 126,
                display: "grid",
                gridTemplateColumns: "68px 1fr auto",
                alignItems: "center",
                gap: 24,
                padding: "24px 28px",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 20,
                backgroundColor: COLORS.surfaceRaised,
                boxShadow: complete ? "0 24px 70px rgba(0,0,0,0.18)" : "none",
                opacity: interpolate(frame, [start, start + 16], [0, 1], {
                  ...clamp,
                  easing: easeOut,
                }),
                translate: `${interpolate(frame, [start, start + 16], [40, 0], {
                  ...clamp,
                  easing: easeOut,
                })}px 0`,
              }}
            >
              <div
                style={{
                  width: 58,
                  height: 58,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 17,
                  backgroundColor: complete
                    ? "rgba(67,209,125,0.13)"
                    : COLORS.accentSoft,
                  color: complete ? COLORS.success : COLORS.accent,
                  fontSize: 26,
                  fontWeight: 700,
                }}
              >
                {complete ? <CheckIcon /> : `0${stageIndex + 1}`}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ color: COLORS.text, fontSize: 40, fontWeight: 650 }}>
                  {stage.title}
                </span>
                <span style={{ color: COLORS.muted, fontSize: 28, fontWeight: 450 }}>
                  {stage.copy}
                </span>
              </div>
              <span
                style={{
                  color: complete ? COLORS.success : COLORS.muted,
                  fontSize: 24,
                  fontWeight: 650,
                }}
              >
                {complete ? "Complete" : "Working"}
              </span>
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: 82,
          right: 82,
          bottom: 116,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: COLORS.success,
          fontSize: 31,
          fontWeight: 650,
          opacity: interpolate(frame, [108, 126], [0, 1], {
            ...clamp,
            easing: easeOut,
          }),
        }}
      >
        <span>18 of 18 items classified</span>
        <CheckIcon size={38} />
      </div>
    </SceneLayout>
  );
};

const ReviewScene: FC<SceneProps> = ({ index }) => (
  <SceneLayout index={index} tint="amber">
    <Headline
      kicker="REVIEW THE SIGNAL"
      title={"Clarity before\ncommitment."}
      copy="See counts, coverage, and warnings—then make the decision."
      top={145}
    />
    <ProductWindow
      screenshot="product/review.png"
      label="TAWREED / REVIEW"
      top={520}
      cursor={{ left: 742, top: 388, clickFrame: 112 }}
    />
  </SceneLayout>
);

const ExportScene: FC<SceneProps> = ({ index }) => {
  const frame = useCurrentFrame();
  const facts = ["Master audit sheet", "12 package sheets", "Local run history"];

  return (
    <SceneLayout index={index} tint="green">
      <Headline
        kicker="YOU STAY IN CONTROL"
        title={"Approve once.\nExport cleanly."}
        copy="The deliverable is created only after your review."
        top={145}
      />
      <div
        style={{
          position: "absolute",
          top: 590,
          left: 125,
          right: 125,
          minHeight: 390,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 30,
          padding: "46px 54px",
          border: "1px solid rgba(67,209,125,0.34)",
          borderRadius: 28,
          backgroundColor: "rgba(13,18,26,0.92)",
          boxShadow: "0 42px 120px rgba(0,0,0,0.45)",
          opacity: interpolate(frame, [18, 38], [0, 1], {
            ...clamp,
            easing: easeOut,
          }),
          scale: interpolate(frame, [18, 42], [0.92, 1], {
            ...clamp,
            easing: easeOut,
          }),
        }}
      >
        <div
          style={{
            width: 88,
            height: 88,
            display: "grid",
            placeItems: "center",
            borderRadius: 24,
            backgroundColor: "rgba(67,209,125,0.13)",
          }}
        >
          <FileIcon size={58} />
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: COLORS.text, fontSize: 38, fontWeight: 650 }}>
            BOQ_Master_work_packages.xlsx
          </div>
          <div
            style={{
              marginTop: 10,
              color: COLORS.success,
              fontSize: 28,
              fontWeight: 600,
            }}
          >
            Workbook generated
          </div>
        </div>
        <div
          style={{
            width: "100%",
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 14,
          }}
        >
          {facts.map((fact, factIndex) => (
            <div
              key={fact}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                color: COLORS.muted,
                fontSize: 28,
                fontWeight: 500,
                opacity: interpolate(
                  frame,
                  [58 + factIndex * 14, 72 + factIndex * 14],
                  [0, 1],
                  { ...clamp, easing: easeOut },
                ),
                translate: `${interpolate(
                  frame,
                  [58 + factIndex * 14, 72 + factIndex * 14],
                  [24, 0],
                  { ...clamp, easing: easeOut },
                )}px 0`,
              }}
            >
              <CheckIcon size={28} />
              {fact}
            </div>
          ))}
        </div>
      </div>
    </SceneLayout>
  );
};

const FinalScene: FC<SceneProps & FilmProps> = ({ index, repository }) => {
  const frame = useCurrentFrame();
  const attributes = ["Portable", "Local-first", "Open source"];

  return (
    <SceneLayout index={index} showBrand={false}>
      <div
        style={{
          position: "absolute",
          inset: "0 82px 88px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 30,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 144,
            height: 144,
            display: "grid",
            placeItems: "center",
            border: "1px solid rgba(47,145,255,0.34)",
            borderRadius: 34,
            backgroundColor: COLORS.accentSoft,
            boxShadow: "0 30px 110px rgba(47,145,255,0.22)",
            opacity: interpolate(frame, [0, 20], [0, 1], {
              ...clamp,
              easing: easeOut,
            }),
            scale: interpolate(frame, [0, 24], [0.82, 1], {
              ...clamp,
              easing: easeOut,
            }),
          }}
        >
          <Img
            src={staticFile("tawreed-logo.png")}
            style={{ width: 104, height: 104, objectFit: "contain" }}
          />
        </div>
        <span
          style={{
            color: COLORS.accent,
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 4,
            opacity: interpolate(frame, [10, 28], [0, 1], {
              ...clamp,
              easing: easeOut,
            }),
          }}
        >
          TAWREED
        </span>
        <h1
          style={{
            maxWidth: 930,
            margin: 0,
            color: COLORS.text,
            fontSize: 102,
            fontWeight: 700,
            letterSpacing: -5.5,
            lineHeight: 0.96,
            whiteSpace: "pre-line",
            opacity: interpolate(frame, [14, 34], [0, 1], {
              ...clamp,
              easing: easeOut,
            }),
            translate: `0 ${interpolate(frame, [14, 34], [40, 0], {
              ...clamp,
              easing: easeOut,
            })}px`,
          }}
        >
          {"From BOQ to\nwork-ready structure."}
        </h1>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 14,
            flexWrap: "wrap",
            opacity: interpolate(frame, [28, 46], [0, 1], {
              ...clamp,
              easing: easeOut,
            }),
          }}
        >
          {attributes.map((attribute) => (
            <span
              key={attribute}
              style={{
                padding: "12px 20px",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 999,
                backgroundColor: COLORS.surfaceRaised,
                color: COLORS.muted,
                fontSize: 25,
                fontWeight: 600,
              }}
            >
              {attribute}
            </span>
          ))}
        </div>
        <div
          style={{
            width: "100%",
            maxWidth: 860,
            marginTop: 18,
            padding: "24px 28px",
            border: "1px solid rgba(47,145,255,0.42)",
            borderRadius: 18,
            backgroundColor: COLORS.surfaceRaised,
            color: COLORS.text,
            fontSize: 34,
            fontWeight: 600,
            letterSpacing: -0.8,
            opacity: interpolate(frame, [42, 62], [0, 1], {
              ...clamp,
              easing: easeOut,
            }),
            scale: interpolate(frame, [42, 62], [0.96, 1], {
              ...clamp,
              easing: easeOut,
            }),
          }}
        >
          {repository}
        </div>
        <span
          style={{
            color: COLORS.muted,
            fontSize: 28,
            fontWeight: 500,
            opacity: interpolate(frame, [56, 74], [0, 1], {
              ...clamp,
              easing: easeOut,
            }),
          }}
        >
          Built for construction QS teams.
        </span>
      </div>
    </SceneLayout>
  );
};

export const TawreedProductFilm: FC<FilmProps> = ({ repository }) => (
  <AbsoluteFill style={{ backgroundColor: COLORS.background }}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[0]}>
        <IntroScene index={0} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[1]}>
        <InputScene index={1} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-bottom" })}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[2]}>
        <ProcessScene index={2} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[3]}>
        <ReviewScene index={3} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[4]}>
        <ExportScene index={4} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={SCENE_DURATIONS[5]}>
        <FinalScene index={5} repository={repository} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);

export const TawreedProductFilmComposition: FC = () => (
  <Composition
    id="TawreedProductFilm"
    component={TawreedProductFilm}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    defaultProps={{ repository: "github.com/sfkareem/tawreed" }}
  />
);
