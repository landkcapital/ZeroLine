import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getPeriodStart, getPeriodLabel, stepPeriod, PERIOD_DAYS, VIEW_PERIODS, VIEW_LABELS } from "../lib/period";
import { computeCarriedDebt } from "../lib/debt";
import { collectLeftovers, processContributions } from "../lib/goals";
import BudgetCard from "../components/BudgetCard";
import AffordCheckCard from "../components/AffordCheckCard";
import AddTransactionModal from "../components/AddTransactionModal";
import GroupExpenseModal from "../components/GroupExpenseModal";
import Loading from "../components/Loading";

function normalize(amount, fromPeriod, toPeriod) {
  const fromDays = PERIOD_DAYS[fromPeriod] || 14;
  const toDays = PERIOD_DAYS[toPeriod] || 14;
  return amount * (toDays / fromDays);
}

export default function Home() {
  const navigate = useNavigate();
  const [budgets, setBudgets] = useState([]);
  const [spentMap, setSpentMap] = useState({});
  const [debtMap, setDebtMap] = useState({});
  const [allocatedMap, setAllocatedMap] = useState({});
  const [mainGoal, setMainGoal] = useState(null);
  const [groupMap, setGroupMap] = useState({});
  const [userGroups, setUserGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showChooser, setShowChooser] = useState(false);
  const [showGroupExpense, setShowGroupExpense] = useState(null);
  const [viewPeriod, setViewPeriod] = useState(
    () => localStorage.getItem("viewPeriod") || "fortnightly"
  );

  const fetchData = useCallback(async () => {
    try {
      const { data: budgetsData, error: budgetsError } = await supabase
        .from("budgets")
        .select("*")
        .order("name");

      if (budgetsError) throw budgetsError;
      if (!budgetsData) {
        setLoading(false);
        return;
      }

      setBudgets(budgetsData);

      // Fetch group names for any group budgets
      const groupIds = [...new Set(
        budgetsData.filter((b) => b.group_id).map((b) => b.group_id)
      )];
      let newGroupMap = {};
      if (groupIds.length > 0) {
        const { data: groupsData } = await supabase
          .from("groups")
          .select("id, name")
          .in("id", groupIds);
        for (const g of groupsData || []) {
          newGroupMap[g.id] = g.name;
        }
      }
      setGroupMap(newGroupMap);

      const spendingBudgets = budgetsData.filter((b) => b.type !== "subscription");

      if (spendingBudgets.length === 0) {
        setSpentMap({});
        setDebtMap({});
        setLoading(false);
        return;
      }

      // Fetch ALL transactions for spending budgets (needed for debt computation)
      const { data: allTx, error: txError } = await supabase
        .from("transactions")
        .select("budget_id, amount, occurred_at, note")
        .in("budget_id", spendingBudgets.map((b) => b.id));

      if (txError) throw txError;

      // Group by budget, only counting transactions within each budget's own period
      const newSpentMap = {};
      const periodStarts = {};
      const periodEnds = {};
      for (const b of spendingBudgets) {
        const ps = getPeriodStart(b.period, b.renew_anchor);
        periodStarts[b.id] = ps.getTime();
        periodEnds[b.id] = stepPeriod(b.period, ps, "next").getTime();
        newSpentMap[b.id] = 0;
      }
      for (const t of allTx || []) {
        const ps = periodStarts[t.budget_id];
        const pe = periodEnds[t.budget_id];
        const txTime = new Date(t.occurred_at).getTime();
        if (ps != null && txTime >= ps && txTime < pe) {
          newSpentMap[t.budget_id] += t.amount;
        }
      }

      // Compute carried debt per budget
      const newDebtMap = {};
      for (const b of spendingBudgets) {
        const budgetTx = (allTx || []).filter((t) => t.budget_id === b.id);
        newDebtMap[b.id] = computeCarriedDebt(b, budgetTx);
      }

      setSpentMap(newSpentMap);
      setDebtMap(newDebtMap);

      // Fetch allocations for spending budgets
      const { data: allocData } = await supabase
        .from("allocations")
        .select("budget_id, amount")
        .in("budget_id", spendingBudgets.map((b) => b.id));

      const newAllocatedMap = {};
      for (const a of allocData || []) {
        newAllocatedMap[a.budget_id] = (newAllocatedMap[a.budget_id] || 0) + a.amount;
      }
      setAllocatedMap(newAllocatedMap);

      // Fetch goals and run leftover collection + auto-contributions
      const { data: goalsData } = await supabase
        .from("goals")
        .select("*")
        .order("sort_order");

      if (goalsData && goalsData.length > 0) {
        // Only collect leftovers from personal budgets
        const personalBudgets = budgetsData.filter((b) => !b.group_id);
        await collectLeftovers(supabase, personalBudgets, allTx || [], goalsData);
        await processContributions(supabase, goalsData);
        // Re-fetch goals after processing to get updated saved_amount
        const { data: updatedGoals } = await supabase
          .from("goals")
          .select("*")
          .order("sort_order");
        setMainGoal(updatedGoals?.[0] || null);
      } else {
        setMainGoal(null);
      }

      // Fetch user's groups for the spend chooser
      const { data: { user } } = await supabase.auth.getUser();
      const { data: memberships } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", user.id);
      const myGroupIds = [...new Set((memberships || []).map((m) => m.group_id))];
      if (myGroupIds.length > 0) {
        const { data: myGroups } = await supabase
          .from("groups")
          .select("id, name")
          .in("id", myGroupIds);
        setUserGroups(myGroups || []);
      } else {
        setUserGroups([]);
      }

      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Lock body scroll when chooser modal is open
  useEffect(() => {
    if (showChooser) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [showChooser]);

  if (loading) return <Loading />;

  if (error) {
    return (
      <div className="page home-page">
        <div className="card" style={{ padding: "1.5rem", textAlign: "center" }}>
          <p className="form-error">{error}</p>
          <button className="btn primary" onClick={fetchData} style={{ marginTop: "1rem" }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const personalBudgets = budgets.filter((b) => !b.group_id);
  const groupBudgets = budgets.filter((b) => b.group_id);

  const subscriptions = personalBudgets.filter((b) => b.type === "subscription");
  const spendingBudgets = budgets.filter((b) => b.type !== "subscription");
  const personalSpending = personalBudgets.filter((b) => b.type !== "subscription");

  // Group budgets grouped by group name
  const groupsByName = {};
  for (const b of groupBudgets) {
    const gName = groupMap[b.group_id] || "Group";
    if (!groupsByName[gName]) groupsByName[gName] = [];
    groupsByName[gName].push(b);
  }

  const totalSubscriptions = subscriptions.reduce(
    (s, b) => s + normalize(b.goal_amount, b.period, viewPeriod), 0
  );
  const totalBudget = spendingBudgets.reduce(
    (s, b) => s + normalize(b.goal_amount, b.period, viewPeriod), 0
  );
  const totalSpent = spendingBudgets.reduce(
    (s, b) => s + (spentMap[b.id] || 0), 0
  );
  const totalDebt = spendingBudgets.reduce(
    (s, b) => s + (debtMap[b.id] || 0), 0
  );
  const totalAllocated = spendingBudgets.reduce(
    (s, b) => s + (allocatedMap[b.id] || 0), 0
  );
  const totalRemaining = totalBudget - totalSpent - totalAllocated + totalDebt;

  const handleViewPeriodChange = (e) => {
    setViewPeriod(e.target.value);
    localStorage.setItem("viewPeriod", e.target.value);
  };

  const hasAny = budgets.length > 0;
  const hasSpending = spendingBudgets.length > 0;
  const canSpend = hasSpending || userGroups.length > 0;

  function handlePlusClick() {
    if (!canSpend) return;
    if (userGroups.length > 0) {
      setShowChooser(true);
    } else {
      setShowModal(true);
    }
  }

  return (
    <div className="page home-page">
      <button
        className={`spend-btn${!canSpend ? " disabled" : ""}`}
        onClick={handlePlusClick}
        disabled={!canSpend}
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
            <AffordCheckCard budgets={spendingBudgets} spentMap={spentMap} debtMap={debtMap} allocatedMap={allocatedMap} mainGoal={mainGoal} groupMap={groupMap} />
          )}

          {personalSpending.length > 0 && (
            <div className="budget-grid">
              {personalSpending.map((budget) => (
                <BudgetCard
                  key={budget.id}
                  budget={budget}
                  spent={spentMap[budget.id] || 0}
                  carriedDebt={debtMap[budget.id] || 0}
                  allocated={allocatedMap[budget.id] || 0}
                />
              ))}
            </div>
          )}

          {Object.entries(groupsByName).map(([gName, gBudgets]) => {
            const gSpending = gBudgets.filter((b) => b.type !== "subscription");
            const gSubs = gBudgets.filter((b) => b.type === "subscription");
            return (
              <div key={gName}>
                <h3 className="section-title">{gName}</h3>
                {gSpending.length > 0 && (
                  <div className="budget-grid">
                    {gSpending.map((budget) => (
                      <BudgetCard
                        key={budget.id}
                        budget={budget}
                        spent={spentMap[budget.id] || 0}
                        carriedDebt={debtMap[budget.id] || 0}
                        allocated={allocatedMap[budget.id] || 0}
                      />
                    ))}
                  </div>
                )}
                {gSubs.length > 0 && (
                  <div className="card subscription-section">
                    <div className="subscription-header">
                      <h3 className="subscription-section-title">{gName} Subscriptions</h3>
                    </div>
                    {gSubs.map((sub) => (
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
                          <span className="subscription-amount">${sub.goal_amount.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

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

      {showChooser && (
        <div className="modal-overlay" onClick={() => setShowChooser(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>What&apos;s this for?</h2>
              <button className="close-btn" onClick={() => setShowChooser(false)}>&times;</button>
            </div>
            <div className="spend-chooser-list">
              {hasSpending && (
                <button
                  className="spend-chooser-item"
                  onClick={() => { setShowChooser(false); setShowModal(true); }}
                >
                  <span className="spend-chooser-icon">You</span>
                  <span className="spend-chooser-label">Personal</span>
                </button>
              )}
              {userGroups.map((g) => (
                <button
                  key={g.id}
                  className="spend-chooser-item"
                  onClick={() => { setShowChooser(false); setShowGroupExpense(g); }}
                >
                  <span className="spend-chooser-icon">Grp</span>
                  <span className="spend-chooser-label">{g.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <AddTransactionModal
          budgets={spendingBudgets}
          spentMap={spentMap}
          debtMap={debtMap}
          allocatedMap={allocatedMap}
          mainGoal={mainGoal}
          groupMap={groupMap}
          onClose={() => setShowModal(false)}
          onAdded={fetchData}
        />
      )}

      {showGroupExpense && (
        <GroupExpenseModal
          groupId={showGroupExpense.id}
          groupName={showGroupExpense.name}
          userBudgets={personalSpending}
          onClose={() => setShowGroupExpense(null)}
          onAdded={fetchData}
        />
      )}
    </div>
  );
}
