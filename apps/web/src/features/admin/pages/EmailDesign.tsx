import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../lib/api";
import { Button } from "../../../components/AcpControls";
import { AcpIcon } from "./acpIcons";

export type EmailHeader = "icon" | "logo" | "name";
export interface EmailDesign { accent: string; page: string; header: EmailHeader; footer: string }

/** Mirrors EMAIL_DESIGN_DEFAULTS on the server; "Use defaults" puts these back. */
export const EMAIL_DESIGN_DEFAULTS: EmailDesign = { accent: "#0d7c72", page: "#f1f1f6", header: "icon", footer: "" };
const HEADERS: EmailHeader[] = ["icon", "logo", "name"];
const FOOTER_MAX = 300;
export const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

/** The browser's picker and a hex field — one value, two ways in. */
function ColorField({ value, fallback, onChange, label }: {
  value: string; fallback: string; onChange: (v: string) => void; label: string;
}) {
  return (
    <div className="em-color">
      <label className="em-color__swatch" style={{ background: isHex(value) ? value : fallback }}>
        <input type="color" value={isHex(value) ? value : fallback} aria-label={label}
               onChange={(e) => onChange(e.target.value)} />
      </label>
      <input className={`inp is-mono em-color__hex${isHex(value) ? "" : " is-invalid"}`} value={value} maxLength={7}
             placeholder={fallback} aria-label={label} onChange={(e) => onChange(e.target.value.trim())} />
    </div>
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
  const valid = isHex(draft.accent) && isHex(draft.page);
  useEffect(() => {
    if (!valid) return;
    let gone = false;
    const id = setTimeout(() => {
      api.post<{ html: string }>("/admin/email/design/preview", draft)
        .then((r) => { if (!gone) setHtml(r.html); })
        .catch(() => {});
    }, 250);
    return () => { gone = true; clearTimeout(id); };
  }, [draft.accent, draft.page, draft.header, draft.footer, valid]);

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

        <div className="set-row em-row-stack">
          <div>
            <div className="set-row__label">{t("email.design.footer")}</div>
            <div className="set-row__desc">{t("email.design.footerDesc")}</div>
          </div>
          <div className="set-row__control em-full">
            <textarea className="inp em-footer" rows={2} maxLength={FOOTER_MAX} value={draft.footer}
                      placeholder={t("email.design.footerPlaceholder")}
                      onChange={(e) => set("footer", e.target.value)} />
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
