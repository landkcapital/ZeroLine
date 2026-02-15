import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { signOut } from "../lib/auth";
import Loading from "../components/Loading";

export default function Account() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState(null);
  const [passwordSuccess, setPasswordSuccess] = useState(null);

  useEffect(() => {
    async function fetchAccount() {
      try {
        const { data: { user: u }, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        setUser(u);

        const [budgetsResult, txResult] = await Promise.all([
          supabase.from("budgets").select("id", { count: "exact", head: true }),
          supabase.from("transactions").select("id", { count: "exact", head: true }),
        ]);

        setStats({
          budgets: budgetsResult.count || 0,
          transactions: txResult.count || 0,
        });
      } catch (err) {
        setError(err.message || "Failed to load account");
      } finally {
        setLoading(false);
      }
    }
    fetchAccount();
  }, []);

  async function handleChangePassword(e) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setChangingPassword(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateErr) throw updateErr;
      setPasswordSuccess("Password updated successfully.");
      setNewPassword("");
      setConfirmPassword("");
      setShowChangePassword(false);
    } catch (err) {
      setPasswordError(err.message || "Failed to update password");
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      navigate("/login");
    } catch (err) {
      setError(err.message || "Failed to sign out");
      setSigningOut(false);
    }
  }

  if (loading) return <Loading />;

  if (error && !user) {
    return (
      <div className="page account-page">
        <div className="card" style={{ padding: "1.5rem", textAlign: "center" }}>
          <p className="form-error">{error}</p>
          <button className="btn primary" onClick={() => window.location.reload()} style={{ marginTop: "1rem" }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="page account-page">
      <div className="card account-card">
        <div className="account-avatar">
          {user?.email?.[0]?.toUpperCase() || "?"}
        </div>
        <h2 className="account-email">{user?.email}</h2>

        <div className="account-details">
          <div className="account-detail-row">
            <span className="account-detail-label">Member since</span>
            <span className="account-detail-value">{formatDate(user?.created_at)}</span>
          </div>
          <div className="account-detail-row">
            <span className="account-detail-label">Last sign in</span>
            <span className="account-detail-value">{formatDate(user?.last_sign_in_at)}</span>
          </div>
        </div>
      </div>

      {stats && (
        <div className="card account-stats">
          <div className="account-stat">
            <span className="account-stat-value">{stats.budgets}</span>
            <span className="account-stat-label">Budgets</span>
          </div>
          <div className="account-stat">
            <span className="account-stat-value">{stats.transactions}</span>
            <span className="account-stat-label">Transactions</span>
          </div>
        </div>
      )}

      {error && <p className="form-error" style={{ margin: "0.75rem 0" }}>{error}</p>}

      <div className="card account-password-section">
        {showChangePassword ? (
          <form onSubmit={handleChangePassword}>
            <h3>Change Password</h3>
            <div className="form-group">
              <label>New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
              />
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                required
                minLength={6}
              />
            </div>
            {passwordError && <p className="form-error">{passwordError}</p>}
            {passwordSuccess && <p className="form-success">{passwordSuccess}</p>}
            <div className="account-password-actions">
              <button type="submit" className="btn primary" disabled={changingPassword}>
                {changingPassword ? "Updating..." : "Update Password"}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setShowChangePassword(false);
                  setNewPassword("");
                  setConfirmPassword("");
                  setPasswordError(null);
                }}
                disabled={changingPassword}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            {passwordSuccess && <p className="form-success" style={{ marginBottom: "0.75rem" }}>{passwordSuccess}</p>}
            <button
              className="btn secondary"
              onClick={() => setShowChangePassword(true)}
              style={{ width: "100%" }}
            >
              Change Password
            </button>
          </>
        )}
      </div>

      <div className="account-sign-out">
        <button
          className="btn danger"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          {signingOut ? "Signing out..." : "Sign Out"}
        </button>
      </div>
    </div>
  );
}
