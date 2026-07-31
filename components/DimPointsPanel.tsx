"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n, type StringKey } from "@/lib/i18n";
import CoordSystemPicker from "@/components/CoordSystemPicker";
import Popover from "@/components/Popover";
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
import { DIM_CSV_COLUMNS, DIM_CSV_TEMPLATE, parseDimCsv, parseDimXlsx, type DimCsvResult } from "@/lib/dimCsv";
import { DEFAULT_DIM_RADIUS_M, DEFAULT_RADIUS_M, isDimPointPlaced, type DimPoint } from "@/lib/types";

interface Props {
  points: DimPoint[];
  setPoints: (points: DimPoint[]) => void;
  entryCrs: CoordSystem;
  setEntryCrs: (cs: CoordSystem) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  // WGS84 extent of the loaded orthophoto; imported points outside it are
  // dropped, since nothing in the image can ever be found at them.
  imageBounds?: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  // EPSG the loaded orthophoto appears to use, surfaced in the picker.
  imageEpsg?: number;
  disabled?: boolean;
}

const RADIUS_PRESETS = [100, 200, 500, 1000, 2000];

// A DIM point list: manual entry (one row per point, coordinates in whichever
// system the user picked) plus CSV import of an existing list. Positions are
// stored as WGS84 lon/lat on the point itself — the entry system only decides
// how they are written and read here (see lib/crs.ts).
export default function DimPointsPanel({
  points,
  setPoints,
  entryCrs,
  setEntryCrs,
  selectedId,
  setSelectedId,
  imageBounds,
  imageEpsg,
  disabled = false,
}: Props) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showFormat, setShowFormat] = useState(false);
  const [defaultRadius, setDefaultRadius] = useState(DEFAULT_DIM_RADIUS_M);
  const [importResult, setImportResult] = useState<DimCsvResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const placedCount = points.filter(isDimPointPlaced).length;
  const labels = axisLabels(entryCrs);

  const updatePoint = (id: string, patch: Partial<DimPoint>) =>
    setPoints(points.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const removePoint = (id: string) => {
    setPoints(points.filter((p) => p.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const addPoint = () => {
    // lat/lon start as NaN ("not placed yet") rather than 0/0, which is a real
    // location — the same guard the single search area uses, so an empty row
    // can never quietly restrict the analysis to the Gulf of Guinea.
    const point: DimPoint = {
      id: `dim-${Date.now()}-${points.length}`,
      name: "",
      lat: NaN,
      lon: NaN,
      radiusM: defaultRadius,
    };
    setPoints([...points, point]);
    setSelectedId(point.id);
  };

  async function handleFile(file: File) {
    setImportError(null);
    setImportResult(null);
    try {
      const opts = {
        fallbackCrs: entryCrs,
        defaultRadiusM: defaultRadius,
        idPrefix: `dim-${Date.now()}`,
        imageBounds,
      };
      // Excel workbooks are read directly; everything else is treated as
      // delimited text, which also covers .txt and .tsv exports.
      const result = /\.xlsx$/i.test(file.name)
        ? await parseDimXlsx(await file.arrayBuffer(), opts)
        : parseDimCsv(await file.text(), opts);
      if (result.points.length === 0) {
        const reason = result.errors[0]?.message;
        setImportError(
          reason === "noCoordinateColumns"
            ? t("dim.import.noColumns")
            : reason === "badWorkbook"
              ? t("dim.import.badWorkbook")
              : result.outOfArea > 0
                ? t("dim.import.allOutOfArea", { n: result.outOfArea })
                : t("dim.import.noRows"),
        );
        setImportResult(result);
        return;
      }
      // Append rather than replace: importing a second list (e.g. a different
      // Landkreis) is a normal thing to want, and replacing silently would
      // throw away work.
      setPoints([...points, ...result.points]);
      setImportResult(result);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  }

  function downloadTemplate() {
    // UTF-8 BOM so Excel opens the umlauts in the header correctly.
    const blob = new Blob(["﻿" + DIM_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dim-points-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="row" style={{ gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
        <CoordSystemPicker
          value={entryCrs}
          onChange={setEntryCrs}
          label={t("dim.entryCrs")}
          disabled={disabled}
          imageEpsg={imageEpsg}
        />

        <label style={{ display: "grid", gap: 6 }}>
          <span className="field-label" style={{ marginBottom: 0 }}>
            {t("dim.defaultRadius")}
          </span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {RADIUS_PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                className="chip-btn"
                disabled={disabled}
                onClick={() => setDefaultRadius(v)}
                title={t("dim.tipDefaultRadius")}
                style={{
                  padding: "4px 12px",
                  fontSize: 12.5,
                  fontWeight: 500,
                  ...(v === defaultRadius
                    ? { background: "var(--accent-soft)", borderColor: "var(--accent)", color: "var(--text)" }
                    : {}),
                }}
              >
                {v} m
              </button>
            ))}
          </div>
        </label>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn-secondary" onClick={addPoint} disabled={disabled} title={t("dim.tipAdd")}>
          + {t("dim.add")}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          title={t("dim.tipImport")}
        >
          ⤓ {t("dim.import")}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-expanded={showFormat}
          onClick={() => setShowFormat((v) => !v)}
          title={t("dim.tipFormatInfo")}
          aria-label={t("dim.formatInfo")}
          style={{ width: 34, height: 34, fontSize: 14, fontWeight: 700 }}
        >
          ⓘ
        </button>
        {points.length > 0 && !disabled && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setPoints([]);
              setSelectedId(null);
              setImportResult(null);
            }}
            title={t("dim.tipClearAll")}
            style={{ marginLeft: "auto" }}
          >
            ✕ {t("dim.clearAll")}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            // Reset so re-picking the same file fires change again.
            e.target.value = "";
          }}
        />
      </div>

      {showFormat && <FormatInfo onDownload={downloadTemplate} />}

      {importError && <div className="error">{importError}</div>}

      {importResult && !importError && (
        <div className="muted" style={{ fontSize: 12.5 }}>
          {t("dim.import.summary", {
            n: importResult.points.length,
            format: importResult.detectedFormat === "utm" ? t("crs.utm") : t("crs.wgs84"),
          })}
          {importResult.errors.length > 0 && (
            <span style={{ color: "var(--warn, #f59e0b)" }}>
              {" · "}
              {t("dim.import.skipped", {
                n: importResult.errors.length,
                rows: importResult.errors
                  .slice(0, 5)
                  .map((e) => e.row)
                  .join(", "),
              })}
            </span>
          )}
          {importResult.outOfArea > 0 && (
            <span style={{ color: "var(--warn, #f59e0b)" }}>
              {" · "}
              {t("dim.import.outOfArea", { n: importResult.outOfArea })}
            </span>
          )}
          {importResult.warnings.includes("noRadiusColumn") && (
            <span>
              {" · "}
              {t("dim.import.defaultRadiusUsed", { r: defaultRadius })}
            </span>
          )}
        </div>
      )}

      {points.length === 0 ? (
        <div className="muted" style={{ fontSize: 12.5 }}>
          {t("dim.empty")}
        </div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 28 }}>{t("th.num")}</th>
                <th>{t("dim.th.name")}</th>
                <th style={{ whiteSpace: "nowrap" }}>{labels.x}</th>
                <th style={{ whiteSpace: "nowrap" }}>{labels.y}</th>
                <th style={{ whiteSpace: "nowrap" }}>{t("dim.th.radius")}</th>
                <th style={{ width: 34 }} aria-label={t("dim.th.remove")} />
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <PointRow
                  key={p.id}
                  index={i + 1}
                  point={p}
                  crs={entryCrs}
                  selected={p.id === selectedId}
                  disabled={disabled}
                  onSelect={() => setSelectedId(p.id === selectedId ? null : p.id)}
                  onChange={(patch) => updatePoint(p.id, patch)}
                  onRemove={() => removePoint(p.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="muted" style={{ fontSize: 12 }}>
        {placedCount === 0 ? t("dim.needsPoint") : t("dim.activeCount", { n: placedCount })}
      </div>
    </div>
  );
}

// ── One editable point ──────────────────────────────────────────────────────

function PointRow({
  index,
  point,
  crs,
  selected,
  disabled,
  onSelect,
  onChange,
  onRemove,
}: {
  index: number;
  point: DimPoint;
  crs: CoordSystem;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<DimPoint>) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const placed = isDimPointPlaced(point);

  // The point's position expressed in the current entry system. Recomputed on
  // every render so switching UTM ↔ lat/lon (or changing the zone) rewrites
  // every row's numbers immediately.
  const [x, y] = useMemo(
    () => (Number.isFinite(point.lat) && Number.isFinite(point.lon) ? fromLonLat(crs, point.lon, point.lat) : [NaN, NaN]),
    [crs, point.lat, point.lon],
  );

  // Writing one axis back: combine the edited value with the other axis as it
  // currently reads in this system, then convert the pair back to lon/lat. A
  // point that has no position yet needs BOTH axes before it becomes real, so
  // a half-entered row stays unplaced instead of jumping to the zone origin.
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

  const decimals = coordDecimals(crs);
  const meta = [point.municipality, point.district, point.nextReview && `→ ${point.nextReview}`]
    .filter(Boolean)
    .join(" · ");
  // Both the imported description AND remark are shown right in the row (a
  // single-line preview each, so a dozen-entry Bemerkung history never blows
  // up the row height) — the popover trigger is only for reading the FULL
  // text, not for hiding it entirely.
  const hasDetails = !!(point.note || point.municipality || point.district || point.nextReview || point.lastUpdate);
  const notePreview = point.note?.split(/\r?\n/)[0] ?? "";

  return (
    <tr
      onClick={onSelect}
      style={{ cursor: "pointer", background: selected ? "var(--accent-soft)" : undefined }}
    >
      <td style={{ verticalAlign: "top", paddingTop: 12 }}>{index}</td>
      <td onClick={(e) => e.stopPropagation()} style={{ minWidth: 200 }}>
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <input
            type="text"
            value={point.name}
            disabled={disabled}
            placeholder={t("dim.namePlaceholder")}
            onChange={(e) => onChange({ name: e.target.value })}
            style={{ width: "100%", flex: 1, minWidth: 0 }}
          />
          {hasDetails && <DimPointDetailsPopover point={point} />}
        </div>
        {meta && (
          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
            {meta}
          </div>
        )}
        {point.note && (
          <div
            className="muted"
            style={{
              fontSize: 11,
              marginTop: 2,
              fontStyle: "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {notePreview}
          </div>
        )}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <NumberCell value={x} decimals={decimals} disabled={disabled} onCommit={(n) => commitAxis("x", n)} />
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <NumberCell value={y} decimals={decimals} disabled={disabled} onCommit={(n) => commitAxis("y", n)} />
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <NumberCell
          value={point.radiusM}
          decimals={0}
          disabled={disabled}
          width={78}
          onCommit={(n) => onChange({ radiusM: Number.isFinite(n) && n > 0 ? n : DEFAULT_RADIUS_M })}
        />
      </td>
      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "right" }}>
        <button
          type="button"
          className="icon-btn"
          disabled={disabled}
          onClick={onRemove}
          title={t("dim.tipRemove")}
          aria-label={t("dim.th.remove")}
          style={{ width: 28, height: 28, fontSize: 12 }}
        >
          ✕
        </button>
        {!placed && (
          <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }} title={t("dim.rowUnplacedTip")}>
            ⚠
          </div>
        )}
      </td>
    </tr>
  );
}

// Full detail for one point — the imported Beschreibung and Bemerkung in
// full, plus the small administrative metadata — shown in a Popover so a long
// Bemerkung (routinely a dozen dated case-history lines) never has to expand
// the row to be read.
function DimPointDetailsPopover({ point }: { point: DimPoint }) {
  const { t } = useI18n();
  return (
    <Popover trigger={<span aria-hidden>🗎</span>} triggerLabel={t("dim.details.tip")} triggerTitle={t("dim.details.tip")}>
      <div style={{ display: "grid", gap: 8 }}>
        <div>
          <div className="field-label" style={{ marginBottom: 2 }}>
            {t("dim.details.description")}
          </div>
          <div>{point.name || t("dim.unnamed")}</div>
        </div>
        <div>
          <div className="field-label" style={{ marginBottom: 2 }}>
            {t("dim.details.note")}
          </div>
          {point.note ? (
            <div style={{ whiteSpace: "pre-line" }}>{point.note}</div>
          ) : (
            <div className="muted" style={{ fontStyle: "italic" }}>
              {t("dim.details.noNote")}
            </div>
          )}
        </div>
        {(point.municipality || point.district || point.nextReview || point.lastUpdate) && (
          <div
            className="muted"
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "3px 10px",
              fontSize: 11.5,
              paddingTop: 6,
              borderTop: "1px solid var(--border)",
            }}
          >
            {point.municipality && (
              <>
                <span>{t("dim.details.municipality")}</span>
                <span>{point.municipality}</span>
              </>
            )}
            {point.district && (
              <>
                <span>{t("dim.details.district")}</span>
                <span>{point.district}</span>
              </>
            )}
            {point.nextReview && (
              <>
                <span>{t("dim.details.nextReview")}</span>
                <span>{point.nextReview}</span>
              </>
            )}
            {point.lastUpdate && (
              <>
                <span>{t("dim.details.lastUpdate")}</span>
                <span>{point.lastUpdate}</span>
              </>
            )}
          </div>
        )}
      </div>
    </Popover>
  );
}

// Commit-on-blur numeric cell — same interaction as the search-area fields
// (free typing, empty means "unset"), sized for a table row.
function NumberCell({
  value,
  onCommit,
  decimals,
  disabled,
  width = 118,
}: {
  value: number;
  onCommit: (n: number) => void;
  decimals: number;
  disabled: boolean;
  width?: number;
}) {
  const display = (n: number) => (Number.isFinite(n) ? String(Number(n.toFixed(decimals))) : "");
  const [raw, setRaw] = useState(display(value));

  useEffect(() => setRaw(display(value)), [value, decimals]);

  const commit = () => {
    if (raw.trim() === "") {
      onCommit(NaN);
      return;
    }
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n)) {
      setRaw(display(value));
      return;
    }
    onCommit(n);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      disabled={disabled}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      style={{ width, fontVariantNumeric: "tabular-nums" }}
    />
  );
}

