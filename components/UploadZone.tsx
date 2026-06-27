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

  const handle = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => onFile(reader.result as string);
    reader.readAsDataURL(file);
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
        flex: 1,
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
        <div style={{ padding: 16 }}>
          <div style={{ fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{sublabel}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>{t("upload.hint")}</div>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => handle(e.target.files?.[0])}
      />
    </div>
  );
}
