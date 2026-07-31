"use client";

import { useMemo } from "react";
import { CHANGE_COLORS, primaryCategory, type Change } from "@/lib/types";
import type { OverlayShape } from "@/lib/geo";
import { categoryLabel, useI18n } from "@/lib/i18n";
import ShapeOutline from "./ShapeOutline";

type Phase = "splitting" | "detecting" | "merging" | "classifying";

// Colors are chosen to stay in their OWN lane, deliberately distinct from
// CHANGE_COLORS (green/red/amber for added/removed/modified — used for raw
// detections below and elsewhere in the app, so kept as-is for consistency):
// a region's PROCESS state (pending/analyzing/done) is an unrelated concept
// from a change's TYPE or VERDICT, and reusing amber for "analyzing now"
// used to sit right next to CHANGE_COLORS.modified (also amber) on screen at
// the same time — a modified-type raw detection and an actively-analyzing
// region looked like the same thing. Violet/teal/slate here don't collide
// with any change-type or verdict color used elsewhere in this panel.
const COLOR_AOI = "#38bdf8"; // sky blue — the requested search area/DIM point, a reference boundary, not a state
const COLOR_REGION_PENDING = "#475569"; // slate — not started yet
const COLOR_REGION_DONE = "#14b8a6"; // teal — finished, distinct from "confirmed" green
const COLOR_REGION_ACTIVE = "#a78bfa"; // violet — being analyzed right now

interface RegionRect {
  gx: number;
  gy: number;
  gw: number;
  gh: number;
  label: string;
  // 1-based display index (position in the run's task list) — the internal
  // `label` (e.g. "aoi-5-overview") is an implementation detail, not
  // something to show a user.
  number: number;
}

interface Props {
  refUrl: string;
  width: number;
  height: number;
  phase: Phase | null;
  // The AOI shape(s) actually analyzed (drawn area or DIM-point circles) —
  // empty for an unrestricted run.
  shapes: OverlayShape[];
  // Region/tile crop boundaries, available once "splitting" resolves.
  regions: RegionRect[];
  // Region label(s) with an in-flight API call RIGHT NOW.
  activeLabels: Set<string>;
  // Region label(s) whose detect call has already finished (success or
  // failure) — everything else is still pending.
  doneLabels: Set<string>;
  // Raw per-tile detections, appended to as "detecting" completes each tile.
  raw: Change[];
  // The deduped set once "merging" runs; null beforehand.
  merged: Change[] | null;
  // Candidates confirmed so far during "classifying".
  classified: Change[];
  // Candidate ids rejected so far during "classifying".
  rejectedIds: Set<string>;
}

