import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Loading from "../components/Loading";

export default function Groups() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchGroups = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Get group IDs user belongs to
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

      // Fetch groups
      const { data: groupsData, error: groupsErr } = await supabase
        .from("groups")
        .select("*")
        .in("id", groupIds)
        .order("created_at", { ascending: false });

      if (groupsErr) throw groupsErr;

      // Get member counts
      const groupsWithCounts = await Promise.all(
        (groupsData || []).map(async (g) => {
          const { count } = await supabase
            .from("group_members")
            .select("id", { count: "exact", head: true })
            .eq("group_id", g.id);
          return { ...g, member_count: count || 0 };
        })
      );

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

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Create group
      const { data: group, error: groupErr } = await supabase
        .from("groups")
        .insert({ name: name.trim(), owner_user_id: user.id })
        .select()
        .single();
      if (groupErr) throw groupErr;

      // Add creator as member
      const { error: memberErr } = await supabase
        .from("group_members")
        .insert({ group_id: group.id, user_id: user.id });
      if (memberErr) throw memberErr;

      setName("");
      setShowForm(false);
      await fetchGroups();
    } catch (err) {
      setError(err.message || "Failed to create group");
    } finally {
      setSaving(false);
    }
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

      {showForm ? (
        <div className="card group-form">
          <h3>New Group</h3>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>Group Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Household"
                required
                autoFocus
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn primary" disabled={saving}>
                {saving ? "Creating..." : "Create Group"}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setShowForm(false);
                  setName("");
                }}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button
          className="btn primary"
          onClick={() => setShowForm(true)}
          style={{ marginBottom: "1rem", width: "100%" }}
        >
          + Create Group
        </button>
      )}

      {groups.length === 0 && !showForm ? (
        <div className="empty-state card">
          <p>No groups yet. Create one to share budgets!</p>
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
                <span className="group-member-count">
                  {group.member_count}{" "}
                  {group.member_count === 1 ? "member" : "members"}
                </span>
              </div>
              <span className="group-arrow">&rsaquo;</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
