"use client";

import { useEffect, useState } from "react";
import { PROVIDERS, type Provider } from "@/lib/models";
import { useI18n, type StringKey } from "@/lib/i18n";
import { EFFORT_LEVELS, SupportedModels, type Currency, type Effort } from "@/lib/types";

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
  currency: Currency;
  setCurrency: (c: Currency) => void;
  effort: Effort;
  setEffort: (e: Effort) => void;
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
  currency,
  setCurrency,
  effort,
  setEffort,
}: Props) {
  const { t } = useI18n();
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testMsg, setTestMsg] = useState("");

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

  async function testConnection() {
    setTestState("testing");
    setTestMsg("");
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: keys[provider] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestState("error");
        setTestMsg(t("settings.testError", { err: data.error || res.statusText }));
        return;
      }
      setTestState("ok");
      setTestMsg(t("settings.testOk", { n: data.models?.length ?? 0 }));
    } catch (e) {
      setTestState("error");
      setTestMsg(t("settings.testError", { err: e instanceof Error ? e.message : String(e) }));
    }
  }

  function onKeyChange(value: string) {
    setKey(provider, value.trim().replace(/[‐-―−]/g, "-"));
    setTestState("idle");
    setTestMsg("");
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span aria-hidden style={{ fontSize: 26, lineHeight: 1 }}>⚙</span>
            {t("settings.topbarLabel")}
          </strong>
          <button className="icon-btn" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="settings-section">
            <div className="settings-section-head">
              <div className="settings-section-title">{t("settings.section.apiKey")}</div>
              <div className="settings-section-desc">{t("settings.section.apiKeyDesc")}</div>
            </div>

            <div>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={meta.keyHint}
                  value={keys[provider] ?? ""}
                  onChange={(e) => onKeyChange(e.target.value)}
                  style={{ flex: 1 }}
                />
                {hasKey && (
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={() => onKeyChange("")}
                    title={t("settings.tipClear")}
                  >
                    {t("settings.clear")}
                  </button>
                )}
              </div>
              {/[^\x20-\x7E]/.test(keys[provider] ?? "") && (
                <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 6 }}>{t("settings.nonAscii")}</div>
              )}
              <div className="field-hint">
                {t("settings.stored")}{" "}
                <a href={meta.keysUrl} target="_blank" rel="noreferrer">
                  {t("settings.getKey")}
                </a>
              </div>

              <div style={{ marginTop: 12 }}>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={testConnection}
                  disabled={testState === "testing"}
                  style={{ flexShrink: 0 }}
                >
                  {testState === "testing" ? t("settings.testing") : t("settings.test")}
                </button>
                {testState === "ok" && (
                  <div style={{ color: "#4ade80", fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>✓ {testMsg}</div>
                )}
                {testState === "error" && (
                  <div style={{ color: "#fca5a5", fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>✕ {testMsg}</div>
                )}
              </div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-head">
              <div className="settings-section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{t("settings.section.model")}</span>
                <button
                  className="icon-btn"
                  onClick={onRefreshModels}
                  title="Refresh Models"
                  disabled={isFetchingModels || !hasKey}
                  style={{ fontSize: 14, opacity: isFetchingModels ? 0.5 : 1 }}
                >
                  {isFetchingModels ? "..." : "↻"}
                </button>
              </div>
              <div className="settings-section-desc">{t("settings.section.modelDesc")}</div>
            </div>

            <div>
              <select value={model} onChange={(e) => setModel(e.target.value)} className="field-select" disabled={!hasKey}>
                <option key={"default"} value={"default"}>
                  default
                </option>
                {availableModels[provider]?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <div className="field-hint">{hasKey ? t("settings.tipModel") : t("settings.modelNeedsKey")}</div>
            </div>

            <div>
              <div className="field-label">{t("settings.section.effort")}</div>
              <div className="field-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                {t("settings.section.effortDesc")}
              </div>
              <div className="segmented">
                {EFFORT_LEVELS.map((lvl) => (
                  <button key={lvl} type="button" aria-pressed={effort === lvl} onClick={() => setEffort(lvl)}>
                    {t(`effort.${lvl}` as StringKey)}
                  </button>
                ))}
              </div>
              <div className="field-hint">{t(`effort.${effort}.hint` as StringKey)}</div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-head">
              <div className="settings-section-title">{t("settings.section.cost")}</div>
              <div className="settings-section-desc">{t("settings.section.costDesc")}</div>
            </div>

            <div>
              <div className="segmented">
                <button type="button" aria-pressed={currency === "EUR"} onClick={() => setCurrency("EUR")}>
                  EUR (€)
                </button>
                <button type="button" aria-pressed={currency === "USD"} onClick={() => setCurrency("USD")}>
                  USD ($)
                </button>
              </div>
              <div className="field-hint">{t(`currency.${currency}.hint` as StringKey)}</div>
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
