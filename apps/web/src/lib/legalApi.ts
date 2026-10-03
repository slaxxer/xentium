import { useQuery } from "@tanstack/react-query";
import type {
  AdminLegalDocument,
  LegalDocumentKey,
  LegalDocumentLink,
  PublicLegalDocument,
} from "@xentium/contracts";
import { api } from "./api";

export const legalApi = {
  // Public
  listPublished: () => api.get<LegalDocumentLink[]>("/legal"),
  get: (key: LegalDocumentKey) => api.get<PublicLegalDocument>(`/legal/${key}`),

  // ACP
  listAll: () => api.get<AdminLegalDocument[]>("/admin/legal"),
  saveDraft: (key: LegalDocumentKey, draftBody: unknown) =>
    api.put<void>(`/admin/legal/${key}/draft`, { draftBody }),
  publish: (key: LegalDocumentKey) => api.post<void>(`/admin/legal/${key}/publish`),
  unpublish: (key: LegalDocumentKey) => api.post<void>(`/admin/legal/${key}/unpublish`),
  discard: (key: LegalDocumentKey) => api.post<void>(`/admin/legal/${key}/discard`),
};

/** Query key of the published list — the ACP invalidates it on publish/unpublish. */
export const LEGAL_LINKS_KEY = ["legal-links"] as const;

/** The published legal documents, in footer order. Footer and registration share it. */
export function useLegalLinks(): LegalDocumentLink[] {
  const { data = [] } = useQuery({
    queryKey: LEGAL_LINKS_KEY,
    queryFn: legalApi.listPublished,
    staleTime: 300_000,
  });
  return data;
}
