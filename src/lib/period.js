export const PERIOD_DAYS = { weekly: 7, fortnightly: 14, "4-weekly": 28, monthly: 30.44 };
export const VIEW_PERIODS = ["weekly", "fortnightly", "4-weekly"];
export const VIEW_LABELS = { weekly: "Weekly", fortnightly: "Fortnightly", "4-weekly": "4-Weekly" };

/**
 * Parse a renew_anchor value (ISO date string like "2026-02-10") into a local Date.
 * Returns null if falsy.
 */
function parseAnchor(anchor) {
  if (!anchor) return null;
  const [y, m, d] = anchor.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Returns the start date of the current period for a given budget.
 *
 * If renewAnchor is provided (ISO date string):
 *   Weekly:      uses the anchor's day-of-week instead of Monday
 *   Fortnightly: aligns 14-day cycles to the anchor date
 *   4-weekly:    aligns 28-day cycles to the anchor date
 *
 * Without anchor, falls back to original defaults.
 */
export function getPeriodStart(period, renewAnchor) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const anchor = parseAnchor(renewAnchor);

  switch (period) {
    case "weekly": {
      const renewDay = anchor ? anchor.getDay() : 1; // default Monday
      const todayDay = today.getDay();
      let diff = todayDay - renewDay;
      if (diff < 0) diff += 7;
      const start = new Date(today);
      start.setDate(today.getDate() - diff);
      return start;
    }
    case "fortnightly": {
      const cycleDays = 14;
      if (anchor) {
        const anchorTime = anchor.getTime();
        const todayTime = today.getTime();
        const dayMs = 86400000;
        const daysSinceAnchor = Math.floor((todayTime - anchorTime) / dayMs);
        const cycleOffset = ((daysSinceAnchor % cycleDays) + cycleDays) % cycleDays;
        const start = new Date(today);
        start.setDate(today.getDate() - cycleOffset);
        return start;
      }
      const start = new Date(today);
      start.setDate(today.getDate() - 13);
      return start;
    }
    case "4-weekly": {
      const cycleDays = 28;
      if (anchor) {
        const anchorTime = anchor.getTime();
        const todayTime = today.getTime();
        const dayMs = 86400000;
        const daysSinceAnchor = Math.floor((todayTime - anchorTime) / dayMs);
        const cycleOffset = ((daysSinceAnchor % cycleDays) + cycleDays) % cycleDays;
        const start = new Date(today);
        start.setDate(today.getDate() - cycleOffset);
        return start;
      }
      const start = new Date(today);
      start.setDate(today.getDate() - 27);
      return start;
    }
    // Keep "monthly" working for any legacy data
    case "monthly": {
      const renewDay = anchor ? anchor.getDate() : 1;
      const start = new Date(today.getFullYear(), today.getMonth(), renewDay);
      if (start > today) {
        start.setMonth(start.getMonth() - 1);
      }
      return start;
    }
    default:
      return today;
  }
}

export function getPeriodLabel(period) {
  switch (period) {
    case "weekly":
      return "This Week";
    case "fortnightly":
      return "Last 14 Days";
    case "4-weekly":
      return "Last 28 Days";
    case "monthly":
      return "This Month";
    default:
      return period;
  }
}

/**
 * Returns { start, end } for the period containing referenceDate.
 * If renewAnchor is provided, it adjusts alignment accordingly.
 */
export function getPeriodRange(period, referenceDate = new Date(), renewAnchor) {
  const ref = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const anchor = parseAnchor(renewAnchor);

  let start, end;

  switch (period) {
    case "weekly": {
      const renewDay = anchor ? anchor.getDay() : 1;
      const refDay = ref.getDay();
      let diff = refDay - renewDay;
      if (diff < 0) diff += 7;
      start = new Date(ref);
      start.setDate(ref.getDate() - diff);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case "fortnightly": {
      const cycleDays = 14;
      if (anchor) {
        const anchorTime = anchor.getTime();
        const refTime = ref.getTime();
        const dayMs = 86400000;
        const daysSinceAnchor = Math.floor((refTime - anchorTime) / dayMs);
        const cycleOffset = ((daysSinceAnchor % cycleDays) + cycleDays) % cycleDays;
        start = new Date(ref);
        start.setDate(ref.getDate() - cycleOffset);
      } else {
        const day = ref.getDay();
        const diff = day === 0 ? 6 : day - 1;
        start = new Date(ref);
        start.setDate(ref.getDate() - diff - 7);
      }
      end = new Date(start);
      end.setDate(start.getDate() + 13);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case "4-weekly": {
      const cycleDays = 28;
      if (anchor) {
        const anchorTime = anchor.getTime();
        const refTime = ref.getTime();
        const dayMs = 86400000;
        const daysSinceAnchor = Math.floor((refTime - anchorTime) / dayMs);
        const cycleOffset = ((daysSinceAnchor % cycleDays) + cycleDays) % cycleDays;
        start = new Date(ref);
        start.setDate(ref.getDate() - cycleOffset);
      } else {
        start = new Date(ref);
        start.setDate(ref.getDate() - 27);
      }
      end = new Date(start);
      end.setDate(start.getDate() + 27);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case "monthly": {
      const renewDay = anchor ? anchor.getDate() : 1;
      start = new Date(ref.getFullYear(), ref.getMonth(), renewDay);
      if (start > ref) {
        start.setMonth(start.getMonth() - 1);
      }
      end = new Date(start.getFullYear(), start.getMonth() + 1, renewDay - 1);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    default:
      start = new Date(ref);
      end = new Date(ref);
      end.setHours(23, 59, 59, 999);
      return { start, end };
  }
}

export function stepPeriod(period, referenceDate, direction) {
  const ref = new Date(referenceDate);
  switch (period) {
    case "weekly":
      ref.setDate(ref.getDate() + (direction === "next" ? 7 : -7));
      return ref;
    case "fortnightly":
      ref.setDate(ref.getDate() + (direction === "next" ? 14 : -14));
      return ref;
    case "4-weekly":
      ref.setDate(ref.getDate() + (direction === "next" ? 28 : -28));
      return ref;
    case "monthly":
      ref.setMonth(ref.getMonth() + (direction === "next" ? 1 : -1));
      return ref;
    default:
      return ref;
  }
}

export function formatPeriodRange(period, start, end) {
  const opts = { month: "short", day: "numeric" };
  const yearOpts = { ...opts, year: "numeric" };

  const startStr = start.toLocaleDateString(undefined, opts);
  const endStr = end.toLocaleDateString(undefined, yearOpts);
  return `${startStr} – ${endStr}`;
}
