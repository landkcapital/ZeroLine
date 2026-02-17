import { useState } from "react";

export default function AffordCheckCard({ budgets, spentMap, debtMap = {}, mainGoal }) {
  const [selectedBudgetId, setSelectedBudgetId] = useState(
    budgets[0]?.id || ""
  );
  const [hypothetical, setHypothetical] = useState("");
  const [coverBudgetId, setCoverBudgetId] = useState("");

  const amount = parseFloat(hypothetical) || 0;
  const selectedBudget = budgets.find((b) => b.id === selectedBudgetId);

  const currentSpent = selectedBudget ? (spentMap[selectedBudget.id] || 0) : 0;
  const currentDebt = selectedBudget ? (debtMap[selectedBudget.id] || 0) : 0;
  const currentRemaining = selectedBudget
    ? selectedBudget.goal_amount - currentSpent + currentDebt
    : 0;
  const newRemaining = currentRemaining - amount;

  const overspend = newRemaining < 0 ? Math.abs(newRemaining) : 0;

  // Other budgets that could cover the overspend
  const coverOptions = budgets.filter((b) => {
    if (b.id === selectedBudgetId) return false;
    const rem = b.goal_amount - (spentMap[b.id] || 0) + (debtMap[b.id] || 0);
    return rem > 0;
  });

  const coverBudget = coverOptions.find((b) => b.id === coverBudgetId);
  const coverRemaining = coverBudget
    ? coverBudget.goal_amount - (spentMap[coverBudget.id] || 0) + (debtMap[coverBudget.id] || 0)
    : 0;
  const coverAfter = coverRemaining - overspend;

  // Compute total remaining across all budgets after the hypothetical + cover
  const totalRemaining = budgets.reduce((acc, b) => {
    const spent = spentMap[b.id] || 0;
    const debt = debtMap[b.id] || 0;
    const rem = b.goal_amount - spent + debt;
    if (b.id === selectedBudgetId) {
      // If covering, this budget goes to $0 (the overspend is moved)
      return acc + (overspend > 0 && coverBudgetId ? 0 : rem - amount);
    }
    if (overspend > 0 && coverBudgetId && b.id === coverBudgetId) {
      return acc + rem - overspend;
    }
    return acc + rem;
  }, 0);

  return (
    <div className="card afford-card">
      <h3>Can I Afford This?</h3>
      <div className="afford-form">
        <div className="form-group">
          <label>Budget</label>
          <select
            value={selectedBudgetId}
            onChange={(e) => {
              setSelectedBudgetId(e.target.value);
              setCoverBudgetId("");
            }}
          >
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Hypothetical Spend</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={hypothetical}
            onChange={(e) => {
              setHypothetical(e.target.value);
              setCoverBudgetId("");
            }}
            placeholder="0.00"
          />
        </div>
      </div>
      {amount > 0 && (
        <div className="afford-results">
          <div className="afford-row">
            <span>New remaining for {selectedBudget?.name}:</span>
            <span className={newRemaining >= 0 ? "positive" : "negative"}>
              ${newRemaining.toFixed(2)}
            </span>
          </div>

          {overspend > 0 && coverOptions.length > 0 && (
            <div className="afford-cover">
              <div className="afford-cover-label">
                Cover the ${overspend.toFixed(2)} overspend from:
              </div>
              <select
                className="afford-cover-select"
                value={coverBudgetId}
                onChange={(e) => setCoverBudgetId(e.target.value)}
              >
                <option value="">-- Select a budget --</option>
                {coverOptions.map((b) => {
                  const rem = b.goal_amount - (spentMap[b.id] || 0) + (debtMap[b.id] || 0);
                  return (
                    <option key={b.id} value={b.id}>
                      {b.name} (${rem.toFixed(2)} remaining)
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {overspend > 0 && coverBudgetId && coverBudget && (
            <div className="afford-row">
              <span>New remaining for {coverBudget.name}:</span>
              <span className={coverAfter >= 0 ? "positive" : "negative"}>
                ${coverAfter.toFixed(2)}
              </span>
            </div>
          )}

          <div className="afford-row">
            <span>New total across all budgets:</span>
            <span className={totalRemaining >= 0 ? "positive" : "negative"}>
              ${totalRemaining.toFixed(2)}
            </span>
          </div>

          {newRemaining < 0 && mainGoal && (
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
        </div>
      )}
    </div>
  );
}
