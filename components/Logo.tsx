"use client";

// TerraDelta brand mark: a rounded "map tile" badge containing a delta (Δ —
// the symbol for change) split by a vertical slider line + knob, echoing the
// app's before/after comparison. Brand colors are constant across themes.
export default function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="TerraDelta"
      style={{ display: "block", flex: "none" }}
    >
      <defs>
        <linearGradient id="td-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e0855a" />
          <stop offset="1" stopColor="#b9502b" />
        </linearGradient>
      </defs>

      <rect x="1.5" y="1.5" width="45" height="45" rx="11" fill="url(#td-bg)" />

      {/* "later" half — lighter split */}
      <path d="M24 9 L39 39 L24 39 Z" fill="#ffffff" fillOpacity="0.18" />

      {/* delta outline */}
      <path
        d="M24 9 L39 39 L9 39 Z"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />

      {/* slider line + knob */}
      <line x1="24" y1="9" x2="24" y2="39" stroke="#ffffff" strokeWidth="1.8" strokeOpacity="0.9" />
      <circle cx="24" cy="26" r="3.4" fill="#ffffff" />
    </svg>
  );
}
