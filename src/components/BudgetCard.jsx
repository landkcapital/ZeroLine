import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { getPeriodLabel } from "../lib/period";

export default memo(function BudgetCard({ budget, spent }) {
  const navigate = useNavigate();
  const remaining = budget.goal_amount - spent;
  const progress = budget.goal_amount > 0 ? (spent / budget.goal_amount) * 100 : 0;

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
      </div>
    </div>
  );
})
