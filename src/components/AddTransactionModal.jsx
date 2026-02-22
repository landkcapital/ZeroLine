import { useState } from "react";
import { supabase } from "../lib/supabase";

function toLocalDatetime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

export default function AddTransactionModal({ budgets, spentMap = {}, debtMap = {}, mainGoal, groupMap = {}, onClose, onAdded }) {
  const [amount, setAmount] = useState("");
  const [budgetId, setBudgetId] = useState(budgets[0]?.id || "");
  const [note, setNote] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => toLocalDatetime(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Goal reminder logic
  const parsedAmount = parseFloat(amount) || 0;
  const selectedBudget = budgets.find((b) => b.id === budgetId);
  const budgetRemaining = selectedBudget
    ? selectedBudget.goal_amount - (spentMap[selectedBudget.id] || 0) + (debtMap[selectedBudget.id] || 0)
    : 0;
  const showGoalReminder = mainGoal && parsedAmount > 0 && parsedAmount > budgetRemaining;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!amount || !budgetId) return;

    setSaving(true);
    setError(null);

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

    onAdded();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Transaction</h2>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
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
              {(() => {
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
              })()}
            </select>
          </div>
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
            {saving ? "Saving..." : "Add Transaction"}
          </button>
        </form>
      </div>
    </div>
  );
}
