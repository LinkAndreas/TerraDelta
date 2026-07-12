"use client";

import { useRef, useState } from "react";
import { useI18n, type StringKey } from "@/lib/i18n";
import type { GeoRef } from "@/lib/types";

export interface UploadMeta {
  ext: string;
  geo: GeoRef | null;
}

interface Props {
  label: string;
  sublabel: string;
  url: string | null;
  onFile: (dataUrl: string, meta: UploadMeta) => void;
}

export default function UploadZone({ label, sublabel, url, onFile }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [tiffError, setTiffError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const ACCEPTED_EXTS = ["png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp", "gif"];

  const toJpeg = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/jpeg", 0.92);

  const handle = (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isTiff = ext === "tif" || ext === "tiff" || file.type === "image/tiff";

    if (!file.type.startsWith("image/") && !ACCEPTED_EXTS.includes(ext)) return;
    setTiffError(null);
    setFileName(file.name);

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
          onFile(json.dataUrl as string, { ext, geo: json.geo ?? null });
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
          onFile(toJpeg(canvas), { ext, geo: null });
        } catch (err) {
          setTiffError(t("upload.tiffError" as StringKey));
          console.warn("TIFF conversion failed:", err);
        }
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
          onFile(toJpeg(canvas), { ext, geo: null });
        };
        img.onerror = () => onFile(raw, { ext, geo: null });
        img.src = raw;
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handle(e.dataTransfer.files[0]);
      }}
      title={t("upload.tip")}
      style={{
        flex: "1 1 260px",
        minHeight: 150,
        border: `2px dashed ${drag ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 10,
        cursor: "pointer",
        overflow: "hidden",
        position: "relative",
        background: drag ? "var(--accent-soft)" : "var(--card)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
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
          <img
            src={url}
            alt={label}
            style={{ width: "100%", height: "100%", objectFit: "cover", maxHeight: 220 }}
          />
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
        </>
      ) : (
        <div style={{ padding: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 16.5 }}>{label}</div>
          <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 6 }}>{sublabel}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 12 }}>{t("upload.hint")}</div>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp,.gif"
        hidden
        onChange={(e) => handle(e.target.files?.[0])}
      />
    </div>
  );
}
