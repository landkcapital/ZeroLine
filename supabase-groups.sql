-- ============================================
-- Groups feature schema
-- Run this in your Supabase SQL Editor
-- ============================================

-- Profiles table (needed for email lookup — Supabase client can't query auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view profiles"
  ON profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Auto-populate profiles on new user signup
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

-- Backfill existing users
INSERT INTO profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT DO NOTHING;

-- ============================================
-- Groups table
-- ============================================
CREATE TABLE groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- Members can view their groups
CREATE POLICY "Members can view group"
  ON groups FOR SELECT
  USING (
    id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
  );

-- Authenticated users can create groups (must be owner)
CREATE POLICY "Authenticated users can create groups"
  ON groups FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

-- Only owner can update
CREATE POLICY "Owner can update group"
  ON groups FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- Only owner can delete
CREATE POLICY "Owner can delete group"
  ON groups FOR DELETE
  USING (owner_user_id = auth.uid());

-- ============================================
-- Group members table
-- ============================================
CREATE TABLE group_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, user_id)
);

ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- Members of a group can see other members
CREATE POLICY "Members can view group members"
  ON group_members FOR SELECT
  USING (
    group_id IN (SELECT gm.group_id FROM group_members gm WHERE gm.user_id = auth.uid())
  );

-- Group owner can add members
CREATE POLICY "Group owner can add members"
  ON group_members FOR INSERT
  WITH CHECK (
    group_id IN (SELECT g.id FROM groups g WHERE g.owner_user_id = auth.uid())
  );

-- Owner or self can remove membership
CREATE POLICY "Owner or self can remove member"
  ON group_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR group_id IN (SELECT g.id FROM groups g WHERE g.owner_user_id = auth.uid())
  );

-- ============================================
-- Add group_id to budgets (nullable — null = personal)
-- ============================================
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE SET NULL;

-- Supplementary RLS policies for group budgets
-- (existing personal budget policy remains: auth.uid() = user_id)

CREATE POLICY "Members can view group budgets"
  ON budgets FOR SELECT
  USING (
    group_id IS NOT NULL
    AND group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can create group budgets"
  ON budgets FOR INSERT
  WITH CHECK (
    (group_id IS NULL AND user_id = auth.uid())
    OR (
      group_id IS NOT NULL
      AND group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Members can update group budgets"
  ON budgets FOR UPDATE
  USING (
    group_id IS NOT NULL
    AND group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can delete group budgets"
  ON budgets FOR DELETE
  USING (
    group_id IS NOT NULL
    AND group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
  );

-- Supplementary RLS for transactions on group budgets
CREATE POLICY "Members can view group budget transactions"
  ON transactions FOR SELECT
  USING (
    budget_id IN (
      SELECT b.id FROM budgets b
      JOIN group_members gm ON gm.group_id = b.group_id
      WHERE gm.user_id = auth.uid()
    )
  );

CREATE POLICY "Members can create group budget transactions"
  ON transactions FOR INSERT
  WITH CHECK (
    budget_id IN (
      SELECT b.id FROM budgets b
      JOIN group_members gm ON gm.group_id = b.group_id
      WHERE gm.user_id = auth.uid()
    )
  );

CREATE POLICY "Members can delete group budget transactions"
  ON transactions FOR DELETE
  USING (
    budget_id IN (
      SELECT b.id FROM budgets b
      JOIN group_members gm ON gm.group_id = b.group_id
      WHERE gm.user_id = auth.uid()
    )
  );
