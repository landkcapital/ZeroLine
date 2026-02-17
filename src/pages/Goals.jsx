import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import Loading from "../components/Loading";

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
    target_amount: "",
    period: "",
    contribution_amount: "",
    collect_leftovers: false,
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

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
      target_amount: "",
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
      target_amount: goal.target_amount.toString(),
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
      const payload = {
        name: form.name.trim(),
        target_amount: parseFloat(form.target_amount),
        period: form.period || null,
        contribution_amount: form.contribution_amount
          ? parseFloat(form.contribution_amount)
          : 0,
        collect_leftovers: form.collect_leftovers,
        renew_anchor: form.period ? new Date().toISOString().slice(0, 10) : null,
      };

      // If enabling collect_leftovers, disable on all other goals
      if (payload.collect_leftovers) {
        await supabase
          .from("goals")
          .update({ collect_leftovers: false })
          .neq("id", editingId || "");
      }

      if (editingId) {
        // Update existing
        let imageUrl = undefined;
        if (imageFile) {
          imageUrl = await uploadImage(editingId);
        }
        const updatePayload = { ...payload };
        if (imageUrl) updatePayload.image_url = imageUrl;

        const { error: updateErr } = await supabase
          .from("goals")
          .update(updatePayload)
          .eq("id", editingId);
        if (updateErr) throw updateErr;
      } else {
        // Create new
        payload.sort_order = goals.length;
        const { data: inserted, error: insertErr } = await supabase
          .from("goals")
          .insert(payload)
          .select()
          .single();
        if (insertErr) throw insertErr;

        // Upload image if selected
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

  async function handleAddSavings(goal) {
    const input = prompt("Amount to add to savings:");
    if (!input) return;
    const amount = parseFloat(input);
    if (!amount || amount <= 0) return;

    await supabase
      .from("goals")
      .update({ saved_amount: goal.saved_amount + amount })
      .eq("id", goal.id);
    await fetchGoals();
  }

  if (loading) return <Loading />;

  const periodLabels = {
    weekly: "Weekly",
    fortnightly: "Fortnightly",
    "4-weekly": "4-Weekly",
  };

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
              <label>Goal Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Holiday Fund"
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

            <div className="form-group">
              <label>Target Amount</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.target_amount}
                onChange={(e) =>
                  setForm({ ...form, target_amount: e.target.value })
                }
                placeholder="0.00"
                required
              />
            </div>

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
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.contribution_amount}
                  onChange={(e) =>
                    setForm({ ...form, contribution_amount: e.target.value })
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
            const progress =
              goal.target_amount > 0
                ? (goal.saved_amount / goal.target_amount) * 100
                : 0;
            const isMain = idx === 0;

            return (
              <div
                key={goal.id}
                className={`card goal-card ${isMain ? "main" : ""}`}
              >
                {isMain && <div className="goal-main-badge">Main Goal</div>}

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
                    <div className="goal-card-amounts">
                      <span className="goal-saved">
                        ${goal.saved_amount.toFixed(2)}
                      </span>
                      <span className="goal-target">
                        {" "}
                        / ${goal.target_amount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="progress-bar goal-progress-bar">
                  <div
                    className="progress-fill goal-fill"
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>

                {goal.period && goal.contribution_amount > 0 && (
                  <div className="goal-contribution-status">
                    <span>
                      ${goal.contribution_amount.toFixed(2)}{" "}
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

                {goal.collect_leftovers && (
                  <div className="goal-leftovers-badge">
                    Collecting budget leftovers
                  </div>
                )}

                <div className="goal-card-actions">
                  <button
                    className="btn small primary"
                    onClick={() => handleAddSavings(goal)}
                  >
                    + Add
                  </button>
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
