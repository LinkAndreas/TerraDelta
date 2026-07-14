"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import UploadZone, { type UploadMeta } from "@/components/UploadZone";
import CompareView from "@/components/CompareView";
import ReportTable from "@/components/ReportTable";
import SearchAreaSection from "@/components/SearchAreaSection";
import CategorySection from "@/components/CategorySection";
import CostSummary from "@/components/CostSummary";
import Settings from "@/components/Settings";
import Onboarding from "@/components/Onboarding";
import Logo from "@/components/Logo";
import { alignImages, loadOpenCv, type AlignResult } from "@/lib/align";
import { buildTiles, buildVerifyCrops, mapToGlobal, dedupe, type Tile } from "@/lib/tiles";
import { rectsOverlap, searchAreaToNormalizedRect, changeInSearchArea } from "@/lib/geo";
import { PROVIDER_KEYS, PROVIDERS, type Provider } from "@/lib/models";
import { useI18n, LANG_NAMES, type Lang, type StringKey } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import {
  CATEGORIES,
  DEFAULT_EFFORT,
  defaultSelectedCategories,
  EFFORT_LEVELS,
  type AnalyzeResult,
  type Category,
  type Change,
  type ChangeType,
  type Confidence,
  type Currency,
  type Effort,
  type SearchArea,
  type SupportedModels,
  type TokenUsage,
} from "@/lib/types";

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
  status?: number;
  usage?: TokenUsage;
}

