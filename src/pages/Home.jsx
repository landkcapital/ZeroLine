import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getPeriodStart, getPeriodLabel } from "../lib/period";
import BudgetCard from "../components/BudgetCard";
import AffordCheckCard from "../components/AffordCheckCard";
import AddTransactionModal from "../components/AddTransactionModal";
import Loading from "../components/Loading";

const PERIOD_DAYS = { weekly: 7, fortnightly: 14, "4-weekly": 28, monthly: 30.44 };
const VIEW_PERIODS = ["weekly", "fortnightly", "4-weekly"];
const VIEW_LABELS = { weekly: "Weekly", fortnightly: "Fortnightly", "4-weekly": "4-Weekly" };

function normalize(amount, fromPeriod, toPeriod) {
  const fromDays = PERIOD_DAYS[fromPeriod] || 14;
  const toDays = PERIOD_DAYS[toPeriod] || 14;
  return amount * (toDays / fromDays);
}

export default function Home() {
  const navigate = useNavigate();
  const [budgets, setBudgets] = useState([]);
  const [spentMap, setSpentMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [viewPeriod, setViewPeriod] = useState(
    () => localStorage.getItem("viewPeriod") || "fortnightly"
  );

  const fetchData = useCallback(async () => {
    const { data: budgetsData } = await supabase
      .from("budgets")
      .select("*")
      .order("name");

    if (!budgetsData) {
      setLoading(false);
      return;
    }

    setBudgets(budgetsData);

    const newSpentMap = {};

    // Only fetch transactions for spending budgets
    const spendingBudgets = budgetsData.filter((b) => b.type !== "subscription");

    await Promise.all(
      spendingBudgets.map(async (budget) => {
        const periodStart = getPeriodStart(budget.period, budget.renew_anchor);

        const { data: transactions } = await supabase
          .from("transactions")
          .select("amount")
          .eq("budget_id", budget.id)
          .gte("occurred_at", periodStart.toISOString());

        const total = (transactions || []).reduce(
          (sum, t) => sum + t.amount,
          0
        );
        newSpentMap[budget.id] = total;
      })
    );

    setSpentMap(newSpentMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <Loading />;

  const subscriptions = budgets.filter((b) => b.type === "subscription");
  const spendingBudgets = budgets.filter((b) => b.type !== "subscription");

  const totalSubscriptions = subscriptions.reduce(
    (s, b) => s + normalize(b.goal_amount, b.period, viewPeriod), 0
  );
  const totalBudget = spendingBudgets.reduce(
    (s, b) => s + normalize(b.goal_amount, b.period, viewPeriod), 0
  );
  const totalSpent = spendingBudgets.reduce(
    (s, b) => s + (spentMap[b.id] || 0), 0
  );
  const totalRemaining = totalBudget - totalSpent;

  const handleViewPeriodChange = (e) => {
    setViewPeriod(e.target.value);
    localStorage.setItem("viewPeriod", e.target.value);
  };

  const hasAny = budgets.length > 0;
  const hasSpending = spendingBudgets.length > 0;

  return (
    <div className="page home-page">
      <button
        className={`spend-btn${!hasSpending ? " disabled" : ""}`}
        onClick={() => hasSpending && setShowModal(true)}
        disabled={!hasSpending}
      >
        <span className="spend-btn-icon-ring">
          <span className="spend-btn-icon">+</span>
        </span>
        <span className="spend-btn-text">I Spent</span>
      </button>

      <div className="card summary-card">
        <div className="summary-card-header">
          <select className="period-select" value={viewPeriod} onChange={handleViewPeriodChange}>
            {VIEW_PERIODS.map((p) => (
              <option key={p} value={p}>{VIEW_LABELS[p]}</option>
            ))}
          </select>
        </div>
        <div className="summary-bar summary-bar-4">
          <div className="summary-item">
            <span className="summary-label">Subscriptions</span>
            <span className="summary-value">${totalSubscriptions.toFixed(2)}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Budget</span>
            <span className="summary-value">${totalBudget.toFixed(2)}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Spent</span>
            <span className="summary-value">${totalSpent.toFixed(2)}</span>
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

      {!hasAny ? (
        <div className="empty-state card">
          <p>No budgets yet. Head to the Budgets page to create one.</p>
        </div>
      ) : (
        <>
          {hasSpending && (
            <AffordCheckCard budgets={spendingBudgets} spentMap={spentMap} />
          )}

          {hasSpending && (
            <div className="budget-grid">
              {spendingBudgets.map((budget) => (
                <BudgetCard
                  key={budget.id}
                  budget={budget}
                  spent={spentMap[budget.id] || 0}
                />
              ))}
            </div>
          )}

          {subscriptions.length > 0 && (
            <div className="card subscription-section">
              <div className="subscription-header">
                <h3 className="subscription-section-title">Subscriptions</h3>
                <span className="subscription-total">
                  ${totalSubscriptions.toFixed(2)}
                  <span className="subscription-total-label"> / </span>
                  <select className="period-select" value={viewPeriod} onChange={handleViewPeriodChange}>
                    {VIEW_PERIODS.map((p) => (
                      <option key={p} value={p}>{VIEW_LABELS[p].toLowerCase()}</option>
                    ))}
                  </select>
                </span>
              </div>
              {subscriptions.map((sub) => {
                const norm = normalize(sub.goal_amount, sub.period, viewPeriod);
                const isSamePeriod = sub.period === viewPeriod;
                return (
                  <div
                    key={sub.id}
                    className="subscription-row"
                    onClick={() => navigate(`/budget/${sub.id}`)}
                  >
                    <div className="subscription-row-left">
                      <span className="subscription-name">{sub.name}</span>
                      <span className="period-badge">{getPeriodLabel(sub.period)}</span>
                    </div>
                    <div className="subscription-row-right">
                      <span className="subscription-amount">
                        ${sub.goal_amount.toFixed(2)}
                      </span>
                      {!isSamePeriod && (
                        <span className="subscription-fn-amount">
                          ${norm.toFixed(2)}/{VIEW_LABELS[viewPeriod].toLowerCase().slice(0, 2)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {showModal && (
        <AddTransactionModal
          budgets={spendingBudgets}
          onClose={() => setShowModal(false)}
          onAdded={fetchData}
        />
      )}
    </div>
  );
}
