import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { faArrowLeft, faLock } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../../components/Icon";
import { SaveChip } from "../../../../components/SaveChip";
import { useAnySaving, useAutosave } from "../../../../hooks/useAutosave";
import { api } from "../../../../lib/api";
import { apiErrorMessage } from "../../../../lib/swal";
import { toast } from "../../../../lib/toast";
import type { Permission } from "../../../../lib/permissions";
import { slotRegistry } from "../../../../plugins/slotRegistry";
import { BadgePill } from "../GroupsPage";
import { DEFAULT_BADGE_COLOR, editableProgression, isHexColor, keysOf, type Group, type ProgressionData } from "./groupModel";
import { GroupGlyph } from "./groupParts";
import { IdentityTab } from "./IdentityTab";
import { PermissionsTab } from "./PermissionsTab";
import { ProgressionTab } from "./ProgressionTab";
import { MembersTab } from "./MembersTab";
import { PluginPanelTab } from "./PluginPanelTab";
import "../acpSystem.scss";
import "./Groups.scss";

// One group, every setting it has, on one page — replacing the four modals the
// list used to open. Identity, permissions and progression AUTOSAVE (the ACP
// convention); the icon, members and deleting the group are explicit actions.
// A plugin's groupConfigPanel is a tab of its own and reports its saves into
// the same indicator, so the page has one answer to "is everything saved".

export type GroupForm = { name: string; showInTeam: boolean };

const CORE_TABS = ["identity", "permissions", "progression"] as const;

export function GroupDetailPage() {
  const { id = "" } = useParams();
  // One mount per group: the drafts below are seeded once, and must not carry
  // one group's edits onto the next.
  return <GroupDetail key={id} id={id} />;
}

