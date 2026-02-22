-- ============================================================
-- Account Check: Bank Reconciliation Checkpoint
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Create account_checks table
CREATE TABLE IF NOT EXISTS account_checks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  screenshot_url TEXT,
  last_transaction_title TEXT,
  last_transaction_amount NUMERIC,
  checked_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE account_checks ENABLE ROW LEVEL SECURITY;

-- 2. RLS policies — users can only manage their own checkpoints
DO $$ BEGIN
  DROP POLICY IF EXISTS "ac_select" ON account_checks;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ac_insert" ON account_checks;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ac_update" ON account_checks;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ac_delete" ON account_checks;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "ac_select" ON account_checks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "ac_insert" ON account_checks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ac_update" ON account_checks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "ac_delete" ON account_checks FOR DELETE
  USING (auth.uid() = user_id);

-- 3. Create checkpoint-images storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('checkpoint-images', 'checkpoint-images', true)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Upload checkpoint images" ON storage.objects;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "View checkpoint images" ON storage.objects;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Delete checkpoint images" ON storage.objects;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "Upload checkpoint images" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'checkpoint-images' AND auth.uid() IS NOT NULL);

CREATE POLICY "View checkpoint images" ON storage.objects
  FOR SELECT USING (bucket_id = 'checkpoint-images');

CREATE POLICY "Delete checkpoint images" ON storage.objects
  FOR DELETE USING (bucket_id = 'checkpoint-images' AND auth.uid() IS NOT NULL);
