"use client";

import { useState } from "react";
import { useI18n, type StringKey } from "@/lib/i18n";
import { CATEGORY_BRANCHES, type Category, type ObjectTypeGroup } from "@/lib/types";

interface Props {
  selectedCategories: Record<Category, boolean>;
  setSelectedCategories: (c: Record<Category, boolean>) => void;
  disabled?: boolean;
}

export default function CategorySection({ selectedCategories, setSelectedCategories, disabled = false }: Props) {
  const { t } = useI18n();
  // Collapsed by default at every level — this is a 3-level tree (branch ->
  // object type -> subtype), so leaving everything open would be right back
  // to a huge wall of rows. Branch and group keys never collide with each
  // other, so one flat Set covers both levels of disclosure state.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleMany(categories: Category[], value: boolean) {
    setSelectedCategories({ ...selectedCategories, ...Object.fromEntries(categories.map((c) => [c, value])) });
  }

  function toggleOne(cat: Category, value: boolean) {
    setSelectedCategories({ ...selectedCategories, [cat]: value });
  }

  function renderGroup(group: ObjectTypeGroup) {
    // A group with a single leaf category matching its own key has no real
    // subtypes (e.g. Straße, Bahnstrecke) — one flat row, no disclosure.
    const isLeaf = group.categories.length === 1 && group.categories[0] === group.key;
    if (isLeaf) {
      const cat = group.categories[0];
      const checked = selectedCategories[cat];
      return (
        <label key={group.key} className="category-row" data-disabled={disabled}>
          <span className="category-row-spacer" aria-hidden />
          <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => toggleOne(cat, e.target.checked)} />
          <span className="category-row-label">{t(`obj.${group.key}` as StringKey)}</span>
        </label>
      );
    }

    const selectedCount = group.categories.filter((c) => selectedCategories[c]).length;
    const allChecked = selectedCount === group.categories.length;
    const noneChecked = selectedCount === 0;
    const isOpen = expanded.has(group.key);

    return (
      <div key={group.key}>
        <div className="category-row" data-disabled={disabled}>
          <button
            type="button"
            className="category-disclosure"
            aria-expanded={isOpen}
            aria-label={isOpen ? t("category.collapse") : t("category.expand")}
            onClick={() => toggleExpanded(group.key)}
          >
            {isOpen ? "▾" : "▸"}
          </button>
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = !allChecked && !noneChecked;
            }}
            disabled={disabled}
            onChange={(e) => toggleMany(group.categories, e.target.checked)}
            title={t("category.groupTip")}
          />
          <span
            className="category-row-label"
            style={{ cursor: disabled ? "not-allowed" : "pointer" }}
            onClick={() => toggleExpanded(group.key)}
          >
            {t(`obj.${group.key}` as StringKey)}
          </span>
          <span className="muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>
            {selectedCount}/{group.categories.length}
          </span>
        </div>
        {isOpen && (
          <div className="category-subtypes">
            {group.categories.map((cat) => {
              const leafChecked = selectedCategories[cat];
              return (
                <label key={cat} className="category-row category-row-sub" data-checked={leafChecked} data-disabled={disabled}>
                  <input
                    type="checkbox"
                    checked={leafChecked}
                    disabled={disabled}
                    onChange={(e) => toggleOne(cat, e.target.checked)}
                  />
                  <span className="category-row-label">{t(`cat.${cat}` as StringKey)}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <strong style={{ fontSize: 15 }}>{t("category.heading")}</strong>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 3, maxWidth: 560 }}>
        {t("category.subheading")}
      </div>

      {disabled && (
        <div className="locked-note" style={{ marginTop: 12 }} title={t("run.lockedTip")}>
          <span aria-hidden>🔒</span>
          {t("run.locked")}
        </div>
      )}

      <div className="category-tree" style={{ marginTop: 16 }}>
        {CATEGORY_BRANCHES.map((branch) => {
          const allBranchCategories = branch.groups.flatMap((g) => g.categories);
          const selectedCount = allBranchCategories.filter((c) => selectedCategories[c]).length;
          const allChecked = selectedCount === allBranchCategories.length;
          const noneChecked = selectedCount === 0;
          const isOpen = expanded.has(branch.key);

          return (
            <div key={branch.key}>
              <div className="category-row" data-disabled={disabled}>
                <button
                  type="button"
                  className="category-disclosure"
                  aria-expanded={isOpen}
                  aria-label={isOpen ? t("category.collapse") : t("category.expand")}
                  onClick={() => toggleExpanded(branch.key)}
                >
                  {isOpen ? "▾" : "▸"}
                </button>
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = !allChecked && !noneChecked;
                  }}
                  disabled={disabled}
                  onChange={(e) => toggleMany(allBranchCategories, e.target.checked)}
                  title={t("category.groupTip")}
                />
                <span
                  className="category-row-label"
                  style={{ fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer" }}
                  onClick={() => toggleExpanded(branch.key)}
                >
                  {t(`branch.${branch.key}` as StringKey)}
                </span>
                <span className="muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>
                  {selectedCount}/{allBranchCategories.length}
                </span>
              </div>
              {isOpen && <div className="category-subtypes">{branch.groups.map(renderGroup)}</div>}
            </div>
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        {t("category.selectedCount", {
          n: CATEGORY_BRANCHES.reduce((n, b) => n + b.groups.flatMap((g) => g.categories).filter((c) => selectedCategories[c]).length, 0),
          total: CATEGORY_BRANCHES.reduce((n, b) => n + b.groups.flatMap((g) => g.categories).length, 0),
        })}
      </div>
    </div>
  );
}
