import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import GroupExpenseModal from "../components/GroupExpenseModal";
import Loading from "../components/Loading";

function simplifyDebts(memberBalances) {
  const creditors = memberBalances
    .filter((m) => m.balance > 0.005)
    .map((m) => ({ ...m, remaining: m.balance }))
    .sort((a, b) => b.remaining - a.remaining);

  const debtors = memberBalances
    .filter((m) => m.balance < -0.005)
    .map((m) => ({ ...m, remaining: Math.abs(m.balance) }))
    .sort((a, b) => b.remaining - a.remaining);

  const settlements = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const amount = Math.min(creditors[ci].remaining, debtors[di].remaining);
    if (amount > 0.005) {
      settlements.push({
        fromId: debtors[di].id,
        fromName: debtors[di].name,
        fromIsMe: debtors[di].isCurrentUser,
        toId: creditors[ci].id,
        toName: creditors[ci].name,
        toIsMe: creditors[ci].isCurrentUser,
        amount: Math.round(amount * 100) / 100,
      });
    }
    creditors[ci].remaining -= amount;
    debtors[di].remaining -= amount;
    if (creditors[ci].remaining < 0.005) ci++;
    if (debtors[di].remaining < 0.005) di++;
  }

  return settlements;
}

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showExpenseModal, setShowExpenseModal] = useState(false);

  // Add member state
  const [addMode, setAddMode] = useState("name");
  const [memberInput, setMemberInput] = useState("");
  const [adding, setAdding] = useState(false);

  // Delete state
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteExpense, setConfirmDeleteExpense] = useState(null);
  const [confirmSettle, setConfirmSettle] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState("");

  // Dispute state
  const [disputes, setDisputes] = useState([]);
  const [disputeExpenseId, setDisputeExpenseId] = useState(null);
  const [disputeNote, setDisputeNote] = useState("");
  const [submittingDispute, setSubmittingDispute] = useState(false);

  // Edit expense state
  const [editingExpense, setEditingExpense] = useState(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const isOwner = group && currentUserId && group.owner_user_id === currentUserId;

  const fetchData = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setCurrentUserId(user.id);

      const { data: groupData, error: groupErr } = await supabase
        .from("groups")
        .select("*")
        .eq("id", id)
        .single();
      if (groupErr) throw groupErr;
      setGroup(groupData);

      const { data: membersData, error: membersErr } = await supabase
        .from("group_members")
        .select("id, user_id, display_name, created_at")
        .eq("group_id", id);
      if (membersErr) throw membersErr;
      setMembers(membersData || []);

      const { data: expensesData, error: expensesErr } = await supabase
        .from("group_expenses")
        .select("*")
        .eq("group_id", id)
        .order("occurred_at", { ascending: false });
      if (expensesErr) throw expensesErr;
      setExpenses(expensesData || []);

      // Fetch disputes for all expenses
      const expenseIds = (expensesData || []).map((e) => e.id);
      if (expenseIds.length > 0) {
        const { data: disputesData } = await supabase
          .from("group_expense_disputes")
          .select("*")
          .in("expense_id", expenseIds);
        setDisputes(disputesData || []);
      } else {
        setDisputes([]);
      }

      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load group");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Balance calculations
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const memberCount = members.length;
  const fairShare = memberCount > 0 ? totalExpenses / memberCount : 0;

  const paidByMember = {};
  for (const e of expenses) {
    if (e.paid_by_member_id) {
      paidByMember[e.paid_by_member_id] = (paidByMember[e.paid_by_member_id] || 0) + e.amount;
    }
  }

  const memberBalances = members.map((m) => {
    const paid = paidByMember[m.id] || 0;
    const balance = paid - fairShare;
    return {
      id: m.id,
      name: m.display_name || "Unknown",
      userId: m.user_id,
      paid,
      balance,
      isCurrentUser: m.user_id === currentUserId,
    };
  });

  const settlements = simplifyDebts(memberBalances);

  // Member name lookup
  const memberMap = {};
  for (const m of members) {
    memberMap[m.id] = m.display_name || "Unknown";
  }

  // Dispute lookup
  const disputesByExpense = {};
  for (const d of disputes) {
    if (!disputesByExpense[d.expense_id]) disputesByExpense[d.expense_id] = [];
    disputesByExpense[d.expense_id].push(d);
  }
  const currentMember = members.find((m) => m.user_id === currentUserId);

  async function handleRename() {
    if (!editName.trim() || editName.trim() === group.name) {
      setEditingName(false);
      return;
    }
    try {
      const { error: renameErr } = await supabase
        .from("groups")
        .update({ name: editName.trim() })
        .eq("id", id);
      if (renameErr) throw renameErr;
      setGroup({ ...group, name: editName.trim() });
      setEditingName(false);
    } catch (err) {
      setError(err.message || "Failed to rename group");
    }
  }

  async function handleAddMember(e) {
    e.preventDefault();
    if (!memberInput.trim()) return;
    setAdding(true);
    setError(null);

    try {
      if (addMode === "email") {
        const { error: addErr } = await supabase
          .rpc("add_user_member", { p_group_id: id, p_email: memberInput.trim() });
        if (addErr) throw addErr;
      } else {
        const { error: addErr } = await supabase
          .rpc("add_named_member", { p_group_id: id, p_name: memberInput.trim() });
        if (addErr) throw addErr;
      }

      setMemberInput("");
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to add member");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveMember(membershipId) {
    try {
      const { error: removeErr } = await supabase
        .from("group_members")
        .delete()
        .eq("id", membershipId);
      if (removeErr) throw removeErr;
      setConfirmRemove(null);
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to remove member");
    }
  }

  async function handleDeleteExpense(expenseId) {
    try {
      const { error: delErr } = await supabase
        .from("group_expenses")
        .delete()
        .eq("id", expenseId);
      if (delErr) throw delErr;
      setConfirmDeleteExpense(null);
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to delete expense");
    }
  }

  async function handleDispute(expenseId) {
    if (!disputeNote.trim() || !currentMember) return;
    setSubmittingDispute(true);
    setError(null);
    try {
      const { error: insertErr } = await supabase
        .from("group_expense_disputes")
        .insert({
          expense_id: expenseId,
          disputed_by_member_id: currentMember.id,
          note: disputeNote.trim(),
        });
      if (insertErr) throw insertErr;
      setDisputeExpenseId(null);
      setDisputeNote("");
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to submit dispute");
    } finally {
      setSubmittingDispute(false);
    }
  }

  async function handleEditExpense(expense) {
    setSavingEdit(true);
    setError(null);
    try {
      const { error: updateErr } = await supabase
        .from("group_expenses")
        .update({
          amount: parseFloat(editAmount),
          note: editNote || null,
        })
        .eq("id", expense.id);
      if (updateErr) throw updateErr;

      // Clear disputes on this expense after edit (resolution)
      await supabase
        .from("group_expense_disputes")
        .delete()
        .eq("expense_id", expense.id);

      setEditingExpense(null);
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to update expense");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleSettle(settlement) {
    try {
      const { error: insertErr } = await supabase
        .from("group_expenses")
        .insert({
          group_id: id,
          paid_by_member_id: settlement.fromId,
          amount: settlement.amount,
          note: `Settlement: ${settlement.fromName} → ${settlement.toName}`,
        });
      if (insertErr) throw insertErr;
      setConfirmSettle(null);
      await fetchData();
    } catch (err) {
      setError(err.message || "Failed to settle up");
    }
  }

  async function handleDeleteGroup() {
    try {
      await supabase.from("group_expenses").delete().eq("group_id", id);

      const { data: budgets } = await supabase
        .from("budgets")
        .select("id")
        .eq("group_id", id);
      const budgetIds = (budgets || []).map((b) => b.id);
      if (budgetIds.length > 0) {
        await supabase.from("transactions").delete().in("budget_id", budgetIds);
        await supabase.from("budgets").delete().eq("group_id", id);
      }

      const { error: delErr } = await supabase
        .from("groups")
        .delete()
        .eq("id", id);
      if (delErr) throw delErr;
      navigate("/groups");
    } catch (err) {
      setError(err.message || "Failed to delete group");
    }
  }

  if (loading) return <Loading />;

  if (!group) {
    return (
      <div className="page">
        <div className="empty-state card">
          <p>Group not found.</p>
        </div>
        <button
          className="btn secondary"
          onClick={() => navigate("/groups")}
          style={{ marginTop: "1rem" }}
        >
          &larr; Back to Groups
        </button>
      </div>
    );
  }

  return (
    <div className="page group-detail-page">
      <button className="btn secondary back-btn" onClick={() => navigate("/groups")}>
        &larr; Back to Groups
      </button>

      <div className="card detail-hero">
        <div className="detail-hero-header">
          {editingName ? (
            <div className="group-name-edit">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") setEditingName(false);
                }}
                autoFocus
              />
              <button className="btn small" onClick={handleRename}>Save</button>
              <button className="btn small secondary" onClick={() => setEditingName(false)}>Cancel</button>
            </div>
          ) : (
            <h2
              onClick={() => { if (isOwner) { setEditName(group.name); setEditingName(true); } }}
              className={isOwner ? "editable-name" : ""}
              title={isOwner ? "Click to rename" : ""}
            >
              {group.name}
            </h2>
          )}
          <div className="detail-hero-badges">
            {isOwner && <span className="type-badge">Owner</span>}
            <span className="period-badge">
              {members.length} {members.length === 1 ? "member" : "members"}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <p className="form-error" style={{ margin: "0.75rem 0" }}>{error}</p>
      )}

      {/* Add Expense Button */}
      <button
        className="btn primary"
        onClick={() => setShowExpenseModal(true)}
        style={{ width: "100%", marginBottom: "1.25rem" }}
      >
        + Add Expense
      </button>

      {/* Balance Summary */}
      {expenses.length > 0 && (
        <>
          <div className="card ge-balance-card">
            <h3 className="ge-balance-title">Balances</h3>
            <div className="ge-total-row">
              <span>Total expenses</span>
              <span className="ge-total-amount">${totalExpenses.toFixed(2)}</span>
            </div>
            <div className="ge-total-row" style={{ marginBottom: "0.75rem" }}>
              <span>Per person</span>
              <span>${fairShare.toFixed(2)}</span>
            </div>
            <div className="ge-balance-list">
              {memberBalances.map((mb) => (
                <div key={mb.id} className="ge-balance-item">
                  <div className="ge-balance-name">
                    {mb.isCurrentUser ? "You" : mb.name}
                    <span className="ge-balance-paid">paid ${mb.paid.toFixed(2)}</span>
                  </div>
                  <span className={`ge-balance-amount ${mb.balance >= 0 ? "positive" : "negative"}`}>
                    {mb.balance >= 0 ? "+" : ""}${mb.balance.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {settlements.length > 0 && (
            <div className="card ge-settle-card">
              <h3 className="ge-balance-title">Settle Up</h3>
              {settlements.map((s, i) => (
                <div key={i} className="ge-settle-row">
                  <div className="ge-settle-info">
                    <span className="ge-settle-from">{s.fromIsMe ? "You" : s.fromName}</span>
                    <span className="ge-settle-arrow">&rarr;</span>
                    <span className="ge-settle-to">{s.toIsMe ? "You" : s.toName}</span>
                    <span className="ge-settle-amount">${s.amount.toFixed(2)}</span>
                  </div>
                  {confirmSettle === i ? (
                    <div className="ge-settle-confirm">
                      <button className="btn small primary" onClick={() => handleSettle(s)}>
                        Confirm
                      </button>
                      <button className="btn small secondary" onClick={() => setConfirmSettle(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button className="btn small ge-settle-btn" onClick={() => setConfirmSettle(i)}>
                      Settle
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Expenses Log */}
      <h3 className="section-title">Expenses</h3>
      {expenses.length === 0 ? (
        <div className="empty-state card">
          <p>No expenses yet. Add one to start tracking!</p>
        </div>
      ) : (
        <div className="transaction-list" style={{ marginBottom: "1.25rem" }}>
          {expenses.map((e) => {
            const payer = memberMap[e.paid_by_member_id] || "Removed member";
            const payerMember = members.find((m) => m.id === e.paid_by_member_id);
            const payerIsMe = payerMember?.user_id === currentUserId;
            const expenseDisputes = disputesByExpense[e.id] || [];
            const isDisputed = expenseDisputes.length > 0;
            const alreadyDisputed = currentMember && expenseDisputes.some(
              (d) => d.disputed_by_member_id === currentMember.id
            );
            const canDispute = currentMember && !payerIsMe && !alreadyDisputed;

            if (editingExpense?.id === e.id) {
              return (
                <div key={e.id} className="card transaction-item dispute-edit-form">
                  <div className="form-group">
                    <label>Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={editAmount}
                      onChange={(ev) => setEditAmount(ev.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label>Note</label>
                    <input
                      type="text"
                      value={editNote}
                      onChange={(ev) => setEditNote(ev.target.value)}
                    />
                  </div>
                  <div className="form-actions">
                    <button
                      className="btn small primary"
                      onClick={() => handleEditExpense(e)}
                      disabled={savingEdit || !editAmount}
                    >
                      {savingEdit ? "Saving..." : "Save"}
                    </button>
                    <button
                      className="btn small secondary"
                      onClick={() => setEditingExpense(null)}
                      disabled={savingEdit}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={e.id} className={`card transaction-item${isDisputed ? " disputed" : ""}`}>
                <div className="transaction-info">
                  <span className="transaction-amount">${e.amount.toFixed(2)}</span>
                  <span className="transaction-budget-tag">{payerIsMe ? "You" : payer}</span>
                  <span className="transaction-note">{e.note || "No note"}</span>
                  {isDisputed && <span className="dispute-badge">Disputed</span>}
                </div>
                {e.receipt_url && (
                  <img
                    src={e.receipt_url}
                    alt="Receipt"
                    className="receipt-thumbnail"
                    onClick={() => window.open(e.receipt_url, "_blank")}
                  />
                )}
                <div className="transaction-right">
                  <span className="transaction-date">
                    {new Date(e.occurred_at).toLocaleDateString()}
                  </span>
                  {isDisputed && payerIsMe && (
                    <button
                      className="btn small"
                      onClick={() => {
                        setEditingExpense(e);
                        setEditAmount(e.amount.toString());
                        setEditNote(e.note || "");
                      }}
                    >
                      Edit
                    </button>
                  )}
                  {canDispute && (
                    <button
                      className="btn small dispute-btn"
                      onClick={() => setDisputeExpenseId(
                        disputeExpenseId === e.id ? null : e.id
                      )}
                    >
                      Dispute
                    </button>
                  )}
                  {confirmDeleteExpense === e.id ? (
                    <div className="transaction-confirm">
                      <button className="btn small danger" onClick={() => handleDeleteExpense(e.id)}>
                        Confirm
                      </button>
                      <button className="btn small secondary" onClick={() => setConfirmDeleteExpense(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn small danger tx-delete-btn"
                      onClick={() => setConfirmDeleteExpense(e.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>

                {isDisputed && (
                  <div className="dispute-details">
                    {expenseDisputes.map((d) => (
                      <div key={d.id} className="dispute-detail-item">
                        <span className="dispute-detail-who">
                          {memberMap[d.disputed_by_member_id] || "Unknown"}:
                        </span>
                        <span className="dispute-detail-note">{d.note}</span>
                      </div>
                    ))}
                  </div>
                )}

                {disputeExpenseId === e.id && (
                  <div className="dispute-form">
                    <div className="form-group">
                      <label>Why are you disputing?</label>
                      <input
                        type="text"
                        value={disputeNote}
                        onChange={(ev) => setDisputeNote(ev.target.value)}
                        placeholder="e.g. Amount seems wrong, I wasn't part of this"
                        autoFocus
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" && disputeNote.trim()) {
                            ev.preventDefault();
                            handleDispute(e.id);
                          }
                        }}
                      />
                    </div>
                    <div className="form-actions">
                      <button
                        className="btn small primary"
                        onClick={() => handleDispute(e.id)}
                        disabled={submittingDispute || !disputeNote.trim()}
                      >
                        {submittingDispute ? "Submitting..." : "Submit Dispute"}
                      </button>
                      <button
                        className="btn small secondary"
                        onClick={() => { setDisputeExpenseId(null); setDisputeNote(""); }}
                        disabled={submittingDispute}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Members Section */}
      <h3 className="section-title">Members</h3>
      <div className="member-list">
        {members.map((m) => (
          <div key={m.id} className="card member-item">
            <div className="member-info">
              <span className="member-email">
                {m.user_id === currentUserId ? "You" : m.display_name || "Unknown"}
              </span>
              {m.user_id === group.owner_user_id && (
                <span className="type-badge">Owner</span>
              )}
              {!m.user_id && (
                <span className="period-badge" style={{ fontSize: "0.6rem" }}>Non-user</span>
              )}
            </div>
            {isOwner && m.user_id !== currentUserId && (
              <>
                {confirmRemove === m.id ? (
                  <div className="transaction-confirm">
                    <button className="btn small danger" onClick={() => handleRemoveMember(m.id)}>
                      Confirm
                    </button>
                    <button className="btn small secondary" onClick={() => setConfirmRemove(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button className="btn small danger" onClick={() => setConfirmRemove(m.id)}>
                    Remove
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Add Member (owner only) */}
      {isOwner && (
        <div className="card add-member-form">
          <h3>Add Member</h3>
          <div className="member-add-toggle">
            <button
              className={`modal-mode-btn ${addMode === "name" ? "active" : ""}`}
              onClick={() => setAddMode("name")}
              type="button"
            >
              By Name
            </button>
            <button
              className={`modal-mode-btn ${addMode === "email" ? "active" : ""}`}
              onClick={() => setAddMode("email")}
              type="button"
            >
              ZeroLine User
            </button>
          </div>
          <form onSubmit={handleAddMember}>
            <div className="form-group">
              <label>{addMode === "email" ? "Email Address" : "Name"}</label>
              <input
                type={addMode === "email" ? "email" : "text"}
                value={memberInput}
                onChange={(e) => setMemberInput(e.target.value)}
                placeholder={addMode === "email" ? "member@example.com" : "Person's name"}
                required
              />
            </div>
            <button type="submit" className="btn primary" disabled={adding}>
              {adding ? "Adding..." : "Add Member"}
            </button>
          </form>
        </div>
      )}

      {/* Delete Group (owner only) */}
      {isOwner && (
        <div className="delete-budget-section">
          {confirmDelete ? (
            <div className="delete-budget-confirm">
              <p>
                Delete <strong>{group.name}</strong> and all its data?
              </p>
              <div className="delete-budget-actions">
                <button className="btn small danger" onClick={handleDeleteGroup}>
                  Yes, Delete
                </button>
                <button className="btn small secondary" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn small danger delete-budget-btn"
              onClick={() => setConfirmDelete(true)}
            >
              Delete Group
            </button>
          )}
        </div>
      )}

      {showExpenseModal && (
        <GroupExpenseModal
          groupId={id}
          groupName={group.name}
          onClose={() => setShowExpenseModal(false)}
          onAdded={fetchData}
        />
      )}
    </div>
  );
}
