"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n, type StringKey } from "@/lib/i18n";
import SearchAreaMap from "@/components/SearchAreaMap";
import DimPointsMap from "@/components/DimPointsMap";
import DimPointsPanel from "@/components/DimPointsPanel";
import CoordSystemPicker from "@/components/CoordSystemPicker";
import {
  axisLabels,
  coordDecimals,
  fromLonLat,
  parseEasting,
  crsForZone,
  isGeographic,
  toLonLat,
  type CoordSystem,
} from "@/lib/crs";
import {
  DEFAULT_RADIUS_M,
  type DimPoint,
  type GeoRef,
  type SearchArea,
  type SearchMode,
  type SearchShape,
} from "@/lib/types";

interface Props {
  geoAvailable: boolean;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  // Which of the two independent restriction modes is active: one drawn area,
  // or a list of DIM points each with its own radius.
  mode: SearchMode;
  setMode: (mode: SearchMode) => void;
  searchArea: SearchArea | null;
  setSearchArea: (area: SearchArea | null) => void;
  dimPoints: DimPoint[];
  setDimPoints: (points: DimPoint[]) => void;
  // Coordinate system used for ENTERING/READING coordinates in this section.
  // Positions are always stored as WGS84 lon/lat regardless (see lib/crs.ts).
  entryCrs: CoordSystem;
  setEntryCrs: (cs: CoordSystem) => void;
  refUrl: string | null;
  targetUrl: string | null;
  refGeo: GeoRef | null;
  targetGeo: GeoRef | null;
  // Extent + coordinate system of the loaded orthophoto, used to reject
  // out-of-scene DIM points and to preselect the matching EPSG.
  imageBounds?: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  imageEpsg?: number;
  disabled?: boolean;
}

const SHAPES: SearchShape[] = ["circle", "rectangle", "square"];
const RADIUS_PRESETS = [100, 200, 500, 1000, 2000, 5000];
const MODES: SearchMode[] = ["area", "points"];

