"use client";

import { useState } from "react";
import { useI18n, type StringKey } from "@/lib/i18n";
import { CATEGORY_BRANCHES, type Category, type CategoryObject } from "@/lib/types";

interface Props {
  selectedCategories: Record<Category, boolean>;
  setSelectedCategories: (c: Record<Category, boolean>) => void;
  disabled?: boolean;
}

// One row shared by every level of the tree (branch / thematic group /
// object): a disclosure toggle, a tri-state checkbox covering every leaf
// category beneath it, a label, and a live "n/total" count — expand only
// reveals the next level down, so the default view stays compact regardless
// of how many leaves the catalog actually has (76, across the two branches).
function TreeRow({
  label,
  categories,
  checked,
  disabled,
  onToggleAll,
  isOpen,
  onToggleOpen,
  bold,
  groupTip,
}: {
  label: string;
  categories: Category[];
  checked: Record<Category, boolean>;
  disabled: boolean;
  onToggleAll: (value: boolean) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  bold?: boolean;
  groupTip?: string;
}) {
  const selectedCount = categories.filter((c) => checked[c]).length;
  const allChecked = selectedCount === categories.length;
  const noneChecked = selectedCount === 0;

  return (
    <div className="category-row" data-disabled={disabled}>
      <button type="button" className="category-disclosure" aria-expanded={isOpen} onClick={onToggleOpen}>
        {isOpen ? "▾" : "▸"}
      </button>
      <input
        type="checkbox"
        checked={allChecked}
        ref={(el) => {
          if (el) el.indeterminate = !allChecked && !noneChecked;
        }}
        disabled={disabled}
        onChange={(e) => onToggleAll(e.target.checked)}
        title={groupTip}
      />
      <span
        className="category-row-label"
        style={{ fontWeight: bold ? 700 : 400, cursor: disabled ? "not-allowed" : "pointer" }}
        onClick={onToggleOpen}
      >
        {label}
      </span>
      <span className="muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>
        {selectedCount}/{categories.length}
      </span>
    </div>
  );
}

export default function CategorySection({ selectedCategories, setSelectedCategories, disabled = false }: Props) {
  const { t } = useI18n();
  // Collapsed by default at every level — with 76 leaf categories across 4
  // tree levels (branch -> thematic group -> object -> subtype), leaving
  // everything open would be right back to a huge wall of rows. Branch,
  // group, and object keys never collide with each other, so one flat Set
  // covers disclosure state for the whole tree.
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

  function renderObject(obj: CategoryObject) {
    // No subtype breakdown given in the spec (e.g. Bahnverkehr, Turm) — a
    // single flat leaf checkbox, no disclosure.
    const isLeaf = obj.categories.length === 1 && obj.categories[0] === obj.key;
    if (isLeaf) {
      const cat = obj.categories[0];
      const checked = selectedCategories[cat];
      return (
        <label key={obj.key} className="category-row" data-disabled={disabled}>
          <span className="category-row-spacer" aria-hidden />
          <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => toggleOne(cat, e.target.checked)} />
          <span className="category-row-label">{t(`obj.${obj.key}` as StringKey)}</span>
        </label>
      );
    }

    const isOpen = expanded.has(obj.key);
    return (
      <div key={obj.key}>
        <TreeRow
          label={t(`obj.${obj.key}` as StringKey)}
          categories={obj.categories}
          checked={selectedCategories}
          disabled={disabled}
          onToggleAll={(v) => toggleMany(obj.categories, v)}
          isOpen={isOpen}
          onToggleOpen={() => toggleExpanded(obj.key)}
          groupTip={t("category.groupTip")}
        />
        {isOpen && (
          <div className="category-subtypes">
            {obj.categories.map((cat) => {
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
    <div>
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
          const allBranchCategories =
            branch.key === "spitze"
              ? branch.objects.flatMap((o) => o.categories)
              : branch.groups.flatMap((g) => g.objects.flatMap((o) => o.categories));
          const isOpen = expanded.has(branch.key);

          return (
            <div key={branch.key}>
              <TreeRow
                label={t(`branch.${branch.key}` as StringKey)}
                categories={allBranchCategories}
                checked={selectedCategories}
                disabled={disabled}
                onToggleAll={(v) => toggleMany(allBranchCategories, v)}
                isOpen={isOpen}
                onToggleOpen={() => toggleExpanded(branch.key)}
                bold
                groupTip={t("category.groupTip")}
              />
              {isOpen && (
                <div className="category-subtypes">
                  {branch.key === "spitze"
                    ? branch.objects.map(renderObject)
                    : branch.groups.map((group) => {
                        const groupCategories = group.objects.flatMap((o) => o.categories);
                        const groupOpen = expanded.has(group.key);
                        return (
                          <div key={group.key}>
                            <TreeRow
                              label={t(`grp.${group.key}` as StringKey)}
                              categories={groupCategories}
                              checked={selectedCategories}
                              disabled={disabled}
                              onToggleAll={(v) => toggleMany(groupCategories, v)}
                              isOpen={groupOpen}
                              onToggleOpen={() => toggleExpanded(group.key)}
                              groupTip={t("category.groupTip")}
                            />
                            {groupOpen && <div className="category-subtypes">{group.objects.map(renderObject)}</div>}
                          </div>
                        );
                      })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        {t("category.selectedCount", {
          n: Object.values(selectedCategories).filter(Boolean).length,
          total: Object.keys(selectedCategories).length,
        })}
      </div>
    </div>
  );
}
