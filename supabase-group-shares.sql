-- ============================================================
-- Group Expense Shares: Custom Splits & Budget Integration
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Add split_mode and created_by_member_id to group_expenses
ALTER TABLE group_expenses ADD COLUMN IF NOT EXISTS split_mode TEXT DEFAULT 'equal';
ALTER TABLE group_expenses ADD COLUMN IF NOT EXISTS created_by_member_id UUID REFERENCES group_members(id);

-- 2. Create group_expense_shares table
CREATE TABLE IF NOT EXISTS group_expense_shares (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id UUID NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES group_members(id) ON DELETE CASCADE,
  share_amount NUMERIC NOT NULL,
  budget_id UUID REFERENCES budgets(id) ON DELETE SET NULL,
  allocation_id UUID REFERENCES allocations(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  settled BOOLEAN DEFAULT false,
  settled_at TIMESTAMPTZ,
  UNIQUE(expense_id, member_id)
);

ALTER TABLE group_expense_shares ENABLE ROW LEVEL SECURITY;

-- 3. RLS policies for group_expense_shares
DO $$ BEGIN
  DROP POLICY IF EXISTS "ges_select" ON group_expense_shares;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ges_insert" ON group_expense_shares;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ges_update" ON group_expense_shares;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ges_delete" ON group_expense_shares;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "ges_select" ON group_expense_shares FOR SELECT
  USING (
    expense_id IN (
      SELECT ge.id FROM group_expenses ge
      WHERE is_group_member(ge.group_id, auth.uid())
    )
  );

CREATE POLICY "ges_insert" ON group_expense_shares FOR INSERT
  WITH CHECK (
    expense_id IN (
      SELECT ge.id FROM group_expenses ge
      WHERE is_group_member(ge.group_id, auth.uid())
    )
  );

CREATE POLICY "ges_update" ON group_expense_shares FOR UPDATE
  USING (
    expense_id IN (
      SELECT ge.id FROM group_expenses ge
      WHERE is_group_member(ge.group_id, auth.uid())
    )
  );

CREATE POLICY "ges_delete" ON group_expense_shares FOR DELETE
  USING (
    expense_id IN (
      SELECT ge.id FROM group_expenses ge
      WHERE is_group_member(ge.group_id, auth.uid())
    )
  );
