import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import Loading from "../components/Loading";
import { fmt } from "../lib/format";

function fmtU(value, unit) {
  if (!unit) return `$${fmt(value)}`;
  return `${fmt(value)} ${unit}`;
}

// Format number input with commas while typing
function fmtInput(val) {
  if (!val || val === "-" || val === ".") return val;
  const parts = val.split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.length > 1 ? `${intPart}.${parts[1]}` : intPart;
}

function stripCommas(val) {
  return (val || "").replace(/,/g, "");
}

export default function Goals() {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState({
    name: "",
    goal_type: "savings",
    target_amount: "",
    saved_amount: "",
    unit: "",
    invested_amount: "",
    current_value: "",
    period: "",
    contribution_amount: "",
    collect_leftovers: false,
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [addingGoalId, setAddingGoalId] = useState(null);
  const [addMode, setAddMode] = useState("add"); // "add" | "invest" | "value"
  const [addAmount, setAddAmount] = useState("");

  const fetchGoals = useCallback(async () => {
    try {
      const { data, error: fetchErr } = await supabase
        .from("goals")
        .select("*")
        .order("sort_order");
      if (fetchErr) throw fetchErr;
      setGoals(data || []);
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load goals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  function resetForm() {
    setForm({
      name: "",
      goal_type: "savings",
      target_amount: "",
      saved_amount: "",
      unit: "",
      invested_amount: "",
      current_value: "",
      period: "",
      contribution_amount: "",
      collect_leftovers: false,
    });
    setImageFile(null);
    setImagePreview(null);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(goal) {
    setForm({
      name: goal.name,
      goal_type: goal.goal_type || "savings",
      target_amount: goal.target_amount.toString(),
      saved_amount: goal.saved_amount.toString(),
      unit: goal.unit || "",
      invested_amount: (goal.invested_amount || 0).toString(),
      current_value: (goal.current_value || 0).toString(),
      period: goal.period || "",
      contribution_amount: goal.contribution_amount
        ? goal.contribution_amount.toString()
        : "",
      collect_leftovers: goal.collect_leftovers,
    });
    setImagePreview(goal.image_url || null);
    setImageFile(null);
    setEditingId(goal.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleImageChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5MB");
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function uploadImage(goalId) {
    if (!imageFile) return null;
    const ext = imageFile.name.split(".").pop();
    const path = `${goalId}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("goal-images")
      .upload(path, imageFile, { upsert: true });
    if (uploadErr) throw uploadErr;
    const { data } = supabase.storage.from("goal-images").getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.target_amount) return;
    setSaving(true);
    setError(null);

    try {
      const isInvestment = form.goal_type === "investment";
      const payload = {
        name: form.name.trim(),
        goal_type: form.goal_type,
        target_amount: parseFloat(form.target_amount),
        unit: form.unit.trim() || null,
        period: isInvestment ? null : (form.period || null),
        contribution_amount: isInvestment ? 0 : (form.contribution_amount
          ? parseFloat(form.contribution_amount)
          : 0),
        collect_leftovers: isInvestment ? false : form.collect_leftovers,
        renew_anchor: !isInvestment && form.period ? new Date().toISOString().slice(0, 10) : null,
      };

      if (isInvestment) {
        payload.invested_amount = form.invested_amount ? parseFloat(form.invested_amount) : 0;
        payload.current_value = form.current_value ? parseFloat(form.current_value) : 0;
      }

      // If enabling collect_leftovers, disable on all other goals
      if (payload.collect_leftovers) {
        await supabase
          .from("goals")
          .update({ collect_leftovers: false })
          .neq("id", editingId || "");
      }

      if (editingId) {
        let imageUrl = undefined;
        if (imageFile) {
          imageUrl = await uploadImage(editingId);
        }
        const updatePayload = { ...payload };
        if (imageUrl) updatePayload.image_url = imageUrl;
        if (!isInvestment && form.saved_amount !== "") {
          updatePayload.saved_amount = parseFloat(form.saved_amount) || 0;
        }

        const { error: updateErr } = await supabase
          .from("goals")
          .update(updatePayload)
          .eq("id", editingId);
        if (updateErr) throw updateErr;
      } else {
        payload.sort_order = goals.length;
        const { data: inserted, error: insertErr } = await supabase
          .from("goals")
          .insert(payload)
          .select()
          .single();
        if (insertErr) throw insertErr;

        if (imageFile && inserted) {
          const imageUrl = await uploadImage(inserted.id);
          if (imageUrl) {
            await supabase
              .from("goals")
              .update({ image_url: imageUrl })
              .eq("id", inserted.id);
          }
        }
      }

      resetForm();
      await fetchGoals();
    } catch (err) {
      setError(err.message || "Failed to save goal");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    setSaving(true);
    setError(null);
    try {
      const { error: delErr } = await supabase
        .from("goals")
        .delete()
        .eq("id", id);
      if (delErr) throw delErr;
      setConfirmDelete(null);
      await fetchGoals();
    } catch (err) {
      setError(err.message || "Failed to delete goal");
    } finally {
      setSaving(false);
    }
  }

  async function handleReorder(goalId, direction) {
    const idx = goals.findIndex((g) => g.id === goalId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= goals.length) return;

    const a = goals[idx];
    const b = goals[swapIdx];

    await Promise.all([
      supabase
        .from("goals")
        .update({ sort_order: b.sort_order })
        .eq("id", a.id),
      supabase
        .from("goals")
        .update({ sort_order: a.sort_order })
        .eq("id", b.id),
    ]);

    await fetchGoals();
  }

  async function togglePause(goal) {
    await supabase
      .from("goals")
      .update({ contribution_paused: !goal.contribution_paused })
      .eq("id", goal.id);
    await fetchGoals();
  }

  async function handleInlineAction(goalId) {
    const amount = parseFloat(addAmount);
    if (!amount && addMode !== "value") return;
    if (addMode === "value" && (isNaN(amount) || amount < 0)) return;

    const goal = goals.find((g) => g.id === goalId);
    setSaving(true);

    if (addMode === "add") {
      // Savings: add/subtract from saved_amount
      await supabase
        .from("goals")
        .update({ saved_amount: Math.max(0, goal.saved_amount + amount) })
        .eq("id", goalId);
    } else if (addMode === "invest") {
      // Investment: add to invested_amount AND current_value
      await supabase
        .from("goals")
        .update({
          invested_amount: Math.max(0, (goal.invested_amount || 0) + amount),
          current_value: Math.max(0, (goal.current_value || 0) + amount),
        })
        .eq("id", goalId);
    } else if (addMode === "value") {
      // Investment: set current_value directly
      await supabase
        .from("goals")
        .update({ current_value: parseFloat(addAmount) || 0 })
        .eq("id", goalId);
    }

    setAddingGoalId(null);
    setAddAmount("");
    setSaving(false);
    await fetchGoals();
  }

  if (loading) return <Loading />;

  const periodLabels = {
    weekly: "Weekly",
    fortnightly: "Fortnightly",
    "4-weekly": "4-Weekly",
  };

  const isFormInvestment = form.goal_type === "investment";

  return (
    <div className="page goals-page">
      <h2 className="page-title">Goals</h2>

      {error && (
        <p className="form-error" style={{ margin: "0.75rem 0" }}>
          {error}
        </p>
      )}

      {showForm ? (
        <div className="card goal-form">
          <h3>{editingId ? "Edit Goal" : "New Goal"}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Type</label>
              <div className="modal-mode-toggle">
                <button
                  type="button"
                  className={`modal-mode-btn ${form.goal_type === "savings" ? "active" : ""}`}
                  onClick={() => setForm({ ...form, goal_type: "savings" })}
                >
                  Savings
                </button>
                <button
                  type="button"
                  className={`modal-mode-btn ${form.goal_type === "investment" ? "active" : ""}`}
                  onClick={() => setForm({ ...form, goal_type: "investment" })}
                >
                  Investment
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>Goal Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={isFormInvestment ? "e.g. Gold, Bitcoin, Stocks" : "e.g. Holiday Fund"}
                required
              />
            </div>

            <div className="form-group">
              <label>Photo</label>
              <div className="goal-image-upload">
                {imagePreview && (
                  <img
                    src={imagePreview}
                    alt="Goal preview"
                    className="goal-image-preview"
                  />
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                />
              </div>
            </div>

            {isFormInvestment && (
              <div className="form-group">
                <label>Unit (optional)</label>
                <input
                  type="text"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  placeholder="e.g. kg, oz, BTC, shares (leave empty for $)"
                  maxLength={10}
                />
              </div>
            )}

            <div className="form-group">
              <label>{isFormInvestment ? "Goal Amount" : "Target Amount"}</label>
              <input
                type="text"
                inputMode="decimal"
                value={fmtInput(form.target_amount)}
                onChange={(e) =>
                  setForm({ ...form, target_amount: stripCommas(e.target.value) })
                }
                placeholder="0.00"
                required
              />
            </div>

            {isFormInvestment && editingId && (
              <>
                <div className="form-group">
                  <label>Invested Amount</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={fmtInput(form.invested_amount)}
                    onChange={(e) => setForm({ ...form, invested_amount: stripCommas(e.target.value) })}
                    placeholder="0.00"
                  />
                </div>
                <div className="form-group">
                  <label>Current Value</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={fmtInput(form.current_value)}
                    onChange={(e) => setForm({ ...form, current_value: stripCommas(e.target.value) })}
                    placeholder="0.00"
                  />
                </div>
              </>
            )}

            {!isFormInvestment && editingId && (
              <div className="form-group">
                <label>Current Saved Amount</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fmtInput(form.saved_amount)}
                  onChange={(e) => setForm({ ...form, saved_amount: stripCommas(e.target.value) })}
                  placeholder="0.00"
                />
              </div>
            )}

            {!isFormInvestment && (
              <>
                <div className="form-group">
                  <label>Auto-Contribute</label>
                  <select
                    value={form.period}
                    onChange={(e) => setForm({ ...form, period: e.target.value })}
                  >
                    <option value="">None</option>
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                    <option value="4-weekly">4-Weekly</option>
                  </select>
                </div>

                {form.period && (
                  <div className="form-group">
                    <label>Contribution Amount</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={fmtInput(form.contribution_amount)}
                      onChange={(e) =>
                        setForm({ ...form, contribution_amount: stripCommas(e.target.value) })
                      }
                      placeholder="0.00"
                    />
                  </div>
                )}

                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.collect_leftovers}
                      onChange={(e) =>
                        setForm({ ...form, collect_leftovers: e.target.checked })
                      }
                    />
                    Collect budget leftovers at end of each period
                  </label>
                </div>
              </>
            )}

            {editingId && (
              <div className="goal-form-reorder">
                <label>Reorder</label>
                <div className="goal-reorder-btns">
                  <button
                    type="button"
                    className="btn small secondary goal-reorder-btn"
                    onClick={() => handleReorder(editingId, "up")}
                    disabled={goals.findIndex((g) => g.id === editingId) === 0}
                  >
                    &#9650; Move Up
                  </button>
                  <button
                    type="button"
                    className="btn small secondary goal-reorder-btn"
                    onClick={() => handleReorder(editingId, "down")}
                    disabled={goals.findIndex((g) => g.id === editingId) === goals.length - 1}
                  >
                    &#9660; Move Down
                  </button>
                </div>
              </div>
            )}

            <div className="goal-form-actions">
              <button
                type="submit"
                className="btn primary"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Update Goal"
                    : "Create Goal"}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={resetForm}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button
          className="btn primary"
          onClick={() => setShowForm(true)}
          style={{ marginBottom: "1rem", width: "100%" }}
        >
          + Add Goal
        </button>
      )}

      {goals.length === 0 && !showForm ? (
        <div className="empty-state card">
          <p>No goals yet. Create one to start saving!</p>
        </div>
      ) : (
        <div className="goal-list">
          {goals.map((goal, idx) => {
            const isInvestment = goal.goal_type === "investment";
            const unit = goal.unit || null;
            const investedAmt = goal.invested_amount || 0;
            const currentVal = goal.current_value || 0;
            const gainLoss = currentVal - investedAmt;
            const gainPct = investedAmt > 0 ? (gainLoss / investedAmt) * 100 : 0;

            const progress = isInvestment
              ? (goal.target_amount > 0 ? (currentVal / goal.target_amount) * 100 : 0)
              : (goal.target_amount > 0 ? (goal.saved_amount / goal.target_amount) * 100 : 0);

            const isMain = idx === 0;

            return (
              <div
                key={goal.id}
                className={`card goal-card ${isMain ? "main" : ""}`}
              >
                {isMain && <div className="goal-main-badge">Main Goal</div>}
                {isInvestment && <div className="goal-type-badge investment">Investment</div>}

                <div className="goal-card-top">
                  {goal.image_url && (
                    <img
                      src={goal.image_url}
                      alt={goal.name}
                      className="goal-card-image"
                    />
                  )}
                  <div className="goal-card-info">
                    <h3 className="goal-card-name">{goal.name}</h3>
                    {isInvestment ? (
                      <div className="goal-card-amounts">
                        <span className="goal-saved">
                          {fmtU(currentVal, unit)}
                        </span>
                        <span className="goal-target">
                          {" "}/ {fmtU(goal.target_amount, unit)}
                        </span>
                      </div>
                    ) : (
                      <div className="goal-card-amounts">
                        <span className="goal-saved">
                          ${fmt(goal.saved_amount)}
                        </span>
                        <span className="goal-target">
                          {" "}/ ${fmt(goal.target_amount)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="progress-bar goal-progress-bar">
                  <div
                    className={`progress-fill goal-fill${isInvestment ? " investment" : ""}`}
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>

                {isInvestment && (
                  <div className="goal-investment-stats">
                    <div className="goal-inv-stat">
                      <span className="goal-inv-label">Invested</span>
                      <span className="goal-inv-value">{fmtU(investedAmt, unit)}</span>
                    </div>
                    <div className="goal-inv-stat">
                      <span className="goal-inv-label">Gain / Loss</span>
                      <span className={`goal-inv-value ${gainLoss >= 0 ? "positive" : "negative"}`}>
                        {gainLoss >= 0 ? "+" : ""}{fmtU(gainLoss, unit)}
                        {investedAmt > 0 && (
                          <span className="goal-inv-pct"> ({gainPct >= 0 ? "+" : ""}{gainPct.toFixed(1)}%)</span>
                        )}
                      </span>
                    </div>
                  </div>
                )}

                {!isInvestment && goal.period && goal.contribution_amount > 0 && (
                  <div className="goal-contribution-status">
                    <span>
                      ${fmt(goal.contribution_amount)}{" "}
                      {periodLabels[goal.period] || goal.period}
                      {goal.contribution_paused && " (Paused)"}
                    </span>
                    <button
                      className="btn small secondary"
                      onClick={() => togglePause(goal)}
                    >
                      {goal.contribution_paused ? "Resume" : "Pause"}
                    </button>
                  </div>
                )}

                {!isInvestment && goal.collect_leftovers && (
                  <div className="goal-leftovers-badge">
                    Collecting budget leftovers
                  </div>
                )}

                {addingGoalId === goal.id && (
                  <div className="goal-add-savings-form">
                    <input
                      type="number"
                      step="0.01"
                      value={addAmount}
                      onChange={(e) => setAddAmount(e.target.value)}
                      placeholder={
                        addMode === "value"
                          ? "Set current value"
                          : addMode === "invest"
                            ? "Amount to invest (- to withdraw)"
                            : "Amount (use - to decrease)"
                      }
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); handleInlineAction(goal.id); }
                        if (e.key === "Escape") { setAddingGoalId(null); setAddAmount(""); }
                      }}
                    />
                    <div className="goal-add-savings-actions">
                      <button className="btn small primary" onClick={() => handleInlineAction(goal.id)} disabled={saving}>
                        {addMode === "value" ? "Update" : "Save"}
                      </button>
                      <button className="btn small secondary" onClick={() => { setAddingGoalId(null); setAddAmount(""); }}>Cancel</button>
                    </div>
                  </div>
                )}

                <div className="goal-card-actions">
                  {isInvestment ? (
                    <>
                      <button
                        className="btn small primary"
                        onClick={() => { setAddingGoalId(goal.id); setAddMode("invest"); setAddAmount(""); }}
                      >
                        + Invest
                      </button>
                      <button
                        className="btn small"
                        onClick={() => { setAddingGoalId(goal.id); setAddMode("value"); setAddAmount(currentVal.toString()); }}
                      >
                        Update Value
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn small primary"
                      onClick={() => { setAddingGoalId(goal.id); setAddMode("add"); setAddAmount(""); }}
                    >
                      + Add
                    </button>
                  )}
                  <button
                    className="btn small secondary"
                    onClick={() => startEdit(goal)}
                  >
                    Edit
                  </button>
                  <div className="goal-reorder-btns">
                    <button
                      className="btn small secondary goal-reorder-btn"
                      onClick={() => handleReorder(goal.id, "up")}
                      disabled={idx === 0}
                    >
                      &#9650;
                    </button>
                    <button
                      className="btn small secondary goal-reorder-btn"
                      onClick={() => handleReorder(goal.id, "down")}
                      disabled={idx === goals.length - 1}
                    >
                      &#9660;
                    </button>
                  </div>
                  {confirmDelete === goal.id ? (
                    <div className="goal-delete-confirm">
                      <button
                        className="btn small danger"
                        onClick={() => handleDelete(goal.id)}
                        disabled={saving}
                      >
                        Confirm
                      </button>
                      <button
                        className="btn small secondary"
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn small danger"
                      onClick={() => setConfirmDelete(goal.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
