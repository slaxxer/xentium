import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { faMagnifyingGlass, faUserMinus, faUserPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../../components/Icon";
import { UserAvatar } from "../../../../components/UserAvatar";
import { api } from "../../../../lib/api";
import { openDialog } from "../../../../lib/dialog";
import { apiErrorMessage } from "../../../../lib/swal";
import { toast } from "../../../../lib/toast";
import type { Group } from "./groupModel";
import { Username } from "../../../../components/Username";

interface MemberRow {
  id: string;
  username: string;
  avatar: string | null;
  createdAt: string;
  groups: Array<{ id: string }>;
}
interface Page { data: MemberRow[]; meta: { total: number; page: number; totalPages: number } }

const PAGE = 25;

// A user can hold several groups, and `PUT /admin/users/:id/groups` REPLACES the
// whole set — so adding or removing one membership always sends the others too.

export function MembersTab({ group, color }: { group: Group; color: string }) {
  const { t, i18n } = useTranslation("acp");
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery<Page>({
    queryKey: ["group-members", group.id, page],
    queryFn:  () => api.get(`/admin/users?groupId=${encodeURIComponent(group.id)}&limit=${PAGE}&page=${page}`),
  });
  const needle = q.trim();
  const { data: found } = useQuery<Page>({
    queryKey: ["group-member-search", needle],
    queryFn:  () => api.get(`/admin/users?search=${encodeURIComponent(needle)}&limit=8`),
    enabled:  adding && needle.length >= 2,
  });

  const setGroups = useMutation({
    mutationFn: ({ user, groupIds }: { user: MemberRow; groupIds: string[] }) => api.put(`/admin/users/${user.id}/groups`, { groupIds }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["group-members", group.id] });
      void qc.invalidateQueries({ queryKey: ["group-member-search"] });
      void qc.invalidateQueries({ queryKey: ["acp-groups-list"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const add = (user: MemberRow) => setGroups.mutate(
    { user, groupIds: [...new Set([...user.groups.map((g) => g.id), group.id])] },
    { onSuccess: () => toast.success(t("groups.members.added", { user: user.username, group: group.name })) },
  );
  const remove = async (user: MemberRow) => {
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("groups.members.removeTitle", { user: user.username }),
      body: t("groups.members.removeBody", { group: group.name }),
      confirmText: t("groups.members.remove"), cancelText: t("groups.cancel"),
    });
    if (!ok) return;
    setGroups.mutate(
      { user, groupIds: user.groups.map((g) => g.id).filter((id) => id !== group.id) },
      { onSuccess: () => toast.success(t("groups.members.removed", { user: user.username, group: group.name })) },
    );
  };

  const total = data?.meta.total ?? group._count.users;
  const joined = (d: string) => new Date(d).toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" });

  return (
    <section className="gp-card">
      <div className="gp-perm-head">
        <div>
          <h2 className="gp-section">{t("groups.members.title")}</h2>
          <p className="gp-hint">{t("groups.members.summary", { count: total })}</p>
        </div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => { setAdding(!adding); setQ(""); }}>
          <FontAwesomeIcon icon={adding ? faXmark : faUserPlus} /> {adding ? t("groups.cancel") : t("groups.members.add")}
        </button>
      </div>

      {adding && (
        <div className="gp-add">
          <label className="gp-filter gp-filter--wide">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("groups.members.search")} aria-label={t("groups.members.search")} />
          </label>
          {needle.length >= 2 && (
            <div className="gp-add__results">
              {(found?.data ?? []).length === 0 && <div className="gp-hint">{t("groups.members.noResults")}</div>}
              {(found?.data ?? []).map((u) => {
                const member = u.groups.some((g) => g.id === group.id);
                return (
                  <div key={u.id} className="gp-member gp-member--compact">
                    <UserAvatar user={u} size={28} />
                    <span className="gp-member__name">{u.username}</span>
                    <button type="button" className="btn-ghost btn-sm" disabled={member || setGroups.isPending} onClick={() => add(u)}>
                      {member ? t("groups.members.already") : t("groups.members.addOne")}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="gp-empty">{t("groups.loading")}</div>
      ) : (data?.data ?? []).length === 0 ? (
        <div className="gp-empty">{t("groups.members.empty")}</div>
      ) : (
        <div className="gp-members-list">
          {data!.data.map((u) => (
            <div key={u.id} className="gp-member">
              <UserAvatar user={u} size={34} />
              <div className="gp-member__main">
                <Username className="gp-member__name" username={u.username} badgeColor={color} />
                <span className="gp-hint">{t("groups.members.joined", { date: joined(u.createdAt) })}</span>
              </div>
              <Link to={`/admin/users/${u.id}`} className="btn-ghost btn-sm">{t("groups.members.open")}</Link>
              <button type="button" className="btn-ghost btn-sm gp-danger-text" disabled={setGroups.isPending}
                onClick={() => void remove(u)} aria-label={t("groups.members.removeTitle", { user: u.username })}>
                <FontAwesomeIcon icon={faUserMinus} />
              </button>
            </div>
          ))}
        </div>
      )}

      {(data?.meta.totalPages ?? 1) > 1 && (
        <div className="gp-pager">
          <button type="button" className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("groups.members.prev")}</button>
          <span className="gp-hint">{t("groups.members.pageOf", { page, pages: data!.meta.totalPages })}</span>
          <button type="button" className="btn-ghost btn-sm" disabled={page >= data!.meta.totalPages} onClick={() => setPage(page + 1)}>{t("groups.members.next")}</button>
        </div>
      )}
    </section>
  );
}
