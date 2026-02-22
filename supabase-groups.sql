-- ============================================
-- Groups feature schema (idempotent — safe to re-run)
-- Run this in your Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. CREATE ALL TABLES FIRST
-- ============================================

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, user_id)
);

ALTER TABLE budgets ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE SET NULL;

-- ============================================
-- 2. ENABLE RLS
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 3. SECURITY DEFINER helper (avoids infinite recursion)
-- ============================================

CREATE OR REPLACE FUNCTION is_group_member(check_group_id UUID, check_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = check_group_id AND user_id = check_user_id
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================
-- 4. PROFILES: policies, trigger, backfill
-- ============================================

DROP POLICY IF EXISTS "Authenticated users can view profiles" ON profiles;
CREATE POLICY "Authenticated users can view profiles"
  ON profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

INSERT INTO profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT DO NOTHING;

-- ============================================
-- 5. GROUPS policies
-- ============================================

DROP POLICY IF EXISTS "Members can view group" ON groups;
CREATE POLICY "Members can view group"
  ON groups FOR SELECT
  USING (is_group_member(id, auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can create groups" ON groups;
CREATE POLICY "Authenticated users can create groups"
  ON groups FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "Owner can update group" ON groups;
CREATE POLICY "Owner can update group"
  ON groups FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "Owner can delete group" ON groups;
CREATE POLICY "Owner can delete group"
  ON groups FOR DELETE
  USING (owner_user_id = auth.uid());

-- ============================================
-- 6. GROUP MEMBERS policies
-- ============================================

DROP POLICY IF EXISTS "Members can view group members" ON group_members;
CREATE POLICY "Members can view group members"
  ON group_members FOR SELECT
  USING (is_group_member(group_id, auth.uid()));

DROP POLICY IF EXISTS "Group owner can add members" ON group_members;
CREATE POLICY "Group owner can add members"
  ON group_members FOR INSERT
  WITH CHECK (
    group_id IN (SELECT g.id FROM groups g WHERE g.owner_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Owner or self can remove member" ON group_members;
CREATE POLICY "Owner or self can remove member"
  ON group_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR group_id IN (SELECT g.id FROM groups g WHERE g.owner_user_id = auth.uid())
  );

-- ============================================
-- 7. BUDGETS supplementary policies for groups
-- ============================================

DROP POLICY IF EXISTS "Members can view group budgets" ON budgets;
CREATE POLICY "Members can view group budgets"
  ON budgets FOR SELECT
  USING (
    group_id IS NOT NULL
    AND is_group_member(group_id, auth.uid())
  );

DROP POLICY IF EXISTS "Members can create group budgets" ON budgets;
CREATE POLICY "Members can create group budgets"
  ON budgets FOR INSERT
  WITH CHECK (
    (group_id IS NULL AND user_id = auth.uid())
    OR (
      group_id IS NOT NULL
      AND is_group_member(group_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Members can update group budgets" ON budgets;
CREATE POLICY "Members can update group budgets"
  ON budgets FOR UPDATE
  USING (
    group_id IS NOT NULL
    AND is_group_member(group_id, auth.uid())
  );

DROP POLICY IF EXISTS "Members can delete group budgets" ON budgets;
CREATE POLICY "Members can delete group budgets"
  ON budgets FOR DELETE
  USING (
    group_id IS NOT NULL
    AND is_group_member(group_id, auth.uid())
  );

-- ============================================
-- 8. TRANSACTIONS supplementary policies for group budgets
-- ============================================

DROP POLICY IF EXISTS "Members can view group budget transactions" ON transactions;
CREATE POLICY "Members can view group budget transactions"
  ON transactions FOR SELECT
  USING (
    budget_id IN (
      SELECT b.id FROM budgets b
      WHERE b.group_id IS NOT NULL
        AND is_group_member(b.group_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Members can create group budget transactions" ON transactions;
CREATE POLICY "Members can create group budget transactions"
  ON transactions FOR INSERT
  WITH CHECK (
    budget_id IN (
      SELECT b.id FROM budgets b
      WHERE b.group_id IS NOT NULL
        AND is_group_member(b.group_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Members can delete group budget transactions" ON transactions;
CREATE POLICY "Members can delete group budget transactions"
  ON transactions FOR DELETE
  USING (
    budget_id IN (
      SELECT b.id FROM budgets b
      WHERE b.group_id IS NOT NULL
        AND is_group_member(b.group_id, auth.uid())
    )
  );
