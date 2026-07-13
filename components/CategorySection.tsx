"use client";

import { useI18n, type StringKey } from "@/lib/i18n";
import { CATEGORIES, categoriesForPreset, type Category, type CategoryPreset } from "@/lib/types";

interface Props {
  preset: CategoryPreset;
  setPreset: (preset: CategoryPreset) => void;
  selectedCategories: Record<Category, boolean>;
  setSelectedCategories: (c: Record<Category, boolean>) => void;
  disabled?: boolean;
}

const PRESETS: { key: CategoryPreset; label: StringKey; hint: StringKey }[] = [
  { key: "grund", label: "preset.grund", hint: "preset.grundHint" },
  { key: "spitze", label: "preset.spitze", hint: "preset.spitzeHint" },
  { key: "custom", label: "preset.custom", hint: "preset.customHint" },
];

export default function CategorySection({ preset, setPreset, selectedCategories, setSelectedCategories, disabled = false }: Props) {
  const { t } = useI18n();
  const locked = preset !== "custom";
  const checkboxesDisabled = locked || disabled;

  function applyPreset(next: CategoryPreset) {
    setPreset(next);
    if (next !== "custom") setSelectedCategories(categoriesForPreset(next));
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <strong style={{ fontSize: 15 }}>{t("category.heading")}</strong>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 3, maxWidth: 560 }}>
        {t("category.subheading")}
      </div>

      <div className="segmented" style={{ marginTop: 14 }}>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={preset === p.key}
            title={t(p.hint)}
            disabled={disabled}
            onClick={() => applyPreset(p.key)}
          >
            {t(p.label)}
          </button>
        ))}
      </div>

      {disabled ? (
        <div className="locked-note" style={{ marginTop: 14 }} title={t("run.lockedTip")}>
          <span aria-hidden>🔒</span>
          {t("run.locked")}
        </div>
      ) : (
        locked && (
          <div className="row" style={{ gap: 6, marginTop: 14, fontSize: 12.5 }}>
            <span aria-hidden>🔒</span>
            <span className="muted">{t("category.locked", { preset: t(PRESETS.find((p) => p.key === preset)!.label) })}</span>
          </div>
        )
      )}

      <div className="row" style={{ gap: 8, marginTop: locked || disabled ? 8 : 16, flexWrap: "wrap" }}>
        {CATEGORIES.map((cat) => {
          const checked = selectedCategories[cat];
          return (
            <label key={cat} className="chip-checkbox" data-checked={checked} data-disabled={checkboxesDisabled}>
              <input
                type="checkbox"
                checked={checked}
                disabled={checkboxesDisabled}
                onChange={(e) => setSelectedCategories({ ...selectedCategories, [cat]: e.target.checked })}
              />
              <span className="chip-checkbox-mark">{checked ? "✓" : ""}</span>
              {t(`cat.${cat}` as StringKey)}
            </label>
          );
        })}
      </div>
    </div>
  );
}
