import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Loading from "../components/Loading";

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addEmail, setAddEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isOwner =
    group && currentUserId && group.owner_user_id === currentUserId;

  const fetchData = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setCurrentUserId(user.id);

      // Fetch group
      const { data: groupData, error: groupErr } = await supabase
        .from("groups")
        .select("*")
        .eq("id", id)
        .single();
      if (groupErr) throw groupErr;
      setGroup(groupData);

      // Fetch members with email from profiles
      const { data: membersData, error: membersErr } = await supabase
        .from("group_members")
        .select("id, user_id, created_at, profiles(email)")
        .eq("group_id", id);
      if (membersErr) throw membersErr;

      // Flatten profiles join
      const membersFlat = (membersData || []).map((m) => ({
        ...m,
        email: m.profiles?.email || m.user_id,
      }));
      setMembers(membersFlat);

      // Fetch group budgets
      const { data: budgetsData, error: budgetsErr } = await supabase
        .from("budgets")
        .select("*")
        .eq("group_id", id)
        .order("name");
      if (budgetsErr) throw budgetsErr;
      setBudgets(budgetsData || []);

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

  async function handleAddMember(e) {
    e.preventDefault();
    if (!addEmail.trim()) return;
    setAdding(true);
    setError(null);

    try {
      // Look up user by email via profiles table
      const { data: profile, error: lookupErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", addEmail.trim().toLowerCase())
        .single();

      if (lookupErr || !profile) {
        setError("No user found with that email address.");
        setAdding(false);
        return;
      }

      const { error: addErr } = await supabase
        .from("group_members")
        .insert({ group_id: id, user_id: profile.id });

      if (addErr) {
        if (addErr.code === "23505") {
          setError("That user is already a member.");
        } else {
          throw addErr;
        }
        setAdding(false);
        return;
      }

      setAddEmail("");
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

  async function handleDeleteGroup() {
    try {
      // Delete all group budgets' transactions first
      const budgetIds = budgets.map((b) => b.id);
      if (budgetIds.length > 0) {
        await supabase
          .from("transactions")
          .delete()
          .in("budget_id", budgetIds);
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
      <button
        className="btn secondary back-btn"
        onClick={() => navigate("/groups")}
      >
        &larr; Back to Groups
      </button>

      <div className="card detail-hero">
        <div className="detail-hero-header">
          <h2>{group.name}</h2>
          <div className="detail-hero-badges">
            {isOwner && <span className="type-badge">Owner</span>}
            <span className="period-badge">
              {members.length} {members.length === 1 ? "member" : "members"}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <p className="form-error" style={{ margin: "0.75rem 0" }}>
          {error}
        </p>
      )}

      {/* Members Section */}
      <h3 className="section-title">Members</h3>
      <div className="member-list">
        {members.map((m) => (
          <div key={m.id} className="card member-item">
            <div className="member-info">
              <span className="member-email">{m.email}</span>
              {m.user_id === group.owner_user_id && (
                <span className="type-badge">Owner</span>
              )}
            </div>
            {isOwner && m.user_id !== currentUserId && (
              <>
                {confirmRemove === m.id ? (
                  <div className="transaction-confirm">
                    <button
                      className="btn small danger"
                      onClick={() => handleRemoveMember(m.id)}
                    >
                      Confirm
                    </button>
                    <button
                      className="btn small secondary"
                      onClick={() => setConfirmRemove(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn small danger"
                    onClick={() => setConfirmRemove(m.id)}
                  >
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
          <form onSubmit={handleAddMember}>
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                placeholder="member@example.com"
                required
              />
            </div>
            <button type="submit" className="btn primary" disabled={adding}>
              {adding ? "Adding..." : "Add Member"}
            </button>
          </form>
        </div>
      )}

      {/* Group Budgets */}
      <h3 className="section-title" style={{ marginTop: "1.5rem" }}>
        Group Budgets
      </h3>
      {budgets.length === 0 ? (
        <div className="empty-state card">
          <p>No budgets in this group yet. Create one on the Budgets page.</p>
        </div>
      ) : (
        <div className="budget-list">
          {budgets.map((budget) => (
            <div
              key={budget.id}
              className="card budget-list-item"
              onClick={() => navigate(`/budget/${budget.id}`)}
              style={{ cursor: "pointer" }}
            >
              <div className="budget-list-info">
                <h3>{budget.name}</h3>
                <span
                  className={`type-badge ${budget.type === "subscription" ? "subscription" : ""}`}
                >
                  {budget.type === "subscription" ? "Fixed" : "Spending"}
                </span>
                <span className="period-badge">{budget.period}</span>
                <span className="budget-amount">
                  ${budget.goal_amount.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Group (owner only) */}
      {isOwner && (
        <div className="delete-budget-section">
          {confirmDelete ? (
            <div className="delete-budget-confirm">
              <p>
                Delete <strong>{group.name}</strong> and all its budgets?
              </p>
              <div className="delete-budget-actions">
                <button
                  className="btn small danger"
                  onClick={handleDeleteGroup}
                >
                  Yes, Delete
                </button>
                <button
                  className="btn small secondary"
                  onClick={() => setConfirmDelete(false)}
                >
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
    </div>
  );
}
