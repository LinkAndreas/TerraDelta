"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import UploadZone, { type UploadMeta } from "@/components/UploadZone";
import CompareView from "@/components/CompareView";
import AnalysisPreview from "@/components/AnalysisPreview";
import ReportTable from "@/components/ReportTable";
import SearchAreaSection from "@/components/SearchAreaSection";
import CategorySection from "@/components/CategorySection";
import CostSummary from "@/components/CostSummary";
import Settings from "@/components/Settings";
import Onboarding from "@/components/Onboarding";
import Changelog from "@/components/Changelog";
import Logo from "@/components/Logo";
import { alignImages, loadOpenCv, type AlignResult } from "@/lib/align";
import { buildTiles, buildAoiTiles, buildVerifyCrops, mapToGlobal, mapToTile, dedupe, type Tile, type AoiRegion } from "@/lib/tiles";
import {
  searchAreaToNormalizedRect,
  searchAreaToOverlayShape,
  dimPointToOverlayShape,
  changeInSearchArea,
  changeInAnyDimPoint,
  dimPointsForChange,
  dimPointToNormalizedRect,
  placedDimPoints,
  geoRefBounds,
  type OverlayShape,
} from "@/lib/geo";
import {
  DEFAULT_COORD_SYSTEM,
  DEFAULT_EXPORT_CRS,
  coordSystemForProj4,
  type CoordSystem,
} from "@/lib/crs";
import {
  PROVIDER_KEYS,
  PROVIDERS,
  modelLabel,
  providerModelLabel,
  providerShortLabel,
  type Provider,
} from "@/lib/models";
import { useI18n, LANG_NAMES, type Lang, type StringKey } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { APP_VERSION } from "@/lib/changelog";
import {
  bandFromScore,
  CATEGORIES,
  DEFAULT_EFFORT,
  defaultSelectedCategories,
  EFFORT_LEVELS,
  primaryCategory,
  type AnalyzeResult,
  type Category,
  type CategoryMatch,
  type Change,
  type ChangeType,
  type Currency,
  type DimPoint,
  type Effort,
  type SearchArea,
  type SearchMode,
  type SupportedModels,
  type TokenUsage,
} from "@/lib/types";
import { DEFAULT_SEARCH_MODE, dimPointHint } from "@/lib/types";

const STORE_KEY = "orthophoto-diff:settings";

type Stage = "idle" | "loading" | "aligning" | "analyzing";

const STAGE_KEY: Record<Stage, StringKey> = {
  idle: "run.detect",
  loading: "run.loading",
  aligning: "run.aligning",
  analyzing: "run.analyzing",
};

// The "analyzing" stage is by far the longest one and used to be a single
// opaque step, so the UI couldn't say whether it was cutting tiles, waiting on
// detection, or classifying candidates. These are its four internal phases, in
// order — surfaced as sub-steps with their own determinate progress bar.
const PHASES = ["splitting", "detecting", "merging", "classifying"] as const;
type Phase = (typeof PHASES)[number];

const PHASE_KEY: Record<Phase, StringKey> = {
  splitting: "substep.split",
  detecting: "substep.detect",
  merging: "substep.merge",
  classifying: "substep.classify",
};

// Phases whose progress is countable (n of total). The other two are short,
// unmeasurable steps and keep the indeterminate bar.
const COUNTED_PHASES: Phase[] = ["detecting", "classifying"];

