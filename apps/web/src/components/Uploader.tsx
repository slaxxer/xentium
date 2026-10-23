import { useEffect, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { authStore } from "../lib/authStore";
import "./Uploader.scss";

/**
 * Drag-and-drop upload with progress, for add-ons (host global `webUploader`).
 *
 * It sends each file to the add-on's OWN route (which calls `host.files.save`), so
 * the add-on decides who may upload and what the file belongs to. Here: the picker,
 * progress per file, image previews, a size check before sending, and the server's
 * own message when it refuses (type, size). `accept` uses the same kinds as
 * `host.files.save` so the picker offers what the server will take.
 */

const KIND_MIME: Record<string, string> = {
  image: "image/jpeg,image/png,image/webp,image/gif,image/avif",
  pdf: "application/pdf",
  archive: ".zip,.7z,.rar,.gz,.tar",
  audio: "audio/*",
  video: "video/mp4,video/webm,video/quicktime",
  document: ".docx,.xlsx,.pptx,.odt,.ods,.odp,.rtf",
};

export interface UploaderProps {
  /** The add-on's upload route, under /api: `/p/<pluginId>/…`. */
  url: string;
  /** The form field the route reads. Default "file". */
  field?: string;
  /** Kinds (`image`, `pdf`, …) or extensions (`.png`). */
  accept?: string[];
  /** Refused here before sending; the server checks again. */
  maxBytes?: number;
  multiple?: boolean;
  /** Extra form fields sent with every file (an album id, say). */
  extra?: Record<string, string>;
  /** Called with the route's answer for each file that went through. */
  onUploaded?: (result: unknown, file: File) => void;
  /** The text inside the drop zone. */
  label?: string;
  disabled?: boolean;
}

interface Item { id: number; file: File; preview: string | null; progress: number; state: "sending" | "done" | "failed"; error?: string }

let seq = 0;

/** POST with upload progress (fetch has none), retried once after a token refresh. */
function send(url: string, form: FormData, onProgress: (p: number) => void, token = authStore.token): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${url}`);
    xhr.withCredentials = true;
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let body: unknown = null;
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { body = null; }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(form);
  });
}

function mb(bytes: number) {
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

export function Uploader({ url, field = "file", accept, maxBytes, multiple = false, extra, onUploaded, label, disabled }: UploaderProps) {
  const { t } = useTranslation("common");
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const acceptAttr = accept?.map((a) => KIND_MIME[a] ?? a).join(",");

  // Previews are object URLs: give them back when they go.
  useEffect(() => () => { items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id: number, p: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)));

  async function upload(file: File) {
    const id = ++seq;
    const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    setItems((list) => [...list, { id, file, preview, progress: 0, state: "sending" }]);
    if (maxBytes && file.size > maxBytes) {
      patch(id, { state: "failed", error: t("uploader.tooLarge", { size: mb(maxBytes) }) });
      return;
    }
    const form = new FormData();
    for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);
    form.append(field, file);
    try {
      let res = await send(url, form, (p) => patch(id, { progress: p }));
      if (res.status === 401 && authStore.token) {
        const fresh = await api.tryRefresh();
        if (fresh) res = await send(url, form, (p) => patch(id, { progress: p }), fresh);
      }
      if (res.status >= 200 && res.status < 300) {
        patch(id, { state: "done", progress: 1 });
        onUploaded?.(res.body, file);
      } else {
        const err = (res.body as { error?: { message?: string } } | null)?.error?.message;
        patch(id, { state: "failed", error: err ?? t("uploader.failed") });
      }
    } catch {
      patch(id, { state: "failed", error: t("uploader.failed") });
    }
  }

  const take = (files: FileList | null) => {
    if (!files || disabled) return;
    const list = multiple ? Array.from(files) : Array.from(files).slice(0, 1);
    list.forEach((f) => void upload(f));
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); };

  return (
    <div className="uploader">
      <button type="button" className={`uploader__zone${over ? " is-over" : ""}`} disabled={disabled}
              onClick={() => input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <span className="uploader__label">{label ?? t(multiple ? "uploader.dropMany" : "uploader.dropOne")}</span>
        {maxBytes ? <span className="uploader__hint">{t("uploader.max", { size: mb(maxBytes) })}</span> : null}
      </button>
      <input ref={input} type="file" hidden accept={acceptAttr} multiple={multiple}
             onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      {items.length > 0 && (
        <ul className="uploader__list">
          {items.map((i) => (
            <li key={i.id} className={`uploader__item is-${i.state}`}>
              {i.preview ? <img src={i.preview} alt="" className="uploader__thumb" /> : <span className="uploader__thumb is-file" aria-hidden="true" />}
              <span className="uploader__name">{i.file.name}</span>
              {i.state === "failed"
                ? <span className="uploader__error" role="alert">{i.error}</span>
                : <span className="uploader__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(i.progress * 100)}>
                    <span style={{ width: `${Math.round(i.progress * 100)}%` }} />
                  </span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