// Live view of the analysis pipeline while a run is in progress: the AOI
// boundary, every region/tile crop built for it (numbered, colored by
// pending/active/done state), raw detections streaming in per tile, the
// deduped set once merging runs, each candidate's confirm/reject verdict as
// classification resolves it, and a running stats readout so the whole
// pipeline's state is visible at a glance without reading the text progress
// line. Entrance/exit animation is pure CSS (keyframes triggered by mount,
// see globals.css `.aoi-*` rules) — no JS timers or orchestration.
export default function AnalysisPreview({
  refUrl,
  width,
  height,
  phase,
  shapes,
  regions,
  activeLabels,
  doneLabels,
  raw,
  merged,
  classified,
  rejectedIds,
}: Props) {
  const { t } = useI18n();

  const classifiedIds = useMemo(() => new Set(classified.map((c) => c.id)), [classified]);
  // Candidates from the deduped set that classification hasn't resolved yet —
  // rendered as a pulsing "checking…" box.
  const pending = useMemo(
    () => (merged ?? []).filter((c) => !classifiedIds.has(c.id) && !rejectedIds.has(c.id)),
    [merged, classifiedIds, rejectedIds],
  );
  // Rejected candidates still need their bbox for the fade-out animation —
  // look it up from the deduped set (previewMerged), the only place it's kept.
  const rejected = useMemo(
    () => (merged ?? []).filter((c) => rejectedIds.has(c.id)),
    [merged, rejectedIds],
  );

  // Before merging has run, show the raw stream; once it has, the deduped set
  // is the more useful picture (fewer, consolidated boxes).
  const showRaw = merged === null;
  // Regions/tiles matter only while detection is still building/running them
  // (splitting/detecting) — by the time merging has produced a deduped set,
  // every region is "done" and showing dozens of finished tile boxes is just
  // clutter on top of the candidates that actually matter now. Same
  // condition as showRaw: both flip together, right when merging runs.
  const showRegions = showRaw;

  const pendingRegions = regions.filter((r) => !activeLabels.has(r.label) && !doneLabels.has(r.label));
  const activeRegions = regions.filter((r) => activeLabels.has(r.label));
  const doneRegions = regions.filter((r) => !activeLabels.has(r.label) && doneLabels.has(r.label));

  // 1-based display number for each candidate, in the deduped list's own
  // order — stable for the rest of the run (merged is set once and never
  // reordered), so "candidate 7" always refers to the same box whether it's
  // still pending, gets confirmed, or gets rejected.
  const candidateNumber = useMemo(() => {
    const map = new Map<string, number>();
    (merged ?? []).forEach((c, i) => map.set(c.id, i + 1));
    return map;
  }, [merged]);

  const frameStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    aspectRatio: `${width} / ${height}`,
    overflow: "hidden",
    borderRadius: 8,
    background: "#000",
  };

  const badgeStyle = (r: RegionRect, kind: "pending" | "active" | "done"): React.CSSProperties => ({
    position: "absolute",
    left: `${r.gx * 100}%`,
    top: `${r.gy * 100}%`,
    transform: "translate(2px, 2px)",
    background: kind === "active" ? COLOR_REGION_ACTIVE : kind === "done" ? COLOR_REGION_DONE : "#1e293b",
    color: kind === "active" ? "#1e1b4b" : kind === "done" ? "#022c22" : "#94a3b8",
    fontSize: 9,
    fontWeight: 700,
    lineHeight: 1,
    padding: "1px 4px",
    borderRadius: "3px 3px 3px 0",
    opacity: kind === "pending" ? 0.7 : 1,
    pointerEvents: "none",
  });

  // Stat chips — a compact, always-visible readout of exactly what stage of
  // the pipeline is doing what, right now, without having to read the text
  // progress line above this panel or infer it from the map alone.
  const stats: { label: string; value: string | number }[] = [];
  if (showRegions && regions.length > 0)
    stats.push({ label: t("preview.stat.regions"), value: `${doneRegions.length}/${regions.length}` });
  if (showRegions && (phase === "detecting" || phase === "merging"))
    stats.push({ label: t("preview.stat.active"), value: activeLabels.size });
  if (showRaw) stats.push({ label: t("preview.stat.raw"), value: raw.length });
  if (!showRaw) {
    stats.push({ label: t("preview.stat.candidates"), value: merged?.length ?? 0 });
    stats.push({ label: t("preview.stat.confirmed"), value: classified.length });
    stats.push({ label: t("preview.stat.rejected"), value: rejectedIds.size });
    if (phase === "classifying") stats.push({ label: t("preview.stat.pending"), value: pending.length });
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>{t("preview.heading")}</strong>
        <div className="row" style={{ gap: 12, fontSize: 11, flexWrap: "wrap" }}>
          <span className="muted">
            <span style={legendSwatch(COLOR_AOI, true)} /> {t("preview.legend.aoi")}
          </span>
          {showRegions && (
            <>
              <span className="muted">
                <span style={legendSwatch(COLOR_REGION_PENDING, true)} /> {t("preview.legend.region")}
              </span>
              {(phase === "detecting" || phase === "merging") && (
                <>
                  <span className="muted">
                    <span style={legendSwatch(COLOR_REGION_ACTIVE)} /> {t("preview.legend.analyzing")}
                  </span>
                  <span className="muted">
                    <span style={legendSwatch(COLOR_REGION_DONE)} /> {t("preview.legend.done")}
                  </span>
                </>
              )}
            </>
          )}
          {showRaw && (
            <span className="muted" title={t("preview.legend.rawTip")}>
              <span style={legendSwatch("#f59e0b", true)} /> {t("preview.legend.raw")}
            </span>
          )}
          {phase === "classifying" && (
            <>
              <span className="muted">
                <span style={legendSwatch("#94a3b8")} /> {t("preview.legend.checking")}
              </span>
              <span className="muted">
                <span style={legendSwatch("#22c55e")} /> {t("preview.legend.confirmed")}
              </span>
              <span className="muted">
                <span style={legendSwatch("#ef4444")} /> {t("preview.legend.rejected")}
              </span>
            </>
          )}
        </div>
      </div>

      {showRaw && raw.length > 0 && (
        <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>
          {t("preview.rawExplainer")}
        </div>
      )}

      {stats.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {stats.map((s) => (
            <span
              key={s.label}
              className="pill"
              style={{ fontSize: 11, display: "inline-flex", gap: 4, alignItems: "baseline" }}
            >
              <strong>{s.value}</strong>
              <span className="muted">{s.label}</span>
            </span>
          ))}
        </div>
      )}

      <div style={frameStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={refUrl}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: 0.85 }}
        />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="overlay-svg">
          {/* AOI boundary — always on top once known. */}
          <ShapeOutline shapes={shapes} stroke={COLOR_AOI} strokeWidth={2} dash="3 2" />

          {/* Region/tile crop boundaries, colored by state: pending (plain
              dashed slate), done (solid teal — already analyzed), active
              (violet, pulsing, drawn last so it's always on top). Hidden
              once merging/classifying starts — see showRegions. */}
          {showRegions && (
            <>
              {pendingRegions.map((r) => (
                <rect
                  key={r.label}
                  x={r.gx * 100}
                  y={r.gy * 100}
                  width={r.gw * 100}
                  height={r.gh * 100}
                  fill="none"
                  stroke={COLOR_REGION_PENDING}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {doneRegions.map((r) => (
                <rect
                  key={r.label}
                  x={r.gx * 100}
                  y={r.gy * 100}
                  width={r.gw * 100}
                  height={r.gh * 100}
                  fill="none"
                  stroke={COLOR_REGION_DONE}
                  strokeWidth={1.5}
                  strokeOpacity={0.7}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {activeRegions.map((r) => (
                <rect
                  key={r.label}
                  className="pulse-rect"
                  x={r.gx * 100}
                  y={r.gy * 100}
                  width={r.gw * 100}
                  height={r.gh * 100}
                  fill={COLOR_REGION_ACTIVE}
                  fillOpacity={0.1}
                  stroke={COLOR_REGION_ACTIVE}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </>
          )}

          {/* Raw detections, streaming in during "detecting" — dashed, like
              every other "not yet confirmed" element in this panel (pending
              regions, checking candidates). Solid outline is reserved for
              things the second pass has actually confirmed. */}
          {showRaw &&
            raw.map((c) => (
              <rect
                key={c.id}
                className="aoi-fade-in"
                x={c.bbox[0] * 100}
                y={c.bbox[1] * 100}
                width={c.bbox[2] * 100}
                height={c.bbox[3] * 100}
                fill={CHANGE_COLORS[c.change_type]}
                fillOpacity={0.1}
                stroke={CHANGE_COLORS[c.change_type]}
                strokeWidth={1.5}
                strokeDasharray="3 2"
                vectorEffect="non-scaling-stroke"
              />
            ))}

          {/* Deduped set, once available — pending ones pulse while
              classification is still working on them. */}
          {!showRaw &&
            pending.map((c) => (
              <rect
                key={c.id}
                className="pulse-rect"
                x={c.bbox[0] * 100}
                y={c.bbox[1] * 100}
                width={c.bbox[2] * 100}
                height={c.bbox[3] * 100}
                fill="none"
                stroke="#94a3b8"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            ))}

          {/* Confirmed candidates. */}
          {classified.map((c) => (
            <rect
              key={c.id}
              className="aoi-confirm-in"
              x={c.bbox[0] * 100}
              y={c.bbox[1] * 100}
              width={c.bbox[2] * 100}
              height={c.bbox[3] * 100}
              fill="#22c55e"
              fillOpacity={0.14}
              stroke="#22c55e"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Rejected candidates — fade out and stay invisible. */}
          {rejected.map((c) => (
            <rect
              key={c.id}
              className="aoi-reject-fade"
              x={c.bbox[0] * 100}
              y={c.bbox[1] * 100}
              width={c.bbox[2] * 100}
              height={c.bbox[3] * 100}
              fill="none"
              stroke="#ef4444"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {/* Region number badges — hidden once classification starts, along
            with the region rects themselves (see showRegions). */}
        {showRegions && (
          <>
            {pendingRegions.map((r) => (
              <span key={`n-${r.label}`} style={badgeStyle(r, "pending")}>
                {r.number}
              </span>
            ))}
            {doneRegions.map((r) => (
              <span key={`n-${r.label}`} style={badgeStyle(r, "done")}>
                {r.number}
              </span>
            ))}
            {activeRegions.map((r) => (
              <span key={`n-${r.label}`} className="pulse-badge" style={badgeStyle(r, "active")}>
                {r.number}
              </span>
            ))}
          </>
        )}

        {/* Candidate number badges, once regions are no longer shown —
            "candidate 7" identifies the same box whether it's still
            "checking…", gets confirmed, or gets rejected, since
            candidateNumber comes from the deduped list's own stable order. */}
        {!showRaw && (
          <>
            {pending.map((c) => (
              <span key={`n-${c.id}`} className="pulse-badge" style={candidateBadgeStyle(c.bbox, "#94a3b8", "#0f172a")}>
                {candidateNumber.get(c.id)}
              </span>
            ))}
            {rejected.map((c) => (
              <span key={`n-${c.id}`} className="aoi-reject-fade" style={candidateBadgeStyle(c.bbox, "#ef4444", "#450a0a")}>
                {candidateNumber.get(c.id)}
              </span>
            ))}
          </>
        )}

        {/* Confirmed candidates: number + category in one tag, same spirit
            as CompareView's numbered badges. */}
        {classified.map((c) => (
          <span
            key={c.id}
            className="aoi-confirm-in"
            style={{
              position: "absolute",
              left: `${c.bbox[0] * 100}%`,
              top: `${c.bbox[1] * 100}%`,
              transform: "translate(0, -100%)",
              background: "#22c55e",
              color: "#06121f",
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
              padding: "2px 5px",
              borderRadius: "4px 4px 4px 0",
              whiteSpace: "nowrap",
            }}
          >
            {candidateNumber.get(c.id)} · {categoryLabel(t, primaryCategory(c.matches))}
          </span>
        ))}
      </div>
    </div>
  );
}

function candidateBadgeStyle(
  bbox: [number, number, number, number],
  background: string,
  color: string,
): React.CSSProperties {
  return {
    position: "absolute",
    left: `${bbox[0] * 100}%`,
    top: `${bbox[1] * 100}%`,
    transform: "translate(2px, 2px)",
    background,
    color,
    fontSize: 9,
    fontWeight: 700,
    lineHeight: 1,
    padding: "1px 4px",
    borderRadius: "3px 3px 3px 0",
    pointerEvents: "none",
  };
}

function legendSwatch(color: string, dashed = false): React.CSSProperties {
  return {
    display: "inline-block",
    width: 10,
    height: 10,
    marginRight: 4,
    verticalAlign: "-1px",
    border: `1.5px ${dashed ? "dashed" : "solid"} ${color}`,
    borderRadius: 2,
  };
}