interface PhaseProgress {
  done: number;
  total: number;
}

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
  // The restriction has two independent modes (§1): one drawn area, or a list
  // of DIM points each with its own radius. Both keep their own state so
  // toggling between them never destroys the other's setup.
  const [searchMode, setSearchMode] = useState<SearchMode>(DEFAULT_SEARCH_MODE);
  const [searchArea, setSearchArea] = useState<SearchArea | null>(null);
  const [dimPoints, setDimPoints] = useState<DimPoint[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<Record<Category, boolean>>(defaultSelectedCategories);

  // Coordinate systems (§2/§3): `entryCrs` is how the user writes and reads
  // coordinates in the options panel, `exportCrs` is what the exports are
  // written in. Independent by design — entering UTM and exporting WGS84 (or
  // the reverse) is a normal combination. Positions themselves are always
  // stored as WGS84 lon/lat; see lib/crs.ts.
  // Both default to EPSG:25832 and STAY there: the imagery's own CRS varies
  // with whoever produced it, while the working system does not. The loaded
  // image's EPSG is surfaced in the picker (marked, plus a one-click "use
  // image CRS" button) rather than silently overriding the user's system.
  const [entryCrs, setEntryCrs] = useState<CoordSystem>(DEFAULT_COORD_SYSTEM);
  const [exportCrs, setExportCrs] = useState<CoordSystem>(DEFAULT_EXPORT_CRS);

  const [stage, setStage] = useState<Stage>("idle");
  // Which sub-step of the analyzing stage is running, and how far along it is
  // when that is countable (see PHASES / COUNTED_PHASES).
  const [phase, setPhase] = useState<Phase | null>(null);
  const [phaseProgress, setPhaseProgress] = useState<PhaseProgress | null>(null);
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

  // Live analysis preview (shown only while `busy`, see AnalysisPreview): the
  // AOI shape(s), the region/tile boundaries built during "splitting", raw
  // per-tile detections as they stream in during "detecting", the deduped set
  // once "merging" runs, and each candidate's confirm/reject verdict as
  // "classifying" resolves them. Reset at the top of run().
  const [previewShapes, setPreviewShapes] = useState<OverlayShape[]>([]);
  // `number` is a simple 1-based display index (a tile's position in the run's
  // task list) — the internal `label` (e.g. "aoi-5-overview") is an
  // implementation detail, not something to show a user.
  const [previewRegions, setPreviewRegions] = useState<
    { gx: number; gy: number; gw: number; gh: number; label: string; number: number }[]
  >([]);
  // Which region/tile label(s) currently have an in-flight API call, so the
  // live preview can highlight what's actually being analyzed RIGHT NOW,
  // distinct from the full set of regions built during "splitting".
  const [previewActiveLabels, setPreviewActiveLabels] = useState<Set<string>>(new Set());
  // Region/tile label(s) that have FINISHED their detect call (success or
  // failure) — lets the preview show at a glance which regions are still
  // pending vs. already done, not just the overall done/total count.
  const [previewDoneLabels, setPreviewDoneLabels] = useState<Set<string>>(new Set());
  const [previewRaw, setPreviewRaw] = useState<Change[]>([]);
  const [previewMerged, setPreviewMerged] = useState<Change[] | null>(null);
  const [previewClassified, setPreviewClassified] = useState<Change[]>([]);
  const [previewRejected, setPreviewRejected] = useState<Set<string>>(new Set());

  // Filters (lifted here so the overlay and the table stay in sync).
  const [typeFilter, setTypeFilter] = useState<Record<ChangeType, boolean>>({
    added: true,
    removed: true,
    modified: true,
  });
  const [minScore, setMinScore] = useState<number>(0);
  const [query, setQuery] = useState("");

  // §5: Vegetation/land-cover is opt-in (Options toggle) and OFF by default —
  // it is the noisiest theme on a typical orthophoto pair (fields look
  // different every year), so including it by default buried the
  // built-environment differences most runs are actually about. When off, the
  // detector is told to skip vegetation-only differences and any change whose
  // classification is purely vegetation is filtered out.
  const [includeVegetation, setIncludeVegetation] = useState(false);

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
  const [changelogOpen, setChangelogOpen] = useState(false);

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

  // Extent and coordinate system of the reference orthophoto, derived once and
  // shared by the DIM import (which rejects out-of-scene points) and the CRS
  // pickers (which mark the matching EPSG).
  const imageInfo = useMemo(() => {
    if (!refMeta?.geo) return null;
    const b = geoRefBounds(refMeta.geo);
    return {
      bounds: { minLon: b.minLon, minLat: b.minLat, maxLon: b.maxLon, maxLat: b.maxLat },
      epsg: coordSystemForProj4(refMeta.geo.proj4Def, (b.minLon + b.maxLon) / 2, (b.minLat + b.maxLat) / 2).epsg,
    };
  }, [refMeta]);

  const startRef = useRef(0);
  const busy = stage !== "idle";
  // A search area isn't "active" until the user has actually picked a point —
  // lat/lon default to NaN ("unset") in SearchAreaSection until then, so a
  // shape/size edit alone can't accidentally run the search at (0, 0). DIM
  // points get the same treatment via `placedDimPoints`.
  const hasValidPoint = !!searchArea && Number.isFinite(searchArea.lat) && Number.isFinite(searchArea.lon);
  const restrictByArea = searchAreaEnabled && geoAvailable && searchMode === "area";
  const restrictByPoints = searchAreaEnabled && geoAvailable && searchMode === "points";
  const activeSearchArea = restrictByArea && hasValidPoint ? searchArea : null;
  const activeDimPoints = useMemo(
    () => (restrictByPoints ? placedDimPoints(dimPoints) : []),
    [restrictByPoints, dimPoints],
  );
  // With the restriction switched on, the run needs somewhere to look — an
  // enabled-but-empty restriction would otherwise silently mean "everywhere".
  const restrictionReady = searchMode === "area" ? !!activeSearchArea : activeDimPoints.length > 0;
  const canRun =
    !!refUrl &&
    !!targetUrl &&
    !busy &&
    !formatMismatch &&
    (!searchAreaEnabled || (geoAvailable && restrictionReady)) &&
    CATEGORIES.some((c) => selectedCategories[c]);
  const hasKey = !!keys[provider]?.trim();
  // What the model chip reads. The provider's fetched model list supplies the
  // display name, so a newly released model labels itself correctly with no
  // change here; `providerModelLabel` also drops the provider prefix when the
  // model name already contains it ("Claude · Claude Sonnet 5" → "Claude
  // Sonnet 5"). "default" isn't a real id and never appears in that list, so it
  // gets its own translated label.
  const modelIndicatorLabel =
    model === "default"
      ? `${providerShortLabel(provider)} · ${t("settings.modelDefault")}`
      : providerModelLabel(provider, model, availableModels[provider]);
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
  const areaSummary = activeSearchArea
    ? activeSearchArea.shape === "circle"
      ? `⌀ ${Math.round(activeSearchArea.radiusM * 2)} m`
      : `${Math.round(activeSearchArea.widthM)} × ${Math.round(activeSearchArea.heightM)} m`
    : activeDimPoints.length > 0
      ? t("options.dimPoints", { n: activeDimPoints.length })
      : t("options.wholeImage");
  const optionsSummary = `${categorySummary} · ${areaSummary}${includeVegetation ? "" : ` · ${t("veg.summaryOff")}`}`;

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [busy]);

  // Percentage of the current sub-step, or null when it isn't measurable (then
  // the bar stays indeterminate).
  const pct =
    phaseProgress && phaseProgress.total > 0
      ? Math.min(100, Math.round((phaseProgress.done / phaseProgress.total) * 100))
      : null;

  const visibleIds = useMemo(() => {
    const set = new Set<string>();
    if (!result) return set;
    const q = query.trim().toLowerCase();
    for (const c of result.changes) {
      if (!typeFilter[c.change_type]) continue;
      if ((c.score ?? 0) < minScore) continue;
      // Search across the description and every candidate category, not just
      // the best-fitting one — an alternative match is shown in the table, so
      // it has to be findable too.
      const haystack = `${c.description} ${(c.matches ?? []).map((m) => m.category).join(" ")}`.toLowerCase();
      if (q && !haystack.includes(q)) continue;
      set.add(c.id);
    }
    return set;
  }, [result, typeFilter, minScore, query]);

  async function run() {
    if (!refUrl || !targetUrl) return;
    setError(null);
    setRateLimitAlert(false);
    setResult(null);
    setSelectedId(null);
    setOptionsOpen(false);
    startRef.current = Date.now();
    setElapsed(0);
    setPreviewShapes([]);
    setPreviewRegions([]);
    setPreviewActiveLabels(new Set());
    setPreviewDoneLabels(new Set());
    setPreviewRaw([]);
    setPreviewMerged(null);
    setPreviewClassified([]);
    setPreviewRejected(new Set());

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
      setPhase("splitting");
      setPhaseProgress(null);
      setProgressMsg(t("progress.splitting"));
      const geoRef = refMeta?.geo;

      // §1/§5/AOI: build the area-of-interest region list for whichever
      // restriction mode is active (or none), then hand it to ONE shape-aware
      // tiler (buildAoiTiles, lib/tiles.ts) that replaces the old split logic:
      //
      //  • DIM points — one region per point (as before), each carrying its
      //    own circle shape.
      //  • drawn area — now ALSO goes through buildAoiTiles instead of
      //    filtering the generic whole-image grid down to overlapping tiles.
      //    That filter sized tiles for the FULL orthophoto and could still
      //    fragment a small drawn shape across multiple oversized, low-detail
      //    tiles — the exact problem per-point tiling already solved for DIM
      //    points, generalized here to any shape.
      //  • neither — unchanged: the plain whole-image grid + overview.
      //
      // Every region also carries its precise shape so buildAoiTiles can draw
      // the AOI boundary directly onto each crop (drawAoiMask) — the model
      // gets an explicit visual scope cue, not just post-hoc filtering. A
      // region larger than one crop can resolve well still gets its own
      // region-scoped "step back" overview pass, so a restricted run never
      // loses the area-scale detection pass an unrestricted run has.
      //
      // `tileHints` carries the operator notes for whichever DIM point(s)
      // produced each tile, keyed by object identity — each Tile object is
      // created once here and consumed by reference below, so this is safe
      // and avoids re-deriving tile/point overlap a second time.
      let tasks: Tile[];
      const tileHints = new Map<Tile, string[]>();
      let aoiShapes: OverlayShape[] = [];
      let previewRegionRects: { gx: number; gy: number; gw: number; gh: number; label: string; number: number }[] =
        [];

      if (geoRef && activeDimPoints.length > 0) {
        const byId = new Map(activeDimPoints.map((p) => [p.id, p]));
        const regions: AoiRegion[] = activeDimPoints.map((p) => ({
          id: p.id,
          rect: dimPointToNormalizedRect(geoRef, p),
          shapes: [dimPointToOverlayShape(geoRef, p)],
          pointIds: [p.id],
        }));
        aoiShapes = regions.flatMap((r) => r.shapes ?? []);
        const aoiTiles = await buildAoiTiles(aligned.refUrl, aligned.targetUrl, regions);
        for (const tile of aoiTiles) {
          const hints = tile.pointIds
            .map((id) => byId.get(id))
            .filter((p): p is DimPoint => !!p)
            .map(dimPointHint)
            .filter((h) => h !== "")
            .slice(0, 8);
          tileHints.set(tile, hints);
        }
        tasks = aoiTiles;
        previewRegionRects = aoiTiles.map((tl, i) => ({
          gx: tl.gx,
          gy: tl.gy,
          gw: tl.gw,
          gh: tl.gh,
          label: tl.label,
          number: i + 1,
        }));
      } else if (geoRef && activeSearchArea) {
        const shape = searchAreaToOverlayShape(geoRef, activeSearchArea);
        aoiShapes = [shape];
        const region: AoiRegion = {
          id: "area",
          rect: searchAreaToNormalizedRect(geoRef, activeSearchArea),
          shapes: [shape],
        };
        const aoiTiles = await buildAoiTiles(aligned.refUrl, aligned.targetUrl, [region]);
        tasks = aoiTiles;
        previewRegionRects = aoiTiles.map((tl, i) => ({
          gx: tl.gx,
          gy: tl.gy,
          gw: tl.gw,
          gh: tl.gh,
          label: tl.label,
          number: i + 1,
        }));
      } else {
        const { overview, tiles } = await buildTiles(aligned.refUrl, aligned.targetUrl);
        tasks = [overview, ...tiles];
        previewRegionRects = tasks.map((tl, i) => ({
          gx: tl.gx,
          gy: tl.gy,
          gw: tl.gw,
          gh: tl.gh,
          label: tl.label,
          number: i + 1,
        }));
      }

      // Whether the crops in `tasks` carry the visual AOI mask/boundary —
      // tells the detect/classify prompts what that overlay means (§ prompt.ts
      // aoiMaskClause). Constant for the whole run, so it stays safe to send
      // on every call sharing the same cached system prompt.
      const aoiMasked = aoiShapes.length > 0;
      const hintsForTile = (tile: Tile): string[] => tileHints.get(tile) ?? [];
      setPreviewShapes(aoiShapes);
      setPreviewRegions(previewRegionRects);

      setPhase("detecting");
      setPhaseProgress({ done: 0, total: tasks.length });
      setProgressMsg(t("progress.region", { done: 0, total: tasks.length }));
      let done = 0;
      const onTaskDone = () => {
        done++;
        setPhaseProgress({ done, total: tasks.length });
        setProgressMsg(t("progress.region", { done, total: tasks.length }));
      };

      // The categories a change must match to be reported. Applied AFTER
      // classification, against every one of a change's candidate categories
      // (see below) — the detection pass itself is intentionally
      // category-free, so nothing is lost just because the detector couldn't
      // place a difference inside the current scope. Vegetation categories
      // count as out of scope while the toggle is off, even if still checked
      // in the tree.
      const activeCategories = new Set<string>(
        CATEGORIES.filter(
          (c) => selectedCategories[c] && (includeVegetation || !c.startsWith("vegetation_landwirtschaft.")),
        ),
      );
      // A change the catalog has no type for is kept regardless of the
      // selection: it IS a detected difference, and hiding it is exactly the
      // over-filtering this pipeline is meant to avoid. It's labeled
      // "unclassified" in the report instead.
      const inScope = (c: Change) => {
        const matches = c.matches ?? [];
        return matches.length === 0 || matches.some((m) => activeCategories.has(m.category));
      };

      const results: TaskResult[] = await runPool<Tile, TaskResult>(
        tasks,
        4,
        async (tile) => {
          // Live preview: mark this tile's region as actively being analyzed
          // right now, for the duration of its own API call — distinct from
          // the full, static set of regions built during "splitting". Always
          // cleared in `finally`, success or failure, so a rejected/errored
          // call doesn't leave a stale highlight.
          setPreviewActiveLabels((prev) => new Set(prev).add(tile.label));
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
                includeVegetation,
                hints: hintsForTile(tile),
                aoiMasked,
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
            // Live preview: stream this tile's raw detections in as soon as
            // they arrive, before dedup/classification — see AnalysisPreview.
            // Each tile's own response numbers its changes from "chg-1"
            // independently, so accumulating them as-is collides across
            // tiles; re-key with the tile's label for a preview-only id
            // (the returned `changes` below keep their original ids, which
            // is all downstream dedup/classification cares about).
            if (changes.length > 0) {
              const previewChanges = changes.map((c, idx) => ({ ...c, id: `${tile.label}-${idx}` }));
              setPreviewRaw((prev) => [...prev, ...previewChanges]);
            }
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
          } finally {
            setPreviewActiveLabels((prev) => {
              const next = new Set(prev);
              next.delete(tile.label);
              return next;
            });
            setPreviewDoneLabels((prev) => new Set(prev).add(tile.label));
          }
        },
        onTaskDone,
      );
      if (results.some((r) => r.status === 429)) setRateLimitAlert(true);

      setPhase("merging");
      setPhaseProgress(null);
      setProgressMsg(t("progress.merging"));
      // §5.4: in restricted-search mode keep only differences whose center
      // actually falls inside the requested search area — tile-overlap pruning
      // above is loose (a tile can overlap the area at just one corner), so a
      // detection anywhere in that tile can still land outside it. Filtering
      // here, before the per-candidate classification pass below, means we
      // never pay for an API call on a difference we're about to discard.
      // No category filtering happens at this point: the detections aren't
      // classified yet.
      // Whether a change survives the active restriction: inside the drawn
      // area, or inside ANY DIM point's radius. Unrestricted runs (and
      // non-georeferenced input, where no test is possible) keep everything.
      const geo = refMeta?.geo;
      const inSearchScope = (c: Change): boolean => {
        if (!geo) return true;
        if (activeSearchArea) return changeInSearchArea(geo, activeSearchArea, c);
        if (activeDimPoints.length > 0) return changeInAnyDimPoint(geo, activeDimPoints, c);
        return true;
      };

      const merged = dedupe(results.flatMap((r) => r.changes)).filter(inSearchScope);
      setPreviewMerged(merged);

      // Second pass: re-examine every candidate on a zoomed-in crop to (a)
      // confirm it's a real physical change and drop artifacts
      // (lighting/season/vehicles), (b) tighten its box and direction, and
      // (c) map it onto the catalog — up to 3 fitting categories, each with
      // its own fit percentage. The detection pass is tuned for recall; this
      // pass restores precision and adds the classification.
      let confirmed = merged;
      const verifyUsages: TokenUsage[] = [];
      // Classification failures used to be swallowed entirely: a failed call
      // fell back to the raw detection, which then showed up as "unclassified"
      // with no hint that anything had gone wrong. A broken classify schema
      // therefore looked like a model that simply refused to classify. Count
      // them and surface the first error instead.
      let classifyFailed = 0;
      let classifyError = "";
      if (merged.length > 0) {
        setPhase("classifying");
        setPhaseProgress({ done: 0, total: merged.length });
        setProgressMsg(t("progress.classifying", { done: 0, total: merged.length }));
        const crops = await buildVerifyCrops(
          aligned.refUrl,
          aligned.targetUrl,
          merged.map((c) => c.bbox),
          1400,
          aoiShapes,
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
                    change_type: chg.change_type,
                    description: chg.description,
                    // Where the candidate sits inside its own crop — lets the
                    // classifier correct a coarse box instead of re-finding the
                    // object in a crop that is mostly context.
                    bbox: mapToTile(crops[i], chg.bbox),
                  },
                  // §5: operator notes for the DIM point(s) whose search radius
                  // actually contains this candidate — precise per-change,
                  // unlike detection's per-tile hints. Both the imported
                  // description AND remark feed classification here (via
                  // dimPointHint), used as a category tie-breaker only (see
                  // prompt.ts buildClassifyHints) — never as evidence the
                  // change itself is genuine.
                  hints:
                    geoRef && activeDimPoints.length > 0
                      ? dimPointsForChange(geoRef, activeDimPoints, chg)
                          .map(dimPointHint)
                          .filter((h) => h !== "")
                          .slice(0, 8)
                      : undefined,
                  aoiMasked,
                }),
              });
              const data = await res.json();
              if (!res.ok) {
                if (res.status === 429) setRateLimitAlert(true);
                throw new Error(data.error || "Classification failed");
              }
              // Record spend even for a rejected candidate — the call still cost tokens.
              if (data.usage) verifyUsages.push(data.usage);
              if (!data.genuine) {
                // Live preview: mark this candidate rejected so it fades out
                // instead of sitting in limbo — see AnalysisPreview.
                setPreviewRejected((prev) => new Set(prev).add(chg.id));
                return null;
              }
              // Accept the tightened box unless it's degenerate (rounded to
              // nothing) or it's the whole crop — "the entire crop changed" is
              // the shape a model returns when it didn't actually localize the
              // object, and it would be a worse box than the detector's.
              const cropBox: [number, number, number, number] = Array.isArray(data.bbox)
                ? (data.bbox as [number, number, number, number])
                : [0, 0, 0, 0];
              const refined = mapToGlobal(crops[i], cropBox);
              const coversWholeCrop = cropBox[2] * cropBox[3] >= 0.92;
              const refinedOk = refined[2] > 0.001 && refined[3] > 0.001 && !coversWholeCrop;
              // The classifier judges the crop up close: adopt its corrected
              // direction (added/removed/modified) when it returned one, its
              // catalog matches, and its one-line rationale as the change's
              // `note` — surfaced in the report, PDF, and data exports.
              const note = typeof data.reason === "string" ? data.reason.trim() : "";
              const verifiedType = ["added", "removed", "modified"].includes(data.changeType)
                ? (data.changeType as ChangeType)
                : chg.change_type;
              const vScore = typeof data.score === "number" ? data.score : chg.score;
              const matches: CategoryMatch[] = Array.isArray(data.matches) ? data.matches : [];
              const verifiedChg: Change = {
                ...chg,
                change_type: verifiedType,
                score: vScore,
                confidence: bandFromScore(vScore),
                matches,
                category: primaryCategory(matches),
                bbox: refinedOk ? refined : chg.bbox,
                note: note || chg.note,
              };
              // Live preview: this candidate is confirmed — see AnalysisPreview.
              setPreviewClassified((prev) => [...prev, verifiedChg]);
              return verifiedChg;
            } catch (e) {
              // Keep the raw detection so the difference isn't lost, but record
              // the failure so the run reports it instead of quietly showing an
              // unclassified change.
              classifyFailed++;
              if (!classifyError) classifyError = e instanceof Error ? e.message : String(e);
              return chg;
            }
          },
          () => {
            vDone++;
            setPhaseProgress({ done: vDone, total: merged.length });
            setProgressMsg(t("progress.classifying", { done: vDone, total: merged.length }));
          },
        );
        confirmed = verified
          .filter((c): c is Change => c !== null)
          .map((c, i) => ({ ...c, id: `chg-${i + 1}` }));
      }

      // Now that every surviving difference carries its catalog matches, apply
      // the category selection — a change stays if ANY of its candidate
      // categories is in scope (or if none of the catalog fits it at all).
      // Also re-apply the area check: the crop-based pass above can
      // tighten/shift a bbox, so a candidate that started inside the search
      // area could refine to just outside it.
      const filtered = confirmed
        .filter(inScope)
        .filter(inSearchScope)
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
      } else if (classifyFailed > 0) {
        // Detection worked but classification didn't — say so, rather than
        // leaving the user to guess why changes came back unclassified.
        setError(
          t("error.classifyFailed", {
            failed: classifyFailed,
            total: merged.length,
            err: classifyError || "unknown error",
          }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.generic"));
    } finally {
      setStage("idle");
      setPhase(null);
      setPhaseProgress(null);
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
    setSearchMode(DEFAULT_SEARCH_MODE);
    setSearchArea(null);
    setDimPoints([]);
    setAlign(null);
    setResult(null);
    setSelectedId(null);
    setError(null);
    setRateLimitAlert(false);
    setTypeFilter({ added: true, removed: true, modified: true });
    setMinScore(0);
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
                setDimPoints([]);
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
                setDimPoints([]);
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
                mode={searchMode}
                setMode={setSearchMode}
                searchArea={searchArea}
                setSearchArea={setSearchArea}
                dimPoints={dimPoints}
                setDimPoints={setDimPoints}
                entryCrs={entryCrs}
                setEntryCrs={setEntryCrs}
                refUrl={refUrl}
                targetUrl={targetUrl}
                refGeo={refMeta?.geo ?? null}
                targetGeo={targetMeta?.geo ?? null}
                imageBounds={imageInfo?.bounds}
                imageEpsg={imageInfo?.epsg}
                disabled={busy}
              />

              <CategorySection
                selectedCategories={selectedCategories}
                setSelectedCategories={setSelectedCategories}
                disabled={busy}
              />

              <div
                className="row"
                style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 14, marginTop: 4 }}
              >
                <div>
                  <strong style={{ fontSize: 15 }}>{t("veg.heading")}</strong>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 3, maxWidth: 480 }}>
                    {t("veg.subheading")}
                  </div>
                </div>
                <label className="switch" title={t("veg.toggleTip")}>
                  <input
                    type="checkbox"
                    checked={includeVegetation}
                    disabled={busy}
                    onChange={(e) => setIncludeVegetation(e.target.checked)}
                  />
                  <span className="switch-track">
                    <span className="switch-thumb" />
                  </span>
                </label>
              </div>
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
            {modelIndicatorLabel}
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
            {stage === "analyzing" && phase && <SubSteps phase={phase} progress={phaseProgress} />}
            <div className="progress-track">
              {/* Determinate while a countable sub-step runs (regions
                  detected, candidates classified); indeterminate otherwise. */}
              {pct === null ? (
                <div className="progress-bar" />
              ) : (
                <div className="progress-bar-fixed" style={{ width: `${pct}%` }} />
              )}
            </div>
            <div className="row" style={{ justifyContent: "space-between", gap: 12, marginTop: 8 }}>
              <span style={{ fontSize: 13 }}>
                {/* During "detecting", up to 4 tiles run concurrently (see
                    runPool below) — the plain done/total count alone doesn't
                    convey that, so show how many are in flight RIGHT NOW too.
                    Computed live from previewActiveLabels (updated on every
                    tile start/finish) rather than the static progressMsg,
                    which only refreshes when a tile completes. */}
                {phase === "detecting" && previewActiveLabels.size > 0
                  ? t("progress.regionActive", {
                      done: phaseProgress?.done ?? 0,
                      total: phaseProgress?.total ?? 0,
                      numbers: previewRegions
                        .filter((r) => previewActiveLabels.has(r.label))
                        .map((r) => r.number)
                        .sort((a, b) => a - b)
                        .join(", "),
                    })
                  : progressMsg}
              </span>
              <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                {pct !== null && `${pct}% · `}
                {elapsed.toFixed(1)}s
              </span>
            </div>
          </div>
        )}

        {busy && stage === "analyzing" && align && (
          <AnalysisPreview
            refUrl={align.refUrl}
            width={align.width}
            height={align.height}
            phase={phase}
            shapes={previewShapes}
            regions={previewRegions}
            activeLabels={previewActiveLabels}
            doneLabels={previewDoneLabels}
            raw={previewRaw}
            merged={previewMerged}
            classified={previewClassified}
            rejectedIds={previewRejected}
          />
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
                  {/* The model that actually ran, by its readable name rather
                      than its wire id. */}
                  {t("summary.meta", {
                    n: result.changes.length,
                    model: modelLabel(result.model, availableModels[provider]),
                  })}
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
              dimPoints={activeDimPoints}
            />
          </div>
          <ReportTable
            changes={result.changes}
            visibleIds={visibleIds}
            selectedId={selectedId}
            onSelect={setSelectedId}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            minScore={minScore}
            setMinScore={setMinScore}
            query={query}
            setQuery={setQuery}
            refUrl={align.refUrl}
            targetUrl={align.targetUrl}
            refGeo={refMeta?.geo}
            merkblattArea={activeSearchArea}
            dimPoints={activeDimPoints}
            exportCrs={exportCrs}
            setExportCrs={setExportCrs}
            imageEpsg={imageInfo?.epsg}
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
        {/* Pushed to the trailing edge on wide screens; the footer switches to
            a column below 720px (see globals.css), where it simply stacks. */}
        <span className="row footer-meta" style={{ gap: 12, fontSize: 13.5 }}>
          <button
            type="button"
            className="version-btn"
            onClick={() => setChangelogOpen(true)}
            title={t("changelog.open", { v: APP_VERSION })}
          >
            v{APP_VERSION}
          </button>
          {t("footer.copyright", { year: new Date().getFullYear() })}
        </span>
      </footer>

      <Changelog open={changelogOpen} onClose={() => setChangelogOpen(false)} />

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

// Sub-steps of the analyzing stage (step 3): shown indented beneath the main
// step row, each with its own state, and the countable ones with their live
// "done/total" tally so a long run is never a black box.
function SubSteps({ phase, progress }: { phase: Phase; progress: PhaseProgress | null }) {
  const { t } = useI18n();
  const current = PHASES.indexOf(phase);
  return (
    <div className="substeps">
      {PHASES.map((p, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        const counted = COUNTED_PHASES.includes(p);
        const showTally = state === "active" && counted && progress;
        return (
          <span key={p} className={`substep substep-${state}`}>
            <span className="substep-dot" aria-hidden>
              {state === "done" ? "✓" : ""}
            </span>
            {t(PHASE_KEY[p])}
            {showTally && (
              <span className="substep-tally">
                {progress.done}/{progress.total}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

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