export default function Home() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();

  const [refUrl, setRefUrl] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState<string | null>(null);
  const [refMeta, setRefMeta] = useState<UploadMeta | null>(null);
  const [targetMeta, setTargetMeta] = useState<UploadMeta | null>(null);

  // §7: both compared images must share the same file type.
  const formatMismatch =
    !!refMeta && !!targetMeta && refMeta.ext !== targetMeta.ext;

  // §1.0: the search-area restriction needs georeferencing on both images.
  const geoAvailable = !!refMeta?.geo && !!targetMeta?.geo;

  // §1/§5: search-area restriction and category selection are independent
  // concerns (where to look vs. what to look for) — kept as separate state,
  // each with its own dedicated UI section.
  const [searchAreaEnabled, setSearchAreaEnabled] = useState(false);
  const [searchArea, setSearchArea] = useState<SearchArea | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Record<Category, boolean>>(defaultSelectedCategories);

  const [stage, setStage] = useState<Stage>("idle");
  const [progressMsg, setProgressMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Set when a request comes back 429 (rate limit / usage quota) — surfaced
  // as its own alert (distinct from a generic failure) and reflected in the
  // model status indicator, since it means the key is fine but throttled.
  const [rateLimitAlert, setRateLimitAlert] = useState(false);
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

  // Provider / model / API keys / cost-estimate currency / reasoning effort (persisted to localStorage).
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [model, setModel] = useState<string>("default");
  const [keys, setKeys] = useState<Record<Provider, string>>({ anthropic: "" });
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [effort, setEffort] = useState<Effort>(DEFAULT_EFFORT);
  const [loaded, setLoaded] = useState(false);
  const [availableModels, setAvailableModels] = useState<Record<Provider, SupportedModels | undefined>>({ anthropic: undefined });
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const refreshModels = async () => {
    setIsFetchingModels(true);
    const newAvailableModels: Record<Provider, SupportedModels | undefined> = { anthropic: undefined };
    for (const p of PROVIDER_KEYS) {
      newAvailableModels[p] = await PROVIDERS[p].fetchModels(keys[p]);
    }
    setAvailableModels(newAvailableModels);
    setIsFetchingModels(false);
  };

  useEffect(() => {
    let active = true;
    const timeout = setTimeout(async () => {
      setIsFetchingModels(true);
      const newAvailableModels: Record<Provider, SupportedModels | undefined> = { anthropic: undefined };
      for (const p of PROVIDER_KEYS) {
        newAvailableModels[p] = await PROVIDERS[p].fetchModels(keys[p]);
      }
      if (active) {
        setAvailableModels(newAvailableModels);
        setIsFetchingModels(false);
      }
    }, 500);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [keys]);

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
      if (saved.currency === "EUR" || saved.currency === "USD") setCurrency(saved.currency);
      if (EFFORT_LEVELS.includes(saved.effort)) setEffort(saved.effort);
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(STORE_KEY, JSON.stringify({ provider, model, keys, currency, effort }));
  }, [loaded, provider, model, keys, currency, effort]);

  const startRef = useRef(0);
  const busy = stage !== "idle";
  // A search area isn't "active" until the user has actually picked a point —
  // lat/lon default to NaN ("unset") in SearchAreaSection until then, so a
  // shape/size edit alone can't accidentally run the search at (0, 0).
  const hasValidPoint = !!searchArea && Number.isFinite(searchArea.lat) && Number.isFinite(searchArea.lon);
  const activeSearchArea = searchAreaEnabled && geoAvailable && hasValidPoint ? searchArea : null;
  const canRun =
    !!refUrl &&
    !!targetUrl &&
    !busy &&
    !formatMismatch &&
    (!searchAreaEnabled || (geoAvailable && !!activeSearchArea)) &&
    CATEGORIES.some((c) => selectedCategories[c]);
  const hasKey = !!keys[provider]?.trim();
  const providerShort = PROVIDERS[provider].label.split(" — ")[1] ?? PROVIDERS[provider].label;
  // Single tri-state readout for "is the selected model usable right now",
  // shared by the topbar and run-row indicators so they never disagree.
  const modelStatus: "ready" | "noKey" | "limited" = rateLimitAlert ? "limited" : hasKey ? "ready" : "noKey";
  const modelStatusColor = { ready: "#22c55e", noKey: "#f59e0b", limited: "#ef4444" }[modelStatus];
  const modelStatusTip = t(
    modelStatus === "limited" ? "settings.tipLimited" : modelStatus === "noKey" ? "run.needKey" : "settings.tipReady",
  );

  // One-line summary shown on the collapsed "Options" toggle, so the current
  // settings are visible without expanding it.
  const categorySummary = t("options.categoriesCount", {
    n: CATEGORIES.filter((c) => selectedCategories[c]).length,
    total: CATEGORIES.length,
  });
  const areaSummary =
    searchAreaEnabled && hasValidPoint && searchArea
      ? searchArea.shape === "circle"
        ? `⌀ ${Math.round(searchArea.radiusM * 2)} m`
        : `${Math.round(searchArea.widthM)} × ${Math.round(searchArea.heightM)} m`
      : t("options.wholeImage");
  const optionsSummary = `${categorySummary} · ${areaSummary}`;

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
    setRateLimitAlert(false);
    setResult(null);
    setSelectedId(null);
    setOptionsOpen(false);
    startRef.current = Date.now();
    setElapsed(0);

    try {
      const engineReady =
        typeof window !== "undefined" && (window as { cv?: { Mat?: unknown } }).cv?.Mat;
      setStage("loading");
      setProgressMsg(t(engineReady ? "progress.engineReady" : "progress.initEngine"));
      await loadOpenCv();

      setStage("aligning");

      const processRefUrl = refUrl;
      const processTargetUrl = targetUrl;

      setProgressMsg(t("progress.aligning"));
      const aligned = await alignImages(processRefUrl, processTargetUrl, 2600);
      setAlign(aligned);

      setStage("analyzing");
      setProgressMsg(t("progress.splitting"));
      const { overview, tiles } = await buildTiles(aligned.refUrl, aligned.targetUrl);

      // §1: when the search area is enabled, only analyze regions that
      // overlap the requested area (using the reference image's GeoTIFF
      // georeferencing — see lib/geo.ts for why only the reference is needed).
      const searchRect = activeSearchArea && refMeta?.geo ? searchAreaToNormalizedRect(refMeta.geo, activeSearchArea) : null;
      let tasks: Tile[] = [overview, ...tiles];
      if (searchRect) {
        const restricted = tiles.filter((tile) =>
          rectsOverlap(searchRect, { gx: tile.gx, gy: tile.gy, gw: tile.gw, gh: tile.gh }),
        );
        tasks = restricted.length > 0 ? restricted : tiles;
      }

      let done = 0;
      const onTaskDone = () => {
        done++;
        setProgressMsg(t("progress.region", { done, total: tasks.length }));
      };

      // Scope the model's search to exactly what's selected, instead of
      // always asking it to hunt through the full 62-category catalog and
      // discarding the unwanted results afterward (see lib/prompt.ts
      // buildSystem) — cuts noise and misclassification risk on runs
      // restricted to a small subset like Spitzenaktualisierung alone.
      const enabledCategories = CATEGORIES.filter((c) => selectedCategories[c]);

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
                effort,
                categories: enabledCategories,
              }),
            });
            const data = await res.json();
            if (!res.ok) {
              const err = new Error(data.error || "Analysis failed") as Error & { status?: number };
              err.status = res.status;
              throw err;
            }
            const changes: Change[] = (data.changes ?? []).map((c: Change) => ({
              ...c,
              bbox: mapToGlobal(tile, c.bbox),
            }));
            return { changes, summary: data.summary ?? "", model: data.model ?? "", failed: false, usage: data.usage };
          } catch (e) {
            return {
              changes: [],
              summary: "",
              model: "",
              failed: true,
              error: e instanceof Error ? e.message : String(e),
              status: (e as { status?: number })?.status,
            };
          }
        },
        onTaskDone,
      );
      if (results.some((r) => r.status === 429)) setRateLimitAlert(true);

      setProgressMsg(t("progress.merging"));
      // §5.0/§5.4: keep only the selected change-type categories, and (in
      // restricted-search mode) only changes whose center actually falls
      // inside the requested search area — tile-overlap pruning above is
      // loose (a tile can overlap the area at just one corner), so a
      // detection anywhere in that tile can still land outside it. Filtering
      // here, before the costly per-candidate verification pass below, means
      // we never pay for an extra API call confirming a change we're about
      // to discard anyway.
      const merged = dedupe(results.flatMap((r) => r.changes))
        .filter((c) => selectedCategories[c.category as Category] ?? true)
        .filter((c) => !activeSearchArea || !refMeta?.geo || changeInSearchArea(refMeta.geo, activeSearchArea, c));

      // Second pass: re-examine every candidate on a zoomed-in crop so false
      // positives (lighting/season artifacts) are dropped and boxes tightened.
      // The detection pass is tuned for recall; this pass restores precision.
      let confirmed = merged;
      const verifyUsages: TokenUsage[] = [];
      if (merged.length > 0) {
        setProgressMsg(t("progress.verifying", { done: 0, total: merged.length }));
        const crops = await buildVerifyCrops(
          aligned.refUrl,
          aligned.targetUrl,
          merged.map((c) => c.bbox),
        );
        let vDone = 0;
        const verified = await runPool<Change, Change | null>(
          merged,
          4,
          async (chg, i) => {
            try {
              const res = await fetch("/api/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  reference: crops[i].refUrl,
                  target: crops[i].targetUrl,
                  provider,
                  model,
                  apiKey: keys[provider] || undefined,
                  lang,
                  effort,
                  candidate: {
                    category: chg.category,
                    change_type: chg.change_type,
                    description: chg.description,
                  },
                }),
              });
              const data = await res.json();
              if (!res.ok) {
                if (res.status === 429) setRateLimitAlert(true);
                throw new Error(data.error || "Verification failed");
              }
              // Record spend even for a rejected candidate — the call still cost tokens.
              if (data.usage) verifyUsages.push(data.usage);
              if (!data.genuine) return null;
              const refined = mapToGlobal(crops[i], data.bbox ?? [0, 0, 0, 0]);
              const refinedOk = refined[2] > 0.001 && refined[3] > 0.001;
              return {
                ...chg,
                confidence: (data.confidence as Confidence) || chg.confidence,
                bbox: refinedOk ? refined : chg.bbox,
              };
            } catch {
              return chg; // verification unavailable — keep the original detection
            }
          },
          () => {
            vDone++;
            setProgressMsg(t("progress.verifying", { done: vDone, total: merged.length }));
          },
        );
        confirmed = verified
          .filter((c): c is Change => c !== null)
          .map((c, i) => ({ ...c, id: `chg-${i + 1}` }));
      }

      // Re-apply the same area check post-verification: the crop-based pass
      // above can tighten/shift a candidate's bbox, so one that started out
      // inside the search area could refine to just outside it.
      const filtered = confirmed
        .filter((c) => !activeSearchArea || !refMeta?.geo || changeInSearchArea(refMeta.geo, activeSearchArea, c))
        .map((c, i) => ({ ...c, id: `chg-${i + 1}` }));

      const failed = results.filter((r) => r.failed).length;
      const summary =
        results[0]?.summary ||
        `${filtered.length} change${filtered.length === 1 ? "" : "s"} detected across ${tasks.length} regions.`;
      const usedModel = results.map((r) => r.model).find(Boolean) || "";

      // Total spend across both passes: every detect call (one per tile) plus
      // every verify call (one per candidate) — regardless of whether that
      // candidate was ultimately confirmed, since a rejected one still cost tokens.
      const totalUsage = [...results.map((r) => r.usage), ...verifyUsages].reduce<TokenUsage>(
        (acc, u) => ({
          inputTokens: acc.inputTokens + (u?.inputTokens ?? 0),
          outputTokens: acc.outputTokens + (u?.outputTokens ?? 0),
          cacheWriteTokens: (acc.cacheWriteTokens ?? 0) + (u?.cacheWriteTokens ?? 0),
          cacheReadTokens: (acc.cacheReadTokens ?? 0) + (u?.cacheReadTokens ?? 0),
        }),
        { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
      );

      setResult({ changes: filtered, summary, model: usedModel, usage: totalUsage });
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

  // Clears everything specific to this comparison run (images, alignment,
  // results, filters) so the user can start a fresh comparison — but leaves
  // standing preferences (category selection, provider/model/key, currency,
  // effort, language, theme) untouched, since those aren't part of "this run".
  function startOver() {
    setRefUrl(null);
    setTargetUrl(null);
    setRefMeta(null);
    setTargetMeta(null);
    setSearchAreaEnabled(false);
    setSearchArea(null);
    setAlign(null);
    setResult(null);
    setSelectedId(null);
    setError(null);
    setRateLimitAlert(false);
    setTypeFilter({ added: true, removed: true, modified: true });
    setMinConf("low");
    setQuery("");
    setOptionsOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
          <p className="muted app-subtitle" style={{ margin: "14px 0 0", fontSize: 15.5, lineHeight: 1.55 }}>
            {t("app.subtitle")}
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            title={t("settings.tipOpen")}
            aria-label={t("settings.topbarLabel")}
            style={{ width: 44, flex: "0 0 auto" }}
          >
            {/* The gear glyph (U+2699, plain monochrome dingbat) renders
                visibly smaller than the sun/moon emoji next to it at the
                same font-size — emoji get real color-glyph metrics, this
                doesn't. Bumped up to compensate so both read as the same
                visual weight/size in the button. */}
            <span aria-hidden style={{ fontSize: 21 }}>⚙</span>
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowGuide((v) => !v)}
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
            disabled={busy}
            onFile={(dataUrl, meta) => {
              setRefUrl(dataUrl);
              setRefMeta(meta);
              if (!meta.geo) {
                setSearchArea(null);
                setSearchAreaEnabled(false);
              }
            }}
          />
          <UploadZone
            label={t("upload.later")}
            sublabel={t("upload.laterSub")}
            url={targetUrl}
            disabled={busy}
            onFile={(dataUrl, meta) => {
              setTargetUrl(dataUrl);
              setTargetMeta(meta);
              if (!meta.geo) {
                setSearchArea(null);
                setSearchAreaEnabled(false);
              }
            }}
          />
        </div>

        {formatMismatch && (
          <div className="error" style={{ marginTop: 12 }}>
            {t("upload.formatMismatch", { a: refMeta?.ext ?? "", b: targetMeta?.ext ?? "" })}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            className="options-toggle"
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen((v) => !v)}
            title={t(optionsOpen ? "options.tipCollapse" : "options.tipExpand")}
          >
            <span className="row" style={{ gap: 10 }}>
              <span className="options-toggle-chevron" aria-hidden>
                ▸
              </span>
              {t("options.heading")}
            </span>
            <span className="muted" style={{ fontWeight: 500, fontSize: 13 }}>
              {optionsSummary}
            </span>
          </button>

          {optionsOpen && (
            <div className="options-panel">
              <SearchAreaSection
                geoAvailable={geoAvailable}
                enabled={searchAreaEnabled}
                setEnabled={setSearchAreaEnabled}
                searchArea={searchArea}
                setSearchArea={setSearchArea}
                refUrl={refUrl}
                targetUrl={targetUrl}
                refGeo={refMeta?.geo ?? null}
                targetGeo={targetMeta?.geo ?? null}
                disabled={busy}
              />

              <CategorySection
                selectedCategories={selectedCategories}
                setSelectedCategories={setSelectedCategories}
                disabled={busy}
              />
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 12, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={run} disabled={!canRun} title={t("run.tip")}>
            {busy && <span className="spinner" />}
            {t(STAGE_KEY[stage])}
          </button>
          <button
            className="model-indicator"
            onClick={() => setSettingsOpen(true)}
            title={modelStatusTip}
            aria-label={t("settings.topbarLabel")}
          >
            <span className="status-dot" style={{ background: modelStatusColor }} aria-hidden />
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

        {rateLimitAlert && (
          <div className="alert" style={{ marginTop: 12 }}>
            <span className="alert-icon" aria-hidden>⚠</span>
            <div>
              <strong>{t("alert.rateLimit.heading")}</strong>
              <p style={{ margin: "4px 0 0" }}>{t("alert.rateLimit.body")}</p>
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
          <div className="row" style={{ justifyContent: "flex-end", marginBottom: 16 }}>
            <button className="btn-secondary" type="button" onClick={startOver} title={t("run.startOverTip")}>
              {t("run.startOver")}
            </button>
          </div>

          {result.summary && (
            <div className="card" style={{ marginBottom: 16 }}>
              <strong>{t("summary.heading")}</strong>
              <p style={{ margin: "6px 0 0" }}>{result.summary}</p>
              <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 2 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {t("summary.meta", { n: result.changes.length, model: result.model })}
                </span>
              </div>
            </div>
          )}

          <CostSummary result={result} currency={currency} />

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
              refGeo={refMeta?.geo}
              searchArea={activeSearchArea}
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
            refGeo={refMeta?.geo}
            merkblattArea={activeSearchArea}
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
        availableModels={availableModels}
        onRefreshModels={refreshModels}
        isFetchingModels={isFetchingModels}
        currency={currency}
        setCurrency={setCurrency}
        effort={effort}
        setEffort={setEffort}
      />
    </div>
  );
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
