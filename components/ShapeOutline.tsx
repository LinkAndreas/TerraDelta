"use client";

import type { OverlayShape } from "@/lib/geo";

// Renders a list of OverlayShapes (an ellipse per circle, a rect per
// rectangle/square) as SVG primitives in a `viewBox="0 0 100 100"` overlay —
// the convention used throughout the app for drawing something at a
// normalized [0..1] position over a plain <img>. Shared by CompareView (the
// final "this run was restricted to here" outline) and AnalysisPreview (the
// live AOI boundary shown while a run is in progress), so the two never
// drift apart visually.
export default function ShapeOutline({
  shapes,
  stroke = "#38bdf8",
  strokeWidth = 2,
  dash = "3 2",
}: {
  shapes: OverlayShape[];
  stroke?: string;
  strokeWidth?: number;
  dash?: string;
}) {
  return (
    <>
      {shapes.map((shape, i) =>
        shape.kind === "ellipse" ? (
          <ellipse
            key={i}
            cx={shape.cx * 100}
            cy={shape.cy * 100}
            rx={shape.rx * 100}
            ry={shape.ry * 100}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <rect
            key={i}
            x={shape.x * 100}
            y={shape.y * 100}
            width={shape.w * 100}
            height={shape.h * 100}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
    </>
  );
}