// ── CSV format help ─────────────────────────────────────────────────────────

function FormatInfo({ onDownload }: { onDownload: () => void }) {
  const { t } = useI18n();
  return (
    <div className="card" style={{ padding: 14, background: "var(--bg)" }}>
      <strong style={{ fontSize: 13.5 }}>{t("dim.formatInfo")}</strong>
      <p className="muted" style={{ fontSize: 12.5, margin: "6px 0 10px" }}>
        {t("dim.format.intro")}
      </p>

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>{t("dim.format.column")}</th>
              <th>{t("dim.format.required")}</th>
              <th>{t("dim.format.meaning")}</th>
            </tr>
          </thead>
          <tbody>
            {DIM_CSV_COLUMNS.map((c) => (
              <tr key={c.header}>
                <td style={{ fontFamily: "var(--mono, monospace)", fontSize: 12, whiteSpace: "nowrap" }}>{c.header}</td>
                <td style={{ fontSize: 12 }}>{c.required ? t("dim.format.yes") : t("dim.format.no")}</td>
                <td style={{ fontSize: 12 }}>{t(`dim.format.col.${c.key}` as StringKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="muted" style={{ fontSize: 12, margin: "10px 0 0", paddingLeft: 18, lineHeight: 1.65 }}>
        <li>{t("dim.format.noteZonePrefix")}</li>
        <li>{t("dim.format.noteDelimiter")}</li>
        <li>{t("dim.format.noteLatLon")}</li>
        <li>{t("dim.format.noteRadius")}</li>
        <li>{t("dim.format.noteQuotes")}</li>
      </ul>

      <div style={{ marginTop: 12 }}>
        <div className="field-label">{t("dim.format.example")}</div>
        <pre
          style={{
            margin: 0,
            padding: 10,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--card, transparent)",
            fontSize: 11.5,
            overflowX: "auto",
            whiteSpace: "pre",
          }}
        >
          {DIM_CSV_TEMPLATE}
        </pre>
      </div>

      <button type="button" className="btn-secondary" onClick={onDownload} style={{ marginTop: 10 }}>
        ⤓ {t("dim.format.downloadTemplate")}
      </button>
    </div>
  );
}
