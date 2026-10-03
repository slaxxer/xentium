import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { faBookOpen, faCheck, faCopy, faRotateLeft, faTrash, faUser, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../../components/Icon";
import { api } from "../../../../lib/api";
import { apiErrorMessage } from "../../../../lib/swal";
import { toast } from "../../../../lib/toast";
import { openDialog } from "../../../../lib/dialog";
import { timeAgo } from "../../../../lib/time";
import { fullTime, type GroupsResponse, type Occurrence, type OccurrencesResponse } from "./errorLogModel";
import { MethodChip, ResolvedPill, SeverityPill } from "./GroupTable";

interface XecEntry { code: string; cause?: string; fix?: string }

export function ErrorDrawer({ groupKey, onClose }: { groupKey: string; onClose: () => void }) {
  const { t, i18n } = useTranslation("acp");
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[role=dialog]")) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => setOpenId(null), [groupKey]);

  // The group's own summary, wherever the list is paged or filtered.
  const summary = useQuery<GroupsResponse>({
    queryKey: ["acp-error-log", "group", groupKey],
    queryFn: () => api.get(`/admin/error-log/groups?key=${groupKey}&status=all&pageSize=1`),
  });
  const g = summary.data?.items[0];

  const occ = useInfiniteQuery<OccurrencesResponse>({
    queryKey: ["acp-error-log", "occurrences", groupKey],
    queryFn: ({ pageParam }) => api.get(`/admin/error-log/groups/${groupKey}/occurrences?limit=20${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = occ.data?.pages.flatMap((p) => p.items) ?? [];
  const total = occ.data?.pages[0]?.total ?? 0;

  // Plugin codes carry their own cause/fix; core codes live in the acp bundle.
  const { data: pluginCodes } = useQuery<XecEntry[]>({
    queryKey: ["admin-xec-codes"],
    queryFn: () => api.get<XecEntry[]>("/admin/xec-codes").catch(() => [] as XecEntry[]),
    staleTime: 300_000,
  });
  const plugin = g ? pluginCodes?.find((c) => c.code === g.code) : undefined;
  const cause = g ? plugin?.cause || t(`errorRef.codes.${g.code}.cause`, { defaultValue: "" }) : "";
  const fix = g ? plugin?.fix || t(`errorRef.codes.${g.code}.fix`, { defaultValue: "" }) : "";

  const invalidate = () => qc.invalidateQueries({ queryKey: ["acp-error-log"] });

  const resolveMut = useMutation({
    mutationFn: (resolved: boolean) => api.patch(`/admin/error-log/groups/${groupKey}`, { resolved }),
    onSuccess: (_d, resolved) => {
      void invalidate();
      toast.success(t(resolved ? "errorLog.toastResolved" : "errorLog.toastReopened", { code: g?.code }));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const deleteGroup = async () => {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("errorLog.deleteGroupTitle", { code: g?.code }),
      body: t("errorLog.deleteGroupBody", { count: g?.count ?? 0 }),
      confirmText: t("errorLog.deleteGroup"),
      cancelText: t("errorLog.cancel"),
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/error-log/groups/${groupKey}`);
      toast.success(t("errorLog.toastGroupDeleted", { code: g?.code }));
      onClose();
      void invalidate();
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  const deleteEntry = async (o: Occurrence) => {
    try {
      await api.delete(`/admin/error-log/${o.id}`);
      toast.success(t("errorLog.toastEntryDeleted"));
      // The last row takes the group with it.
      if (total <= 1) onClose();
      void invalidate();
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast.success(t("errorLog.toastCopied", { id }));
    } catch { toast.error(t("errorLog.copyFailed")); }
  };

  return (
    <aside className="el-drawer" aria-label={g?.message ?? t("errorLog.title")}>
      <div className="el-drawer__head">
        <div className="el-drawer__pills">
          {g && <SeverityPill severity={g.severity} />}
          {g && <span className="el-domain">{g.domain}</span>}
          {g?.resolved && <ResolvedPill />}
          <button type="button" className="el-close" onClick={onClose} aria-label={t("errorLog.close")}>
            <FontAwesomeIcon icon={faXmark} className="el-ic" />
          </button>
        </div>
        {g ? (
          <>
            <code className="el-code el-code--lg">{g.code}</code>
            <h2 className="el-drawer__title">{g.message}</h2>
            <div className="el-drawer__actions">
              {g.resolved ? (
                <button type="button" className="btn-ghost btn-sm" onClick={() => resolveMut.mutate(false)} disabled={resolveMut.isPending}>
                  <FontAwesomeIcon icon={faRotateLeft} className="el-ic" /> {t("errorLog.reopen")}
                </button>
              ) : (
                <button type="button" className="btn-primary btn-sm" onClick={() => resolveMut.mutate(true)} disabled={resolveMut.isPending}>
                  <FontAwesomeIcon icon={faCheck} className="el-ic" /> {t("errorLog.markResolved")}
                </button>
              )}
              <Link to={`/admin/error-ref?code=${encodeURIComponent(g.code)}`} className="btn-ghost btn-sm">
                <FontAwesomeIcon icon={faBookOpen} className="el-ic" /> {t("errorLog.reference")}
              </Link>
              <button type="button" className="btn-ghost btn-sm el-btn-danger el-drawer__delete" onClick={() => void deleteGroup()}>
                <FontAwesomeIcon icon={faTrash} className="el-ic" /> {t("errorLog.deleteGroup")}
              </button>
            </div>
          </>
        ) : (
          <p className="el-empty">{summary.isLoading ? t("errorLog.loading") : t("errorLog.groupGone")}</p>
        )}
      </div>

      {g && (
        <>
          <div className="el-stats">
            <div><span>{t("errorLog.col.count")}</span><strong>{g.count.toLocaleString(i18n.language)}</strong></div>
            <div><span>{t("errorLog.col.last")}</span><strong>{timeAgo(g.lastSeen)}</strong></div>
            <div><span>{t("errorLog.first")}</span><strong>{timeAgo(g.firstSeen)}</strong></div>
            <div><span>{t("errorLog.usersLabel")}</span><strong>{g.userCount}</strong></div>
          </div>

          <div className="el-ref">
            <span>{t("errorLog.cause")}</span><p>{cause || t("errorLog.noReference")}</p>
            {fix && <><span>{t("errorLog.fix")}</span><p>{fix}</p></>}
          </div>
        </>
      )}

      <div className="el-occ">
        <div className="el-occ__head">
          <h3>{t("errorLog.occurrences")}</h3>
          {total > 0 && <span>{t("errorLog.newestOf", { shown: rows.length, count: total })}</span>}
        </div>
        {rows.map((o) => {
          const open = openId === o.id;
          const who = o.username ?? (o.method === "JOB" ? t("errorLog.system") : o.userId ? o.userId.slice(0, 8) : t("errorLog.guest"));
          return (
            <div key={o.id} className={`el-occ__item${open ? " is-open" : ""}`}>
              <button type="button" className="el-occ__top" aria-expanded={open} onClick={() => setOpenId(open ? null : o.id)}>
                <MethodChip method={o.method} />
                <code className="el-url" title={o.url ?? ""}>{o.url ?? "—"}</code>
                <span className="el-occ__ago">{timeAgo(o.createdAt)}</span>
              </button>
              <div className="el-occ__meta">
                <span>{fullTime(o.createdAt, i18n.language)}</span>
                <span className="el-occ__who"><FontAwesomeIcon icon={faUser} className="el-ic" /> {who}</span>
                <span className="el-occ__tools">
                  {o.requestId && (
                    <button type="button" className="el-reqid" onClick={() => void copyId(o.requestId!)} title={t("errorLog.copyId")}>
                      #{o.requestId} <FontAwesomeIcon icon={faCopy} className="el-ic" />
                    </button>
                  )}
                  <button type="button" className="el-iconbtn" onClick={() => void deleteEntry(o)} aria-label={t("errorLog.deleteEntry")} title={t("errorLog.deleteEntry")}>
                    <FontAwesomeIcon icon={faTrash} className="el-ic" />
                  </button>
                </span>
              </div>
              {open && <pre className="el-occ__ctx">{o.context ? JSON.stringify(o.context, null, 2) : t("errorLog.noContext")}</pre>}
            </div>
          );
        })}
        {occ.hasNextPage && (
          <button type="button" className="el-link" onClick={() => void occ.fetchNextPage()} disabled={occ.isFetchingNextPage}>
            {t("errorLog.loadOlder")}
          </button>
        )}
      </div>
    </aside>
  );
}
