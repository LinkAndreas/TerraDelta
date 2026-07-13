"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n, type StringKey } from "@/lib/i18n";
import { geoRefBounds } from "@/lib/geo";
import type { GeoRef } from "@/lib/types";

export interface UploadMeta {
  ext: string;
  geo: GeoRef | null;
  width: number;
  height: number;
  fileSizeBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

interface Props {
  label: string;
  sublabel: string;
  url: string | null;
  onFile: (dataUrl: string, meta: UploadMeta) => void;
  disabled?: boolean;
}

export default function UploadZone({ label, sublabel, url, onFile, disabled = false }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [tiffError, setTiffError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  // Server-side TIFF conversion (large GeoTIFFs, resized up to 3000x3000) and
  // the client-side canvas fallback can both take a few seconds — this drives
  // a processing overlay so the drop zone isn't just sitting there inert.
  const [loading, setLoading] = useState(false);
  const busy = disabled || loading;
  // Kept locally (in addition to being handed up via onFile) so the info
  // dropdown below has something to show without extra prop plumbing.
  const [meta, setMeta] = useState<UploadMeta | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!infoOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) setInfoOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [infoOpen]);

  const ACCEPTED_EXTS = ["png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp", "gif"];

  const toJpeg = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/jpeg", 0.92);

  const finish = (dataUrl: string, uploadMeta: UploadMeta) => {
    setLoading(false);
    setMeta(uploadMeta);
    onFile(dataUrl, uploadMeta);
  };

