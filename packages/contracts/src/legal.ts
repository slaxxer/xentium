/**
 * The site's legal documents. A fixed set core owns: each has a route, a footer
 * link and a tab in ACP → Legal. An admin writes the text; nobody adds, renames or
 * removes a document, so no layout or theme can take the imprint away.
 *
 * The order is the footer order.
 */
export const LEGAL_DOCUMENTS = ['imprint', 'privacy', 'terms', 'disclaimer'] as const;

export type LegalDocumentKey = (typeof LEGAL_DOCUMENTS)[number];

export const isLegalDocumentKey = (key: string): key is LegalDocumentKey =>
  (LEGAL_DOCUMENTS as readonly string[]).includes(key);

/** Public path for a legal document. */
export const legalPath = (key: LegalDocumentKey): string => `/legal/${key}`;

/** A published document as the footer and registration see it. */
export interface LegalDocumentLink {
  key: LegalDocumentKey;
  publishedAt: string;
}

/** A published document as its page renders it. */
export interface PublicLegalDocument {
  key: LegalDocumentKey;
  body: unknown;
  publishedAt: string;
}

/** One document in the ACP editor. */
export interface AdminLegalDocument {
  key: LegalDocumentKey;
  draftBody: unknown | null;
  /** Null = not published. */
  body: unknown | null;
  publishedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}
