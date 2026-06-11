import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUpload, faCheck, faTrash, faBolt } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";

interface StylePack {
  id:          string;
  name:        string;
  vendor:      string;
  version:     string;
  isActive:    boolean;
  installedAt: string;
}

function reloadTokenStyle() {
  // Bust the browser HTTP cache (see StyleEditorPage) so an activated/deleted pack
  // applies instantly instead of after the 60s max-age window.
  fetch(`/api/appearance/css?t=${Date.now()}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.text() : ""))
    .then((css) => {
      let el = document.getElementById("nodevo-custom-tokens") as HTMLStyleElement | null;
      if (!el) { el = document.createElement("style"); el.id = "nodevo-custom-tokens"; document.head.appendChild(el); }
      el.textContent = css;
    }).catch(() => {});
}

export function StylesPage() {
  const { t } = useTranslation("acp");
  const qc      = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: packs = [], isLoading } = useQuery<StylePack[]>({
    queryKey: ["acp-style-packs"],
    queryFn:  () => api.get("/appearance/style-packs"),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post("/appearance/style-packs", fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-style-packs"] });
      swalToast(t("styles.toastInstalled"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => api.post(`/appearance/style-packs/${id}/activate`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-style-packs"] });
      qc.invalidateQueries({ queryKey: ["acp-tokens"] });
      reloadTokenStyle();
      swalToast(t("styles.toastActivated"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/appearance/style-packs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-style-packs"] });
      swalToast(t("styles.toastRemoved"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".nvstyle") && !file.name.endsWith(".zip")) {
      swalToast(t("styles.invalidFile"), "error");
      return;
    }
    uploadMut.mutate(file);
    e.target.value = "";
  };

  const handleDelete = async (pack: StylePack) => {
    const ok = await swalConfirm(
      t("styles.removeConfirmTitle", { name: pack.name }),
      pack.isActive ? t("styles.removeActiveBody") : t("styles.removeBody"),
      t("styles.removeBtn"),
    );
    if (ok) deleteMut.mutate(pack.id);
  };

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("styles.sub")}</div>
          <h1 className="acp-page-title">{t("styles.title")}</h1>
        </div>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploadMut.isPending}
        >
          <FontAwesomeIcon icon={faUpload} style={{ marginRight: 5 }} />
          {uploadMut.isPending ? t("styles.uploading") : t("styles.uploadBtn")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".nvstyle,.zip"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>

      {isLoading ? (
        <div style={{ color: "var(--c-fg-muted)", fontSize: 13 }}>{t("styles.loading")}</div>
      ) : packs.length === 0 ? (
        <div
          className="acp-card"
          style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 200, gap: 12 }}
        >
          <FontAwesomeIcon icon={faUpload} style={{ fontSize: 28, color: "var(--c-fg-muted)" }} />
          <div style={{ fontSize: 14, color: "var(--c-fg-muted)" }}>{t("styles.emptyTitle")}</div>
          <button type="button" className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
            {t("styles.emptyUpload")}
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
          {packs.map((pack) => (
            <div key={pack.id} className="acp-card" style={{ overflow: "hidden" }}>
              <div style={{
                height: 90,
                background: pack.isActive
                  ? "linear-gradient(135deg, var(--c-accent-soft), var(--c-accent-glow))"
                  : "var(--c-bg)",
                borderBottom: "1px solid var(--c-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}>
                <FontAwesomeIcon
                  icon={faBolt}
                  style={{ fontSize: 28, color: pack.isActive ? "var(--c-accent)" : "var(--c-fg-muted)", opacity: 0.6 }}
                />
                {pack.isActive && (
                  <div style={{ position: "absolute", top: 10, right: 10 }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "3px 10px", borderRadius: 100,
                      fontSize: 11, fontWeight: 700,
                      background: "var(--c-success)", color: "#fff",
                    }}>
                      <FontAwesomeIcon icon={faCheck} /> {t("styles.active")}
                    </span>
                  </div>
                )}
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--c-fg)", marginBottom: 2 }}>{pack.name}</div>
                <div style={{ fontSize: 12, color: "var(--c-fg-muted)", marginBottom: 12 }}>
                  {t("styles.byline", { vendor: pack.vendor, version: pack.version, date: new Date(pack.installedAt).toLocaleDateString() })}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {!pack.isActive && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      style={{ color: "var(--c-accent)", borderColor: "var(--c-accent-glow)", background: "var(--c-accent-soft)" }}
                      onClick={() => activateMut.mutate(pack.id)}
                      disabled={activateMut.isPending}
                    >
                      {t("styles.activate")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => handleDelete(pack)}
                    disabled={deleteMut.isPending}
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Upload slot */}
          <div
            className="acp-card"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              minHeight: 180, border: "2px dashed var(--c-border)", cursor: "pointer",
              background: "transparent",
            }}
            onClick={() => fileRef.current?.click()}
          >
            <div style={{ textAlign: "center" }}>
              <FontAwesomeIcon icon={faUpload} style={{ fontSize: 22, color: "var(--c-fg-muted)", marginBottom: 8, display: "block" }} />
              <div style={{ fontSize: 13, color: "var(--c-fg-muted)" }}>{t("styles.uploadSlot")}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
