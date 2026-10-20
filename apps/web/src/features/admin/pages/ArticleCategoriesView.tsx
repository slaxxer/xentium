import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  faPlus, faPen, faTrashCan, faChevronDown, faChevronRight, faGripVertical, faFolder, faList,
} from "@fortawesome/free-solid-svg-icons";
import type { GroupAccessValue, GroupItem } from "@xentium/ui";
import { FontAwesomeIcon } from "../../../components/Icon";
import { Button } from "../../../components/AcpControls";
import { EditorDialog } from "../../../components/EditorDialog";
import { api } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { openDialog } from "../../../lib/dialog";
import { apiErrorMessage } from "../../../lib/swal";
import { AcpIcon } from "./acpIcons";

/**
 * ACP · Content · Articles → Categories: the category tree (it was its own page).
 *
 * Top-level categories reorder by dragging; a category holds sub-categories one
 * level down. Creating and editing use the ACP's editor dialog (Details, Access).
 * Each row says how many articles it holds and opens them in the Articles view.
 */

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  visibility: string;
  visibilityGroups: string[];
  visibilityMinLevel: number | null;
  hideIfNoAccess?: boolean;
  effectiveVisibility: string;
  children: CategoryNode[];
}

/** The tree as one list in display order, with each category's depth. */
export function flattenCategories(nodes: CategoryNode[], depth = 0): (CategoryNode & { depth: number })[] {
  return nodes.flatMap((n) => [{ ...n, depth }, ...flattenCategories(n.children, depth + 1)]);
}

function findNode(nodes: CategoryNode[], id: string): CategoryNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const child = findNode(n.children, id);
    if (child) return child;
  }
  return undefined;
}

type Editing = { category: CategoryNode | null; parentId: string | null };

