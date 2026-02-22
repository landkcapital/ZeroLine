import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Loading from "../components/Loading";

export default function Groups() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Creation wizard state
  const [showCreate, setShowCreate] = useState(false);
  const [step, setStep] = useState(1); // 1=name, 2=add members
  const [name, setName] = useState("");
  const [pendingMembers, setPendingMembers] = useState([]);
  const [addMode, setAddMode] = useState("name"); // "name" | "email"
  const [memberInput, setMemberInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState(null);

  const fetchGroups = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: memberships, error: memErr } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", user.id);

      if (memErr) throw memErr;

      const groupIds = (memberships || []).map((m) => m.group_id);
      if (groupIds.length === 0) {
        setGroups([]);
        setError(null);
        setLoading(false);
        return;
      }

      const { data: groupsData, error: groupsErr } = await supabase
        .from("groups")
        .select("*")
        .in("id", groupIds)
        .order("created_at", { ascending: false });

      if (groupsErr) throw groupsErr;

      // Fetch all members, expenses, and shares across all groups for balance calc
      const { data: allMembers } = await supabase
        .from("group_members")
        .select("id, group_id, user_id")
        .in("group_id", groupIds);

      const { data: allExpenses } = await supabase
        .from("group_expenses")
        .select("id, group_id, paid_by_member_id, amount")
        .in("group_id", groupIds);

      const expenseIds = (allExpenses || []).map((e) => e.id);
      let allShares = [];
      if (expenseIds.length > 0) {
        const { data: sharesData } = await supabase
          .from("group_expense_shares")
          .select("expense_id, member_id, share_amount, settled")
          .in("expense_id", expenseIds);
        allShares = sharesData || [];
      }

      // Build per-group balance for current user
      const groupsWithCounts = (groupsData || []).map((g) => {
        const gMembers = (allMembers || []).filter((m) => m.group_id === g.id);
        const gExpenses = (allExpenses || []).filter((e) => e.group_id === g.id);
        const myMember = gMembers.find((m) => m.user_id === user.id);
        const memberCount = gMembers.length;

        let myBalance = 0;

        if (myMember) {
          // Share-based balance (new expenses)
          const gExpenseIds = new Set(gExpenses.map((e) => e.id));
          const gShares = allShares.filter((s) => gExpenseIds.has(s.expense_id));

          for (const e of gExpenses) {
            const expShares = gShares.filter((s) => s.expense_id === e.id);
            if (expShares.length > 0) {
              // New-style expense with shares
              for (const sh of expShares) {
                if (!sh.settled && sh.member_id !== e.paid_by_member_id) {
                  if (sh.member_id === myMember.id) {
                    myBalance -= Number(sh.share_amount); // I owe
                  }
                  if (e.paid_by_member_id === myMember.id) {
                    myBalance += Number(sh.share_amount); // Owed to me
                  }
                }
              }
            } else {
              // Legacy expense — equal split
              if (memberCount > 0) {
                const fairShare = e.amount / memberCount;
                if (e.paid_by_member_id === myMember.id) {
                  myBalance += e.amount - fairShare; // I paid, others owe me
                } else {
                  myBalance -= fairShare; // Someone else paid, I owe
                }
              }
            }
          }
        }

        return {
          ...g,
          member_count: gMembers.length,
          myBalance: Math.round(myBalance * 100) / 100,
        };
      });

      setGroups(groupsWithCounts);
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load groups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  function handleAddPending() {
    if (!memberInput.trim()) return;
    setAddError(null);

    const val = memberInput.trim();
    const isDup = pendingMembers.some(
      (m) => m.value.toLowerCase() === val.toLowerCase()
    );
    if (isDup) {
      setAddError("Already added.");
      return;
    }

    setPendingMembers([...pendingMembers, { type: addMode, value: val }]);
    setMemberInput("");
  }

  function removePending(idx) {
    setPendingMembers(pendingMembers.filter((_, i) => i !== idx));
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    setAddError(null);

    try {
      // 1. Create group via RPC (auto-adds creator as member)
      const { data: group, error: groupErr } = await supabase
        .rpc("create_group", { group_name: name.trim() });
      if (groupErr) throw groupErr;

      // 2. Add each pending member
      const errors = [];
      for (const pm of pendingMembers) {
        if (pm.type === "email") {
          const { error: addErr } = await supabase
            .rpc("add_user_member", { p_group_id: group.id, p_email: pm.value });
          if (addErr) errors.push(`${pm.value}: ${addErr.message}`);
        } else {
          const { error: addErr } = await supabase
            .rpc("add_named_member", { p_group_id: group.id, p_name: pm.value });
          if (addErr) errors.push(`${pm.value}: ${addErr.message}`);
        }
      }

      if (errors.length > 0) {
        setAddError("Some members couldn't be added: " + errors.join(", "));
      }

      resetForm();
      navigate(`/group/${group.id}`);
    } catch (err) {
      setError(err.message || "Failed to create group");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setShowCreate(false);
    setStep(1);
    setName("");
    setPendingMembers([]);
    setMemberInput("");
    setAddMode("name");
    setAddError(null);
  }

  if (loading) return <Loading />;

  return (
    <div className="page groups-page">
      <h2 className="page-title">Groups</h2>

      {error && (
        <p className="form-error" style={{ margin: "0.75rem 0" }}>
          {error}
        </p>
      )}

      {showCreate ? (
        <div className="card group-form">
          {step === 1 ? (
            <>
              <h3>New Group</h3>
              <div className="form-group">
                <label>Group Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Household, Trip to Bali"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && (e.preventDefault(), setStep(2))}
                />
              </div>
              <div className="form-actions">
                <button
                  className="btn primary"
                  onClick={() => name.trim() && setStep(2)}
                  disabled={!name.trim()}
                >
                  Next
                </button>
                <button className="btn secondary" onClick={resetForm}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <h3>Add Members to &ldquo;{name}&rdquo;</h3>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
                You&apos;re already in the group. Add others below.
              </p>

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

              <div className="member-add-row">
                <input
                  type={addMode === "email" ? "email" : "text"}
                  value={memberInput}
                  onChange={(e) => setMemberInput(e.target.value)}
                  placeholder={addMode === "email" ? "email@example.com" : "Person's name"}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddPending();
                    }
                  }}
                />
                <button className="btn small" onClick={handleAddPending} type="button">
                  Add
                </button>
              </div>

              {addError && <p className="form-error">{addError}</p>}

              {pendingMembers.length > 0 && (
                <div className="pending-members-list">
                  {pendingMembers.map((m, i) => (
                    <div key={i} className="pending-member-item">
                      <div className="pending-member-info">
                        <span className="pending-member-name">{m.value}</span>
                        <span className="pending-member-type">
                          {m.type === "email" ? "ZeroLine user" : "Name only"}
                        </span>
                      </div>
                      <button
                        className="btn small danger"
                        onClick={() => removePending(i)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="form-actions" style={{ marginTop: "1rem" }}>
                <button
                  className="btn primary"
                  onClick={handleCreate}
                  disabled={saving}
                >
                  {saving ? "Creating..." : "Create Group"}
                </button>
                <button
                  className="btn secondary"
                  onClick={() => setStep(1)}
                  disabled={saving}
                >
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button
          className="btn primary"
          onClick={() => setShowCreate(true)}
          style={{ marginBottom: "1rem", width: "100%" }}
        >
          + Create Group
        </button>
      )}

      {groups.length === 0 && !showCreate ? (
        <div className="empty-state card">
          <p>No groups yet. Create one to split expenses!</p>
        </div>
      ) : (
        <div className="group-list">
          {groups.map((group) => (
            <div
              key={group.id}
              className="card group-list-item"
              onClick={() => navigate(`/group/${group.id}`)}
            >
              <div className="group-list-info">
                <h3>{group.name}</h3>
                <div className="group-list-meta">
                  <span className="group-member-count">
                    {group.member_count}{" "}
                    {group.member_count === 1 ? "member" : "members"}
                  </span>
                  {group.myBalance > 0.005 ? (
                    <span className="group-balance owed-to-you">
                      Owed ${group.myBalance.toFixed(2)}
                    </span>
                  ) : group.myBalance < -0.005 ? (
                    <span className="group-balance you-owe">
                      You Owe ${Math.abs(group.myBalance).toFixed(2)}
                    </span>
                  ) : (
                    <span className="group-balance balanced">Balanced</span>
                  )}
                </div>
              </div>
              <span className="group-arrow">&rsaquo;</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
