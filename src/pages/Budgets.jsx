import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import Loading from "../components/Loading";

const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

/** Build an ISO date string whose day-of-week matches the given value (0–6). */
function anchorForDayOfWeek(dayOfWeek) {
  const d = new Date();
  const diff = dayOfWeek - d.getDay();
  d.setDate(d.getDate() + diff);
  return toISO(d);
}

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Extract the display value from an anchor for a given period type. */
function renewValueFromAnchor(period, anchor) {
  if (!anchor) return period === "monthly" ? "1" : "1";
  const [y, m, d] = anchor.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (period === "weekly") return String(date.getDay());
  if (period === "monthly") return String(date.getDate());
  return anchor; // fortnightly returns full date
}

const EMPTY_FORM = {
  name: "",
  type: "spending",
  period: "fortnightly",
  goal_amount: "",
  renew_anchor: toISO(new Date()),
};

export default function Budgets() {
  const [budgets, setBudgets] = useState([]);
  const [groups, setGroups] = useState([]);
  const [scope, setScope] = useState("personal");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  async function fetchBudgets() {
    // Fetch user's groups
    const { data: { user } } = await supabase.auth.getUser();
    const { data: memberships } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id);
    const groupIds = (memberships || []).map((m) => m.group_id);

    let groupsData = [];
    if (groupIds.length > 0) {
      const { data } = await supabase
        .from("groups")
        .select("id, name")
        .in("id", groupIds);
      groupsData = data || [];
    }
    setGroups(groupsData);

    // RLS returns personal + group budgets
    const { data } = await supabase
      .from("budgets")
      .select("*")
      .order("name");
    setBudgets(data || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchBudgets();
  }, []);

  function handleEdit(budget) {
    setEditingId(budget.id);
    setScope(budget.group_id || "personal");
    setForm({
      name: budget.name,
      type: budget.type || "spending",
      period: budget.period,
      goal_amount: budget.goal_amount.toString(),
      renew_anchor: budget.renew_anchor || toISO(new Date()),
    });
    setError(null);
  }

  function handleCancel() {
    setEditingId(null);
    setScope("personal");
    setForm(EMPTY_FORM);
    setError(null);
  }

  function handlePeriodChange(newPeriod) {
    // Set a sensible default anchor when switching period types
    let anchor;
    if (newPeriod === "weekly") anchor = anchorForDayOfWeek(1); // Monday
    else anchor = toISO(new Date()); // fortnightly & 4-weekly: today
    setForm({ ...form, period: newPeriod, renew_anchor: anchor });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      type: form.type,
      period: form.period,
      goal_amount: parseFloat(form.goal_amount),
      renew_anchor: form.renew_anchor,
      group_id: scope !== "personal" ? scope : null,
    };

    if (editingId) {
      const { error: updateError } = await supabase
        .from("budgets")
        .update(payload)
        .eq("id", editingId);

      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from("budgets")
        .insert(payload);

      if (insertError) {
        setError(insertError.message);
        setSaving(false);
        return;
      }
    }

    setForm(EMPTY_FORM);
    setEditingId(null);
    setScope("personal");
    setSaving(false);
    await fetchBudgets();
  }

  async function handleDelete(id) {
    const { error: deleteError } = await supabase
      .from("transactions")
      .delete()
      .eq("budget_id", id);

    if (deleteError) {
      setError(deleteError.message);
      setConfirmDelete(null);
      return;
    }

    const { error: budgetDeleteError } = await supabase
      .from("budgets")
      .delete()
      .eq("id", id);

    if (budgetDeleteError) {
      setError(budgetDeleteError.message);
    }

    setConfirmDelete(null);
    await fetchBudgets();
  }

  if (loading) return <Loading />;

  // Render the renewal picker based on current period
  function renderRenewPicker() {
    if (form.period === "weekly") {
      const currentDay = renewValueFromAnchor("weekly", form.renew_anchor);
      return (
        <div className="form-group">
          <label>Renews On</label>
          <select
            value={currentDay}
            onChange={(e) =>
              setForm({
                ...form,
                renew_anchor: anchorForDayOfWeek(Number(e.target.value)),
              })
            }
          >
            {DAYS_OF_WEEK.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (form.period === "fortnightly" || form.period === "4-weekly") {
      return (
        <div className="form-group">
          <label>Cycle Start Date</label>
          <input
            type="date"
            value={form.renew_anchor}
            onChange={(e) =>
              setForm({ ...form, renew_anchor: e.target.value })
            }
          />
        </div>
      );
    }

    return null;
  }

  function renderBudgetItem(budget, isSub = false, isGroup = false) {
    return (
      <div key={budget.id} className="card budget-list-item">
        <div className="budget-list-info">
          <h3>{budget.name}</h3>
          {isSub && <span className="type-badge subscription">Fixed</span>}
          {isGroup && <span className="type-badge">Group</span>}
          <span className="period-badge">{budget.period}</span>
          <span className="budget-amount">${budget.goal_amount.toFixed(2)}</span>
        </div>
        <div className="budget-list-actions">
          <button className="btn small" onClick={() => handleEdit(budget)}>Edit</button>
          {confirmDelete === budget.id ? (
            <>
              <button className="btn small danger" onClick={() => handleDelete(budget.id)}>Confirm</button>
              <button className="btn small secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
            </>
          ) : (
            <button className="btn small danger" onClick={() => setConfirmDelete(budget.id)}>Delete</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page budgets-page">
      <div className="card budget-form-card">
        <h2>{editingId ? "Edit Budget" : "New Budget"}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-row form-row-4">
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={form.type === "subscription" ? "e.g. Netflix" : "e.g. Groceries"}
                required
              />
            </div>
            <div className="form-group">
              <label>Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="spending">Spending</option>
                <option value="subscription">Subscription</option>
              </select>
            </div>
            <div className="form-group">
              <label>Period</label>
              <select
                value={form.period}
                onChange={(e) => handlePeriodChange(e.target.value)}
              >
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="4-weekly">4 Weekly</option>
              </select>
            </div>
            <div className="form-group">
              <label>{form.type === "subscription" ? "Amount" : "Goal Amount"}</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.goal_amount}
                onChange={(e) =>
                  setForm({ ...form, goal_amount: e.target.value })
                }
                placeholder="0.00"
                required
              />
            </div>
          </div>
          <div className="form-row renew-row">
            {groups.length > 0 && (
              <div className="form-group">
                <label>Scope</label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="personal">Personal</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {renderRenewPicker()}
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={saving}>
              {saving
                ? "Saving..."
                : editingId
                  ? "Update Budget"
                  : "Add Budget"}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn secondary"
                onClick={handleCancel}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {budgets.length === 0 ? (
        <div className="empty-state card">
          <p>No budgets yet. Create your first one above.</p>
        </div>
      ) : (
        <>
          {(() => {
            const personal = budgets.filter((b) => !b.group_id);
            const personalSpending = personal.filter((b) => b.type !== "subscription");
            const personalSubs = personal.filter((b) => b.type === "subscription");
            const groupBudgets = budgets.filter((b) => b.group_id);
            const groupMap = {};
            for (const g of groups) groupMap[g.id] = g.name;
            const groupedByGroup = {};
            for (const b of groupBudgets) {
              const gName = groupMap[b.group_id] || "Group";
              if (!groupedByGroup[gName]) groupedByGroup[gName] = [];
              groupedByGroup[gName].push(b);
            }

            return (
              <>
                {personalSpending.length > 0 && (
                  <>
                    <h3 className="section-title">Spending</h3>
                    <div className="budget-list">
                      {personalSpending.map((budget) => renderBudgetItem(budget))}
                    </div>
                  </>
                )}

                {personalSubs.length > 0 && (
                  <>
                    <h3 className="section-title" style={{ marginTop: "1.5rem" }}>Subscriptions</h3>
                    <div className="budget-list">
                      {personalSubs.map((budget) => renderBudgetItem(budget, true))}
                    </div>
                  </>
                )}

                {Object.entries(groupedByGroup).map(([gName, gBudgets]) => (
                  <div key={gName}>
                    <h3 className="section-title" style={{ marginTop: "1.5rem" }}>{gName}</h3>
                    <div className="budget-list">
                      {gBudgets.map((budget) => renderBudgetItem(budget, budget.type === "subscription", true))}
                    </div>
                  </div>
                ))}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
