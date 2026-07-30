"use client";

import { useEffect, useRef, useState } from "react";
import {
  CATEGORY_REF,
  CHANGE_COLORS,
  scoreLabel,
  type Category,
  type Change,
  type ChangeType,
  type DimPoint,
  type GeoRef,
  type SearchArea,
} from "@/lib/types";
import { useI18n, type StringKey } from "@/lib/i18n";
import CoordSystemPicker from "@/components/CoordSystemPicker";
import { crsEpsg, type CoordSystem } from "@/lib/crs";

interface Props {
  changes: Change[];
  visibleIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  typeFilter: Record<ChangeType, boolean>;
  setTypeFilter: (f: Record<ChangeType, boolean>) => void;
  minScore: number;
  setMinScore: (s: number) => void;
  query: string;
  setQuery: (q: string) => void;
  refUrl?: string;
  targetUrl?: string;
  refGeo?: GeoRef | null;
  // Present only in restricted-search-area mode (§5.1) — enables the
  // "digitales Merkblatt" export (§6).
  merkblattArea?: SearchArea | null;
  // Present in the other restriction mode: the run was limited to a radius
  // around each of these points. Also enables the Merkblatt, and adds the
  // point name to every coordinate-bearing export.
  dimPoints?: DimPoint[];
  // Coordinate system every exported coordinate is written in (§2/§3).
  exportCrs: CoordSystem;
  setExportCrs: (cs: CoordSystem) => void;
  // EPSG the loaded orthophoto uses, marked in the export picker.
  imageEpsg?: number;
}

const TYPES: ChangeType[] = ["added", "removed", "modified"];

