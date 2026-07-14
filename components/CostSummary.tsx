"use client";

import { useI18n } from "@/lib/i18n";
import { estimateCost, formatCost } from "@/lib/models";
import type { AnalyzeResult, Currency } from "@/lib/types";

interface Props {
  result: AnalyzeResult;
  currency: Currency;
}

// A dedicated post-run widget (rather than a line tucked into the summary
// card) so the token/cost breakdown — including how much of the run was
// served from the cached system prompt — is easy to spot after every run.
export default function CostSummary({ result, currency }: Props) {
  const { t } = useI18n();
  const { usage, model } = result;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const totalTokens = usage.inputTokens + usage.outputTokens + cacheWrite + cacheRead;
  if (totalTokens <= 0) return null;

  const cost = estimateCost(model, usage, currency);

  const rows: { key: string; label: string; value: number }[] = [
    { key: "input", label: t("cost.input"), value: usage.inputTokens },
    { key: "output", label: t("cost.output"), value: usage.outputTokens },
  ];
  if (cacheWrite > 0) rows.push({ key: "cacheWrite", label: t("cost.cacheWrite"), value: cacheWrite });
  if (cacheRead > 0) rows.push({ key: "cacheRead", label: t("cost.cacheRead"), value: cacheRead });

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
        <strong style={{ fontSize: 15 }}>{t("cost.heading")}</strong>
        <span style={{ fontSize: 24, fontWeight: 700 }} title={t("cost.tip")}>
          ~{formatCost(cost, currency)}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        {t("cost.total", { tokens: totalTokens.toLocaleString() })}
      </div>

      <div className="row" style={{ gap: 20, flexWrap: "wrap", marginTop: 12 }}>
        {rows.map((r) => (
          <div key={r.key}>
            <div className="muted" style={{ fontSize: 11 }}>
              {r.label}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{r.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {cacheRead > 0 && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          {t("cost.cacheNote", { tokens: cacheRead.toLocaleString() })}
        </div>
      )}
    </div>
  );
}
