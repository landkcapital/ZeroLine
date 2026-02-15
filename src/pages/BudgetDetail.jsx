import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getPeriodStart, getPeriodLabel, stepPeriod } from "../lib/period";
import Loading from "../components/Loading";

export default function BudgetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [budget, setBudget] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDeleteBudget, setConfirmDeleteBudget] = useState(false);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpSourceId, setTopUpSourceId] = useState("");
  const [topUpMode, setTopUpMode] = useState("budget");
  const [otherBudgets, setOtherBudgets] = useState([]);
  const [transferring, setTransferring] = useState(false);

  async function handleDeleteBudget() {
    setDeleting(true);
    setError(null);
    try {
      const { error: txErr } = await supabase.from("transactions").delete().eq("budget_id", id);
      if (txErr) throw txErr;
      const { error: budgetErr } = await supabase.from("budgets").delete().eq("id", id);
      if (budgetErr) throw budgetErr;
      navigate("/");
    } catch (err) {
      setError(err.message || "Failed to delete budget");
      setDeleting(false);
    }
  }

  async function handleDeleteTransaction(txId) {
    setDeleting(true);
    setError(null);
    try {
      const { error: txErr } = await supabase.from("transactions").delete().eq("id", txId);
      if (txErr) throw txErr;
      setConfirmDelete(null);
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to delete transaction");
    } finally {
      setDeleting(false);
    }
  }

  async function handleTopUp() {
    const amount = parseFloat(topUpAmount);
    if (!amount || amount <= 0 || !topUpSourceId) return;

    setTransferring(true);
    setError(null);
    try {
      const now = new Date().toISOString();

      if (topUpMode === "next-period") {
        // Find the source budget (could be current budget or another)
        const source = topUpSourceId === id
          ? budget
          : otherBudgets.find((b) => b.id === topUpSourceId);
        if (!source) return;

        const nextPeriodStart = stepPeriod(
          source.period,
          getPeriodStart(source.period, source.renew_anchor),
          "next"
        ).toISOString();

        const [targetResult, sourceResult] = await Promise.all([
          supabase.from("transactions").insert({
            budget_id: id,
            amount: -amount,
            note: `Borrowed from ${source.name} (next period)`,
            occurred_at: now,
          }),
          supabase.from("transactions").insert({
            budget_id: topUpSourceId,
            amount: amount,
            note: `Borrowed by ${budget.name} (from next period)`,
            occurred_at: nextPeriodStart,
          }),
        ]);

        if (targetResult.error) throw targetResult.error;
        if (sourceResult.error) throw sourceResult.error;
      } else {
        const source = otherBudgets.find((b) => b.id === topUpSourceId);
        if (!source) return;

        const [targetResult, sourceResult] = await Promise.all([
          supabase.from("transactions").insert({
            budget_id: id,
            amount: -amount,
            note: `Top up from ${source.name}`,
            occurred_at: now,
          }),
          supabase.from("transactions").insert({
            budget_id: topUpSourceId,
            amount: amount,
            note: `Transfer to ${budget.name}`,
            occurred_at: now,
          }),
        ]);

        if (targetResult.error) throw targetResult.error;
        if (sourceResult.error) throw sourceResult.error;
      }

      setShowTopUp(false);
      setTopUpAmount("");
      setTopUpSourceId("");
      setTopUpMode("budget");
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to transfer");
    } finally {
      setTransferring(false);
    }
  }

  const fetchData = useCallback(async () => {
    try {
      const { data: budgetRows, error: budgetError } = await supabase
        .from("budgets")
        .select("*")
        .eq("id", id)
        .limit(1);

      if (budgetError) throw budgetError;
      const budgetData = budgetRows?.[0] ?? null;

      if (!budgetData) {
        setLoading(false);
        return;
      }

      setBudget(budgetData);

      if (budgetData.type !== "subscription") {
        const periodStart = getPeriodStart(budgetData.period, budgetData.renew_anchor);

        // Fetch this budget's transactions and all other spending budgets in parallel
        const [txResult, othersResult] = await Promise.all([
          supabase
            .from("transactions")
            .select("*")
            .eq("budget_id", id)
            .gte("occurred_at", periodStart.toISOString())
            .order("occurred_at", { ascending: false }),
          supabase
            .from("budgets")
            .select("*")
            .neq("type", "subscription")
            .neq("id", id)
            .order("name"),
        ]);

        if (txResult.error) throw txResult.error;
        if (othersResult.error) throw othersResult.error;

        setTransactions(txResult.data || []);

        // Calculate remaining for each other budget
        const others = othersResult.data || [];
        if (others.length > 0) {
          const budgetIds = others.map((b) => b.id);
          let earliestStart = new Date();
          const periodStarts = {};
          for (const b of others) {
            const ps = getPeriodStart(b.period, b.renew_anchor);
            periodStarts[b.id] = ps.getTime();
            if (ps < earliestStart) earliestStart = ps;
          }

          const { data: otherTx } = await supabase
            .from("transactions")
            .select("budget_id, amount, occurred_at")
            .in("budget_id", budgetIds)
            .gte("occurred_at", earliestStart.toISOString());

          const spentMap = {};
          for (const b of others) spentMap[b.id] = 0;
          for (const t of otherTx || []) {
            const ps = periodStarts[t.budget_id];
            if (ps != null && new Date(t.occurred_at).getTime() >= ps) {
              spentMap[t.budget_id] += t.amount;
            }
          }

          setOtherBudgets(
            others.map((b) => ({
              ...b,
              remaining: b.goal_amount - (spentMap[b.id] || 0),
            }))
          );
        } else {
          setOtherBudgets([]);
        }
      }

      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load budget");
    } finally {
      setLoading(false);
    }
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

      {error && <p className="form-error" style={{ margin: "0.75rem 0" }}>{error}</p>}

      {!isSubscription && (
        <div className="topup-section">
          {showTopUp ? (
            <div className="card topup-form">
              <h3>Top Up {budget.name}</h3>
              <div className="topup-mode-toggle">
                <button
                  className={`topup-mode-btn ${topUpMode === "budget" ? "active" : ""}`}
                  onClick={() => { setTopUpMode("budget"); setTopUpSourceId(""); }}
                  type="button"
                >
                  From budget
                </button>
                <button
                  className={`topup-mode-btn ${topUpMode === "next-period" ? "active" : ""}`}
                  onClick={() => { setTopUpMode("next-period"); setTopUpSourceId(""); }}
                  type="button"
                >
                  From next period
                </button>
              </div>
              <div className="form-group">
                <label>Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="form-group">
                <label>{topUpMode === "next-period" ? "Borrow from" : "Take from"}</label>
                <select
                  value={topUpSourceId}
                  onChange={(e) => setTopUpSourceId(e.target.value)}
                >
                  <option value="">-- Select a budget --</option>
                  {topUpMode === "next-period" ? (
                    <>
                      <option value={id}>{budget.name} (this budget)</option>
                      {otherBudgets.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </>
                  ) : (
                    otherBudgets
                      .filter((b) => b.remaining > 0)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} (${b.remaining.toFixed(2)} remaining)
                        </option>
                      ))
                  )}
                </select>
              </div>
              {topUpSourceId && topUpAmount && parseFloat(topUpAmount) > 0 && (
                <div className="topup-preview">
                  {(() => {
                    const amt = parseFloat(topUpAmount) || 0;
                    const targetAfter = remaining + amt;

                    if (topUpMode === "next-period") {
                      const source = topUpSourceId === id
                        ? budget
                        : otherBudgets.find((b) => b.id === topUpSourceId);
                      if (!source) return null;
                      return (
                        <>
                          <div className="topup-preview-row">
                            <span>{budget.name} remaining now:</span>
                            <span className={targetAfter >= 0 ? "positive" : "negative"}>
                              ${targetAfter.toFixed(2)}
                            </span>
                          </div>
                          <div className="topup-preview-row">
                            <span>{source.name} next period:</span>
                            <span className="negative">
                              -${amt.toFixed(2)}
                            </span>
                          </div>
                        </>
                      );
                    }

                    const source = otherBudgets.find((b) => b.id === topUpSourceId);
                    if (!source) return null;
                    const sourceAfter = source.remaining - amt;
                    return (
                      <>
                        <div className="topup-preview-row">
                          <span>{budget.name} remaining:</span>
                          <span className={targetAfter >= 0 ? "positive" : "negative"}>
                            ${targetAfter.toFixed(2)}
                          </span>
                        </div>
                        <div className="topup-preview-row">
                          <span>{source.name} remaining:</span>
                          <span className={sourceAfter >= 0 ? "positive" : "negative"}>
                            ${sourceAfter.toFixed(2)}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
              <div className="topup-actions">
                <button
                  className="btn primary"
                  onClick={handleTopUp}
                  disabled={transferring || !topUpSourceId || !topUpAmount || parseFloat(topUpAmount) <= 0}
                >
                  {transferring ? "Transferring..." : topUpMode === "next-period" ? "Borrow" : "Transfer"}
                </button>
                <button
                  className="btn secondary"
                  onClick={() => {
                    setShowTopUp(false);
                    setTopUpAmount("");
                    setTopUpSourceId("");
                    setTopUpMode("budget");
                  }}
                  disabled={transferring}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn topup-btn"
              onClick={() => {
                setShowTopUp(true);
                if (remaining < 0) {
                  setTopUpAmount(Math.abs(remaining).toFixed(2));
                }
              }}
            >
              Top Up Budget
            </button>
          )}
        </div>
      )}

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
                          disabled={deleting}
                        >
                          {deleting ? "Deleting..." : "Confirm"}
                        </button>
                        <button
                          className="btn small secondary"
                          onClick={() => setConfirmDelete(null)}
                          disabled={deleting}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn small danger tx-delete-btn"
                        onClick={() => setConfirmDelete(t.id)}
                        disabled={deleting}
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
              <button className="btn small danger" onClick={handleDeleteBudget} disabled={deleting}>
                {deleting ? "Deleting..." : "Yes, Delete"}
              </button>
              <button className="btn small secondary" onClick={() => setConfirmDeleteBudget(false)} disabled={deleting}>
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
