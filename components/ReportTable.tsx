"use client";

import { CHANGE_COLORS, type Change, type ChangeType, type Confidence } from "@/lib/types";
import { useI18n, type StringKey } from "@/lib/i18n";

interface Props {
  changes: Change[];
  visibleIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  typeFilter: Record<ChangeType, boolean>;
  setTypeFilter: (f: Record<ChangeType, boolean>) => void;
  minConf: Confidence;
  setMinConf: (c: Confidence) => void;
  query: string;
  setQuery: (q: string) => void;
}

const TYPES: ChangeType[] = ["added", "removed", "modified"];

export default function ReportTable({
  changes,
  visibleIds,
  selectedId,
  onSelect,
  typeFilter,
  setTypeFilter,
  minConf,
  setMinConf,
  query,
  setQuery,
}: Props) {
  const { t } = useI18n();
  const counts: Record<ChangeType, number> = { added: 0, removed: 0, modified: 0 };
  for (const c of changes) counts[c.change_type]++;

  const rows = changes
    .map((c, i) => ({ c, n: i + 1 }))
    .filter(({ c }) => visibleIds.has(c.id));

  const catLabel = (cat: string) => {
    const key = `cat.${cat}` as StringKey;
    const label = t(key);
    return label === key ? cat : label;
  };

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <strong style={{ fontSize: 19 }}>
          {rows.length !== changes.length
            ? t("report.headingOf", { n: rows.length, total: changes.length })
            : t("report.heading", { n: changes.length })}
        </strong>
        <button className="btn-secondary" onClick={() => downloadCsv(changes)} title={t("report.tipExport")}>
          {t("report.export")}
        </button>
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
            value={minConf}
            onChange={(e) => setMinConf(e.target.value as Confidence)}
            style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", fontSize: 14 }}
          >
            <option value="low">{t("conf.any")}</option>
            <option value="medium">{t("conf.mediumPlus")}</option>
            <option value="high">{t("conf.highOnly")}</option>
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
                  <td>{catLabel(c.category)}</td>
                  <td>{c.description}</td>
                  <td>{t(`conf.${c.confidence}` as StringKey)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function downloadCsv(changes: Change[]) {
  const header = ["#", "change_type", "category", "description", "confidence", "x", "y", "w", "h"];
  const rows = changes.map((c, i) => [
    i + 1,
    c.change_type,
    c.category,
    c.description.replace(/"/g, '""'),
    c.confidence,
    ...c.bbox.map((n) => n.toFixed(4)),
  ]);
  const csv = [header, ...rows].map((r) => r.map((cell) => `"${String(cell)}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "orthophoto-changes.csv";
  a.click();
  URL.revokeObjectURL(url);
}
