"use client";

import { useRef, useState } from "react";
import { useI18n, type StringKey } from "@/lib/i18n";

interface Props {
  label: string;
  sublabel: string;
  url: string | null;
  onFile: (dataUrl: string) => void;
}

export default function UploadZone({ label, sublabel, url, onFile }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [tiffError, setTiffError] = useState<string | null>(null);

  const ACCEPTED_EXTS = ["png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp", "gif"];

  const toJpeg = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/jpeg", 0.92);

  const canvasFromBitmap = async (blob: Blob): Promise<HTMLCanvasElement> => {
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return c;
  };

  const handle = (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isTiff = ext === "tif" || ext === "tiff" || file.type === "image/tiff";

    if (!file.type.startsWith("image/") && !ACCEPTED_EXTS.includes(ext)) return;
    setTiffError(null);

    if (isTiff) {
      const reader = new FileReader();
      reader.onload = async () => {
        const buffer = reader.result as ArrayBuffer;

        // 1. Try native browser decode (Safari on macOS supports TIFF natively)
        try {
          const blob = new Blob([buffer], { type: "image/tiff" });
          const canvas = await canvasFromBitmap(blob);
          onFile(toJpeg(canvas));
          return;
        } catch {
          // Browser doesn't support TIFF natively — fall through to utif
        }

        // 2. utif fallback with strict dimension validation
        try {
          const UTIF = await import("utif");
          const ifds = UTIF.decode(buffer);
          if (!ifds.length) throw new Error("no IFDs");
          UTIF.decodeImage(buffer, ifds[0]);
          const ifd = ifds[0];
          const rgba = UTIF.toRGBA8(ifd);
          const width = ifd.width;
          const height = ifd.height;

          // Guard against corrupt dimension metadata producing garbled output
          if (!width || !height || rgba.length !== width * height * 4) {
            throw new Error(`size mismatch: ${rgba.length} vs ${width}×${height}×4=${width * height * 4}`);
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d")!;
          const imgData = ctx.createImageData(width, height);
          imgData.data.set(rgba);
          ctx.putImageData(imgData, 0, 0);
          onFile(toJpeg(canvas));
        } catch (err) {
          setTiffError(t("upload.tiffError" as StringKey));
          console.warn("TIFF decode failed:", err);
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
          onFile(toJpeg(canvas));
        };
        img.onerror = () => onFile(raw);
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
