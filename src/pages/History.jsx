import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  getPeriodRange,
  stepPeriod,
  formatPeriodRange,
  getPeriodLabel,
} from "../lib/period";
import Loading from "../components/Loading";

export default function History() {
  const [period, setPeriod] = useState("fortnightly");
  const [refDate, setRefDate] = useState(new Date());
  const [budgets, setBudgets] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { start, end } = getPeriodRange(period, refDate);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { start: s, end: e } = getPeriodRange(period, refDate);

      const { data: budgetsData, error: budgetsErr } = await supabase
        .from("budgets")
        .select("*")
        .order("name");

      if (budgetsErr) throw budgetsErr;
      setBudgets(budgetsData || []);

      const { data: txData, error: txErr } = await supabase
        .from("transactions")
        .select("*")
        .gte("occurred_at", s.toISOString())
        .lte("occurred_at", e.toISOString())
        .order("occurred_at", { ascending: false });

      if (txErr) throw txErr;
      setTransactions(txData || []);
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [period, refDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handlePrev() {
    setRefDate(stepPeriod(period, refDate, "prev"));
  }

  function handleNext() {
    setRefDate(stepPeriod(period, refDate, "next"));
  }

  function handlePeriodChange(newPeriod) {
    setPeriod(newPeriod);
    setRefDate(new Date());
  }

  const spentByBudget = {};
  for (const t of transactions) {
    spentByBudget[t.budget_id] = (spentByBudget[t.budget_id] || 0) + t.amount;
  }

  const budgetMap = {};
  for (const b of budgets) {
    budgetMap[b.id] = b;
  }

  const subscriptions = budgets.filter((b) => b.type === "subscription");
  const spendingBudgets = budgets.filter((b) => b.type !== "subscription");

  const totalSubscriptions = subscriptions.reduce((s, b) => s + b.goal_amount, 0);
  const totalBudget = spendingBudgets.reduce((s, b) => s + b.goal_amount, 0);
  const totalSpent = transactions.reduce((s, t) => s + t.amount, 0);
  const totalRemaining = totalBudget - totalSpent;

  return (
    <div className="page history-page">
      <div className="card history-controls">
        <div className="history-period-selector">
          {["weekly", "fortnightly", "4-weekly"].map((p) => (
            <button
              key={p}
              className={`btn small ${period === p ? "active-period" : ""}`}
              onClick={() => handlePeriodChange(p)}
            >
              {p === "weekly"
                ? "Week"
                : p === "fortnightly"
                  ? "Fortnight"
                  : "4 Weeks"}
            </button>
          ))}
        </div>
        <div className="history-nav">
          <button className="btn small" onClick={handlePrev}>
            &larr;
          </button>
          <span className="history-range-label">
            {formatPeriodRange(period, start, end)}
          </span>
          <button className="btn small" onClick={handleNext}>
            &rarr;
          </button>
        </div>
      </div>

      {loading ? (
        <Loading />
      ) : error ? (
        <div className="card" style={{ padding: "1.5rem", textAlign: "center" }}>
          <p className="form-error">{error}</p>
          <button className="btn primary" onClick={fetchData} style={{ marginTop: "1rem" }}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="card summary-card">
            <div className="summary-bar summary-bar-4">
              <div className="summary-item">
                <span className="summary-label">Subscriptions</span>
                <span className="summary-value">
                  ${totalSubscriptions.toFixed(2)}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Spending Budget</span>
                <span className="summary-value">
                  ${totalBudget.toFixed(2)}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Spent</span>
                <span className="summary-value">
                  ${totalSpent.toFixed(2)}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Remaining</span>
                <span
                  className={`summary-value ${totalRemaining >= 0 ? "positive" : "negative"}`}
                >
                  ${totalRemaining.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {subscriptions.length > 0 && (
            <div className="card subscription-section">
              <div className="subscription-header">
                <h3 className="subscription-section-title">Subscriptions</h3>
                <span className="subscription-total">
                  ${totalSubscriptions.toFixed(2)}
                </span>
              </div>
              {subscriptions.map((sub) => (
                <div key={sub.id} className="subscription-row">
                  <div className="subscription-row-left">
                    <span className="subscription-name">{sub.name}</span>
                    <span className="period-badge">{getPeriodLabel(sub.period)}</span>
                  </div>
                  <div className="subscription-row-right">
                    <span className="subscription-amount">
                      ${sub.goal_amount.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <h3 className="section-title">Spending Breakdown</h3>
          <div className="history-budget-list">
            {spendingBudgets.length === 0 ? (
              <div className="empty-state card">
                <p>No spending budgets.</p>
              </div>
            ) : (
              spendingBudgets.map((b) => {
                const bSpent = spentByBudget[b.id] || 0;
                const bRemaining = b.goal_amount - bSpent;
                const bProgress =
                  b.goal_amount > 0 ? (bSpent / b.goal_amount) * 100 : 0;
                return (
                  <div key={b.id} className="card history-budget-row">
                    <div className="history-budget-name">
                      <span>{b.name}</span>
                      <span className="period-badge">{b.period}</span>
                    </div>
                    <div className="budget-stats">
                      <div className="stat">
                        <span className="stat-label">Goal</span>
                        <span className="stat-value">
                          ${b.goal_amount.toFixed(2)}
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Spent</span>
                        <span className="stat-value">
                          ${bSpent.toFixed(2)}
                        </span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Remaining</span>
                        <span
                          className={`stat-value ${bRemaining >= 0 ? "positive" : "negative"}`}
                        >
                          ${bRemaining.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="progress-bar">
                      <div
                        className={`progress-fill ${bProgress > 100 ? "over" : ""}`}
                        style={{ width: `${Math.min(bProgress, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <h3 className="section-title">All Transactions</h3>
          {transactions.length === 0 ? (
            <div className="empty-state card">
              <p>No transactions in this period.</p>
            </div>
          ) : (
            <div className="transaction-list">
              {transactions.map((t) => (
                <div key={t.id} className="card transaction-item">
                  <div className="transaction-info">
                    <span className="transaction-amount">
                      ${t.amount.toFixed(2)}
                    </span>
                    <span className="transaction-budget-tag">
                      {budgetMap[t.budget_id]?.name || "Unknown"}
                    </span>
                    <span className="transaction-note">
                      {t.note || "No note"}
                    </span>
                  </div>
                  <span className="transaction-date">
                    {new Date(t.occurred_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
