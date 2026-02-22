-- ============================================================
-- Receipt Uploads & Group Expense Disputes
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Add receipt_url column to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS receipt_url TEXT;

-- 2. Add receipt_url column to group_expenses
ALTER TABLE group_expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT;

-- 3. Create receipt-images storage bucket (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipt-images', 'receipt-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for receipt-images bucket
DO $$ BEGIN
  DROP POLICY IF EXISTS "Upload receipt images" ON storage.objects;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "View receipt images" ON storage.objects;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Delete receipt images" ON storage.objects;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "Upload receipt images" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'receipt-images' AND auth.uid() IS NOT NULL);

CREATE POLICY "View receipt images" ON storage.objects
  FOR SELECT USING (bucket_id = 'receipt-images');

CREATE POLICY "Delete receipt images" ON storage.objects
  FOR DELETE USING (bucket_id = 'receipt-images' AND auth.uid() IS NOT NULL);

-- 4. Add UPDATE policy on group_expenses (needed for editing disputed expenses)
DO $$ BEGIN
  DROP POLICY IF EXISTS "ge_update" ON group_expenses;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "ge_update" ON group_expenses FOR UPDATE
  USING (is_group_member(group_id, auth.uid()));

-- 5. Create group_expense_disputes table
CREATE TABLE IF NOT EXISTS group_expense_disputes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id UUID NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
  disputed_by_member_id UUID NOT NULL REFERENCES group_members(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(expense_id, disputed_by_member_id)
);

ALTER TABLE group_expense_disputes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "dispute_select" ON group_expense_disputes;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "dispute_insert" ON group_expense_disputes;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "dispute_delete" ON group_expense_disputes;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "dispute_select" ON group_expense_disputes FOR SELECT
  USING (
    expense_id IN (
      SELECT ge.id FROM group_expenses ge
      WHERE is_group_member(ge.group_id, auth.uid())
    )
  );

CREATE POLICY "dispute_insert" ON group_expense_disputes FOR INSERT
  WITH CHECK (
    expense_id IN (
      SELECT ge.id FROM group_expenses ge
      WHERE is_group_member(ge.group_id, auth.uid())
    )
  );

CREATE POLICY "dispute_delete" ON group_expense_disputes FOR DELETE
  USING (
    expense_id IN (
      SELECT ge.id FROM group_expenses ge
      WHERE is_group_member(ge.group_id, auth.uid())
    )
  );
