"use client";

import { useCallback, useRef, useState } from "react";
import { CHANGE_COLORS, type Change } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

type Mode = "old" | "new" | "slider" | "side";

interface Props {
  refUrl: string;
  targetUrl: string;
  width: number;
  height: number;
  changes: Change[];
  visibleIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function CompareView({
  refUrl,
  targetUrl,
  width,
  height,
  changes,
  visibleIds,
  selectedId,
  onSelect,
}: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("slider");
  const [wipe, setWipe] = useState(50);
  const [showBoxes, setShowBoxes] = useState(true);
  const [spotlight, setSpotlight] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const updateWipeFromClientX = useCallback((clientX: number) => {
    const el = sliderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setWipe(Math.min(100, Math.max(0, pct)));
  }, []);

  const onHandleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    updateWipeFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    updateWipeFromClientX(e.clientX);
  };
  const endDrag = () => {
    draggingRef.current = false;
  };

  const shown = changes
    .map((c, i) => ({ c, n: i + 1 }))
    .filter(({ c }) => visibleIds.has(c.id));

  const overlay = (maskId: string) =>
    showBoxes ? (
      <>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="overlay-svg">
          {spotlight && (
            <>
              <defs>
                <mask id={maskId}>
                  <rect x="0" y="0" width="100" height="100" fill="white" />
                  {shown.map(({ c }) => (
                    <rect
                      key={c.id}
                      x={c.bbox[0] * 100}
                      y={c.bbox[1] * 100}
                      width={c.bbox[2] * 100}
                      height={c.bbox[3] * 100}
                      fill="black"
                    />
                  ))}
                </mask>
              </defs>
              <rect x="0" y="0" width="100" height="100" fill="black" opacity="0.55" mask={`url(#${maskId})`} />
            </>
          )}
          {shown.map(({ c }) => {
            const [x, y, w, h] = c.bbox;
            const color = CHANGE_COLORS[c.change_type];
            const isSel = c.id === selectedId;
            return (
              <g key={c.id} style={{ cursor: "pointer" }} onClick={() => onSelect(isSel ? null : c.id)}>
                <rect
                  x={x * 100}
                  y={y * 100}
                  width={w * 100}
                  height={h * 100}
                  fill={isSel ? color : "transparent"}
                  fillOpacity={isSel ? 0.16 : 0}
                  stroke="#000"
                  strokeOpacity={0.85}
                  strokeWidth={isSel ? 5 : 4}
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x={x * 100}
                  y={y * 100}
                  width={w * 100}
                  height={h * 100}
                  fill="none"
                  stroke={color}
                  strokeWidth={isSel ? 3 : 2}
                  vectorEffect="non-scaling-stroke"
                  className={isSel ? "pulse-rect" : undefined}
                />
              </g>
            );
          })}
        </svg>
        {shown.map(({ c, n }) => {
          const [x, y] = c.bbox;
          const color = CHANGE_COLORS[c.change_type];
          return (
            <span
              key={c.id}
              title={c.description}
              onClick={() => onSelect(c.id === selectedId ? null : c.id)}
              style={{
                position: "absolute",
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                transform: "translate(-1px, -100%)",
                background: color,
                color: "#06121f",
                fontSize: 11,
                fontWeight: 800,
                lineHeight: 1,
                padding: "2px 5px",
                borderRadius: "4px 4px 4px 0",
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(0,0,0,0.6)",
                outline: c.id === selectedId ? "2px solid #fff" : "none",
              }}
            >
              {n}
            </span>
          );
        })}
      </>
    ) : null;

