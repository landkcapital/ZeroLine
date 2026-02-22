import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export default function GroupExpenseModal({ groupId, groupName, onClose, onAdded }) {
  const [members, setMembers] = useState([]);
  const [paidByMemberId, setPaidByMemberId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMembers() {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error: fetchErr } = await supabase
        .from("group_members")
        .select("id, display_name, user_id")
        .eq("group_id", groupId);

      if (fetchErr) {
        setError(fetchErr.message);
        setLoading(false);
        return;
      }

      const memberList = data || [];
      setMembers(memberList);

      // Pre-select current user as "who paid"
      const me = memberList.find((m) => m.user_id === user.id);
      if (me) setPaidByMemberId(me.id);
      else if (memberList.length > 0) setPaidByMemberId(memberList[0].id);

      setLoading(false);
    }
    fetchMembers();
  }, [groupId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!amount || !paidByMemberId) return;

    setSaving(true);
    setError(null);

    const { error: insertErr } = await supabase
      .from("group_expenses")
      .insert({
        group_id: groupId,
        paid_by_member_id: paidByMemberId,
        amount: parseFloat(amount),
        note: note || null,
      });

    if (insertErr) {
      setError(insertErr.message);
      setSaving(false);
      return;
    }

    onAdded();
    onClose();
  }

  const parsedAmount = parseFloat(amount) || 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{groupName}</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        {loading ? (
          <p style={{ textAlign: "center", padding: "1rem", color: "var(--text-dim)" }}>Loading...</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Who Paid?</label>
              <select value={paidByMemberId} onChange={(e) => setPaidByMemberId(e.target.value)} required>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.display_name || "Unknown"}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Amount</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>What for? (optional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Groceries, Dinner, Gas"
              />
            </div>
            <div className="ge-split-info">
              Split equally between {members.length} {members.length === 1 ? "person" : "people"}
              {parsedAmount > 0 && (
                <span> &mdash; ${(parsedAmount / members.length).toFixed(2)} each</span>
              )}
            </div>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "Saving..." : "Add Expense"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
