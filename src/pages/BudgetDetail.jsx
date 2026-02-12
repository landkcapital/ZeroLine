import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getPeriodStart, getPeriodLabel } from "../lib/period";
import Loading from "../components/Loading";

export default function BudgetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [budget, setBudget] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDeleteBudget, setConfirmDeleteBudget] = useState(false);

  async function handleDeleteBudget() {
    await supabase.from("transactions").delete().eq("budget_id", id);
    await supabase.from("budgets").delete().eq("id", id);
    navigate("/");
  }

  async function handleDeleteTransaction(txId) {
    await supabase.from("transactions").delete().eq("id", txId);
    setConfirmDelete(null);
    fetchData();
  }

  const fetchData = useCallback(async () => {
    const { data: budgetRows, error: budgetError } = await supabase
      .from("budgets")
      .select("*")
      .eq("id", id)
      .limit(1);

    const budgetData = budgetRows?.[0] ?? null;

    if (budgetError || !budgetData) {
      setLoading(false);
      return;
    }

    setBudget(budgetData);

    // Only fetch transactions for spending budgets
    if (budgetData.type !== "subscription") {
      const periodStart = getPeriodStart(budgetData.period, budgetData.renew_anchor);

      const { data: txData } = await supabase
        .from("transactions")
        .select("*")
        .eq("budget_id", id)
        .gte("occurred_at", periodStart.toISOString())
        .order("occurred_at", { ascending: false });

      setTransactions(txData || []);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <Loading />;

  if (!budget) {
    return (
      <div className="page">
        <div className="empty-state card">
          <p>Budget not found.</p>
        </div>
        <button className="btn secondary" onClick={() => navigate("/")}>
          &larr; Back to Home
        </button>
      </div>
    );
  }

  const isSubscription = budget.type === "subscription";
  const spent = isSubscription
    ? budget.goal_amount
    : transactions.reduce((sum, t) => sum + t.amount, 0);
  const remaining = budget.goal_amount - spent;
  const progress =
    budget.goal_amount > 0 ? (spent / budget.goal_amount) * 100 : 0;

  return (
    <div className="page detail-page">
      <button className="btn secondary back-btn" onClick={() => navigate("/")}>
        &larr; Back
      </button>

      <div className="card detail-hero">
        <div className="detail-hero-header">
          <h2>{budget.name}</h2>
          <div className="detail-hero-badges">
            <span className={`type-badge ${isSubscription ? "subscription" : ""}`}>
              {isSubscription ? "Fixed" : "Spending"}
            </span>
            <span className="period-badge">
              {getPeriodLabel(budget.period)}
            </span>
          </div>
        </div>
        {isSubscription ? (
          <div className="summary-bar">
            <div className="summary-item">
              <span className="summary-label">Committed</span>
              <span className="summary-value">
                ${budget.goal_amount.toFixed(2)}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="summary-bar">
              <div className="summary-item">
                <span className="summary-label">Goal</span>
                <span className="summary-value">
                  ${budget.goal_amount.toFixed(2)}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Spent</span>
                <span className="summary-value">${spent.toFixed(2)}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Remaining</span>
                <span
                  className={`summary-value ${remaining >= 0 ? "positive" : "negative"}`}
                >
                  ${remaining.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="progress-bar detail-progress">
              <div
                className={`progress-fill ${progress > 100 ? "over" : ""}`}
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
          </>
        )}
      </div>

      {isSubscription ? (
        <div className="empty-state card">
          <p>This is a fixed subscription — auto-committed each period.</p>
        </div>
      ) : (
        <>
          <h3 className="section-title">Transactions</h3>
          {transactions.length === 0 ? (
            <div className="empty-state card">
              <p>No transactions this period.</p>
            </div>
          ) : (
            <div className="transaction-list">
              {transactions.map((t) => (
                <div key={t.id} className="card transaction-item">
                  <div className="transaction-info">
                    <span className="transaction-amount">
                      ${t.amount.toFixed(2)}
                    </span>
                    <span className="transaction-note">
                      {t.note || "No note"}
                    </span>
                  </div>
                  <div className="transaction-right">
                    <span className="transaction-date">
                      {new Date(t.occurred_at).toLocaleString()}
                    </span>
                    {confirmDelete === t.id ? (
                      <div className="transaction-confirm">
                        <button
                          className="btn small danger"
                          onClick={() => handleDeleteTransaction(t.id)}
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
                        className="btn small danger tx-delete-btn"
                        onClick={() => setConfirmDelete(t.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="delete-budget-section">
        {confirmDeleteBudget ? (
          <div className="delete-budget-confirm">
            <p>Delete <strong>{budget.name}</strong> and all its transactions?</p>
            <div className="delete-budget-actions">
              <button className="btn small danger" onClick={handleDeleteBudget}>
                Yes, Delete
              </button>
              <button className="btn small secondary" onClick={() => setConfirmDeleteBudget(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn small danger delete-budget-btn"
            onClick={() => setConfirmDeleteBudget(true)}
          >
            Delete Budget
          </button>
        )}
      </div>
    </div>
  );
}
