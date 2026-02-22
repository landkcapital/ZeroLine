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

  // Nickname state
  const [nickname, setNickname] = useState("");
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");
  const [savingNickname, setSavingNickname] = useState(false);
  const [nicknameError, setNicknameError] = useState(null);

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState(null);
  const [passwordSuccess, setPasswordSuccess] = useState(null);

  // Account Check state
  const [checkpoint, setCheckpoint] = useState(null);
  const [showCheckForm, setShowCheckForm] = useState(false);
  const [checkFile, setCheckFile] = useState(null);
  const [checkPreview, setCheckPreview] = useState(null);
  const [checkTitle, setCheckTitle] = useState("");
  const [checkAmount, setCheckAmount] = useState("");
  const [savingCheck, setSavingCheck] = useState(false);
  const [checkError, setCheckError] = useState(null);

  useEffect(() => {
    async function fetchAccount() {
      try {
        const { data: { user: u }, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        setUser(u);
        setNickname(u.user_metadata?.display_name || "");

        const [budgetsResult, txResult] = await Promise.all([
          supabase.from("budgets").select("id", { count: "exact", head: true }),
          supabase.from("transactions").select("id", { count: "exact", head: true }),
        ]);

        setStats({
          budgets: budgetsResult.count || 0,
          transactions: txResult.count || 0,
        });

        // Fetch latest account check
        const { data: checkData } = await supabase
          .from("account_checks")
          .select("*")
          .eq("user_id", u.id)
          .order("checked_at", { ascending: false })
          .limit(1);
        if (checkData && checkData.length > 0) {
          setCheckpoint(checkData[0]);
        }
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

  async function handleSaveNickname() {
    const trimmed = nicknameInput.trim();
    if (trimmed === nickname) {
      setEditingNickname(false);
      return;
    }
    setSavingNickname(true);
    setNicknameError(null);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({
        data: { display_name: trimmed || null },
      });
      if (updateErr) throw updateErr;
      setNickname(trimmed);
      setEditingNickname(false);
    } catch (err) {
      setNicknameError(err.message || "Failed to update nickname");
    } finally {
      setSavingNickname(false);
    }
  }

  function handleCheckFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setCheckError("Image must be under 5MB");
      return;
    }
    setCheckFile(file);
    setCheckPreview(URL.createObjectURL(file));
  }

  async function handleSaveCheck(e) {
    e.preventDefault();
    if (!checkTitle.trim() && !checkFile) return;
    setSavingCheck(true);
    setCheckError(null);

    try {
      const { data: inserted, error: insertErr } = await supabase
        .from("account_checks")
        .insert({
          user_id: user.id,
          last_transaction_title: checkTitle.trim() || null,
          last_transaction_amount: checkAmount ? parseFloat(checkAmount) : null,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      // Upload screenshot if present
      if (checkFile && inserted) {
        const ext = checkFile.name.split(".").pop();
        const path = `${user.id}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("checkpoint-images")
          .upload(path, checkFile, { upsert: true });
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from("checkpoint-images").getPublicUrl(path);
        await supabase
          .from("account_checks")
          .update({ screenshot_url: urlData.publicUrl })
          .eq("id", inserted.id);
        inserted.screenshot_url = urlData.publicUrl;
      }

      setCheckpoint(inserted);
      setShowCheckForm(false);
      setCheckFile(null);
      setCheckPreview(null);
      setCheckTitle("");
      setCheckAmount("");
    } catch (err) {
      setCheckError(err.message || "Failed to save check");
    } finally {
      setSavingCheck(false);
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

  // Check if checkpoint is stale (> 7 days old)
  const isStale = checkpoint && (
    (Date.now() - new Date(checkpoint.checked_at).getTime()) > 7 * 24 * 60 * 60 * 1000
  );
  const daysSinceCheck = checkpoint
    ? Math.floor((Date.now() - new Date(checkpoint.checked_at).getTime()) / (24 * 60 * 60 * 1000))
    : null;

  return (
    <div className="page account-page">
      <div className="card account-card">
        <div className="account-avatar">
          {(nickname || user?.email)?.[0]?.toUpperCase() || "?"}
        </div>

        {editingNickname ? (
          <div className="account-nickname-edit">
            <input
              type="text"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              placeholder="Enter a nickname"
              autoFocus
              maxLength={30}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleSaveNickname(); }
                if (e.key === "Escape") setEditingNickname(false);
              }}
            />
            {nicknameError && <p className="form-error">{nicknameError}</p>}
            <div className="account-nickname-actions">
              <button className="btn small primary" onClick={handleSaveNickname} disabled={savingNickname}>
                {savingNickname ? "Saving..." : "Save"}
              </button>
              <button className="btn small secondary" onClick={() => setEditingNickname(false)} disabled={savingNickname}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="account-nickname-display" onClick={() => { setNicknameInput(nickname); setEditingNickname(true); setNicknameError(null); }}>
            {nickname ? (
              <>
                <h2 className="account-name">{nickname}</h2>
                <p className="account-email-sub">{user?.email}</p>
              </>
            ) : (
              <>
                <h2 className="account-email">{user?.email}</h2>
                <button className="btn-link account-set-nickname">Set a nickname</button>
              </>
            )}
          </div>
        )}

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

      {/* Account Check Card */}
      <div className={`card account-check-card${isStale ? " stale" : ""}`}>
        <h3 className="account-check-title">Account Check</h3>
        <p className="account-check-subtitle">
          Track the last bank transaction you verified against ZeroLine
        </p>

        {checkpoint ? (
          <div className="account-check-status">
            <div className="account-check-row">
              <span className="account-check-label">Last checked</span>
              <span className={`account-check-value ${isStale ? "stale-text" : "fresh-text"}`}>
                {formatDate(checkpoint.checked_at)}
                {daysSinceCheck !== null && (
                  <span className="account-check-ago">
                    {daysSinceCheck === 0 ? " (today)" : daysSinceCheck === 1 ? " (yesterday)" : ` (${daysSinceCheck}d ago)`}
                  </span>
                )}
              </span>
            </div>
            {checkpoint.last_transaction_title && (
              <div className="account-check-row">
                <span className="account-check-label">Last transaction</span>
                <span className="account-check-value">
                  {checkpoint.last_transaction_title}
                  {checkpoint.last_transaction_amount != null && (
                    <span className="account-check-tx-amount">
                      {" "}${Number(checkpoint.last_transaction_amount).toFixed(2)}
                    </span>
                  )}
                </span>
              </div>
            )}
            {checkpoint.screenshot_url && (
              <div className="account-check-row">
                <span className="account-check-label">Screenshot</span>
                <img
                  src={checkpoint.screenshot_url}
                  alt="Bank screenshot"
                  className="account-check-screenshot"
                  onClick={() => window.open(checkpoint.screenshot_url, "_blank")}
                />
              </div>
            )}
            {isStale && (
              <div className="account-check-warning">
                It's been {daysSinceCheck} days since your last check. Review your bank account for any unfamiliar transactions.
              </div>
            )}
          </div>
        ) : (
          <div className="account-check-empty">
            You haven't checked your account yet. Tap below to log your last verified bank transaction.
          </div>
        )}

        {showCheckForm ? (
          <form onSubmit={handleSaveCheck} className="account-check-form">
            <div className="form-group">
              <label>Last Transaction Title</label>
              <input
                type="text"
                value={checkTitle}
                onChange={(e) => setCheckTitle(e.target.value)}
                placeholder="e.g. Woolworths, Netflix, Transfer"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Amount (optional)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={checkAmount}
                onChange={(e) => setCheckAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="form-group">
              <label>Screenshot (optional)</label>
              <div className="receipt-upload">
                {checkPreview && (
                  <img src={checkPreview} alt="Screenshot preview" className="receipt-preview" />
                )}
                <input type="file" accept="image/*" onChange={handleCheckFileChange} />
              </div>
            </div>
            {checkError && <p className="form-error">{checkError}</p>}
            <div className="form-actions">
              <button type="submit" className="btn small primary" disabled={savingCheck || (!checkTitle.trim() && !checkFile)}>
                {savingCheck ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                className="btn small secondary"
                onClick={() => {
                  setShowCheckForm(false);
                  setCheckFile(null);
                  setCheckPreview(null);
                  setCheckTitle("");
                  setCheckAmount("");
                  setCheckError(null);
                }}
                disabled={savingCheck}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            className="btn small"
            onClick={() => setShowCheckForm(true)}
            style={{ width: "100%", marginTop: "0.75rem" }}
          >
            {checkpoint ? "Update" : "Log First Check"}
          </button>
        )}
      </div>

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
