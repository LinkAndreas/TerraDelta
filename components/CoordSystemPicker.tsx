"use client";

import { useI18n, type StringKey } from "@/lib/i18n";
import { CRS_LIST, crsDef, isKnownEpsg, type CoordSystem, type CrsDef } from "@/lib/crs";

interface Props {
  value: CoordSystem;
  onChange: (cs: CoordSystem) => void;
  // Shown above the control, e.g. "Entry format" / "Export coordinates".
  label?: string;
  disabled?: boolean;
  // The system the loaded GeoTIFF appears to use, marked in the list so the
  // user can see at a glance which entry matches their imagery.
  imageEpsg?: number;
}

// Registry order groups related grids together; these are the group captions.
const GROUP_KEY: Record<CrsDef["group"], StringKey> = {
  geographic: "crs.group.geographic",
  etrs89: "crs.group.etrs89",
  wgs84utm: "crs.group.wgs84utm",
  legacy: "crs.group.legacy",
  web: "crs.group.web",
};

const GROUP_ORDER: CrsDef["group"][] = ["etrs89", "geographic", "wgs84utm", "legacy", "web"];

// Coordinate systems are picked by EPSG code — that is what an orthophoto's
// metadata, a DIM point list and a QGIS project all name, so matching the
// source data is a matter of matching a number rather than reasoning about
// zones and datums. Used both for coordinate ENTRY and for choosing the system
// an EXPORT is written in; the two are independent settings, so this component
// is deliberately stateless.
export default function CoordSystemPicker({ value, onChange, label, disabled = false, imageEpsg }: Props) {
  const { t } = useI18n();
  const def = crsDef(value);

  return (
    <label style={{ display: "grid", gap: 6 }}>
      {label && (
        <span className="field-label" style={{ marginBottom: 0 }}>
          {label}
        </span>
      )}
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={def.code}
          disabled={disabled}
          title={t("crs.tipSelect")}
          onChange={(e) => {
            const code = Number(e.target.value);
            if (isKnownEpsg(code)) onChange({ epsg: code });
          }}
          style={{
            background: "var(--bg)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            padding: "8px 26px 8px 10px",
            fontSize: 14,
            minWidth: 250,
          }}
        >
          {GROUP_ORDER.map((group) => {
            const entries = CRS_LIST.filter((d) => d.group === group);
            if (entries.length === 0) return null;
            return (
              <optgroup key={group} label={t(GROUP_KEY[group])}>
                {entries.map((d) => (
                  <option key={d.code} value={d.code}>
                    EPSG:{d.code} — {d.label}
                    {d.code === imageEpsg ? ` ${t("crs.matchesImageSuffix")}` : ""}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>

        {imageEpsg !== undefined && imageEpsg !== def.code && (
          <button
            type="button"
            className="chip-btn"
            disabled={disabled}
            onClick={() => onChange({ epsg: imageEpsg })}
            title={t("crs.tipUseImage", { code: imageEpsg })}
            style={{ padding: "4px 10px", fontSize: 12 }}
          >
            {t("crs.useImage", { code: imageEpsg })}
          </button>
        )}
      </div>
      <span className="muted" style={{ fontSize: 11.5 }}>
        {def.geographic ? t("crs.hintGeographic") : t("crs.hintProjected", { x: def.xLabel, y: def.yLabel })}
      </span>
    </label>
  );
}
