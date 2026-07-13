"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  lonLatToNormalized,
  moveSearchArea,
  resizeSearchArea,
  searchAreaFromDrag,
  searchAreaToOverlayShape,
  type NormalizedPoint,
} from "@/lib/geo";
import type { GeoRef, SearchArea } from "@/lib/types";

interface Props {
  refUrl: string;
  targetUrl: string;
  refGeo: GeoRef;
  targetGeo: GeoRef;
  area: SearchArea;
  pointSet: boolean;
  onChange: (patch: Partial<SearchArea>) => void;
  onClear: () => void;
  disabled?: boolean;
}

type Source = "ref" | "target";

type DragState =
  | { mode: "draw"; start: NormalizedPoint }
  | { mode: "move"; grabOffset: NormalizedPoint }
  | { mode: "resize" }
  | null;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export default function SearchAreaMap({
  refUrl,
  targetUrl,
  refGeo,
  targetGeo,
  area,
  pointSet,
  onChange,
  onClear,
  disabled = false,
}: Props) {
  const { t } = useI18n();
  const [source, setSource] = useState<Source>("ref");
  const [drag, setDrag] = useState<DragState>(null);
  const geo = source === "ref" ? refGeo : targetGeo;

  const overlay = pointSet ? searchAreaToOverlayShape(geo, area) : null;

  function pointFromEvent(e: React.PointerEvent<HTMLDivElement>): NormalizedPoint {
    const rect = e.currentTarget.getBoundingClientRect();
    return { nx: clamp01((e.clientX - rect.left) / rect.width), ny: clamp01((e.clientY - rect.top) / rect.height) };
  }

  // Container-level delegation: everything interactive (the shape body in
  // the SVG, the HTML handle markers) bubbles up here, so a single pointer
  // capture + move/up pair drives draw, move, and resize alike. Handles are
  // plain HTML (not SVG) so they stay perfectly round regardless of the
  // image's aspect ratio — the SVG viewBox is stretched non-uniformly to
  // match the container, which would distort an SVG circle.
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointFromEvent(e);
    const role = (e.target as Element).closest?.("[data-role]")?.getAttribute("data-role");

    if (role === "handle") {
      setDrag({ mode: "resize" });
    } else if (role === "shape") {
      const [cx, cy] = lonLatToNormalized(geo, area.lon, area.lat);
      setDrag({ mode: "move", grabOffset: { nx: p.nx - cx, ny: p.ny - cy } });
    } else {
      setDrag({ mode: "draw", start: p });
      onChange(searchAreaFromDrag(geo, area.shape, p, p));
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag || disabled) return;
    const p = pointFromEvent(e);
    if (drag.mode === "draw") onChange(searchAreaFromDrag(geo, area.shape, drag.start, p));
    else if (drag.mode === "move") onChange(moveSearchArea(geo, p, drag.grabOffset));
    else onChange(resizeSearchArea(geo, area, p));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    setDrag(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  const sizeCaption =
    area.shape === "circle" ? `⌀ ${Math.round(area.radiusM * 2)} m` : `${Math.round(area.widthM)} × ${Math.round(area.heightM)} m`;
  const coordCaption = pointSet ? `${area.lat.toFixed(4)}, ${area.lon.toFixed(4)}` : "";

  const handlePoints: [number, number][] | null = !overlay
    ? null
    : overlay.kind === "ellipse"
      ? [[overlay.cx + overlay.rx, overlay.cy]]
      : [
          [overlay.x, overlay.y],
          [overlay.x + overlay.w, overlay.y],
          [overlay.x, overlay.y + overlay.h],
          [overlay.x + overlay.w, overlay.y + overlay.h],
        ];

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
        <div className="field-label" style={{ marginBottom: 0 }}>
          {t("search.imageSource")}
        </div>
        <div className="segmented">
          <button type="button" aria-pressed={source === "ref"} onClick={() => setSource("ref")}>
            {t("search.imageSource.ref")}
          </button>
          <button type="button" aria-pressed={source === "target"} onClick={() => setSource("target")}>
            {t("search.imageSource.target")}
          </button>
        </div>
      </div>

      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDragStart={(e) => e.preventDefault()}
        style={{
          position: "relative",
          width: "100%",
          lineHeight: 0,
          borderRadius: 10,
          overflow: "hidden",
          background: "#000",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          border: "1px solid var(--border)",
          cursor: disabled ? "not-allowed" : pointSet ? "default" : "crosshair",
        }}
      >
        <img
          src={source === "ref" ? refUrl : targetUrl}
          alt=""
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            userSelect: "none",
            WebkitUserDrag: "none",
            opacity: disabled ? 0.75 : 1,
            transition: "opacity 0.15s ease",
          } as React.CSSProperties}
        />

        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: disabled ? "none" : "all" }}
        >
          {overlay && (
            <>
              {overlay.kind === "ellipse" ? (
                <ellipse
                  data-role="shape"
                  cx={overlay.cx * 100}
                  cy={overlay.cy * 100}
                  rx={overlay.rx * 100}
                  ry={overlay.ry * 100}
                  style={{ ...shapeStyle, cursor: disabled ? "not-allowed" : "move" }}
                />
              ) : (
                <rect
                  data-role="shape"
                  x={overlay.x * 100}
                  y={overlay.y * 100}
                  width={overlay.w * 100}
                  height={overlay.h * 100}
                  style={{ ...shapeStyle, cursor: disabled ? "not-allowed" : "move" }}
                />
              )}

              {(() => {
                const cx = overlay.kind === "ellipse" ? overlay.cx * 100 : (overlay.x + overlay.w / 2) * 100;
                const cy = overlay.kind === "ellipse" ? overlay.cy * 100 : (overlay.y + overlay.h / 2) * 100;
                return (
                  <>
                    <line x1={cx - 2.2} y1={cy} x2={cx + 2.2} y2={cy} style={crosshairStyle} />
                    <line x1={cx} y1={cy - 2.2} x2={cx} y2={cy + 2.2} style={crosshairStyle} />
                  </>
                );
              })()}
            </>
          )}
        </svg>

        {!disabled &&
          handlePoints?.map(([hx, hy], i) => (
            <div
              key={i}
              data-role="handle"
              className="map-handle-hit"
              style={{
                left: `${hx * 100}%`,
                top: `${hy * 100}%`,
                cursor: area.shape === "circle" ? "ew-resize" : "nwse-resize",
              }}
            >
              <span className="map-handle-dot" />
            </div>
          ))}

        {!disabled && !pointSet && (
          <div className="map-hint-bar">
            <span aria-hidden>✛</span>
            {t("search.drawHint")}
          </div>
        )}

        {pointSet && !disabled && (
          <button type="button" onClick={onClear} title={t("search.clearTip")} className="map-clear-btn">
            ✕ {t("search.clear")}
          </button>
        )}

        {pointSet && (
          <div className="map-caption-bar">
            <span className="map-caption-badge">
              {sizeCaption} · {coordCaption}
            </span>
            {disabled ? (
              <span className="map-caption-hint">🔒 {t("run.locked")}</span>
            ) : (
              <span className="map-caption-hint">{t("search.dragMoveHint")}</span>
            )}
          </div>
        )}

        {!pointSet && disabled && (
          <div className="map-caption-bar" style={{ justifyContent: "center" }}>
            <span className="map-caption-badge">🔒 {t("run.locked")}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const shapeStyle: React.CSSProperties = {
  fill: "var(--accent-soft)",
  stroke: "var(--accent)",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeDasharray: "0.1 2.6",
  vectorEffect: "non-scaling-stroke",
  pointerEvents: "all",
};

const crosshairStyle: React.CSSProperties = {
  stroke: "#fff",
  strokeWidth: 1,
  strokeOpacity: 0.9,
  vectorEffect: "non-scaling-stroke",
  pointerEvents: "none",
};
