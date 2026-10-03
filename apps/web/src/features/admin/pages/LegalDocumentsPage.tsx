import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import {
  LEGAL_DOCUMENTS,
  isLegalDocumentKey,
  legalPath,
  type AdminLegalDocument,
  type LegalDocumentKey,
} from "@xentium/contracts";
import { legalApi, LEGAL_LINKS_KEY } from "../../../lib/legalApi";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { sameValue, useAutosave } from "../../../hooks/useAutosave";
import { SaveChip } from "../../../components/SaveChip";
import Image from "@tiptap/extension-image";
import type { JSONContent } from "@tiptap/react";
import { Composer } from "../../../components/composer/Composer";
import { AcpIcon } from "./acpIcons";
import "./acpSystem.scss";
import "./LegalDocumentsPage.scss";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
// The reader draws bodies with the article extensions, Image included. There is no
// upload here, but a document carried over from a custom page may hold an image,
// and an editor without the node would drop it on the first save.
const LEGAL_EXTENSIONS = [Image.configure({ inline: false, HTMLAttributes: { class: "article-editor__image" } })];
const QUERY_KEY = ["acp-legal"] as const;

/** True when the doc holds any text — the server refuses to publish one that does not. */
function hasText(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as { text?: unknown; content?: unknown };
  if (typeof n.text === "string" && n.text.trim() !== "") return true;
  return Array.isArray(n.content) && n.content.some(hasText);
}

/**
 * ACP → Content → Legal: terms, privacy, disclaimer and imprint.
 *
 * A fixed set of four, not a list an admin adds to — core owns the routes and the
 * footer links. The text autosaves as a DRAFT; going live is an explicit Publish,
 * because a half-typed terms of service must never be what a visitor agrees to.
 */
