"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import UploadZone from "@/components/UploadZone";
import CompareView from "@/components/CompareView";
import ReportTable from "@/components/ReportTable";
import Settings from "@/components/Settings";
import Onboarding from "@/components/Onboarding";
import Logo from "@/components/Logo";
import { alignImages, loadOpenCv, type AlignResult } from "@/lib/align";
import { buildTiles, mapToGlobal, dedupe, type Tile } from "@/lib/tiles";
import { PROVIDERS, type Provider } from "@/lib/models";
import { useI18n, LANG_NAMES, type Lang, type StringKey } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import type { AnalyzeResult, Change, ChangeType, Confidence } from "@/lib/types";

const STORE_KEY = "orthophoto-diff:settings";

type Stage = "idle" | "loading" | "aligning" | "analyzing";

const STAGE_KEY: Record<Stage, StringKey> = {
  idle: "run.detect",
  loading: "run.loading",
  aligning: "run.aligning",
  analyzing: "run.analyzing",
};

const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

interface TaskResult {
  changes: Change[];
  summary: string;
  model: string;
  failed: boolean;
  error?: string;
}

export default function Home() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();

  const [refUrl, setRefUrl] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState<string | null>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [progressMsg, setProgressMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [align, setAlign] = useState<AlignResult | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Filters (lifted here so the overlay and the table stay in sync).
  const [typeFilter, setTypeFilter] = useState<Record<ChangeType, boolean>>({
    added: true,
    removed: true,
    modified: true,
  });
  const [minConf, setMinConf] = useState<Confidence>("low");
  const [query, setQuery] = useState("");

  // Provider / model / API keys (persisted to localStorage).
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [model, setModel] = useState<string>(PROVIDERS.anthropic.defaultModel);
  const [keys, setKeys] = useState<Record<Provider, string>>({ anthropic: "" });
  const [loaded, setLoaded] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoUpscale, setAutoUpscale] = useState(false);

  useEffect(() => {
    setShowGuide(localStorage.getItem("orthophoto-diff:onboarded") !== "1");
  }, []);
  const dismissGuide = () => {
    setShowGuide(false);
    localStorage.setItem("orthophoto-diff:onboarded", "1");
  };

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      if (saved.provider && PROVIDERS[saved.provider as Provider]) setProvider(saved.provider);
      if (typeof saved.model === "string") setModel(saved.model);
      if (saved.keys) setKeys({ anthropic: "", ...saved.keys });
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(STORE_KEY, JSON.stringify({ provider, model, keys }));
  }, [loaded, provider, model, keys]);

  const startRef = useRef(0);
  const busy = stage !== "idle";
  const canRun = !!refUrl && !!targetUrl && !busy;
  const hasKey = !!keys[provider]?.trim();
  const providerShort = PROVIDERS[provider].label.split(" — ")[1] ?? PROVIDERS[provider].label;

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [busy]);

  const visibleIds = useMemo(() => {
    const set = new Set<string>();
    if (!result) return set;
    const q = query.trim().toLowerCase();
    for (const c of result.changes) {
      if (!typeFilter[c.change_type]) continue;
      if (CONF_RANK[c.confidence] < CONF_RANK[minConf]) continue;
      if (q && !(`${c.description} ${c.category}`.toLowerCase().includes(q))) continue;
      set.add(c.id);
    }
    return set;
  }, [result, typeFilter, minConf, query]);

  async function run() {
    if (!refUrl || !targetUrl) return;
    setError(null);
    setResult(null);
    setSelectedId(null);
    startRef.current = Date.now();
    setElapsed(0);

    try {
      const engineReady =
        typeof window !== "undefined" && (window as { cv?: { Mat?: unknown } }).cv?.Mat;
      setStage("loading");
      setProgressMsg(t(engineReady ? "progress.engineReady" : "progress.initEngine"));
      await loadOpenCv();

      setStage("aligning");

      // Optionally upscale before alignment — original URLs are kept for the
      // upload-zone previews; only the processed outputs reach CompareView.
      let processRefUrl = refUrl;
      let processTargetUrl = targetUrl;
      if (autoUpscale) {
        setProgressMsg(t("progress.analyzingRes"));
        const [refThumb, tgtThumb] = await Promise.all([
          thumbnailDataUrl(refUrl, 512),
          thumbnailDataUrl(targetUrl, 512),
        ]);
        const res = await fetch("/api/upscale-suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            refUrl: refThumb,
            targetUrl: tgtThumb,
            apiKey: keys[provider] || undefined,
          }),
        });
        const { factor = 1 } = (await res.json()) as { factor?: number };
        if (factor > 1) {
          setProgressMsg(t("progress.upscaling", { factor }));
          const { upscaleImage } = await import("@/lib/upscale");
          [processRefUrl, processTargetUrl] = await Promise.all([
            upscaleImage(refUrl, factor),
            upscaleImage(targetUrl, factor),
          ]);
        }
      }

      setProgressMsg(t("progress.aligning"));
      const aligned = await alignImages(processRefUrl, processTargetUrl, 2600);
      setAlign(aligned);

      setStage("analyzing");
      setProgressMsg(t("progress.splitting"));
      const { overview, tiles } = await buildTiles(aligned.refUrl, aligned.targetUrl);
      const tasks: Tile[] = [overview, ...tiles];

      let done = 0;
      const onTaskDone = () => {
        done++;
        setProgressMsg(t("progress.region", { done, total: tasks.length }));
      };

      const results: TaskResult[] = await runPool<Tile, TaskResult>(
        tasks,
        4,
        async (tile) => {
          try {
            const res = await fetch("/api/analyze", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                reference: tile.refUrl,
                target: tile.targetUrl,
                provider,
                model,
                apiKey: keys[provider] || undefined,
                lang,
              }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Analysis failed");
            const changes: Change[] = (data.changes ?? []).map((c: Change) => ({
              ...c,
              bbox: mapToGlobal(tile, c.bbox),
            }));
            return { changes, summary: data.summary ?? "", model: data.model ?? "", failed: false };
          } catch (e) {
            return {
              changes: [],
              summary: "",
              model: "",
              failed: true,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        },
        onTaskDone,
      );

      setProgressMsg(t("progress.merging"));
      const merged = dedupe(results.flatMap((r) => r.changes));
      const failed = results.filter((r) => r.failed).length;
      const summary =
        results[0]?.summary ||
        `${merged.length} change${merged.length === 1 ? "" : "s"} detected across ${tasks.length} regions.`;
      const usedModel = results.map((r) => r.model).find(Boolean) || "";

      setResult({ changes: merged, summary, model: usedModel });
      if (failed > 0) {
        const firstErr = results.find((r) => r.failed)?.error || "unknown error";
        const allFailed = failed === tasks.length;
        setError(
          t(allFailed ? "error.allFailed" : "error.someFailed", {
            failed,
            total: tasks.length,
            err: firstErr,
          }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.generic"));
    } finally {
      setStage("idle");
      setProgressMsg("");
    }
  }

  return (
    <div className="container">
      <div className="topbar">
        <div>
          <div className="row" style={{ gap: 14 }}>
            <Logo size={46} />
            <div>
              <h1 className="wordmark">
                Terra<span className="wordmark-accent">Delta</span>
              </h1>
              <div className="muted" style={{ fontSize: 14, marginTop: 0, letterSpacing: 0.2 }}>
                {t("app.tagline")}
              </div>
            </div>
          </div>
          <p className="muted" style={{ margin: "14px 0 0", maxWidth: 860, fontSize: 15.5 }}>
            {t("app.subtitle")}
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            title={t("settings.tipOpen")}
            aria-label={t("settings.heading")}
            style={{ position: "relative" }}
          >
            ⚙
            {!hasKey && (
              <span
                className="status-dot"
                style={{ position: "absolute", top: 4, right: 4, background: "#f59e0b" }}
              />
            )}
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowGuide(true)}
            title={t("onboard.tipReopen")}
            style={{ fontSize: 14.5, fontWeight: 600 }}
          >
            {t("onboard.reopen")}
          </button>
          <select
            className="lang"
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            title={t("lang.label")}
            aria-label={t("lang.label")}
          >
            {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
              <option key={l} value={l}>
                {LANG_NAMES[l]}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            onClick={toggle}
            title={theme === "dark" ? t("theme.toLight") : t("theme.toDark")}
            aria-label={theme === "dark" ? t("theme.toLight") : t("theme.toDark")}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </div>

      {showGuide && (
        <Onboarding
          hasKey={!!keys[provider]?.trim()}
          hasRef={!!refUrl}
          hasTarget={!!targetUrl}
          hasResult={!!result}
          onClose={dismissGuide}
        />
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
          <UploadZone
            label={t("upload.earlier")}
            sublabel={t("upload.earlierSub")}
            url={refUrl}
            onFile={setRefUrl}
          />
          <UploadZone
            label={t("upload.later")}
            sublabel={t("upload.laterSub")}
            url={targetUrl}
            onFile={setTargetUrl}
          />
        </div>

        <div className="row" style={{ gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={run} disabled={!canRun} title={t("run.tip")}>
            {busy && <span className="spinner" />}
            {t(STAGE_KEY[stage])}
          </button>
          <button
            className="chip-btn"
            onClick={() => setSettingsOpen(true)}
            title={t("settings.tipOpen")}
          >
            <span
              className="status-dot"
              style={{ background: hasKey ? "#22c55e" : "#f59e0b" }}
            />
            {providerShort} · {model}
          </button>
          {align && stage === "idle" && (
            <span className="pill">
              {align.aligned
                ? t("align.matched", { n: align.matchCount })
                : t("align.fallback")}
            </span>
          )}
        </div>

        <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 13 }} title={t("run.tipUpscale")}>
            {t("run.upscale")}:
          </span>
          <div className="segmented" role="group" title={t("run.tipUpscale")}>
            <button aria-pressed={!autoUpscale} onClick={() => setAutoUpscale(false)}>
              {t("run.upscaleOff")}
            </button>
            <button aria-pressed={autoUpscale} onClick={() => setAutoUpscale(true)}>
              {t("run.upscaleAuto")}
            </button>
          </div>
        </div>

        {!hasKey && (
          <button
            className="link-hint"
            onClick={() => setSettingsOpen(true)}
            style={{ marginTop: 10 }}
          >
            ⚠ {t("run.needKey")}
          </button>
        )}

        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          {t("note.pipeline")}
        </div>

        {busy && (
          <div style={{ marginTop: 14 }}>
            <Steps stage={stage} />
            <div className="progress-track">
              <div className="progress-bar" />
            </div>
            <div className="row" style={{ justifyContent: "space-between", gap: 12, marginTop: 8 }}>
              <span style={{ fontSize: 13 }}>{progressMsg}</span>
              <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                {elapsed.toFixed(1)}s
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>

      {result && align && (
        <>
          {result.summary && (
            <div className="card" style={{ marginBottom: 16 }}>
              <strong>{t("summary.heading")}</strong>
              <p style={{ margin: "6px 0 0" }}>{result.summary}</p>
              <span className="muted" style={{ fontSize: 12 }}>
                {t("summary.meta", { n: result.changes.length, model: result.model })}
              </span>
            </div>
          )}

          {/* Comparison spans full width (much larger), report below it. */}
          <div style={{ marginBottom: 16 }}>
            <CompareView
              refUrl={align.refUrl}
              targetUrl={align.targetUrl}
              width={align.width}
              height={align.height}
              changes={result.changes}
              visibleIds={visibleIds}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
          <ReportTable
            changes={result.changes}
            visibleIds={visibleIds}
            selectedId={selectedId}
            onSelect={setSelectedId}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            minConf={minConf}
            setMinConf={setMinConf}
            query={query}
            setQuery={setQuery}
            refUrl={align.refUrl}
            targetUrl={align.targetUrl}
          />
        </>
      )}

      {!result && !busy && (
        <div className="card muted" style={{ fontSize: 13 }}>
          <strong style={{ color: "var(--text)" }}>{t("how.heading")}</strong>
          <ol style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            <li>{t("how.1")}</li>
            <li>{t("how.2")}</li>
            <li>{t("how.3")}</li>
            <li>{t("how.4")}</li>
          </ol>
        </div>
      )}

      <footer className="footer">
        <Logo size={20} />
        <span>
          <strong style={{ color: "var(--text)" }}>TerraDelta</strong> · {t("app.tagline")}
        </span>
      </footer>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        provider={provider}
        setProvider={setProvider}
        model={model}
        setModel={setModel}
        keys={keys}
        setKey={(p, value) => setKeys((k) => ({ ...k, [p]: value }))}
      />
    </div>
  );
}

// Downsamples a data-URL image to a thumbnail for lightweight API calls.
function thumbnailDataUrl(src: string, size: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth <= size && img.naturalHeight <= size) {
        resolve(src);
        return;
      }
      const ar = img.naturalWidth / img.naturalHeight;
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = ar > 1 ? [size, Math.round(size / ar)] : [Math.round(size * ar), size];
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.src = src;
  });
}

// Runs `worker` over `items` with at most `limit` in flight; preserves order.
async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onDone: () => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function pump(): Promise<void> {
    const i = next++;
    if (i >= items.length) return;
    results[i] = await worker(items[i], i);
    onDone();
    return pump();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump));
  return results;
}

const STEPS: { key: Stage; label: StringKey }[] = [
  { key: "loading", label: "step.load" },
  { key: "aligning", label: "step.align" },
  { key: "analyzing", label: "step.detect" },
];

function Steps({ stage }: { stage: Stage }) {
  const { t } = useI18n();
  const order: Stage[] = ["loading", "aligning", "analyzing"];
  const current = order.indexOf(stage);
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
      {STEPS.map((s, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return (
          <span key={s.key} className={`step step-${state}`}>
            <span className="step-dot">{state === "done" ? "✓" : i + 1}</span>
            {t(s.label)}
          </span>
        );
      })}
    </div>
  );
}
