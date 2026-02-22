import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { getPeriodLabel } from "../lib/period";

export default memo(function BudgetCard({ budget, spent, carriedDebt = 0, allocated = 0 }) {
  const navigate = useNavigate();
  const remaining = budget.goal_amount - spent - allocated + carriedDebt;
  const effectiveGoal = Math.max(0, budget.goal_amount + carriedDebt);
  const progress = effectiveGoal > 0 ? ((spent + allocated) / effectiveGoal) * 100 : (spent > 0 ? 100 : 0);

  return (
    <div
      className="card budget-card"
      onClick={() => navigate(`/budget/${budget.id}`)}
      style={{ cursor: "pointer" }}
    >
      <div className="budget-card-header">
        <h3>{budget.name}</h3>
        <span className="period-badge">{getPeriodLabel(budget.period)}</span>
      </div>
      <div className="budget-stats">
        <div className="stat">
          <span className="stat-label">Goal</span>
          <span className="stat-value">${budget.goal_amount.toFixed(2)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Spent</span>
          <span className="stat-value">${spent.toFixed(2)}</span>
        </div>
        {allocated > 0 && (
          <div className="stat">
            <span className="stat-label">Allocated</span>
            <span className="stat-value allocated">${allocated.toFixed(2)}</span>
          </div>
        )}
        <div className="stat">
          <span className="stat-label">Remaining</span>
          <span
            className={`stat-value ${remaining >= 0 ? "positive" : "negative"}`}
          >
            ${remaining.toFixed(2)}
          </span>
        </div>
      </div>
      <div className="progress-bar">
        <div
          className={`progress-fill ${progress > 100 ? "over" : ""}`}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
        {allocated > 0 && spent < effectiveGoal && (
          <div
            className="progress-fill allocated"
            style={{
              width: `${Math.min((allocated / effectiveGoal) * 100, Math.max(0, 100 - (spent / effectiveGoal) * 100))}%`,
              left: `${Math.min((spent / effectiveGoal) * 100, 100)}%`,
            }}
          />
        )}
      </div>
    </div>
  );
})
