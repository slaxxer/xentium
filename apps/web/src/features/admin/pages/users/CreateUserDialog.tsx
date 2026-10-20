/**
 * ACP → Users → Create user.
 *
 * The account registration would make, made by an admin: same username, email and
 * password rules (checked here as you type, and again by the API), the default group
 * unless one is picked. No email code — the admin vouches for the address, so it is
 * marked verified unless they switch that off.
 *
 * A create dialog keeps its own Save/Cancel: nothing is real until it is committed,
 * and a half-typed account must never exist.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api";
import { apiErrorMessage } from "../../../../lib/swal";
import { toast } from "../../../../lib/toast";
import { Toggle, Button } from "../../../../components/AcpControls";

interface GroupOption { id: string; key: string; name: string }

const USERNAME = /^[a-zA-Z0-9_-]{3,30}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A password nobody has to invent: 16 characters, no look-alikes. */
function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [verified, setVerified] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { data: groups = [] } = useQuery<GroupOption[]>({
    queryKey: ["acp-groups-list"],
    queryFn: () => api.get("/admin/groups"),
  });

  const problems = {
    username: username && !USERNAME.test(username) ? t("users.create.usernameRule") : null,
    email: email && !EMAIL.test(email) ? t("users.create.emailRule") : null,
    password: password && (password.length < 8 || password.length > 128) ? t("users.create.passwordRule") : null,
  };
  const ready = USERNAME.test(username) && EMAIL.test(email) && password.length >= 8 && password.length <= 128;

  const create = useMutation({
    mutationFn: () => api.post<{ id: string; username: string }>("/admin/users", {
      username: username.trim(), email: email.trim(), password,
      ...(groupId ? { groupId } : {}),
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      verified,
    }),
    onSuccess: (user) => {
      toast.success(t("users.create.done", { name: user.username }));
      void qc.invalidateQueries({ queryKey: ["acp-users"] });
      onCreated(user.id);
    },
    // Shown in the dialog, where the field is: "Username is already taken".
    onError: (e) => setError(apiErrorMessage(e)),
  });

  return (
    <div className="acp-modal-overlay" onClick={onClose}>
      <div className="acp-modal usr-create" role="dialog" aria-modal="true" aria-labelledby="usr-create-title"
        onClick={(e) => e.stopPropagation()}>
        <h2 id="usr-create-title" className="usr-create__title">{t("users.create.title")}</h2>
        <p className="usr-create__lede">{t("users.create.lede")}</p>

        <form className="usr-create__form" onSubmit={(e) => { e.preventDefault(); if (ready && !create.isPending) { setError(null); create.mutate(); } }}>
          <label className="usr-create__field">
            <span>{t("users.create.username")}</span>
            <input className="acp-input" value={username} autoFocus autoComplete="off" maxLength={30}
              onChange={(e) => setUsername(e.target.value)} aria-invalid={!!problems.username} />
            {problems.username && <small className="usr-create__err">{problems.username}</small>}
          </label>

          <label className="usr-create__field">
            <span>{t("users.create.email")}</span>
            <input className="acp-input" type="email" value={email} autoComplete="off" maxLength={255}
              onChange={(e) => setEmail(e.target.value)} aria-invalid={!!problems.email} />
            {problems.email && <small className="usr-create__err">{problems.email}</small>}
          </label>

          <label className="usr-create__field">
            <span>{t("users.create.password")}</span>
            <div className="usr-create__pw">
              <input className="acp-input" type={showPassword ? "text" : "password"} value={password}
                autoComplete="new-password" maxLength={128}
                onChange={(e) => setPassword(e.target.value)} aria-invalid={!!problems.password} />
              <Button variant="ghost" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? t("users.create.hide") : t("users.create.show")}
              </Button>
              <Button variant="ghost"
                onClick={() => { setPassword(generatePassword()); setShowPassword(true); }}>
                {t("users.create.generate")}
              </Button>
            </div>
            <small className={problems.password ? "usr-create__err" : "usr-create__hint"}>
              {problems.password ?? t("users.create.passwordHint")}
            </small>
          </label>

          <label className="usr-create__field">
            <span>{t("users.create.displayName")} <em>{t("users.create.optional")}</em></span>
            <input className="acp-input" value={displayName} maxLength={80} onChange={(e) => setDisplayName(e.target.value)} />
          </label>

          <label className="usr-create__field">
            <span>{t("users.create.group")}</span>
            <select className="acp-select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">{t("users.create.defaultGroup")}</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>

          <label className="usr-create__check">
            <Toggle on={verified} onToggle={() => setVerified((v) => !v)} />
            <span>
              <span>{t("users.create.verified")}</span>
              <small className="usr-create__hint">{t("users.create.verifiedHint")}</small>
            </span>
          </label>

          {error && <p className="usr-create__err usr-create__err--box" role="alert">{error}</p>}

          <div className="usr-create__foot">
            <Button variant="ghost" onClick={onClose}>{t("users.create.cancel")}</Button>
            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? t("users.create.creating") : t("users.create.submit")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