  const handle = (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isTiff = ext === "tif" || ext === "tiff" || file.type === "image/tiff";
    const fileSizeBytes = file.size;

    if (!file.type.startsWith("image/") && !ACCEPTED_EXTS.includes(ext)) return;
    setTiffError(null);
    setFileName(file.name);
    setInfoOpen(false);
    setLoading(true);

    if (isTiff) {
      const reader = new FileReader();
      reader.onload = async () => {
        const buffer = reader.result as ArrayBuffer;
        const blob = new Blob([buffer], { type: "image/tiff" });

        // 1. Server-side conversion (handles all TIFF variants via sharp,
        //    falling back to geotiff.js) — this is also where GeoTIFF
        //    georeferencing is extracted, so it must run whenever possible.
        try {
          const form = new FormData();
          form.append("file", blob, file.name);
          const res = await fetch("/api/tiff", { method: "POST", body: form });
          const json = await res.json();
          if (!res.ok || json.error) throw new Error(json.error ?? "Server conversion failed");
          finish(json.dataUrl as string, {
            ext,
            geo: json.geo ?? null,
            width: json.width ?? 0,
            height: json.height ?? 0,
            fileSizeBytes,
          });
          return;
        } catch (err) {
          console.warn("Server TIFF conversion failed, trying native decode:", err);
        }

        // 2. Fallback: native browser decode via object URL (works in Safari
        //    on macOS). No georeferencing is available on this path.
        try {
          const objectUrl = URL.createObjectURL(blob);
          const canvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              if (!img.naturalWidth || !img.naturalHeight) {
                reject(new Error("zero dimensions"));
                return;
              }
              const c = document.createElement("canvas");
              c.width = img.naturalWidth;
              c.height = img.naturalHeight;
              c.getContext("2d")!.drawImage(img, 0, 0);
              resolve(c);
            };
            img.onerror = reject;
            img.src = objectUrl;
          });
          URL.revokeObjectURL(objectUrl);
          finish(toJpeg(canvas), { ext, geo: null, width: canvas.width, height: canvas.height, fileSizeBytes });
        } catch (err) {
          setLoading(false);
          setTiffError(t("upload.tiffError" as StringKey));
          console.warn("TIFF conversion failed:", err);
        }
      };
      reader.onerror = () => {
        setLoading(false);
        setTiffError(t("upload.tiffError" as StringKey));
      };
      reader.readAsArrayBuffer(file);
    } else {
      // All other formats: read as data URL, normalize to JPEG via canvas
      const reader = new FileReader();
      reader.onload = () => {
        const raw = reader.result as string;
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext("2d")!.drawImage(img, 0, 0);
          finish(toJpeg(canvas), { ext, geo: null, width: canvas.width, height: canvas.height, fileSizeBytes });
        };
        img.onerror = () => finish(raw, { ext, geo: null, width: 0, height: 0, fileSizeBytes });
        img.src = raw;
      };
      reader.onerror = () => setLoading(false);
      reader.readAsDataURL(file);
    }
  };

  return (
    <div
      onClick={() => !busy && inputRef.current?.click()}
      onDragOver={(e) => {
        if (busy) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (busy) return;
        handle(e.dataTransfer.files[0]);
      }}
      title={disabled ? t("run.lockedTip") : loading ? t("upload.processing") : t("upload.tip")}
      style={{
        flex: "1 1 260px",
        minHeight: 150,
        border: `2px dashed ${drag && !busy ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 10,
        cursor: busy ? "not-allowed" : "pointer",
        position: "relative",
        background: drag && !busy ? "var(--accent-soft)" : "var(--card)",
        opacity: disabled ? 0.6 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        transition: "opacity 0.15s ease",
      }}
    >
      {tiffError ? (
        <div style={{ padding: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 16.5 }}>{label}</div>
          <div style={{ fontSize: 13, color: "var(--error, #ef4444)", marginTop: 10 }}>{tiffError}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{t("upload.hint")}</div>
        </div>
      ) : url ? (
        <>
          <div style={{ width: "100%", height: "100%", maxHeight: 220, overflow: "hidden", borderRadius: 10 }}>
            <img src={url} alt={label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <span
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              fontSize: 12,
              padding: "2px 8px",
              borderRadius: 4,
              background: "rgba(0,0,0,0.6)",
              color: "#fff",
            }}
          >
            {label}
          </span>
          {fileName && (
            <span
              title={fileName}
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                fontSize: 11.5,
                padding: "5px 10px",
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
                textAlign: "left",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {fileName}
            </span>
          )}
          {disabled && (
            <span
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
              }}
            >
              🔒
            </span>
          )}
          {meta && (
            <div
              ref={infoRef}
              onClick={(e) => e.stopPropagation()}
              style={{ position: "absolute", top: 8, right: disabled ? 38 : 8 }}
            >
              <button
                type="button"
                onClick={() => setInfoOpen((v) => !v)}
                title={t("upload.info")}
                aria-expanded={infoOpen}
                aria-label={t("upload.info")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                  fontStyle: "italic",
                  fontFamily: "Georgia, serif",
                  padding: 0,
                  background: "rgba(0,0,0,0.6)",
                  border: "1px solid rgba(255,255,255,0.25)",
                  color: "#fff",
                }}
              >
                i
              </button>
              {infoOpen && (
                <div
                  className="dropdown-menu"
                  style={{ top: "calc(100% + 6px)", right: 0, left: "auto", minWidth: 240, padding: 12, display: "grid", gap: 9 }}
                >
                  <MetaRow label={t("upload.meta.format")} value={meta.ext.toUpperCase()} />
                  <MetaRow
                    label={t("upload.meta.dimensions")}
                    value={meta.width && meta.height ? `${meta.width} × ${meta.height} px` : "—"}
                  />
                  <MetaRow label={t("upload.meta.fileSize")} value={formatBytes(meta.fileSizeBytes)} />
                  <div style={{ height: 1, background: "var(--border)", margin: "1px 0" }} />
                  {meta.geo ? (
                    <>
                      <MetaRow label={t("upload.meta.geo")} value={t("upload.meta.geoYes")} valueColor="#22c55e" />
                      {(() => {
                        const b = geoRefBounds(meta.geo);
                        return (
                          <>
                            <MetaRow
                              label={t("upload.meta.bounds")}
                              value={`${b.minLat.toFixed(4)}, ${b.minLon.toFixed(4)}  →  ${b.maxLat.toFixed(4)}, ${b.maxLon.toFixed(4)}`}
                            />
                            <MetaRow
                              label={t("upload.meta.covers")}
                              value={`${Math.round(b.widthM).toLocaleString()} × ${Math.round(b.heightM).toLocaleString()} m (${
                                b.areaKm2 >= 1 ? `${b.areaKm2.toFixed(2)} km²` : `${(b.areaKm2 * 100).toFixed(1)} ha`
                              })`}
                            />
                          </>
                        );
                      })()}
                    </>
                  ) : (
                    <MetaRow label={t("upload.meta.geo")} value={t("upload.meta.geoNo")} />
                  )}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 16.5 }}>{label}</div>
          <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 6 }}>{sublabel}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 12 }}>{t("upload.hint")}</div>
        </div>
      )}
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: 20,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(2px)",
          }}
        >
          <span className="spinner" style={{ margin: 0, width: 20, height: 20 }} />
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "#fff" }}>{t("upload.processing")}</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>{t("upload.processingHint")}</div>
          <div className="progress-track" style={{ width: "70%", marginTop: 4 }}>
            <div className="progress-bar" />
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp,.gif"
        hidden
        disabled={busy}
        onChange={(e) => handle(e.target.files?.[0])}
      />
    </div>
  );
}

function MetaRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted)", fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: valueColor ?? "var(--text)", fontWeight: 500, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}
