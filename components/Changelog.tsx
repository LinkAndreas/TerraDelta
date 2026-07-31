"use client";

import { useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Release history, one section per version. Entries come from lib/changelog.ts,
// which is generated from the repository's release tags — so what is shown here
// is what was actually shipped.
export default function Changelog({ open, onClose }: Props) {
  const { t, lang } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(`${iso}T00:00:00`));

  const versionLabel = (e: ChangelogEntry) =>
    e.date === null ? t("changelog.unreleased") : `v${e.version}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("changelog.heading")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <strong>{t("changelog.heading")}</strong>
          <button className="icon-btn" onClick={onClose} aria-label={t("changelog.close")}>
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ gap: 0, maxHeight: "62vh", overflowY: "auto" }}>
          {CHANGELOG.map((entry) => (
            <section key={entry.version} className="changelog-entry">
              <div className="changelog-version">
                <span
                  className="changelog-tag"
                  data-unreleased={entry.date === null ? "true" : undefined}
                >
                  {versionLabel(entry)}
                </span>
                {entry.date && <span className="muted">{formatDate(entry.date)}</span>}
              </div>
              <ul className="changelog-list">
                {entry.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="modal-foot">
          <button className="btn-secondary" onClick={onClose}>
            {t("changelog.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
