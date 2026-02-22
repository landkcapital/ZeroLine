import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export default function GroupExpenseModal({ groupId, groupName, userBudgets = [], onClose, onAdded }) {
  const [members, setMembers] = useState([]);
  const [paidByMemberId, setPaidByMemberId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState(null);

  // Split & budget state
  const [splitMode, setSplitMode] = useState("equal");
  const [customPercents, setCustomPercents] = useState({});
  const [selectedBudgetId, setSelectedBudgetId] = useState(userBudgets[0]?.id || "");

  // Current user info
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentMemberId, setCurrentMemberId] = useState(null);

  useEffect(() => {
    async function fetchMembers() {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user.id);

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
      if (me) {
        setPaidByMemberId(me.id);
        setCurrentMemberId(me.id);
      } else if (memberList.length > 0) {
        setPaidByMemberId(memberList[0].id);
      }

      // Initialize equal percents
      if (memberList.length > 0) {
        const equalPct = 100 / memberList.length;
        const pcts = {};
        for (const m of memberList) {
          pcts[m.id] = equalPct;
        }
        setCustomPercents(pcts);
      }

      setLoading(false);
    }
    fetchMembers();
  }, [groupId]);

  // Update selectedBudgetId when userBudgets changes
  useEffect(() => {
    if (userBudgets.length > 0 && !selectedBudgetId) {
      setSelectedBudgetId(userBudgets[0].id);
    }
  }, [userBudgets, selectedBudgetId]);

  function handleReceiptChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5MB");
      return;
    }
    setReceiptFile(file);
    setReceiptPreview(URL.createObjectURL(file));
  }

  function handleSliderChange(memberId, newPct) {
    const clamped = Math.max(0, Math.min(100, newPct));
    const otherIds = members.filter((m) => m.id !== memberId).map((m) => m.id);
    const remaining = 100 - clamped;

    // Get current total of others
    const othersTotal = otherIds.reduce((s, id) => s + (customPercents[id] || 0), 0);

    const newPcts = { ...customPercents, [memberId]: clamped };

    if (othersTotal > 0) {
      // Redistribute proportionally
      for (const oid of otherIds) {
        newPcts[oid] = ((customPercents[oid] || 0) / othersTotal) * remaining;
      }
    } else if (otherIds.length > 0) {
      // All others at 0, distribute equally
      const each = remaining / otherIds.length;
      for (const oid of otherIds) {
        newPcts[oid] = each;
      }
    }

    setCustomPercents(newPcts);
  }

  function resetToEqual() {
    if (members.length === 0) return;
    const equalPct = 100 / members.length;
    const pcts = {};
    for (const m of members) {
      pcts[m.id] = equalPct;
    }
    setCustomPercents(pcts);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!amount || !paidByMemberId) return;
    if (userBudgets.length > 0 && !selectedBudgetId) return;

    setSaving(true);
    setError(null);

    try {
      const parsedAmt = parseFloat(amount);

      // Calculate shares
      const shareAmounts = {};
      if (splitMode === "equal") {
        const each = parsedAmt / members.length;
        for (const m of members) {
          shareAmounts[m.id] = Math.round(each * 100) / 100;
        }
      } else {
        for (const m of members) {
          const pct = customPercents[m.id] || 0;
          shareAmounts[m.id] = Math.round((parsedAmt * pct / 100) * 100) / 100;
        }
      }

      // 1. Insert group expense
      const { data: inserted, error: insertErr } = await supabase
        .from("group_expenses")
        .insert({
          group_id: groupId,
          paid_by_member_id: paidByMemberId,
          amount: parsedAmt,
          note: note || null,
          split_mode: splitMode,
          created_by_member_id: currentMemberId,
        })
        .select()
        .single();

      if (insertErr) {
        setError(insertErr.message);
        setSaving(false);
        return;
      }

      // 2. Upload receipt if present
      if (receiptFile && inserted) {
        const ext = receiptFile.name.split(".").pop();
        const path = `group-expenses/${inserted.id}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("receipt-images")
          .upload(path, receiptFile, { upsert: true });
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from("receipt-images").getPublicUrl(path);
        await supabase
          .from("group_expenses")
          .update({ receipt_url: urlData.publicUrl })
          .eq("id", inserted.id);
      }

      // 3. Create shares for each member
      const creatorIsThePayer = currentMemberId === paidByMemberId;

      for (const m of members) {
        const shareAmt = shareAmounts[m.id];
        if (shareAmt <= 0) continue;

        const shareRow = {
          expense_id: inserted.id,
          member_id: m.id,
          share_amount: shareAmt,
          settled: false,
        };

        // Creator's own share — link to budget
        if (m.id === currentMemberId && selectedBudgetId) {
          shareRow.budget_id = selectedBudgetId;

          if (creatorIsThePayer) {
            // Creator paid → create transaction (immediate spend)
            const { data: tx, error: txErr } = await supabase
              .from("transactions")
              .insert({
                budget_id: selectedBudgetId,
                amount: shareAmt,
                note: `${groupName}: ${note || "Group expense"} (your share)`,
                occurred_at: new Date().toISOString(),
              })
              .select()
              .single();
            if (txErr) throw txErr;
            shareRow.transaction_id = tx.id;
            shareRow.settled = true;
            shareRow.settled_at = new Date().toISOString();
          } else {
            // Someone else paid → create allocation (earmarked until settled)
            const { data: alloc, error: allocErr } = await supabase
              .from("allocations")
              .insert({
                budget_id: selectedBudgetId,
                amount: shareAmt,
                note: `${groupName}: ${note || "Group expense"} (owed)`,
              })
              .select()
              .single();
            if (allocErr) throw allocErr;
            shareRow.allocation_id = alloc.id;
          }
        }

        // Payer's own share is auto-settled (they paid for themselves)
        if (m.id === paidByMemberId) {
          shareRow.settled = true;
          shareRow.settled_at = new Date().toISOString();
        }

        const { error: shareErr } = await supabase
          .from("group_expense_shares")
          .insert(shareRow);
        if (shareErr) throw shareErr;
      }

      onAdded();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save expense");
      setSaving(false);
    }
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

            {/* Split Mode Toggle */}
            <div className="form-group">
              <label>Split</label>
              <div className="modal-mode-toggle">
                <button
                  type="button"
                  className={`modal-mode-btn ${splitMode === "equal" ? "active" : ""}`}
                  onClick={() => { setSplitMode("equal"); resetToEqual(); }}
                >
                  Equal
                </button>
                <button
                  type="button"
                  className={`modal-mode-btn ${splitMode === "custom" ? "active" : ""}`}
                  onClick={() => setSplitMode("custom")}
                >
                  Custom
                </button>
              </div>
            </div>

            {splitMode === "equal" ? (
              <div className="ge-split-info">
                Split equally between {members.length} {members.length === 1 ? "person" : "people"}
                {parsedAmount > 0 && (
                  <span> &mdash; ${(parsedAmount / members.length).toFixed(2)} each</span>
                )}
              </div>
            ) : (
              <div className="split-slider-list">
                {members.map((m) => {
                  const pct = customPercents[m.id] || 0;
                  const dollarAmt = parsedAmount > 0 ? (parsedAmount * pct / 100) : 0;
                  return (
                    <div key={m.id} className="split-slider-row">
                      <div className="split-slider-header">
                        <span className="split-slider-name">
                          {m.user_id === currentUserId ? "You" : m.display_name || "Unknown"}
                        </span>
                        <span className="split-slider-value">{Math.round(pct)}%</span>
                      </div>
                      <input
                        type="range"
                        className="split-slider-input"
                        min="0"
                        max="100"
                        step="1"
                        value={Math.round(pct)}
                        onChange={(e) => handleSliderChange(m.id, parseInt(e.target.value))}
                      />
                      <div className="split-slider-amount">
                        ${dollarAmt.toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Budget selector (only if creator has budgets) */}
            {userBudgets.length > 0 && (
              <div className="form-group">
                <label>Your Budget</label>
                <select
                  value={selectedBudgetId}
                  onChange={(e) => setSelectedBudgetId(e.target.value)}
                  required
                >
                  {userBudgets.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label>Receipt (optional)</label>
              <div className="receipt-upload">
                {receiptPreview && (
                  <img src={receiptPreview} alt="Receipt preview" className="receipt-preview" />
                )}
                <input type="file" accept="image/*" onChange={handleReceiptChange} />
              </div>
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
