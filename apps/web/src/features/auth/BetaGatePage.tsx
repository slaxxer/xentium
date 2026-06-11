import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { swalToast } from "../../lib/swal";
import { applyLogin } from "../../hooks/useAuth";
import Swal from "sweetalert2";

interface BetaGatePageProps {
  onSuccess: (isNew: boolean) => void;
}

export function BetaGatePage({ onSuccess }: BetaGatePageProps) {
  const qc = useQueryClient();
  const [code,    setCode]    = useState("");
  const [loading, setLoading] = useState(false);

  // Staff login panel
  const [showStaff,    setShowStaff]    = useState(false);
  const [staffEmail,   setStaffEmail]   = useState("");
  const [staffPass,    setStaffPass]    = useState("");
  const [staffLoading, setStaffLoading] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    try {
      const res = await api.post<{ success: boolean; isNew: boolean }>("/beta/redeem", { code: code.trim() });
      onSuccess(res.isNew);
    } catch (err: any) {
      const nec = err?.detail?.error as string | undefined;
      if (nec === "NEC-AUTH-1031") {
        swalToast("Invalid beta code. Please check and try again.");
      } else if (nec === "NEC-AUTH-1032") {
        const details   = err?.detail?.details as { redeemerIp?: string; registeredUser?: string | null } | undefined;
        const who       = details?.registeredUser ? `@${details.registeredUser}` : null;
        const ip        = details?.redeemerIp ?? "unknown";
        const bodyLines = [
          who
            ? `This code was already used by <strong>${who}</strong> to register an account.`
            : `This code was already redeemed but registration has not been completed yet.`,
          `<span style="font-size:12px;color:var(--c-fg-muted)">Locked to IP: ${ip}</span>`,
        ].join("<br><br>");
        Swal.fire({
          background:        "var(--c-card)",
          color:             "var(--c-fg)",
          icon:              "error",
          title:             "Code already in use",
          html:              bodyLines,
          confirmButtonText: "OK",
          confirmButtonColor: "var(--c-accent)",
        });
      } else {
        swalToast("Could not redeem code. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleStaffLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!staffEmail.trim() || !staffPass) return;
    setStaffLoading("loading");
    try {
      const res = await api.post<{ accessToken?: string; requiresPin?: boolean }>(
        "/auth/login",
        { email: staffEmail.trim(), password: staffPass },
      );
      if (res.requiresPin) {
        swalToast("PIN login is not supported on this screen. Use the main login page.", "error");
        setStaffLoading("");
        return;
      }
      if (res.accessToken) {
        await applyLogin(res.accessToken);
        // Re-fetch beta status — the API now returns hasAccess:true for authenticated staff,
        // which causes BetaGate to unmount the gate and render the app.
        await qc.invalidateQueries({ queryKey: ["beta-status"] });
        setStaffLoading("success");
      }
    } catch (err: any) {
      const code = err?.detail?.error as string | undefined;
      if (code === "account_banned") {
        swalToast("This account is suspended.", "error");
      } else if (code === "invalid_credentials") {
        swalToast("Incorrect email or password.");
      } else {
        swalToast(err instanceof Error ? err.message : "Login failed. Please try again.");
      }
      setStaffLoading("");
    }
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "100dvh", background: "var(--c-bg)", padding: "var(--sp-6)",
    }}>
      <div style={{
        width: "100%", maxWidth: 400,
        background: "var(--c-card)", border: "1px solid var(--c-border)",
        borderRadius: "var(--radius-lg)", padding: "40px 36px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        textAlign: "center",
      }}>
        {/* Logo mark */}
        <div style={{
          width: 48, height: 48, borderRadius: 14, margin: "0 auto 24px",
          background: "linear-gradient(135deg, var(--c-accent), var(--c-accent2))",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ width: 20, height: 20, border: "2.5px solid rgba(255,255,255,0.9)", borderRadius: 5 }} />
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--c-fg)", margin: "0 0 8px", letterSpacing: "-0.02em" }}>
          Beta Access
        </h1>
        <p style={{ fontSize: 14, color: "var(--c-fg-muted)", marginBottom: 32, lineHeight: 1.6 }}>
          This site is in closed beta. Enter your invite code to continue.
        </p>

        {/* Beta code form */}
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="BETA-XXXX-XXXX"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "12px 16px", marginBottom: 16,
              background: "var(--c-surface)", border: "1px solid var(--c-border)",
              borderRadius: "var(--radius-sm)", color: "var(--c-fg)",
              fontSize: 16, fontFamily: "monospace", letterSpacing: "0.08em",
              textAlign: "center", outline: "none",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--c-accent)"; }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--c-border)"; }}
          />
          <button
            type="submit"
            disabled={!code.trim() || loading}
            style={{
              width: "100%", padding: "12px",
              background: "var(--c-accent)", color: "#fff",
              border: "none", borderRadius: "var(--radius-sm)",
              fontSize: 15, fontWeight: 700, cursor: "pointer",
              opacity: (!code.trim() || loading) ? 0.5 : 1,
              transition: "opacity .15s",
              fontFamily: "inherit",
            }}
          >
            {loading ? "Verifying…" : "Enter Beta"}
          </button>
        </form>

        {/* Staff login divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "24px 0 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
          <button
            type="button"
            onClick={() => setShowStaff((v) => !v)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 12, color: "var(--c-fg-muted)", fontFamily: "inherit",
              padding: "2px 4px", borderRadius: 4,
              transition: "color .15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--c-accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--c-fg-muted)")}
          >
            {showStaff ? "Hide staff login ▲" : "Staff login ▼"}
          </button>
          <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
        </div>

        {/* Staff login form */}
        {showStaff && (
          <form onSubmit={handleStaffLogin} style={{ marginTop: 20, textAlign: "left" }}>
            <p style={{ fontSize: 12, color: "var(--c-fg-muted)", marginBottom: 14, textAlign: "center", lineHeight: 1.5 }}>
              Admin, Supermod and Moderator accounts bypass beta restrictions.
            </p>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>
                Email
              </label>
              <input
                type="email"
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                placeholder="admin@example.com"
                autoComplete="username"
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "10px 14px",
                  background: "var(--c-surface)", border: "1px solid var(--c-border)",
                  borderRadius: "var(--radius-sm)", color: "var(--c-fg)",
                  fontSize: 14, fontFamily: "inherit", outline: "none",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--c-accent)"; }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--c-border)"; }}
              />
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--c-fg-muted)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password"
                value={staffPass}
                onChange={(e) => setStaffPass(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "10px 14px",
                  background: "var(--c-surface)", border: "1px solid var(--c-border)",
                  borderRadius: "var(--radius-sm)", color: "var(--c-fg)",
                  fontSize: 14, fontFamily: "inherit", outline: "none",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--c-accent)"; }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--c-border)"; }}
              />
            </div>

            <button
              type="submit"
              disabled={!staffEmail.trim() || !staffPass || staffLoading === "loading"}
              style={{
                width: "100%", padding: "11px",
                background: "var(--c-accent-soft)", color: "var(--c-accent)",
                border: "1px solid var(--c-accent-glow)", borderRadius: "var(--radius-sm)",
                fontSize: 14, fontWeight: 700, cursor: "pointer",
                opacity: (!staffEmail.trim() || !staffPass || staffLoading === "loading") ? 0.5 : 1,
                transition: "opacity .15s",
                fontFamily: "inherit",
              }}
            >
              {staffLoading === "loading" ? "Signing in…" : "Sign in as Staff"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
