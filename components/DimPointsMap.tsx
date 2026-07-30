"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  dimPointToOverlayShape,
  lonLatToNormalized,
  moveSearchArea,
  normalizedToLonLat,
  resizeSearchArea,
  type NormalizedPoint,
} from "@/lib/geo";
import { formatLonLatIn, type CoordSystem } from "@/lib/crs";
import { dimPointToArea, isDimPointPlaced, type DimPoint, type GeoRef } from "@/lib/types";

interface Props {
  refUrl: string;
  targetUrl: string;
  refGeo: GeoRef;
  targetGeo: GeoRef;
  points: DimPoint[];
  selectedId: string | null;
  crs: CoordSystem;
  onSelect: (id: string | null) => void;
  onChangePoint: (id: string, patch: Partial<DimPoint>) => void;
  // Called when the user clicks empty image space — places the currently
  // selected point if it has no position yet, otherwise adds a new one.
  onPlaceAt: (lon: number, lat: number) => void;
  disabled?: boolean;
}

type Source = "ref" | "target";

type DragState =
  | { mode: "move"; id: string; grabOffset: NormalizedPoint }
  | { mode: "resize"; id: string }
  | null;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Image preview for the DIM-point mode: every placed point is drawn as its
// search circle, the selected one gets a resize handle, and clicking empty
// space drops a new point. Same interaction vocabulary as the single-area map
// (SearchAreaMap), fanned out over a list.
export default function DimPointsMap({
  refUrl,
  targetUrl,
  refGeo,
  targetGeo,
  points,
  selectedId,
  crs,
  onSelect,
  onChangePoint,
  onPlaceAt,
  disabled = false,
}: Props) {
  const { t } = useI18n();
  const [source, setSource] = useState<Source>("ref");
  const [drag, setDrag] = useState<DragState>(null);
  const geo = source === "ref" ? refGeo : targetGeo;

  const placed = points.filter(isDimPointPlaced);
  const selected = placed.find((p) => p.id === selectedId) ?? null;

  function pointFromEvent(e: React.PointerEvent<HTMLDivElement>): NormalizedPoint {
    const rect = e.currentTarget.getBoundingClientRect();
    return { nx: clamp01((e.clientX - rect.left) / rect.width), ny: clamp01((e.clientY - rect.top) / rect.height) };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    const p = pointFromEvent(e);
    const el = (e.target as Element).closest?.("[data-role]");
    const role = el?.getAttribute("data-role");
    const id = el?.getAttribute("data-id");

    if (role === "handle" && id) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ mode: "resize", id });
      return;
    }
    if (role === "shape" && id) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const target = placed.find((q) => q.id === id);
      if (!target) return;
      onSelect(id);
      const [cx, cy] = lonLatToNormalized(geo, target.lon, target.lat);
      setDrag({ mode: "move", id, grabOffset: { nx: p.nx - cx, ny: p.ny - cy } });
      return;
    }

    const [lon, lat] = normalizedToLonLat(geo, p.nx, p.ny);
    onPlaceAt(lon, lat);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag || disabled) return;
    const p = pointFromEvent(e);
    const target = points.find((q) => q.id === drag.id);
    if (!target) return;
    if (drag.mode === "move") {
      onChangePoint(drag.id, moveSearchArea(geo, p, drag.grabOffset));
    } else {
      const { radiusM } = resizeSearchArea(geo, dimPointToArea(target), p);
      onChangePoint(drag.id, { radiusM });
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    setDrag(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  const selectedShape = selected ? dimPointToOverlayShape(geo, selected) : null;
  const handlePoint: [number, number] | null =
    selectedShape && selectedShape.kind === "ellipse"
      ? [selectedShape.cx + selectedShape.rx, selectedShape.cy]
      : null;

  return (
    <div>
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}
      >
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
          cursor: disabled ? "not-allowed" : "crosshair",
        }}
      >
        <img
          src={source === "ref" ? refUrl : targetUrl}
          alt=""
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          style={
            {
              width: "100%",
              height: "auto",
              display: "block",
              userSelect: "none",
              WebkitUserDrag: "none",
              opacity: disabled ? 0.75 : 1,
              transition: "opacity 0.15s ease",
            } as React.CSSProperties
          }
        />

        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: disabled ? "none" : "all",
          }}
        >
          {placed.map((p, i) => {
            const shape = dimPointToOverlayShape(geo, p);
            if (shape.kind !== "ellipse") return null;
            const isSel = p.id === selectedId;
            return (
              <g key={p.id}>
                <ellipse
                  data-role="shape"
                  data-id={p.id}
                  cx={shape.cx * 100}
                  cy={shape.cy * 100}
                  rx={shape.rx * 100}
                  ry={shape.ry * 100}
                  style={{
                    fill: isSel ? "var(--accent-soft)" : "transparent",
                    stroke: "var(--accent)",
                    strokeWidth: isSel ? 2 : 1.4,
                    strokeDasharray: isSel ? undefined : "0.1 2.6",
                    strokeLinecap: "round",
                    vectorEffect: "non-scaling-stroke",
                    pointerEvents: "all",
                    cursor: disabled ? "not-allowed" : "move",
                  }}
                />
                <line
                  x1={shape.cx * 100 - 2.2}
                  y1={shape.cy * 100}
                  x2={shape.cx * 100 + 2.2}
                  y2={shape.cy * 100}
                  style={crosshairStyle}
                />
                <line
                  x1={shape.cx * 100}
                  y1={shape.cy * 100 - 2.2}
                  x2={shape.cx * 100}
                  y2={shape.cy * 100 + 2.2}
                  style={crosshairStyle}
                />
                <text
                  x={shape.cx * 100}
                  y={(shape.cy - shape.ry) * 100 - 1.2}
                  textAnchor="middle"
                  style={{
                    fill: "#fff",
                    fontSize: 3,
                    fontWeight: 700,
                    paintOrder: "stroke",
                    stroke: "rgba(0,0,0,0.65)",
                    strokeWidth: 0.8,
                    pointerEvents: "none",
                  }}
                >
                  {i + 1}
                </text>
              </g>
            );
          })}
        </svg>

        {!disabled && handlePoint && selected && (
          <div
            data-role="handle"
            data-id={selected.id}
            className="map-handle-hit"
            style={{ left: `${handlePoint[0] * 100}%`, top: `${handlePoint[1] * 100}%`, cursor: "ew-resize" }}
          >
            <span className="map-handle-dot" />
          </div>
        )}

        {!disabled && placed.length === 0 && (
          <div className="map-hint-bar">
            <span aria-hidden>✛</span>
            {t("dim.mapHint")}
          </div>
        )}

        <div className="map-caption-bar">
          <span className="map-caption-badge">
            {selected
              ? `${selected.name || t("dim.unnamed")} · ${Math.round(selected.radiusM)} m · ${formatLonLatIn(crs, selected.lon, selected.lat, crs.format === "utm" ? 0 : 5)}`
              : t("dim.activeCount", { n: placed.length })}
          </span>
          {disabled ? (
            <span className="map-caption-hint">🔒 {t("run.locked")}</span>
          ) : (
            <span className="map-caption-hint">{t("dim.mapDragHint")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

const crosshairStyle: React.CSSProperties = {
  stroke: "#fff",
  strokeWidth: 1,
  strokeOpacity: 0.9,
  vectorEffect: "non-scaling-stroke",
  pointerEvents: "none",
};
