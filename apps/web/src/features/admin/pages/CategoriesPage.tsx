import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus, faPencil, faTrash, faChevronDown, faChevronRight, faGripVertical,
} from "@fortawesome/free-solid-svg-icons";
import { GroupAccessPicker } from "@nodevo/ui";
import type { GroupAccessValue, GroupItem } from "@nodevo/ui";

interface CategoryInput {
  name: string;
  description: string | null;
  visibility: string;
  visibilityGroups: string[];
  visibilityMinLevel: number | null;
  hideIfNoAccess: boolean;
  parentId: string | null;
}

interface CategoryNode {
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

function toAccessValue(node: Partial<CategoryNode>): GroupAccessValue {
  return {
    visibility: (node.visibility ?? "public") as GroupAccessValue["visibility"],
    visibilityGroups: node.visibilityGroups ?? [],
    visibilityMinLevel: node.visibilityMinLevel ?? null,
    hideIfNoAccess: node.hideIfNoAccess ?? true,
  };
}

function findNode(nodes: CategoryNode[], id: string): CategoryNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const child = findNode(n.children, id);
    if (child) return child;
  }
  return undefined;
}

function CategoryModal({
  category,
  parentId,
  parentEffectiveVisibility,
  allGroups,
  onClose,
  onSave,
}: {
  category: Partial<CategoryNode> | null;
  parentId?: string | null;
  parentEffectiveVisibility?: string | null;
  allGroups: GroupItem[];
  onClose: () => void;
  onSave: (data: CategoryInput) => void;
}) {
  const isNew = !category?.id;
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [access, setAccess] = useState<GroupAccessValue>(
    isNew
      ? { visibility: "public", visibilityGroups: [], visibilityMinLevel: null, hideIfNoAccess: true }
      : toAccessValue(category!),
  );

  const inheritedWarning =
    parentEffectiveVisibility && parentEffectiveVisibility !== "public"
      ? parentEffectiveVisibility
      : null;

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div
        className="acp-modal"
        style={{ maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: "1.5rem", fontSize: "1.1rem" }}>
          {isNew ? (parentId ? "Add Subcategory" : "Add Category") : `Edit: ${category?.name}`}
        </h2>

        <div className="acp-form-field">
          <label className="acp-label">Name</label>
          <input
            className="acp-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Category name"
            autoFocus
          />
        </div>

        <div className="acp-form-field">
          <label className="acp-label">Description (optional)</label>
          <input
            className="acp-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description"
          />
        </div>

        <div className="acp-form-field">
          <label className="acp-label">Access Control</label>
          <GroupAccessPicker
            value={access}
            onChange={setAccess}
            groups={allGroups}
            inheritedRestriction={inheritedWarning}
          />
        </div>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!name.trim()}
            onClick={() =>
              onSave({
                name: name.trim(),
                description: description.trim() || null,
                visibility: access.visibility,
                visibilityGroups: access.visibilityGroups,
                visibilityMinLevel: access.visibilityMinLevel,
                hideIfNoAccess: access.hideIfNoAccess,
                parentId: isNew ? (parentId ?? null) : (category?.parentId ?? null),
              })
            }
          >
            {isNew ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const VISIBILITY_LABEL: Record<string, string> = {
  public: "Public",
  members: "Members",
  level: "Level N+",
  groups: "Groups",
};

const VISIBILITY_BADGE: Record<string, string> = {
  public: "acp-badge--success",
  members: "acp-badge--neutral",
  level: "acp-badge--warn",
  groups: "acp-badge--warn",
};

function TreeNode({
  node,
  depth = 0,
  isDragOver,
  onEdit,
  onDelete,
  onAddChild,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  node: CategoryNode;
  depth?: number;
  isDragOver?: boolean;
  onEdit: (n: CategoryNode) => void;
  onDelete: (n: CategoryNode) => void;
  onAddChild: (parentId: string) => void;
  onDragStart?: (e: React.DragEvent, id: string) => void;
  onDragOver?: (e: React.DragEvent, id: string) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent, id: string) => void;
  onDragEnd?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const effectiveBadge = VISIBILITY_BADGE[node.effectiveVisibility] ?? "acp-badge--muted";
  const ownLabel = VISIBILITY_LABEL[node.visibility] ?? node.visibility;
  const effectiveLabel = VISIBILITY_LABEL[node.effectiveVisibility] ?? node.effectiveVisibility;
  const isInherited = node.effectiveVisibility !== node.visibility;

  const canDrag = depth === 0 && !!onDragStart;

  return (
    <div
      className="acp-tree-node"
      draggable={canDrag}
      onDragStart={canDrag ? (e) => onDragStart!(e, node.id) : undefined}
      onDragOver={canDrag ? (e) => { e.preventDefault(); onDragOver!(e, node.id); } : undefined}
      onDragLeave={canDrag ? onDragLeave : undefined}
      onDrop={canDrag ? (e) => onDrop!(e, node.id) : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      style={{ opacity: isDragOver ? 0.55 : 1, transition: "opacity 0.15s" }}
    >
      <div
        className="acp-tree-row"
        style={{
          paddingLeft: `${depth * 1.5 + 0.75}rem`,
          borderColor: isDragOver ? "var(--c-accent)" : undefined,
        }}
      >
        {/* Drag handle — only root nodes */}
        {canDrag ? (
          <span
            style={{
              cursor: "grab", color: "var(--c-fg-muted)", fontSize: 13,
              marginRight: 4, flexShrink: 0,
            }}
            title="Drag to reorder"
          >
            <FontAwesomeIcon icon={faGripVertical} />
          </span>
        ) : (
          <span style={{ width: 20, flexShrink: 0 }} />
        )}

        <button
          type="button"
          className="acp-tree-expand"
          onClick={() => setExpanded((e) => !e)}
          style={{ visibility: hasChildren ? "visible" : "hidden" }}
        >
          <FontAwesomeIcon icon={expanded ? faChevronDown : faChevronRight} />
        </button>

        <span className="acp-tree-name">{node.name}</span>

        <span className={`acp-badge ${effectiveBadge}`} style={{ marginTop: 0, marginLeft: 6, fontSize: 10 }}>
          {isInherited ? `${effectiveLabel} (inherited)` : ownLabel}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: "0.4rem" }}>
          {depth === 0 && (
            <button type="button" className="btn-ghost btn-sm" title="Add subcategory" onClick={() => onAddChild(node.id)}>
              <FontAwesomeIcon icon={faPlus} />
            </button>
          )}
          <button type="button" className="btn-ghost btn-sm" onClick={() => onEdit(node)}>
            <FontAwesomeIcon icon={faPencil} />
          </button>
          <button type="button" className="btn-danger btn-sm" onClick={() => onDelete(node)}>
            <FontAwesomeIcon icon={faTrash} />
          </button>
        </div>
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CategoriesPage() {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<{
    mode: "create" | "edit";
    category?: CategoryNode;
    parentId?: string | null;
    parentEffectiveVisibility?: string | null;
  } | null>(null);

  // useRef for drag source — synchronous, never stale in event closures
  const dragSrcRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const { data: tree = [], isLoading } = useQuery<CategoryNode[]>({
    queryKey: ["acp-categories"],
    queryFn: () => api.get("/article-categories"),
  });

  const { data: groups = [] } = useQuery<GroupItem[]>({
    queryKey: ["acp-groups-list"],
    queryFn: () => api.get<GroupItem[]>("/admin/groups"),
  });

  const createMutation = useMutation({
    mutationFn: (data: Omit<CategoryInput, "parentId"> & { parentId?: string | null }) =>
      api.post("/article-categories", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acp-categories"] });
      swalToast("Category created!", "success");
      setModal(null);
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CategoryInput> }) =>
      api.patch(`/article-categories/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acp-categories"] });
      swalToast("Category updated!", "success");
      setModal(null);
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/article-categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acp-categories"] });
      swalToast("Category deleted!", "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const reorderMutation = useMutation({
    mutationFn: (items: Array<{ id: string; position: number }>) =>
      api.patch("/article-categories/reorder", { items }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["acp-categories"] }),
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  function handleDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData("text/plain", id);  // required for Firefox
    e.dataTransfer.effectAllowed = "move";
    dragSrcRef.current = id;                    // synchronous — never stale
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragSrcRef.current) setDragOverId(id);
  }

  function handleDragLeave() {
    setDragOverId(null);
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    const src = dragSrcRef.current;
    if (!src || src === targetId) { handleDragEnd(); return; }

    const rootNodes = tree as CategoryNode[];
    const fromIdx = rootNodes.findIndex(n => n.id === src);
    const toIdx   = rootNodes.findIndex(n => n.id === targetId);
    if (fromIdx === -1 || toIdx === -1) { handleDragEnd(); return; }

    const reordered = [...rootNodes];
    const [moved] = reordered.splice(fromIdx, 1);
    if (!moved) { handleDragEnd(); return; }
    reordered.splice(toIdx, 0, moved);

    reorderMutation.mutate(
      reordered.map((n, i) => ({ id: n.id, position: i + 1, parentId: n.parentId ?? null })),
    );
    handleDragEnd();
  }

  function handleDragEnd() {
    dragSrcRef.current = null;
    setDragOverId(null);
  }

  async function handleDelete(node: CategoryNode) {
    const result = await swalConfirm(
      "Delete category?",
      node.children.length > 0
        ? `"${node.name}" has ${node.children.length} subcategory(ies). They will be moved up one level.`
        : `"${node.name}" will be permanently deleted.`,
      "Delete",
      "Cancel",
    );
    if (result) deleteMutation.mutate(node.id);
  }

  function handleSave(data: CategoryInput) {
    if (modal?.mode === "create") {
      createMutation.mutate(data);
    } else if (modal?.mode === "edit" && modal.category) {
      updateMutation.mutate({ id: modal.category.id, data });
    }
  }

  function openEditModal(n: CategoryNode) {
    const parentNode = n.parentId
      ? findNode(tree as CategoryNode[], n.parentId)
      : null;
    setModal({
      mode: "edit",
      category: n,
      parentEffectiveVisibility: parentNode?.effectiveVisibility ?? null,
    });
  }

  function openAddChildModal(parentId: string) {
    const parentNode = findNode(tree as CategoryNode[], parentId);
    setModal({
      mode: "create",
      parentId,
      parentEffectiveVisibility: parentNode?.effectiveVisibility ?? null,
    });
  }

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">Content</div>
          <h1 className="acp-page-title">Article Categories</h1>
        </div>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => setModal({ mode: "create", parentId: null })}
        >
          <FontAwesomeIcon icon={faPlus} /> Add Category
        </button>
      </div>

      <div className="acp-card">
        {isLoading ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--c-fg-muted)" }}>Loading…</div>
        ) : (tree as CategoryNode[]).length === 0 ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--c-fg-muted)" }}>
            No categories yet. Create one to get started.
          </div>
        ) : (
          <div className="acp-tree">
            {(tree as CategoryNode[]).map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                isDragOver={dragOverId === node.id}
                onEdit={openEditModal}
                onDelete={handleDelete}
                onAddChild={openAddChildModal}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>
        )}
      </div>

      {modal && (
        <CategoryModal
          category={modal.mode === "edit" ? modal.category! : null}
          parentId={modal.parentId}
          parentEffectiveVisibility={modal.parentEffectiveVisibility}
          allGroups={groups as GroupItem[]}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
