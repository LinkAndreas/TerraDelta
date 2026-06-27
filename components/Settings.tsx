"use client";

import { useEffect } from "react";
import { PROVIDERS, PROVIDER_KEYS, type Provider } from "@/lib/models";
import { useI18n } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
  provider: Provider;
  setProvider: (p: Provider) => void;
  model: string;
  setModel: (m: string) => void;
  keys: Record<Provider, string>;
  setKey: (p: Provider, value: string) => void;
}

export default function Settings({
  open,
  onClose,
  provider,
  setProvider,
  model,
  setModel,
  keys,
  setKey,
}: Props) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const meta = PROVIDERS[provider];
  const hasKey = !!keys[provider]?.trim();
  const shortName = meta.label.split(" — ")[1] ?? meta.label;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>⚙ {t("settings.heading")}</strong>
          <button className="icon-btn" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div title={t("settings.tipProvider")}>
            <div className="field-label">{t("settings.provider")}</div>
            <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
              {PROVIDER_KEYS.map((p) => (
                <label
                  key={p}
                  className="provider-option"
                  data-active={provider === p}
                  style={{ flex: "1 1 200px" }}
                >
                  <input
                    type="radio"
                    name="provider"
                    checked={provider === p}
                    onChange={() => {
                      setProvider(p);
                      setModel(PROVIDERS[p].defaultModel);
                    }}
                  />
                  {PROVIDERS[p].label}
                </label>
              ))}
            </div>
          </div>

          <div title={t("settings.tipModel")}>
            <div className="field-label">{t("settings.model")}</div>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="field-select">
              {meta.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div title={t("settings.tipKey")}>
            <div className="field-label">{t("settings.apiKey", { provider: shortName })}</div>
            <div className="row" style={{ gap: 8 }}>
              <input
                type="password"
                autoComplete="off"
                placeholder={meta.keyHint}
                value={keys[provider] ?? ""}
                onChange={(e) => setKey(provider, e.target.value.trim().replace(/[‐-―−]/g, "-"))}
                style={{ flex: 1 }}
              />
              {hasKey && (
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => setKey(provider, "")}
                  title={t("settings.tipClear")}
                >
                  {t("settings.clear")}
                </button>
              )}
            </div>
            {/[^\x20-\x7E]/.test(keys[provider] ?? "") && (
              <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 6 }}>{t("settings.nonAscii")}</div>
            )}
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {t("settings.stored")}{" "}
              <a href={meta.keysUrl} target="_blank" rel="noreferrer">
                {t("settings.getKey")}
              </a>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button onClick={onClose}>{t("common.done")}</button>
        </div>
      </div>
    </div>
  );
}
