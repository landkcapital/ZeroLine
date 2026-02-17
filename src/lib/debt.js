import { getPeriodStart, stepPeriod } from "./period";

/**
 * Compute carried debt from previous periods for a budget.
 * Only negative balances (debt) carry forward; surplus does not.
 * A [RESET] transaction clears all prior debt.
 * Returns 0 or a negative number.
 */
export function computeCarriedDebt(budget, allTransactions) {
  const currentPeriodStart = getPeriodStart(budget.period, budget.renew_anchor);

  // Find the most recent [RESET] transaction
  const resets = allTransactions
    .filter((t) => t.note && t.note.includes("[RESET]"))
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
  const resetDate = resets.length > 0 ? new Date(resets[0].occurred_at) : null;

  // Only consider transactions after the most recent reset
  const relevantTx = resetDate
    ? allTransactions.filter((t) => new Date(t.occurred_at) >= resetDate)
    : allTransactions;

  if (relevantTx.length === 0) return 0;

  const earliestTxDate = relevantTx.reduce(
    (min, t) => {
      const d = new Date(t.occurred_at);
      return d < min ? d : min;
    },
    new Date()
  );

  // Walk back from current period to cover the earliest transaction
  let cursor = new Date(currentPeriodStart);
  while (cursor.getTime() > earliestTxDate.getTime()) {
    cursor = stepPeriod(budget.period, cursor, "prev");
  }

  // Walk forward period by period, accumulating debt
  let debt = 0;
  while (cursor.getTime() < currentPeriodStart.getTime()) {
    const periodEnd = stepPeriod(budget.period, cursor, "next");
    const periodSpent = relevantTx
      .filter((t) => {
        const time = new Date(t.occurred_at).getTime();
        return time >= cursor.getTime() && time < periodEnd.getTime();
      })
      .reduce((sum, t) => sum + t.amount, 0);

    const periodRemaining = budget.goal_amount - periodSpent + debt;
    debt = Math.min(0, periodRemaining);
    cursor = periodEnd;
  }

  return debt;
}
