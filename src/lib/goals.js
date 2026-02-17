import { getPeriodStart, stepPeriod } from "./period";

/**
 * Collect budget leftovers into the goal that has collect_leftovers enabled.
 * Runs on app load — checks if a new period started since last collection.
 */
export async function collectLeftovers(supabase, budgets, allTx, goals) {
  const target = goals.find((g) => g.collect_leftovers);
  if (!target) return;

  const spendingBudgets = budgets.filter((b) => b.type !== "subscription");
  let totalCollected = 0;

  for (const b of spendingBudgets) {
    const periodStart = getPeriodStart(b.period, b.renew_anchor);
    const lastCollected = b.leftover_collected_until
      ? new Date(b.leftover_collected_until)
      : null;

    // Skip if already collected for this period
    if (lastCollected && lastCollected.getTime() >= periodStart.getTime()) continue;

    // Compute previous period's remaining
    const prevStart = stepPeriod(b.period, periodStart, "prev");
    const prevSpent = allTx
      .filter((t) => {
        if (t.budget_id !== b.id) return false;
        const time = new Date(t.occurred_at).getTime();
        return time >= prevStart.getTime() && time < periodStart.getTime();
      })
      .reduce((sum, t) => sum + t.amount, 0);

    const prevRemaining = b.goal_amount - prevSpent;

    if (prevRemaining > 0) {
      totalCollected += prevRemaining;
    }

    // Mark as collected regardless (even if no leftovers)
    await supabase
      .from("budgets")
      .update({ leftover_collected_until: periodStart.toISOString() })
      .eq("id", b.id);
  }

  if (totalCollected > 0) {
    await supabase
      .from("goals")
      .update({ saved_amount: target.saved_amount + totalCollected })
      .eq("id", target.id);
  }
}

/**
 * Process auto-contributions for goals that have a period and amount set.
 * Runs on app load — checks if a new period started since last contribution.
 */
export async function processContributions(supabase, goals) {
  for (const goal of goals) {
    if (!goal.period || !goal.contribution_amount || goal.contribution_paused) continue;
    if (goal.contribution_amount <= 0) continue;

    const periodStart = getPeriodStart(goal.period, goal.renew_anchor);
    const lastContrib = goal.last_contribution_at
      ? new Date(goal.last_contribution_at)
      : null;

    // Skip if already contributed for this period
    if (lastContrib && lastContrib.getTime() >= periodStart.getTime()) continue;

    await supabase
      .from("goals")
      .update({
        saved_amount: goal.saved_amount + goal.contribution_amount,
        last_contribution_at: new Date().toISOString(),
      })
      .eq("id", goal.id);
  }
}