export default function SearchAreaSection({
  geoAvailable,
  enabled,
  setEnabled,
  mode,
  setMode,
  searchArea,
  setSearchArea,
  dimPoints,
  setDimPoints,
  entryCrs,
  setEntryCrs,
  refUrl,
  targetUrl,
  refGeo,
  targetGeo,
  imageBounds,
  imageEpsg,
  disabled = false,
}: Props) {
  const { t } = useI18n();
  const active = enabled && geoAvailable;
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  // lat/lon default to NaN ("no point picked yet") rather than 0 — 0/0 is a
  // real place (off the coast of West Africa), so silently seeding it would
  // let a shape/size-only edit turn into a runnable search at the wrong spot.
  const area: SearchArea =
    searchArea ?? {
      shape: "circle",
      lat: NaN,
      lon: NaN,
      radiusM: DEFAULT_RADIUS_M,
      widthM: DEFAULT_RADIUS_M * 2,
      heightM: DEFAULT_RADIUS_M * 2,
    };
  const update = (patch: Partial<SearchArea>) => setSearchArea({ ...area, ...patch });
  const pointSet = Number.isFinite(area.lat) && Number.isFinite(area.lon);

  const updatePoint = (id: string, patch: Partial<DimPoint>) =>
    setDimPoints(dimPoints.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  // Clicking empty image space fills in the selected point when it has no
  // position yet; otherwise it adds a new point there. That makes "add row,
  // then click where it is" and "just keep clicking to drop points" both work.
  const placeAt = (lon: number, lat: number) => {
    const selected = dimPoints.find((p) => p.id === selectedPointId);
    if (selected && !(Number.isFinite(selected.lat) && Number.isFinite(selected.lon))) {
      updatePoint(selected.id, { lon, lat });
      return;
    }
    const point: DimPoint = {
      id: `dim-${Date.now()}-${dimPoints.length}`,
      name: "",
      lat,
      lon,
      radiusM: DEFAULT_RADIUS_M,
    };
    setDimPoints([...dimPoints, point]);
    setSelectedPointId(point.id);
  };

  return (
    <div>
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 14,
          opacity: geoAvailable ? 1 : 0.5,
          transition: "opacity 0.15s ease",
        }}
      >
        <div>
          <strong style={{ fontSize: 15 }}>{t("search.heading")}</strong>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3, maxWidth: 480 }}>
            {t("search.subheading")}
          </div>
        </div>
        <label
          className="switch"
          title={!geoAvailable ? t("search.needsGeoTiff") : disabled ? t("run.lockedTip") : t("search.toggleTip")}
        >
          <input
            type="checkbox"
            checked={enabled}
            disabled={!geoAvailable || disabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="switch-track">
            <span className="switch-thumb" />
          </span>
        </label>
      </div>

      {!geoAvailable && (
        <div className="row" style={{ gap: 6, marginTop: 12, fontSize: 12.5 }}>
          <span aria-hidden>🔒</span>
          <span className="muted">{t("search.needsGeoTiff")}</span>
        </div>
      )}

      {geoAvailable && disabled && (
        <div className="locked-note" style={{ marginTop: 12 }} title={t("run.lockedTip")}>
          <span aria-hidden>🔒</span>
          {t("run.locked")}
        </div>
      )}

      {geoAvailable && !enabled && !disabled && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
          {t("search.wholeImageNote")}
        </div>
      )}

      {active && (
        <div className="row" style={{ gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div className="segmented" style={{ width: "fit-content" }}>
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                disabled={disabled}
                title={t(m === "area" ? "search.mode.areaTip" : "search.mode.pointsTip")}
                onClick={() => setMode(m)}
              >
                {t(m === "area" ? "search.mode.area" : "search.mode.points")}
              </button>
            ))}
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            {t(mode === "area" ? "search.mode.areaHint" : "search.mode.pointsHint")}
          </span>
        </div>
      )}

      {active && mode === "points" && (
        <div style={{ marginTop: 18, display: "grid", gap: 18 }}>
          {refUrl && targetUrl && refGeo && targetGeo && (
            <DimPointsMap
              refUrl={refUrl}
              targetUrl={targetUrl}
              refGeo={refGeo}
              targetGeo={targetGeo}
              points={dimPoints}
              selectedId={selectedPointId}
              crs={entryCrs}
              onSelect={setSelectedPointId}
              onChangePoint={updatePoint}
              onPlaceAt={placeAt}
              disabled={disabled}
            />
          )}
          <DimPointsPanel
            points={dimPoints}
            setPoints={setDimPoints}
            entryCrs={entryCrs}
            setEntryCrs={setEntryCrs}
            selectedId={selectedPointId}
            setSelectedId={setSelectedPointId}
            imageBounds={imageBounds}
            imageEpsg={imageEpsg}
            disabled={disabled}
          />
        </div>
      )}

      {active && mode === "area" && refUrl && targetUrl && refGeo && targetGeo && (
        <div style={{ marginTop: 20 }}>
          <SearchAreaMap
            refUrl={refUrl}
            targetUrl={targetUrl}
            refGeo={refGeo}
            targetGeo={targetGeo}
            area={area}
            pointSet={pointSet}
            crs={entryCrs}
            onChange={update}
            onClear={() => setSearchArea(null)}
            disabled={disabled}
          />

          <div className="row" style={{ gap: 28, marginTop: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px", display: "grid", gap: 14 }}>
              <GroupLabel icon="📍">{t("search.groupLocation")}</GroupLabel>
              <CoordSystemPicker value={entryCrs} onChange={setEntryCrs} disabled={disabled} imageEpsg={imageEpsg} />
              <AreaCoordFields area={area} crs={entryCrs} onChange={update} disabled={disabled} />
              {!pointSet && (
                <div className="muted" style={{ fontSize: 12 }}>
                  {t("search.needsPoint")}
                </div>
              )}
            </div>

            <div style={{ flex: "1 1 260px", display: "grid", gap: 14 }}>
              <GroupLabel icon="◻">{t("search.groupGeometry")}</GroupLabel>

              <div className="segmented" style={{ width: "fit-content" }}>
                {SHAPES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={area.shape === s}
                    disabled={disabled}
                    onClick={() => update({ shape: s })}
                  >
                    <span className="row" style={{ gap: 6 }}>
                      <ShapeIcon shape={s} />
                      {t(`search.shape.${s}` as StringKey)}
                    </span>
                  </button>
                ))}
              </div>

              <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                {area.shape === "circle" ? (
                  <NumberField
                    label={t("search.radius")}
                    value={area.radiusM}
                    min={1}
                    onCommit={(n) => update({ radiusM: Number.isFinite(n) && n > 0 ? n : DEFAULT_RADIUS_M })}
                    width={100}
                    disabled={disabled}
                  />
                ) : area.shape === "square" ? (
                  <NumberField
                    label={t("search.side")}
                    value={area.widthM}
                    min={1}
                    onCommit={(n) => {
                      const side = Number.isFinite(n) && n > 0 ? n : DEFAULT_RADIUS_M * 2;
                      update({ widthM: side, heightM: side, radiusM: side / 2 });
                    }}
                    width={100}
                    disabled={disabled}
                  />
                ) : (
                  <>
                    <NumberField
                      label={t("search.width")}
                      value={area.widthM}
                      min={1}
                      onCommit={(n) => update({ widthM: Number.isFinite(n) && n > 0 ? n : DEFAULT_RADIUS_M * 2 })}
                      width={100}
                      disabled={disabled}
                    />
                    <NumberField
                      label={t("search.height")}
                      value={area.heightM}
                      min={1}
                      onCommit={(n) => update({ heightM: Number.isFinite(n) && n > 0 ? n : DEFAULT_RADIUS_M * 2 })}
                      width={100}
                      disabled={disabled}
                    />
                  </>
                )}
                <span className="muted" style={{ fontSize: 12, paddingBottom: 9 }}>
                  {t("search.unitMeters")}
                </span>
              </div>

              {(area.shape === "circle" || area.shape === "square") && (
                <div>
                  <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
                    {t("search.quickPick")}
                  </div>
                  <PresetChips
                    values={RADIUS_PRESETS}
                    activeValue={area.shape === "circle" ? area.radiusM : area.widthM}
                    onPick={(v) =>
                      update(
                        area.shape === "circle"
                          ? { radiusM: v }
                          : { widthM: v, heightM: v, radiusM: v / 2 },
                      )
                    }
                    disabled={disabled}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// The search area's center, written in whichever coordinate system the user
// picked. Editing one axis keeps the other as it currently reads in that
// system and converts the pair back to lon/lat, so a UTM northing edit never
// drags the easting along through a rounding round-trip.
function AreaCoordFields({
  area,
  crs,
  onChange,
  disabled,
}: {
  area: SearchArea;
  crs: CoordSystem;
  onChange: (patch: Partial<SearchArea>) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const labels = axisLabels(crs);
  const decimals = coordDecimals(crs);

  const [x, y] = useMemo(
    () =>
      Number.isFinite(area.lat) && Number.isFinite(area.lon)
        ? fromLonLat(crs, area.lon, area.lat)
        : [NaN, NaN],
    [crs, area.lat, area.lon],
  );

  const commitAxis = (axis: "x" | "y", raw: number) => {
    let nx = axis === "x" ? raw : x;
    let ny = axis === "y" ? raw : y;
    let activeCrs = crs;

    if (!isGeographic(crs) && axis === "x") {
      // Accept the German zone-prefixed easting ("32578636") in the field — it
      // is what a DIM list carries. On a zE-N grid (EPSG:4647/5650) the prefix
      // is part of the coordinate and is left alone; elsewhere it selects the
      // matching zone's system for this entry.
      const { easting, zone } = parseEasting(raw, crs);
      nx = easting;
      if (zone !== null) activeCrs = crsForZone(zone, crs);
    }

    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      onChange({ lat: NaN, lon: NaN });
      return;
    }
    const [lon, lat] = toLonLat(activeCrs, nx, ny);
    onChange({ lon, lat });
  };

  return (
    <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
      <NumberField
        label={isGeographic(crs) ? t("search.lon") : labels.x}
        value={x}
        decimals={decimals}
        placeholder={isGeographic(crs) ? t("search.lonPlaceholder") : t("search.eastingPlaceholder")}
        onCommit={(n) => commitAxis("x", n)}
        width={150}
        disabled={disabled}
      />
      <NumberField
        label={isGeographic(crs) ? t("search.lat") : labels.y}
        value={y}
        decimals={decimals}
        placeholder={isGeographic(crs) ? t("search.latPlaceholder") : t("search.northingPlaceholder")}
        onCommit={(n) => commitAxis("y", n)}
        width={150}
        disabled={disabled}
      />
    </div>
  );
}

function GroupLabel({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ gap: 7, fontSize: 13.5, fontWeight: 600 }}>
      <span aria-hidden>{icon}</span>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span className="field-label" style={{ marginBottom: 0 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

// Free typing with commit-on-blur (or Enter): clamps to [min, max] and treats
// an empty field as "unset" (NaN) rather than silently coercing to 0.
// Uses type="text" + inputMode="decimal" (not type="number") so it renders
// through the same input styling as every other text field in the app —
// type="number" picks up the browser's native spin buttons and, without a
// placeholder set, falls outside the app's input CSS entirely.
function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  decimals,
  placeholder,
  width = 100,
  disabled = false,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  // Round the committed (and re-displayed) value to this many decimal
  // places — e.g. 6 for lat/lon, 2 for projected metres, left unset for
  // whole-metre sizes.
  decimals?: number;
  placeholder?: string;
  width?: number;
  disabled?: boolean;
}) {
  // Values driven by dragging on the map (radius/width/height, in meters)
  // arrive with float noise — round for display the same way a manual
  // commit would (0 decimals unless the field asks for more).
  const displayValue = (n: number) => {
    const factor = 10 ** (decimals ?? 0);
    return Math.round(n * factor) / factor;
  };

  const [raw, setRaw] = useState(Number.isFinite(value) ? String(displayValue(value)) : "");

  useEffect(() => {
    setRaw(Number.isFinite(value) ? String(displayValue(value)) : "");
  }, [value, decimals]);

  const commit = () => {
    if (raw.trim() === "") {
      onCommit(NaN);
      return;
    }
    let n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n)) {
      setRaw(Number.isFinite(value) ? String(displayValue(value)) : "");
      return;
    }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    if (decimals !== undefined) {
      const factor = 10 ** decimals;
      n = Math.round(n * factor) / factor;
    }
    onCommit(n);
    setRaw(String(n));
  };

  return (
    <Field label={label}>
      <input
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={raw}
        disabled={disabled}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        style={{ width }}
      />
    </Field>
  );
}

function PresetChips({
  values,
  activeValue,
  onPick,
  disabled = false,
}: {
  values: number[];
  activeValue: number;
  onPick: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {values.map((v) => {
        const isActive = v === activeValue;
        return (
          <button
            key={v}
            type="button"
            className="chip-btn"
            disabled={disabled}
            onClick={() => onPick(v)}
            style={{
              padding: "4px 12px",
              fontSize: 12.5,
              fontWeight: 500,
              ...(isActive ? { background: "var(--accent-soft)", borderColor: "var(--accent)", color: "var(--text)" } : {}),
            }}
          >
            {v} m
          </button>
        );
      })}
    </div>
  );
}

function ShapeIcon({ shape }: { shape: SearchShape }) {
  if (shape === "circle") {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
        <circle cx={7} cy={7} r={5.5} fill="none" stroke="currentColor" strokeWidth={1.5} />
      </svg>
    );
  }
  if (shape === "square") {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
        <rect x={2} y={2} width={10} height={10} rx={1.5} fill="none" stroke="currentColor" strokeWidth={1.5} />
      </svg>
    );
  }
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
      <rect x={1} y={3.5} width={12} height={7} rx={1.5} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}