  const frameStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    aspectRatio: `${width} / ${height}`,
    overflow: "hidden",
    borderRadius: 8,
    background: "#000",
    userSelect: "none",
  };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <strong>{t("compare.heading")}</strong>
        <div className="row" style={{ gap: 14, fontSize: 13, flexWrap: "wrap" }}>
          <div className="segmented" role="group">
            <button aria-pressed={mode === "old"} onClick={() => setMode("old")} title={t("mode.tipOld")}>
              {t("mode.old")}
            </button>
            <button aria-pressed={mode === "new"} onClick={() => setMode("new")} title={t("mode.tipNew")}>
              {t("mode.new")}
            </button>
            <button aria-pressed={mode === "slider"} onClick={() => setMode("slider")} title={t("mode.tipSlider")}>
              {t("mode.slider")}
            </button>
            <button aria-pressed={mode === "side"} onClick={() => setMode("side")} title={t("mode.tipSide")}>
              {t("mode.side")}
            </button>
          </div>
          <label className="row" style={{ gap: 6 }} title={t("compare.tipOverlays")}>
            <input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} />
            {t("compare.overlays")}
          </label>
          <label className="row" style={{ gap: 6 }} title={t("compare.tipSpotlight")}>
            <input type="checkbox" checked={spotlight} onChange={(e) => setSpotlight(e.target.checked)} />
            {t("compare.spotlight")}
          </label>
        </div>
      </div>

      {mode === "side" ? (
        <div className="row" style={{ gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 280px" }}>
            <div style={frameStyle}>
              <img src={refUrl} alt="earlier" style={imgStyle} draggable={false} />
              {overlay("mask-side-a")}
              <span style={badge("left")}>◀ {t("badge.earlier")}</span>
            </div>
          </div>
          <div style={{ flex: "1 1 280px" }}>
            <div style={frameStyle}>
              <img src={targetUrl} alt="later" style={imgStyle} draggable={false} />
              {overlay("mask-side-b")}
              <span style={badge("right")}>{t("badge.later")} ▶</span>
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={sliderRef}
          style={{ ...frameStyle, cursor: mode === "slider" ? "ew-resize" : "default" }}
          onPointerMove={mode === "slider" ? onPointerMove : undefined}
          onPointerUp={mode === "slider" ? endDrag : undefined}
          onPointerCancel={mode === "slider" ? endDrag : undefined}
        >
          {mode !== "new" && <img src={refUrl} alt="earlier" style={imgStyle} draggable={false} />}
          {mode === "new" && <img src={targetUrl} alt="later" style={imgStyle} draggable={false} />}
          {mode === "slider" && (
            <>
              <img src={targetUrl} alt="later" style={imgStyle} draggable={false} />
              <img
                src={refUrl}
                alt="earlier"
                style={{ ...imgStyle, clipPath: `inset(0 ${100 - wipe}% 0 0)` }}
                draggable={false}
              />
              {/* Draggable divider + knob */}
              <div
                onPointerDown={onHandleDown}
                title={t("compare.tipWipe")}
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${wipe}%`,
                  width: 22,
                  marginLeft: -11,
                  cursor: "ew-resize",
                  touchAction: "none",
                  zIndex: 5,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 10,
                    width: 2,
                    background: "rgba(255,255,255,0.9)",
                    boxShadow: "0 0 4px rgba(0,0,0,0.7)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.95)",
                    border: "2px solid var(--accent)",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
                    userSelect: "none",
                  }}
                />
              </div>
              <span style={badge("left")}>◀ {t("badge.earlier")}</span>
              <span style={badge("right")}>{t("badge.later")} ▶</span>
            </>
          )}
          {overlay("mask-single")}
        </div>
      )}

      <div className="row" style={{ gap: 16, marginTop: 12, fontSize: 13, flexWrap: "wrap" }}>
        <Legend color={CHANGE_COLORS.added} label={t("type.added")} />
        <Legend color={CHANGE_COLORS.removed} label={t("type.removed")} />
        <Legend color={CHANGE_COLORS.modified} label={t("type.modified")} />
        <span className="muted" style={{ marginLeft: "auto" }}>
          {t("compare.showing", { n: shown.length, total: changes.length })}
        </span>
      </div>
    </div>
  );
}

const imgStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, border: `2px solid ${color}`, display: "inline-block" }} />
      {label}
    </span>
  );
}

function badge(side: "left" | "right"): React.CSSProperties {
  return {
    position: "absolute",
    top: 8,
    [side]: 8,
    fontSize: 11,
    padding: "2px 6px",
    borderRadius: 4,
    background: "rgba(0,0,0,0.55)",
    color: "#fff",
  } as React.CSSProperties;
}
