import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { Button } from "../../../components/AcpControls";
import { AcpIcon } from "./acpIcons";
import { ColorField, isHex } from "../../../components/ColorField";
import { Composer } from "../../../components/composer/Composer";

export { isHex };

export type EmailHeader = "icon" | "logo" | "name";
export interface EmailDesign { accent: string; page: string; header: EmailHeader; footer: string; support: string }

/** Mirrors EMAIL_DESIGN_DEFAULTS on the server; "Use defaults" puts these back. */
export const EMAIL_DESIGN_DEFAULTS: EmailDesign = { accent: "#14796b", page: "#eef1ef", header: "icon", footer: "", support: "" };

/** Mirrors `supportHref` on the server: a web address, an email address, or nothing. */
export const isSupportAddress = (v: string) =>
  !v.trim() || /^https?:\/\/[^\s<>"]+$/i.test(v.trim()) || /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v.trim());
const HEADERS: EmailHeader[] = ["icon", "logo", "name"];

/** A note saved before the editor is plain text: open it as paragraphs, line breaks kept. */
function footerHtml(raw: string): string {
  if (!raw.trim() || raw.trim().startsWith("<")) return raw;
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<p>${esc(raw.trim()).replace(/\r?\n/g, "<br>")}</p>`;
}

/** An editor with nothing typed in it is no note at all. */
const isEmptyHtml = (html: string) => !html.replace(/<[^>]*>|&nbsp;/g, "").trim();

/** The note's words, for the save bar's list of changes. */
export const footerText = (raw: string) => raw.replace(/<\/(p|h\d|li)>|<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

/**
 * The footer note in our editor. It opens on the draft once and then owns it; a
 * change from outside (Use defaults, discard, a revert in the save bar) remounts it.
 * Loading emits the editor's own HTML for what it opened; that is not an edit.
 */
function FooterNoteEditor({ value, onChange, placeholder }: {
  value: string; onChange: (next: string) => void; placeholder: string;
}) {
  const own = useRef(value);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (value !== own.current) { own.current = value; setEpoch((n) => n + 1); }
  }, [value]);
  return <FooterNoteComposer key={epoch} start={value} placeholder={placeholder}
                             onChange={(html) => { own.current = html; onChange(html); }} />;
}

function FooterNoteComposer({ start, onChange, placeholder }: {
  start: string; onChange: (next: string) => void; placeholder: string;
}) {
  const [initial] = useState(() => footerHtml(start));
  const loading = useRef(!!initial);
  return (
    <Composer variant="panel" toolbarPosition="top" minHeight={96} mentions={false} attachments={false}
              submitInBar={false} initialHtml={initial} placeholder={placeholder}
              onChange={(html) => {
                if (loading.current) { loading.current = false; return; }
                onChange(isEmptyHtml(html) ? "" : html);
              }} />
  );
}
/**
 * ACP → Email → Design: the frame every email is sent in. The draft lives in
 * EmailPage (switching section is not leaving the page); this card renders it and
 * a live preview of the password-reset mail, rendered by the server exactly as it
 * would be sent, in a sandboxed frame.
 */
export function EmailDesignCard({ draft, onChange, logoAvailable }: {
  draft: EmailDesign; onChange: (next: EmailDesign) => void; logoAvailable: boolean;
}) {
  const { t } = useTranslation("acp");
  const set = <K extends keyof EmailDesign>(k: K, v: EmailDesign[K]) => onChange({ ...draft, [k]: v });
  const [html, setHtml] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  // As tall as the mail, so the preview never scrolls inside the page.
  const fit = () => {
    const doc = frame.current?.contentDocument;
    if (doc && frame.current) frame.current.style.height = `${doc.body.scrollHeight}px`;
  };

  // A half-typed hex keeps the last good preview rather than flashing an error.
  const valid = isHex(draft.accent) && isHex(draft.page) && isSupportAddress(draft.support);
  useEffect(() => {
    if (!valid) return;
    let gone = false;
    const id = setTimeout(() => {
      api.post<{ html: string }>("/admin/email/design/preview", draft)
        .then((r) => { if (!gone) setHtml(r.html); })
        .catch(() => {});
    }, 250);
    return () => { gone = true; clearTimeout(id); };
  }, [draft.accent, draft.page, draft.header, draft.footer, draft.support, valid]);

  return (
    <section className="set-card">
      <div className="set-card__head">
        <div className="set-card__icon"><AcpIcon name="palette" size={19} /></div>
        <div className="set-card__titles">
          <h3>{t("email.design.title")}</h3>
          <p>{t("email.design.desc")}</p>
        </div>
        <Button variant="ghost" className="em-reset" onClick={() => onChange(EMAIL_DESIGN_DEFAULTS)}>
          {t("email.design.defaults")}
        </Button>
      </div>

      <div className="set-rows">
        <div className="set-row">
          <div>
            <div className="set-row__label">{t("email.design.accent")}</div>
            <div className="set-row__desc">{t("email.design.accentDesc")}</div>
          </div>
          <div className="set-row__control">
            <ColorField value={draft.accent} fallback={EMAIL_DESIGN_DEFAULTS.accent}
                        label={t("email.design.accent")} onChange={(v) => set("accent", v)} />
          </div>
        </div>

        <div className="set-row">
          <div>
            <div className="set-row__label">{t("email.design.page")}</div>
            <div className="set-row__desc">{t("email.design.pageDesc")}</div>
          </div>
          <div className="set-row__control">
            <ColorField value={draft.page} fallback={EMAIL_DESIGN_DEFAULTS.page}
                        label={t("email.design.page")} onChange={(v) => set("page", v)} />
          </div>
        </div>

        <div className="set-row">
          <div>
            <div className="set-row__label">{t("email.design.header")}</div>
            <div className="set-row__desc">
              {t("email.design.headerDesc")}
              {draft.header === "logo" && !logoAvailable && <> {t("email.design.logoMissing")}</>}
            </div>
          </div>
          <div className="set-row__control">
            <div className="acp-seg acp-seg--auto" role="radiogroup" aria-label={t("email.design.header")}>
              {HEADERS.map((h) => (
                <button key={h} type="button" role="radio" aria-checked={draft.header === h}
                        className={draft.header === h ? "is-on" : ""} onClick={() => set("header", h)}>
                  {t(`email.design.headers.${h}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="set-row">
          <div>
            <div className="set-row__label">{t("email.design.support")}</div>
            <div className="set-row__desc">
              {t("email.design.supportDesc")}
              {!isSupportAddress(draft.support) && <span className="em-invalid"> {t("email.design.supportInvalid")}</span>}
            </div>
          </div>
          <div className="set-row__control">
            <input className="inp em-support" type="text" inputMode="url" maxLength={300} value={draft.support}
                   placeholder={t("email.design.supportPlaceholder")} aria-invalid={!isSupportAddress(draft.support)}
                   aria-label={t("email.design.support")} onChange={(e) => set("support", e.target.value)} />
          </div>
        </div>

        <div className="set-row em-row-stack">
          <div>
            <div className="set-row__label">{t("email.design.footer")}</div>
            <div className="set-row__desc">{t("email.design.footerDesc")}</div>
          </div>
          <div className="set-row__control em-full">
            <FooterNoteEditor value={draft.footer} placeholder={t("email.design.footerPlaceholder")}
                              onChange={(v) => set("footer", v)} />
          </div>
        </div>
      </div>

      <div className="set-extra em-preview">
        <div>
          <div className="set-row__label">{t("email.design.preview")}</div>
          <div className="set-row__desc">{t("email.design.previewDesc")}</div>
        </div>
        {/* No scripts: the frame only paints the mail. Same-origin only so its height can be read. */}
        <iframe ref={frame} className="em-preview__frame" sandbox="allow-same-origin" title={t("email.design.preview")}
                srcDoc={html && `<!doctype html><html><body style="margin:0">${html}</body></html>`} onLoad={fit} />
      </div>
    </section>
  );
}
