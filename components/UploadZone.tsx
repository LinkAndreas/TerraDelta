"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

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

  const ACCEPTED_EXTS = ["png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp", "gif"];

  const toJpeg = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/jpeg", 0.92);

  const handle = (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isTiff = ext === "tif" || ext === "tiff" || file.type === "image/tiff";

    if (!file.type.startsWith("image/") && !ACCEPTED_EXTS.includes(ext)) return;

    if (isTiff) {
      // Browsers can't decode TIFF natively — use utif to decode to raw RGBA
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const UTIF = await import("utif");
          const buffer = reader.result as ArrayBuffer;
          const ifds = UTIF.decode(buffer);
          if (!ifds.length) return;
          UTIF.decodeImage(buffer, ifds[0]);
          const rgba = UTIF.toRGBA8(ifds[0]);
          const { width, height } = ifds[0];
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d")!;
          const imgData = ctx.createImageData(width, height);
          imgData.data.set(rgba);
          ctx.putImageData(imgData, 0, 0);
          onFile(toJpeg(canvas));
        } catch {
          // silently ignore unreadable TIFFs
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
      {url ? (
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