export function LegalDocumentsPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const requested = params.get("doc") ?? "";
  const active: LegalDocumentKey = isLegalDocumentKey(requested) ? requested : LEGAL_DOCUMENTS[0];

  const { data: docs } = useQuery({ queryKey: QUERY_KEY, queryFn: legalApi.listAll });

  const saveMut = useMutation({
    mutationFn: ({ key, body }: { key: LegalDocumentKey; body: unknown }) => legalApi.saveDraft(key, body),
    // Written into the cache rather than refetched: the editor holds the live text,
    // and this only moves the autosave baseline.
    onSuccess: (_r, { key, body }) =>
      qc.setQueryData<AdminLegalDocument[]>(QUERY_KEY, (old) =>
        old?.map((d) => (d.key === key ? { ...d, draftBody: body } : d))),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const select = (key: LegalDocumentKey) => setParams({ doc: key }, { replace: true });
  const doc = docs?.find((d) => d.key === active);

  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="pg-head">
        <div>
          <p className="pg-eyebrow">{t("legal.eyebrow")}</p>
          <h1 className="pg-title">{t("legal.title")}</h1>
          <p className="pg-sub">{t("legal.subtitle")}</p>
        </div>
        <SaveChip saving={saveMut.isPending} />
      </div>

      <div className="set-layout">
        <nav className="set-secnav">
          <p className="set-secnav__label">{t("legal.documents")}</p>
          {LEGAL_DOCUMENTS.map((key) => {
            const d = docs?.find((x) => x.key === key);
            const live = !!d?.publishedAt;
            return (
              <button key={key} type="button" className={key === active ? "is-active" : ""} onClick={() => select(key)}>
                <AcpIcon name="file" size={17} />
                <span>{t(`legal.docs.${key}.name`)}</span>
                <span className={`lg-dot ${live ? "lg-dot--live" : ""}`} title={t(live ? "legal.state.live" : "legal.state.offline")} />
              </button>
            );
          })}
        </nav>

        <div className="set-content">
          {doc && (
            <LegalDocumentCard
              key={doc.key}
              doc={doc}
              onSave={(body) => saveMut.mutate({ key: doc.key, body })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** One document. Keyed by the document, so switching tabs starts a fresh editor and autosave baseline. */
function LegalDocumentCard({ doc, onSave }: { doc: AdminLegalDocument; onSave: (body: unknown) => void }) {
  const { t, i18n } = useTranslation("acp");
  const qc = useQueryClient();
  const saved = doc.draftBody ?? EMPTY_DOC;
  const [draft, setDraft] = useState<unknown>(saved);

  useAutosave({ value: draft, savedValue: saved, onSave });

  const live = doc.publishedAt !== null;
  const pending = live && !sameValue(draft, doc.body);
  const canPublish = hasText(draft) && (!live || pending);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: QUERY_KEY });
    qc.invalidateQueries({ queryKey: LEGAL_LINKS_KEY });
    qc.invalidateQueries({ queryKey: ["legal", doc.key] });
  };

  const publishMut = useMutation({
    // The draft first: an edit still inside the autosave debounce would otherwise
    // be left out of what goes live.
    mutationFn: async () => {
      await legalApi.saveDraft(doc.key, draft);
      await legalApi.publish(doc.key);
    },
    onSuccess: () => { refresh(); toast.success(t("legal.toast.published")); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const unpublishMut = useMutation({
    mutationFn: () => legalApi.unpublish(doc.key),
    onSuccess: () => { refresh(); toast.success(t("legal.toast.unpublished")); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const discardMut = useMutation({
    mutationFn: () => legalApi.discard(doc.key),
    onSuccess: () => {
      setDraft(doc.body);
      qc.setQueryData<AdminLegalDocument[]>(QUERY_KEY, (old) =>
        old?.map((d) => (d.key === doc.key ? { ...d, draftBody: doc.body } : d)));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  async function onUnpublish() {
    const ok = await openDialog({
      kind: "confirm", icon: "warning",
      title: t("legal.unpublishTitle", { name: t(`legal.docs.${doc.key}.name`) }),
      body: t("legal.unpublishBody"),
      confirmText: t("legal.unpublish"),
      danger: true,
    });
    if (ok) unpublishMut.mutate();
  }

  async function onDiscard() {
    const ok = await openDialog({
      kind: "confirm", icon: "warning",
      title: t("legal.discardTitle"),
      body: t("legal.discardBody"),
      confirmText: t("legal.discard"),
      danger: true,
    });
    if (ok) discardMut.mutate();
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { dateStyle: "long" });
  const busy = publishMut.isPending || unpublishMut.isPending || discardMut.isPending;

  return (
    <section className="set-card">
      <div className="set-card__head">
        <div className="set-card__icon"><AcpIcon name="file" size={19} /></div>
        <div className="set-card__titles">
          <h3>{t(`legal.docs.${doc.key}.name`)}</h3>
          <p>{t(`legal.docs.${doc.key}.desc`)}</p>
        </div>
      </div>

      <div className="lg-status">
        <span className={`lg-pill ${live ? "lg-pill--live" : ""}`}>
          {t(live ? "legal.state.live" : "legal.state.offline")}
        </span>
        <span className="lg-status__text">
          {live
            ? <>
                {t("legal.publishedOn", { date: date(doc.publishedAt!) })}
                {" · "}
                <Link to={legalPath(doc.key)} target="_blank" rel="noreferrer">{legalPath(doc.key)}</Link>
              </>
            : t("legal.offlineHint")}
          {pending && <> · <b>{t("legal.pending")}</b></>}
        </span>
        <span className="lg-status__actions">
          {pending && (
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onDiscard}>
              {t("legal.discard")}
            </button>
          )}
          {live && (
            <button type="button" className="btn-ghost btn-sm lg-danger" disabled={busy} onClick={onUnpublish}>
              {t("legal.unpublish")}
            </button>
          )}
          <button type="button" className="btn-primary btn-sm" disabled={!canPublish || busy}
                  onClick={() => publishMut.mutate()}>
            {t(live ? "legal.publishChanges" : "legal.publish")}
          </button>
        </span>
      </div>

      <div className="lg-editor">
        {/* Our one editor. `initialJson` follows `draft`, so Discard puts the published
            text back in place without a remount. */}
        <Composer
          variant="panel"
          toolbarPosition="top"
          minHeight={360}
          mentions={false}
          extraExtensions={LEGAL_EXTENSIONS}
          initialJson={draft as JSONContent}
          onChangeJson={setDraft}
          placeholder={t(`legal.docs.${doc.key}.placeholder`)}
          submitInBar={false}
          disabled={busy}
        />
      </div>
    </section>
  );
}