export function ArticleCategoriesView({ tree, loading, counts, onShowArticles }: {
  tree: CategoryNode[];
  loading: boolean;
  counts: Record<string, number>;
  onShowArticles: (categoryId: string) => void;
}) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Editing | null>(null);
  // A ref for the drag source: read synchronously in the drop handler, never stale.
  const dragSrc = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["acp-categories"] });
    void qc.invalidateQueries({ queryKey: ["acp-articles-summary"] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/article-categories/${id}`),
    onSuccess: () => { toast.success(t("categories.toastDeleted")); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const reorder = useMutation({
    mutationFn: (items: { id: string; position: number }[]) => api.patch("/article-categories/reorder", { items }),
    onSuccess: refresh,
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function drop(targetId: string) {
    const src = dragSrc.current;
    dragSrc.current = null;
    setDragOver(null);
    if (!src || src === targetId) return;
    const from = tree.findIndex((n) => n.id === src);
    const to = tree.findIndex((n) => n.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...tree];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    reorder.mutate(next.map((n, i) => ({ id: n.id, position: i + 1 })));
  }

  async function askDelete(n: CategoryNode) {
    const held = counts[n.id] ?? 0;
    const ok = await openDialog({
      kind: "confirm", icon: "warning", danger: true,
      title: t("categories.deleteTitle"),
      body: [
        n.children.length > 0
          ? t("categories.deleteTextChildren", { name: n.name, count: n.children.length })
          : t("categories.deleteText", { name: n.name }),
        held > 0 ? t("categories.deleteArticles", { count: held }) : "",
      ].filter(Boolean).join(" "),
      confirmText: t("categories.delete"), cancelText: t("categories.cancel"),
    });
    if (ok) remove.mutate(n.id);
  }

  const row = (n: CategoryNode, depth: number) => (
    <CategoryRow key={n.id} n={n} depth={depth} count={counts[n.id] ?? 0} dragOver={dragOver === n.id}
      onEdit={() => setEditing({ category: n, parentId: n.parentId })}
      onAddChild={() => setEditing({ category: null, parentId: n.id })}
      onDelete={() => askDelete(n)}
      onShow={() => onShowArticles(n.id)}
      drag={depth === 0 ? {
        start: (e) => { e.dataTransfer.setData("text/plain", n.id); e.dataTransfer.effectAllowed = "move"; dragSrc.current = n.id; },
        over: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (n.id !== dragSrc.current) setDragOver(n.id); },
        leave: () => setDragOver(null),
        drop: (e) => { e.preventDefault(); drop(n.id); },
        end: () => { dragSrc.current = null; setDragOver(null); },
      } : undefined}
      renderChild={(c) => row(c, depth + 1)} />
  );

  return (
    <>
      <div className="arp-cat-bar">
        <p className="mlp-muted">
          {t("categories.uncategorisedNote", { count: counts["none"] ?? 0 })}
          {(counts["none"] ?? 0) > 0 && <> <button type="button" className="arp-link" onClick={() => onShowArticles("none")}>{t("categories.showThem")}</button></>}
        </p>
        <Button icon={faPlus} onClick={() => setEditing({ category: null, parentId: null })}>{t("categories.add")}</Button>
      </div>

      {loading ? (
        <p className="mlp-muted">{t("categories.loading")}</p>
      ) : tree.length === 0 ? (
        <div className="mlp-empty">
          <p>{t("categories.empty")}</p>
          <Button icon={faPlus} onClick={() => setEditing({ category: null, parentId: null })}>{t("categories.add")}</Button>
        </div>
      ) : (
        <section className="arp-list arp-cats" aria-label={t("categories.listLabel")}>
          {tree.map((n) => row(n, 0))}
        </section>
      )}

      {editing && (
        <CategoryDialog
          category={editing.category}
          parent={editing.parentId ? findNode(tree, editing.parentId) ?? null : null}
          count={editing.category ? counts[editing.category.id] ?? 0 : 0}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </>
  );
}

interface DragHandlers {
  start: (e: React.DragEvent) => void;
  over: (e: React.DragEvent) => void;
  leave: () => void;
  drop: (e: React.DragEvent) => void;
  end: () => void;
}

function CategoryRow({ n, depth, count, dragOver, drag, onEdit, onAddChild, onDelete, onShow, renderChild }: {
  n: CategoryNode; depth: number; count: number; dragOver: boolean; drag?: DragHandlers;
  onEdit: () => void; onAddChild: () => void; onDelete: () => void; onShow: () => void;
  renderChild: (c: CategoryNode) => React.ReactNode;
}) {
  const { t } = useTranslation("acp");
  const [open, setOpen] = useState(true);
  const inherited = n.effectiveVisibility !== n.visibility;
  const vis = t(`categories.vis.${n.effectiveVisibility}`, { defaultValue: n.effectiveVisibility });

  return (
    <>
      <div className={`arp-cat${dragOver ? " is-over" : ""}`} style={{ ["--arp-depth" as string]: depth }}
        draggable={!!drag} onDragStart={drag?.start} onDragOver={drag?.over} onDragLeave={drag?.leave} onDrop={drag?.drop} onDragEnd={drag?.end}>
        {drag
          ? <span className="arp-cat__grip" title={t("categories.dragTitle")}><FontAwesomeIcon icon={faGripVertical} /></span>
          : <span className="arp-cat__grip" aria-hidden="true" />}
        <button type="button" className="arp-cat__toggle" style={{ visibility: n.children.length ? "visible" : "hidden" }}
          aria-expanded={open} aria-label={n.name} onClick={() => setOpen((o) => !o)}>
          <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} />
        </button>
        <span className="arp-thumb arp-thumb--sm" aria-hidden="true"><FontAwesomeIcon icon={faFolder} /></span>
        <div className="arp-cat__text">
          <b>{n.name}</b>
          {n.description && <span>{n.description}</span>}
        </div>
        <span className={`arp-pill arp-vis--${n.effectiveVisibility}`}>{inherited ? t("categories.inherited", { label: vis }) : vis}</span>
        <button type="button" className="arp-cat__count" onClick={onShow} title={t("categories.showArticles")}>
          {t("categories.articles", { count })}
        </button>
        <div className="arp-actions">
          <button type="button" className="arp-ic" onClick={onShow} title={t("categories.showArticles")} aria-label={t("categories.showArticles")}><FontAwesomeIcon icon={faList} /></button>
          {depth === 0 && (
            <button type="button" className="arp-ic" onClick={onAddChild} title={t("categories.addSubTitle")} aria-label={t("categories.addSubTitle")}><FontAwesomeIcon icon={faPlus} /></button>
          )}
          <button type="button" className="arp-ic" onClick={onEdit} title={t("categories.edit")} aria-label={t("categories.edit")}><FontAwesomeIcon icon={faPen} /></button>
          <button type="button" className="arp-ic arp-ic--danger" onClick={onDelete} title={t("categories.delete")} aria-label={t("categories.delete")}><FontAwesomeIcon icon={faTrashCan} /></button>
        </div>
      </div>
      {open && n.children.map(renderChild)}
    </>
  );
}

type Tab = "details" | "access";

function CategoryDialog({ category, parent, count, onClose, onSaved }: {
  category: CategoryNode | null;
  parent: CategoryNode | null;
  count: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation("acp");
  const isEdit = !!category;
  const [tab, setTab] = useState<Tab>("details");
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [access, setAccess] = useState<GroupAccessValue>({
    visibility: (category?.visibility ?? "public") as GroupAccessValue["visibility"],
    visibilityGroups: category?.visibilityGroups ?? [],
    visibilityMinLevel: category?.visibilityMinLevel ?? null,
    hideIfNoAccess: category?.hideIfNoAccess ?? true,
  });
  const groups = useQuery<GroupItem[]>({ queryKey: ["acp-groups-list"], queryFn: () => api.get("/admin/groups") });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim(),
        visibility: access.visibility,
        visibilityGroups: access.visibilityGroups,
        visibilityMinLevel: access.visibilityMinLevel,
        hideIfNoAccess: access.hideIfNoAccess,
        parentId: category ? category.parentId : parent?.id ?? null,
      };
      return category ? api.patch(`/article-categories/${category.id}`, body) : api.post("/article-categories", body);
    },
    onSuccess: () => { toast.success(t(isEdit ? "categories.toastUpdated" : "categories.toastCreated")); onSaved(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const restricted = access.visibility !== "public";

  return (
    <EditorDialog
      mark={<span className="arp-mark" aria-hidden="true"><FontAwesomeIcon icon={faFolder} /></span>}
      name={name || t("categories.namePreview")}
      nameEmpty={!name}
      sub={parent ? t("categories.under", { name: parent.name }) : t("categories.topLevel")}
      tabs={[
        { id: "details", label: t("categories.tab.details"), icon: <AcpIcon name="sliders" size={16} /> },
        { id: "access", label: t("categories.tab.access"), icon: <AcpIcon name="shield" size={16} />, mark: restricted ? t("categories.restricted") : undefined },
      ]}
      tab={tab}
      onTab={(id) => setTab(id as Tab)}
      railNote={isEdit ? t("categories.railCount", { count }) : t("categories.railNew")}
      title={t(`categories.pane.${tab}`)}
      description={t(`categories.paneNote.${tab}`)}
      onClose={onClose}
      closeLabel={t("categories.close")}
      footNote={t(isEdit ? "categories.footEdit" : "categories.footNew")}
      actions={<>
        <Button variant="ghost" onClick={onClose}>{t("categories.cancel")}</Button>
        <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          {t(isEdit ? "categories.save" : "categories.create")}
        </Button>
      </>}
    >
      {tab === "details" ? (
        <div className="set-rows xed-rows">
          <div className="set-row">
            <div>
              <div className="set-row__label">{t("categories.name")}</div>
              <div className="set-row__desc">{t("categories.nameDesc")}</div>
            </div>
            <div className="set-row__control">
              <input className="inp" value={name} maxLength={120} autoFocus placeholder={t("categories.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <div className="set-row">
            <div>
              <div className="set-row__label">{t("categories.descLabel")}</div>
              <div className="set-row__desc">{t("categories.descDesc")}</div>
            </div>
            <div className="set-row__control">
              <textarea className="inp" rows={3} value={description} maxLength={500} placeholder={t("categories.descPlaceholder")} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
        </div>
      ) : (
        <AccessSection value={access} onChange={setAccess} groups={groups.data ?? []} />
      )}
    </EditorDialog>
  );
}

/**
 * Who can see a category: the forum categories' access picker, the same three
 * choices and the same group list. `level` (a progression minimum) is no longer
 * offered; a category that still has it shows it, so it never looks unset.
 */
function AccessSection({ value, onChange, groups }: {
  value: GroupAccessValue;
  onChange: (v: GroupAccessValue) => void;
  groups: GroupItem[];
}) {
  const { t } = useTranslation("acp");
  const modes = ["public", "members", "groups", ...(value.visibility === "level" ? ["level"] : [])] as GroupAccessValue["visibility"][];
  const pick = (visibility: GroupAccessValue["visibility"]) =>
    onChange({ ...value, visibility, visibilityGroups: visibility === "groups" ? value.visibilityGroups : [], visibilityMinLevel: visibility === "level" ? value.visibilityMinLevel : null });
  const toggle = (id: string) => onChange({
    ...value,
    visibilityGroups: value.visibilityGroups.includes(id) ? value.visibilityGroups.filter((g) => g !== id) : [...value.visibilityGroups, id],
  });

  return (
    <div className="arp-access">
      <div className="arp-access__modes" role="radiogroup" aria-label={t("categories.pane.access")}>
        {modes.map((m) => (
          <label key={m} className={`arp-access__mode${value.visibility === m ? " is-on" : ""}`}>
            <input type="radio" name="category-access" checked={value.visibility === m} onChange={() => pick(m)} />
            <span>
              <b>{t(`categories.accessMode.${m}`)}</b>
              <small>{t(`categories.accessMode.${m}Desc`)}</small>
            </span>
          </label>
        ))}
      </div>
      {value.visibility === "groups" && (
        <div className="arp-access__groups">
          <div className="mlp-caps">{t("categories.groupsWithAccess")}</div>
          {groups.length === 0 ? (
            <p className="mlp-muted">{t("categories.noGroups")}</p>
          ) : (
            <div className="arp-access__list">
              {groups.map((g) => {
                const on = value.visibilityGroups.includes(g.id);
                return (
                  <label key={g.id} className={on ? "is-on" : ""}>
                    <input type="checkbox" checked={on} onChange={() => toggle(g.id)} />
                    <span>{g.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