function GroupDetail({ id }: { id: string }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const panels = useMemo(
    () => [...slotRegistry.getGroupConfigPanels()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
    [],
  );
  const tabs = [...CORE_TABS, ...panels.map((p) => `plugin:${p.id}`), "members"];
  const tab = tabs.includes(params.get("tab") ?? "") ? params.get("tab")! : "identity";
  const setTab = (next: string) => setParams(next === "identity" ? {} : { tab: next }, { replace: true });

  const { data: groups, isLoading: groupsLoading } = useQuery<Group[]>({
    queryKey: ["acp-groups-list"],
    queryFn:  () => api.get("/admin/groups"),
  });
  const { data: allPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["acp-permissions-all"],
    queryFn:  () => api.get("/admin/permissions"),
  });
  const { data: progression } = useQuery<ProgressionData>({
    queryKey: ["group-progression", id],
    queryFn:  async () => editableProgression(await api.get(`/admin/progression/${id}`)),
    enabled:  !!id,
  });

  const rank = groups ? groups.findIndex((g) => g.id === id) : -1;
  const group = rank >= 0 ? groups![rank]! : null;

  // ── Drafts, each autosaved to the endpoint that owns it ────────────────────
  const savedForm = useMemo<GroupForm | undefined>(
    () => group ? { name: group.name, showInTeam: group.showInTeam } : undefined, [group]);
  const [form, setForm] = useState<GroupForm | null>(null);
  const [prog, setProg] = useState<ProgressionData | null>(null);

  // Seed each draft once, from the first server copy.
  useEffect(() => { if (savedForm && !form) setForm(savedForm); }, [savedForm, form]);
  useEffect(() => { if (progression && !prog) setProg(progression); }, [progression, prog]);

  const invalidateList = () => qc.invalidateQueries({ queryKey: ["acp-groups-list"] });

  const saveGroup = useMutation({
    mutationFn: (v: GroupForm) => api.patch(`/admin/groups/${id}`, { name: v.name.trim(), showInTeam: v.showInTeam }),
    onSuccess: invalidateList,
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const saveProg = useMutation({
    mutationFn: (v: ProgressionData) => api.patch(`/admin/progression/${id}`, v) as Promise<Record<string, unknown>>,
    onSuccess: (fresh) => {
      if (fresh) qc.setQueryData(["group-progression", id], editableProgression(fresh));
      void invalidateList();
      void qc.invalidateQueries({ queryKey: ["acp-progression"] });
      // The colour + glow every <Username> reads (BadgeShadowSync) and the footer legend:
      // without this a changed glow only showed after a reload or five minutes.
      void qc.invalidateQueries({ queryKey: ["legend-groups"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  // Permissions are NOT a draft. Each change is sent as grant/revoke of just
  // those keys: replacing the whole set from a copy taken when the page opened
  // silently revoked whatever had been granted since (it lost a real grant while
  // this page was built). The cache is updated first so the counts respond at
  // once; the refetch afterwards is the truth. One scope, so a quick
  // on-off-on reaches the server in the order it was clicked.
  const savePerms = useMutation({
    scope: { id: `group-perms-${id}` },
    mutationFn: (d: { grant: string[]; revoke: string[] }) => api.patch(`/admin/groups/${id}/permissions`, d),
    onMutate: async (d) => {
      // A refetch already in flight would land after this and undo it on screen.
      await qc.cancelQueries({ queryKey: ["acp-groups-list"] });
      qc.setQueryData<Group[]>(["acp-groups-list"], (list) => list?.map((g) => {
        if (g.id !== id) return g;
        const revoke = new Set(d.revoke);
        const kept = g.permissions.filter((gp) => !revoke.has(gp.permission.key));
        const have = new Set(kept.map((gp) => gp.permission.key));
        const added = allPermissions.filter((p) => d.grant.includes(p.key) && !have.has(p.key) && !revoke.has(p.key));
        return { ...g, permissions: [...kept, ...added.map((permission) => ({ permission }))] };
      }));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
    onSettled: invalidateList,
  });

  // A name under two characters, or a half-typed colour, is a draft the server
  // would refuse: hold it back until it is valid instead of toasting on every key.
  const formValid = !!form && form.name.trim().length >= 2;
  const progValid = !!prog && (!prog.badgeColor || isHexColor(prog.badgeColor))
    && (!prog.badgeShadowColor || isHexColor(prog.badgeShadowColor));

  useAutosave({ value: form, savedValue: formValid ? savedForm : undefined, onSave: (v) => v && formValid && saveGroup.mutate(v) });
  useAutosave({ value: prog, savedValue: progValid ? progression : undefined, onSave: (v) => v && progValid && saveProg.mutate(v) });

  const pluginSaving = useAnySaving();
  const saving = saveGroup.isPending || saveProg.isPending || savePerms.isPending || pluginSaving;

  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/groups/${id}`),
    onSuccess: () => {
      toast.success(t("groups.delete.done", { name: group?.name ?? "" }));
      void invalidateList();
      navigate("/admin/groups");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (!groupsLoading && !group) {
    return (
      <div className="gp-page">
        <Link to="/admin/groups" className="gp-crumb"><FontAwesomeIcon icon={faArrowLeft} /> {t("nav.groups")}</Link>
        <div className="acp-card acp-empty">{t("groups.detail.notFound")}</div>
      </div>
    );
  }
  if (!group || !form || !prog) {
    return <div className="gp-page"><div className="acp-card acp-empty">{t("groups.loading")}</div></div>;
  }

  const color = prog.badgeColor && isHexColor(prog.badgeColor) ? prog.badgeColor : DEFAULT_BADGE_COLOR;
  const keys = keysOf(group);

  return (
    <div className="gp-page">
      <nav className="gp-crumb">
        <Link to="/admin/groups"><FontAwesomeIcon icon={faArrowLeft} /> {t("nav.groups")}</Link>
        <span>/</span>
        <span className="gp-crumb__here">{form.name || group.name}</span>
      </nav>

      <header className="gp-card gp-detail-head">
        <div className="gp-detail-head__top">
          <GroupGlyph color={color} size="lg" />
          <div className="gp-detail-head__titles">
            <div className="gp-detail-head__line">
              <h1>{form.name || group.name}</h1>
              <BadgePill color={color} label={prog.badgeLabel || form.name || group.name} />
              {group.isSystem && <span className="gp-protected"><FontAwesomeIcon icon={faLock} /> {t("groups.protected")}</span>}
            </div>
            <div className="gp-detail-head__meta">
              <code>{group.key}</code>
              <span>{t("groups.memberCount", { count: group._count.users })}</span>
              <span>{t("groups.permCount", { count: keys.length })}</span>
              <span>{t("groups.detail.precedence", { n: rank + 1 })}</span>
            </div>
          </div>
          <SaveChip saving={saving} />
        </div>
        <div className="gp-tabs" role="tablist">
          {tabs.map((id) => {
            const panel = id.startsWith("plugin:") ? panels.find((p) => `plugin:${p.id}` === id) : null;
            return (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>
                {panel ? panel.label : t(`groups.tabs.${id}`)}
                {panel && <span className="gp-plugin-chip">{t("groups.tabs.plugin")}</span>}
              </button>
            );
          })}
        </div>
      </header>

      {tab === "identity" && (
        <IdentityTab
          group={group} rank={rank + 1} form={form} setForm={setForm} prog={prog} setProg={setProg}
          nameInvalid={!formValid}
          onDelete={() => remove.mutate()} deleting={remove.isPending}
        />
      )}
      {tab === "permissions" && <PermissionsTab allPermissions={allPermissions} keys={keys} onChange={(d) => savePerms.mutate(d)} />}
      {tab === "progression" && <ProgressionTab prog={prog} setProg={setProg} panels={panels} onOpenPanel={(pid) => setTab(`plugin:${pid}`)} />}
      {tab.startsWith("plugin:") && (() => {
        const panel = panels.find((p) => `plugin:${p.id}` === tab)!;
        return <PluginPanelTab key={panel.id} panel={panel} group={group} onLadder={prog.isProgressionGroup} onOpenProgression={() => setTab("progression")} />;
      })()}
      {tab === "members" && <MembersTab group={group} color={color} />}
    </div>
  );
}
