import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

function toLocalDatetime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

export default function AddTransactionModal({ budgets, spentMap = {}, debtMap = {}, allocatedMap = {}, mainGoal, groupMap = {}, onClose, onAdded }) {
  const [mode, setMode] = useState("spend"); // "spend" | "allocate" | "use-allocation"
  const [amount, setAmount] = useState("");
  const [budgetId, setBudgetId] = useState(budgets[0]?.id || "");
  const [note, setNote] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => toLocalDatetime(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Use Allocation state
  const [allocations, setAllocations] = useState([]);
  const [loadingAllocs, setLoadingAllocs] = useState(false);
  const [selectedAlloc, setSelectedAlloc] = useState(null);

  // Fetch allocations when switching to use-allocation mode
  useEffect(() => {
    if (mode !== "use-allocation") return;
    setLoadingAllocs(true);
    const budgetIds = budgets.map((b) => b.id);
    if (budgetIds.length === 0) {
      setAllocations([]);
      setLoadingAllocs(false);
      return;
    }
    supabase
      .from("allocations")
      .select("*")
      .in("budget_id", budgetIds)
      .order("created_at", { ascending: false })
      .then(({ data, error: fetchErr }) => {
        if (fetchErr) {
          setError(fetchErr.message);
        } else {
          setAllocations(data || []);
        }
        setLoadingAllocs(false);
      });
  }, [mode, budgets]);

  // Goal reminder logic (spend mode only)
  const parsedAmount = parseFloat(amount) || 0;
  const selectedBudget = budgets.find((b) => b.id === budgetId);
  const budgetAllocated = selectedBudget ? (allocatedMap[selectedBudget.id] || 0) : 0;
  const budgetRemaining = selectedBudget
    ? selectedBudget.goal_amount - (spentMap[selectedBudget.id] || 0) - budgetAllocated + (debtMap[selectedBudget.id] || 0)
    : 0;
  const showGoalReminder = mode === "spend" && mainGoal && parsedAmount > 0 && parsedAmount > budgetRemaining;

  function getBudgetName(bId) {
    const b = budgets.find((x) => x.id === bId);
    return b ? b.name : "Unknown";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!amount || !budgetId) return;

    setSaving(true);
    setError(null);

    if (mode === "allocate") {
      const { error: insertError } = await supabase
        .from("allocations")
        .insert({
          budget_id: budgetId,
          amount: parseFloat(amount),
          note: note || null,
        });

      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from("transactions")
        .insert({
          budget_id: budgetId,
          amount: parseFloat(amount),
          note: note || null,
          occurred_at: new Date(occurredAt).toISOString(),
        });

      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }
    }

    onAdded();
    onClose();
  }

  async function handleResolveAllocation(e) {
    e.preventDefault();
    if (!selectedAlloc || !amount) return;

    setSaving(true);
    setError(null);

    try {
      // Delete the allocation
      const { error: delErr } = await supabase
        .from("allocations")
        .delete()
        .eq("id", selectedAlloc.id);
      if (delErr) throw delErr;

      // Create actual transaction with the real amount
      const { error: txErr } = await supabase
        .from("transactions")
        .insert({
          budget_id: selectedAlloc.budget_id,
          amount: parseFloat(amount),
          note: note || selectedAlloc.note || null,
          occurred_at: new Date(occurredAt).toISOString(),
        });
      if (txErr) throw txErr;

      onAdded();
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  function selectAllocation(alloc) {
    setSelectedAlloc(alloc);
    setAmount(alloc.amount.toString());
    setNote(alloc.note || "");
    setBudgetId(alloc.budget_id);
    setOccurredAt(toLocalDatetime(new Date()));
  }

  function renderBudgetSelect() {
    const personal = budgets.filter((b) => !b.group_id);
    const grouped = {};
    for (const b of budgets.filter((b) => b.group_id)) {
      const gName = groupMap[b.group_id] || "Group";
      if (!grouped[gName]) grouped[gName] = [];
      grouped[gName].push(b);
    }
    const hasGroups = Object.keys(grouped).length > 0;
    return (
      <>
        {hasGroups ? (
          <optgroup label="Personal">
            {personal.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </optgroup>
        ) : (
          personal.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))
        )}
        {Object.entries(grouped).map(([gName, gBudgets]) => (
          <optgroup key={gName} label={gName}>
            {gBudgets.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </optgroup>
        ))}
      </>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {mode === "spend" ? "Add Transaction" : mode === "allocate" ? "Allocate Funds" : "Use Allocation"}
          </h2>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="modal-mode-toggle">
          <button
            className={`modal-mode-btn ${mode === "spend" ? "active" : ""}`}
            onClick={() => { setMode("spend"); setSelectedAlloc(null); setError(null); }}
            type="button"
          >
            Spend
          </button>
          <button
            className={`modal-mode-btn ${mode === "allocate" ? "active" : ""}`}
            onClick={() => { setMode("allocate"); setSelectedAlloc(null); setError(null); }}
            type="button"
          >
            Allocate
          </button>
          <button
            className={`modal-mode-btn ${mode === "use-allocation" ? "active" : ""}`}
            onClick={() => { setMode("use-allocation"); setSelectedAlloc(null); setError(null); }}
            type="button"
          >
            Use Allocation
          </button>
        </div>

        {mode === "use-allocation" && !selectedAlloc ? (
          <div className="allocation-list">
            {loadingAllocs ? (
              <p style={{ textAlign: "center", padding: "1rem", color: "var(--text-dim)" }}>Loading...</p>
            ) : allocations.length === 0 ? (
              <p style={{ textAlign: "center", padding: "1rem", color: "var(--text-dim)" }}>No pending allocations.</p>
            ) : (
              allocations.map((alloc) => (
                <div
                  key={alloc.id}
                  className="allocation-list-item"
                  onClick={() => selectAllocation(alloc)}
                >
                  <div className="allocation-list-info">
                    <span className="allocation-list-amount">${alloc.amount.toFixed(2)}</span>
                    <span className="allocation-list-budget">{getBudgetName(alloc.budget_id)}</span>
                  </div>
                  <div className="allocation-list-meta">
                    <span>{alloc.note || "No note"}</span>
                    <span>{new Date(alloc.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : mode === "use-allocation" && selectedAlloc ? (
          <form onSubmit={handleResolveAllocation}>
            <div className="allocation-resolve-info">
              <span>Allocated: <strong>${selectedAlloc.amount.toFixed(2)}</strong> from <strong>{getBudgetName(selectedAlloc.budget_id)}</strong></span>
            </div>
            <div className="form-group">
              <label>Actual Amount Spent</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
                autoFocus
              />
            </div>
            {parsedAmount !== selectedAlloc.amount && parsedAmount > 0 && (
              <div className={`allocation-diff ${parsedAmount > selectedAlloc.amount ? "over" : "under"}`}>
                {parsedAmount > selectedAlloc.amount
                  ? `$${(parsedAmount - selectedAlloc.amount).toFixed(2)} more than allocated`
                  : `$${(selectedAlloc.amount - parsedAmount).toFixed(2)} returned to budget`}
              </div>
            )}
            <div className="form-group">
              <label>Note (optional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What was this for?"
              />
            </div>
            <div className="form-group">
              <label>Date & Time</label>
              <input
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                required
              />
            </div>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button type="submit" className="btn primary" disabled={saving} style={{ flex: 1 }}>
                {saving ? "Saving..." : "Confirm Spend"}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => { setSelectedAlloc(null); setAmount(""); setNote(""); }}
                disabled={saving}
              >
                Back
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Amount</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Budget</label>
              <select
                value={budgetId}
                onChange={(e) => setBudgetId(e.target.value)}
                required
              >
                {renderBudgetSelect()}
              </select>
            </div>
            <div className="form-group">
              <label>Note (optional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={mode === "allocate" ? "What is this for?" : "What was this for?"}
              />
            </div>
            {mode === "spend" && (
              <div className="form-group">
                <label>Date & Time</label>
                <input
                  type="datetime-local"
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                  required
                />
              </div>
            )}
            {error && <p className="form-error">{error}</p>}

            {showGoalReminder && (
              <div className="goal-reminder">
                {mainGoal.image_url && (
                  <img src={mainGoal.image_url} alt={mainGoal.name} className="goal-reminder-image" />
                )}
                <div className="goal-reminder-text">
                  <div className="goal-reminder-title">Remember your goal!</div>
                  <div className="goal-reminder-message">
                    Will this help you save for <strong>{mainGoal.name}</strong>?
                  </div>
                  <div className="goal-reminder-progress">
                    ${mainGoal.saved_amount.toFixed(2)} / ${mainGoal.target_amount.toFixed(2)} saved
                  </div>
                </div>
              </div>
            )}

            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "Saving..." : mode === "allocate" ? "Allocate" : "Add Transaction"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
