"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  MAX_UTM_ZONE,
  MIN_UTM_ZONE,
  clampZone,
  crsEpsg,
  type CoordFormat,
  type CoordSystem,
} from "@/lib/crs";

interface Props {
  value: CoordSystem;
  onChange: (cs: CoordSystem) => void;
  // Shown next to the control, e.g. "Entry format" / "Export coordinates".
  label?: string;
  disabled?: boolean;
}

const FORMATS: CoordFormat[] = ["wgs84", "utm"];

// Format switch plus, for UTM, the zone and hemisphere that pin it down. Used
// both for coordinate ENTRY (DIM points, search-area location) and for
// choosing the coordinate system of an EXPORT — the two are independent
// settings, so this component is deliberately stateless.
export default function CoordSystemPicker({ value, onChange, label, disabled = false }: Props) {
  const { t } = useI18n();

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {label && (
        <span className="field-label" style={{ marginBottom: 0 }}>
          {label}
        </span>
      )}
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div className="segmented" style={{ width: "fit-content" }}>
          {FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={value.format === f}
              disabled={disabled}
              title={t(f === "utm" ? "crs.tipUtm" : "crs.tipWgs84")}
              onClick={() => onChange({ ...value, format: f })}
            >
              {t(f === "utm" ? "crs.utm" : "crs.wgs84")}
            </button>
          ))}
        </div>

        {value.format === "utm" && (
          <>
            <ZoneField
              zone={value.zone}
              disabled={disabled}
              onCommit={(zone) => onChange({ ...value, zone })}
            />
            <div className="segmented" style={{ width: "fit-content" }}>
              <button
                type="button"
                aria-pressed={!value.south}
                disabled={disabled}
                title={t("crs.tipNorth")}
                onClick={() => onChange({ ...value, south: false })}
              >
                {t("crs.north")}
              </button>
              <button
                type="button"
                aria-pressed={value.south}
                disabled={disabled}
                title={t("crs.tipSouth")}
                onClick={() => onChange({ ...value, south: true })}
              >
                {t("crs.south")}
              </button>
            </div>
          </>
        )}

        <span
          className="muted"
          style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}
          title={t("crs.tipEpsg")}
        >
          {crsEpsg(value)}
        </span>
      </div>
    </div>
  );
}

// Zone as a free-typed field (commit on blur/Enter) rather than a 60-entry
// dropdown — users of this app know their zone number and typing "32" is
// faster than hunting through a long list.
function ZoneField({
  zone,
  onCommit,
  disabled,
}: {
  zone: number;
  onCommit: (zone: number) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [raw, setRaw] = useState(String(zone));

  useEffect(() => setRaw(String(zone)), [zone]);

  const commit = () => {
    const n = Number(raw);
    const next = clampZone(Number.isFinite(n) ? n : zone);
    setRaw(String(next));
    onCommit(next);
  };

  return (
    <label className="row" style={{ gap: 6, fontSize: 12.5 }}>
      <span className="muted">{t("crs.zone")}</span>
      <input
        type="text"
        inputMode="numeric"
        value={raw}
        disabled={disabled}
        title={t("crs.tipZone", { min: MIN_UTM_ZONE, max: MAX_UTM_ZONE })}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        style={{ width: 56, textAlign: "center" }}
      />
    </label>
  );
}