export default function ReportTable({
  changes,
  visibleIds,
  selectedId,
  onSelect,
  typeFilter,
  setTypeFilter,
  minScore,
  setMinScore,
  query,
  setQuery,
  refUrl,
  targetUrl,
  refGeo,
  merkblattArea,
  dimPoints,
  exportCrs,
  setExportCrs,
  imageEpsg,
}: Props) {
  const { t, lang } = useI18n();
  const [exporting, setExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const counts: Record<ChangeType, number> = { added: 0, removed: 0, modified: 0 };
  for (const c of changes) counts[c.change_type]++;

  const rows = changes
    .map((c, i) => ({ c, n: i + 1 }))
    .filter(({ c }) => visibleIds.has(c.id));
  const visibleChanges = rows.map(({ c }) => c);
  // The numbers shown on screen and on the comparison-view chips: position in
  // the FULL result set, not in the filtered subset. Exports carry these so a
  // reviewer can cross-reference the PDF against the app (and against a CSV)
  // instead of reconciling two different numbering schemes.
  const visibleNumbers = rows.map(({ n }) => n);
  // Describes the active filtering so the PDF can state that it is a subset.
  const filterInfo = {
    total: changes.length,
    minScore,
    types: TYPES.filter((tp) => typeFilter[tp]),
    query,
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  // Everything the export layer needs beyond the changes themselves: the
  // georeferencing, the coordinate system to write coordinates in, and the
  // DIM points to attribute changes to. Assembled once so every format gets
  // exactly the same context.
  const exportCtx = { geo: refGeo, crs: exportCrs, dimPoints };
  // The Merkblatt documents a restricted run — either mode qualifies.
  const canMerkblatt = !!refGeo && (!!merkblattArea || (dimPoints?.length ?? 0) > 0);

  async function handleExportPdf() {
    if (!refUrl || !targetUrl || exporting) return;
    setMenuOpen(false);
    setExporting(true);
    try {
      const { exportPdf } = await import("@/lib/pdf");
      await exportPdf({
        refUrl,
        targetUrl,
        changes: visibleChanges,
        lang,
        displayNumbers: visibleNumbers,
        filter: filterInfo,
        ...exportCtx,
      });
    } finally {
      setExporting(false);
    }
  }

  async function handleExportCsv() {
    setMenuOpen(false);
    const { exportCsv } = await import("@/lib/exportData");
    exportCsv(visibleChanges, exportCtx);
  }

  async function handleExportGeoJson() {
    if (!refGeo) return;
    setMenuOpen(false);
    const { exportGeoJson } = await import("@/lib/exportData");
    exportGeoJson(visibleChanges, refGeo, exportCtx);
  }

  async function handleExportKml() {
    if (!refGeo) return;
    setMenuOpen(false);
    const { exportKml } = await import("@/lib/exportData");
    exportKml(visibleChanges, refGeo, lang, exportCtx);
  }

  async function handleExportAll() {
    if (!refUrl || !targetUrl || exporting) return;
    setMenuOpen(false);
    setExporting(true);
    try {
      const { exportAll } = await import("@/lib/exportData");
      await exportAll({
        changes: visibleChanges,
        refUrl,
        targetUrl,
        lang,
        displayNumbers: visibleNumbers,
        filter: filterInfo,
        ...exportCtx,
      });
    } finally {
      setExporting(false);
    }
  }

  async function handleExportMerkblatt() {
    if (!refUrl || !targetUrl || !refGeo || !canMerkblatt || exporting) return;
    setMenuOpen(false);
    setExporting(true);
    try {
      const { exportMerkblatt } = await import("@/lib/pdf");
      await exportMerkblatt({
        refUrl,
        targetUrl,
        changes: visibleChanges,
        lang,
        searchArea: merkblattArea,
        geo: refGeo,
        crs: exportCrs,
        dimPoints,
        displayNumbers: visibleNumbers,
        filter: filterInfo,
      });
    } finally {
      setExporting(false);
    }
  }

  const catLabel = (cat: string) => {
    const key = `cat.${cat}` as StringKey;
    const label = t(key);
    return label === key ? cat : label;
  };

  // Catalog classification cell: the best-fitting category with its fit
  // percentage, plus the runner-up alternatives (up to MAX_CATEGORY_MATCHES in
  // total) — the mapping from "a physical difference" to a catalog object type
  // is often genuinely ambiguous, so the alternatives are shown rather than
  // hidden behind a forced single pick. A difference the catalog has no type
  // for is reported as unclassified instead of being dropped.
  const CategoryCell = ({ c }: { c: Change }) => {
    const matches = c.matches ?? [];
    if (matches.length === 0) {
      return (
        <span className="muted" style={{ fontStyle: "italic" }} title={t("cat.unclassifiedTip")}>
          {t("cat.unclassified")}
        </span>
      );
    }
    const [best, ...alts] = matches;
    return (
      <>
        <div>
          {catLabel(best.category)}
          <span className="muted" style={{ fontSize: 11, marginLeft: 5, fontVariantNumeric: "tabular-nums" }} title={t("report.fitTip")}>
            {scoreLabel(best.fit)}
          </span>
          {CATEGORY_REF[best.category as Category] && (
            <span className="muted" style={{ fontSize: 10.5, marginLeft: 6, fontVariantNumeric: "tabular-nums" }}>
              {CATEGORY_REF[best.category as Category]}
            </span>
          )}
        </div>
        {alts.length > 0 && (
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }} title={t("report.altCategoriesTip")}>
            {alts.map((m) => (
              <div key={m.category}>
                ∼ {catLabel(m.category)}{" "}
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{scoreLabel(m.fit)}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <strong style={{ fontSize: 19 }}>
          {rows.length !== changes.length
            ? t("report.headingOf", { n: rows.length, total: changes.length })
            : t("report.heading", { n: changes.length })}
        </strong>
        <div className="dropdown-wrap" ref={menuRef}>
          <button
            className="btn-secondary"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={exporting}
            title={t("report.tipExport")}
            aria-expanded={menuOpen}
          >
            {exporting ? (
              <>
                <span className="spinner" /> Generating…
              </>
            ) : (
              <>{t("report.export")} ▾</>
            )}
          </button>
          {menuOpen && (
            <div className="dropdown-menu">
              {/* Coordinate system for every export below. Sits inside the
                  menu because it only matters at export time, and putting it
                  here keeps the choice next to the action it applies to. */}
              {refGeo && (
                <>
                  <div style={{ padding: "10px 12px 12px" }} onClick={(e) => e.stopPropagation()}>
                    <CoordSystemPicker
                      value={exportCrs}
                      onChange={setExportCrs}
                      label={t("report.exportCrs")}
                      imageEpsg={imageEpsg}
                    />
                    <div className="muted" style={{ fontSize: 11, marginTop: 8, maxWidth: 280, lineHeight: 1.5 }}>
                      {t("report.exportCrsNote", { crs: crsEpsg(exportCrs) })}
                    </div>
                  </div>
                  <div className="dropdown-divider" role="separator" />
                </>
              )}
              <button className="dropdown-item" onClick={handleExportPdf} disabled={!refUrl || !targetUrl} title={t("report.tipExportPdf")}>
                {t("report.exportPdf")}
              </button>
              <button className="dropdown-item" onClick={handleExportCsv} title={t("report.tipExportCsv")}>
                {t("report.exportCsv")}
              </button>
              <button className="dropdown-item" onClick={handleExportGeoJson} disabled={!refGeo} title={refGeo ? t("report.tipExportGeoJson") : t("report.needsGeoTiffForExport")}>
                {t("report.exportGeoJson")}
              </button>
              <button className="dropdown-item" onClick={handleExportKml} disabled={!refGeo} title={refGeo ? t("report.tipExportKml") : t("report.needsGeoTiffForExport")}>
                {t("report.exportKml")}
              </button>
              {canMerkblatt && (
                <button className="dropdown-item" onClick={handleExportMerkblatt} title={t("report.tipExportMerkblatt")}>
                  {t("report.exportMerkblatt")}
                </button>
              )}
              <div className="dropdown-divider" role="separator" />
              <button className="dropdown-item" onClick={handleExportAll} disabled={!refUrl || !targetUrl} title={t("report.tipExportAll")}>
                {t("report.exportAll")}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="row" style={{ gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {TYPES.map((tp) => (
          <label key={tp} className="row" style={{ gap: 6, fontSize: 14 }} title={t("report.tipType")}>
            <input
              type="checkbox"
              checked={typeFilter[tp]}
              onChange={(e) => setTypeFilter({ ...typeFilter, [tp]: e.target.checked })}
            />
            <span style={{ color: CHANGE_COLORS[tp], fontWeight: 600 }}>{t(`type.${tp}` as StringKey)}</span>
            <span style={{ color: "var(--muted)" }}>({counts[tp]})</span>
          </label>
        ))}
        <label className="row" style={{ gap: 6, fontSize: 14 }} title={t("report.tipMinConf")}>
          <span className="muted">{t("report.minConf")}</span>
          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 24px 6px 8px", fontSize: 14 }}
          >
            <option value={0}>{t("conf.any")}</option>
            <option value={40}>≥ 40%</option>
            <option value={55}>≥ 55%</option>
            <option value={70}>≥ 70%</option>
            <option value={85}>≥ 85%</option>
            <option value={95}>≥ 95%</option>
          </select>
        </label>
        <input
          placeholder={t("report.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginLeft: "auto", minWidth: 160 }}
        />
      </div>

      <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}>{t("th.num")}</th>
              <th>{t("th.type")}</th>
              <th>{t("th.category")}</th>
              <th>{t("th.description")}</th>
              <th>{t("th.conf")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>
                  {t("report.noMatch")}
                </td>
              </tr>
            )}
            {rows.map(({ c, n }) => {
              const sel = c.id === selectedId;
              return (
                <tr
                  key={c.id}
                  onClick={() => onSelect(sel ? null : c.id)}
                  style={{ cursor: "pointer", background: sel ? "var(--accent-soft)" : undefined }}
                >
                  <td>{n}</td>
                  <td>
                    <span style={{ color: CHANGE_COLORS[c.change_type], fontWeight: 600 }}>
                      {t(`type.${c.change_type}` as StringKey)}
                    </span>
                  </td>
                  <td>
                    <CategoryCell c={c} />
                  </td>
                  <td>
                    {c.description}
                    {c.note && (
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 3, fontStyle: "italic" }}>
                        ↳ {c.note}
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {scoreLabel(c.score)}
                    {(c.agreement ?? 1) >= 2 && (
                      <span
                        className="muted"
                        title={t("report.corroborated", { n: c.agreement ?? 2 })}
                        style={{ marginLeft: 5, fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}
                      >
                        ·{c.agreement}×
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

