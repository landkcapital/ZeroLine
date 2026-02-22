-- ============================================
-- Allocations feature schema (idempotent — safe to re-run)
-- Run this in your Supabase SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS allocations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE allocations ENABLE ROW LEVEL SECURITY;

-- Personal budget allocations: user owns the budget
DROP POLICY IF EXISTS "Users can view own allocations" ON allocations;
CREATE POLICY "Users can view own allocations"
  ON allocations FOR SELECT
  USING (
    budget_id IN (SELECT id FROM budgets WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create own allocations" ON allocations;
CREATE POLICY "Users can create own allocations"
  ON allocations FOR INSERT
  WITH CHECK (
    budget_id IN (SELECT id FROM budgets WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete own allocations" ON allocations;
CREATE POLICY "Users can delete own allocations"
  ON allocations FOR DELETE
  USING (
    budget_id IN (SELECT id FROM budgets WHERE user_id = auth.uid())
  );

-- Group budget allocations: user is a group member
DROP POLICY IF EXISTS "Members can view group allocations" ON allocations;
CREATE POLICY "Members can view group allocations"
  ON allocations FOR SELECT
  USING (
    budget_id IN (
      SELECT b.id FROM budgets b
      WHERE b.group_id IS NOT NULL
        AND is_group_member(b.group_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Members can create group allocations" ON allocations;
CREATE POLICY "Members can create group allocations"
  ON allocations FOR INSERT
  WITH CHECK (
    budget_id IN (
      SELECT b.id FROM budgets b
      WHERE b.group_id IS NOT NULL
        AND is_group_member(b.group_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Members can delete group allocations" ON allocations;
CREATE POLICY "Members can delete group allocations"
  ON allocations FOR DELETE
  USING (
    budget_id IN (
      SELECT b.id FROM budgets b
      WHERE b.group_id IS NOT NULL
        AND is_group_member(b.group_id, auth.uid())
    )
  );
