"use client";

import { useEffect } from "react";
import { PROVIDERS, type Provider } from "@/lib/models";
import { useI18n } from "@/lib/i18n";
import { SupportedModels } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  provider: Provider;
  setProvider: (p: Provider) => void;
  model: string;
  setModel: (m: string) => void;
  keys: Record<Provider, string>;
  setKey: (p: Provider, value: string) => void;
  availableModels: Record<Provider, SupportedModels | undefined>;
  onRefreshModels: () => void;
  isFetchingModels: boolean;
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
  availableModels,
  onRefreshModels,
  isFetchingModels,
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
          <div title={t("settings.tipModel")}>
            <div className="field-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{t("settings.model")}</span>
              <button 
                className="icon-btn" 
                onClick={onRefreshModels} 
                title="Refresh Models" 
                disabled={isFetchingModels}
                style={{ fontSize: 14, opacity: isFetchingModels ? 0.5 : 1 }}
              >
                {isFetchingModels ? "..." : "↻"}
              </button>
            </div>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="field-select">
              <option key={"default"} value={"default"}>
                default
              </option>
              {availableModels[provider]?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
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
