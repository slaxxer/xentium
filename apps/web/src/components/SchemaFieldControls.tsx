/**
 * The richer controls `SchemaFields` draws for a FORMAT hint — `.meta({ format })`
 * on a block prop, core's or a plugin's. Like `format: "icon"`, nothing registers
 * anything: a schema declares, the editor renders.
 *
 *   - "image"    — a path or URL, with an Upload button (the layout image store).
 *   - "richtext" — our Composer; the value is ProseMirror JSON, the same shape as an
 *                  article body, so `ArticleContent` renders it.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { JSONContent } from "@tiptap/react";
import { api } from "../lib/api";
import { toast } from "../lib/toast";
import { apiErrorMessage } from "../lib/swal";
import { resolveImageSource } from "../layout/blocks/sectionBackground";
import { Composer } from "./composer/Composer";

export function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation("acp");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // The PATH is stored, never the URL: a theme export reads the file off disk by it.
      const res = await api.post<{ path: string }>("/admin/layouts/images", fd);
      onChange(res.path);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="sf-image">
      {value && <img className="sf-image__thumb" src={resolveImageSource(value)} alt="" />}
      <div className="sf-image__row">
        <input className="acp-input" value={value} placeholder={t("layoutEditor.imagePlaceholder")}
               onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn-ghost btn-sm" disabled={uploading}
                onClick={() => fileRef.current?.click()}>
          {uploading ? t("layoutEditor.bgUploading") : t("layoutEditor.bgUpload")}
        </button>
      </div>
      <input ref={fileRef} type="file" hidden
             accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
             onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
    </div>
  );
}

export function RichTextField({ value, onChange }: { value: unknown; onChange: (v: JSONContent) => void }) {
  const { t } = useTranslation("acp");
  return (
    <div className="sf-richtext">
      {/* Follows `initialJson` when another block is selected; feeding its own output
          back in is a no-op, so typing never moves the caret. */}
      <Composer variant="panel" toolbarPosition="top" minHeight={140} mentions={false} attachments={false} submitInBar={false}
                initialJson={(value as JSONContent | null) ?? { type: "doc", content: [{ type: "paragraph" }] }}
                onChangeJson={onChange} placeholder={t("layoutEditor.richTextPlaceholder")} />
    </div>
  );
}
