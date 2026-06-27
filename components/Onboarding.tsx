"use client";

import { useI18n, type StringKey } from "@/lib/i18n";

interface Props {
  hasKey: boolean;
  hasRef: boolean;
  hasTarget: boolean;
  hasResult: boolean;
  onClose: () => void;
}

interface Step {
  label: StringKey;
  hint: StringKey;
  done: boolean;
  optional?: boolean;
}

export default function Onboarding({ hasKey, hasRef, hasTarget, hasResult, onClose }: Props) {
  const { t } = useI18n();

  const steps: Step[] = [
    { label: "onboard.key", hint: "onboard.keyHint", done: hasKey, optional: true },
    { label: "onboard.earlier", hint: "onboard.earlierHint", done: hasRef },
    { label: "onboard.later", hint: "onboard.laterHint", done: hasTarget },
    { label: "onboard.run", hint: "onboard.runHint", done: hasResult },
    { label: "onboard.explore", hint: "onboard.exploreHint", done: hasResult },
  ];

  // The active step is the first non-optional, not-yet-done step.
  const activeIndex = steps.findIndex((s) => !s.done && !s.optional);

  return (
    <div className="card onboard" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <strong style={{ fontSize: 16 }}>👋 {t("onboard.heading")}</strong>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {t("onboard.subtitle")}
          </div>
        </div>
        <button className="btn-secondary" onClick={onClose}>
          {t("onboard.dismiss")}
        </button>
      </div>

      <ol className="onboard-steps">
        {steps.map((s, i) => {
          const state = s.done ? "done" : i === activeIndex ? "active" : "todo";
          return (
            <li key={s.label} className={`onboard-step onboard-${state}`}>
              <span className="onboard-dot">{s.done ? "✓" : i + 1}</span>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {t(s.label)}
                  {s.optional && !s.done && (
                    <span className="pill" style={{ marginLeft: 8, fontSize: 11 }}>
                      {t("onboard.optional")}
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {t(s.hint)}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
