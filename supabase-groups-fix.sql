-- ============================================
-- FIX SCRIPT: Run this to fix the RLS policies
-- Safe to run multiple times
-- ============================================

-- Step 1: Helper function
CREATE OR REPLACE FUNCTION is_group_member(check_group_id UUID, check_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = check_group_id AND user_id = check_user_id
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Step 2: Drop ALL group-related policies (clean slate)
DROP POLICY IF EXISTS "Members can view group" ON groups;
DROP POLICY IF EXISTS "Authenticated users can create groups" ON groups;
DROP POLICY IF EXISTS "Owner can update group" ON groups;
DROP POLICY IF EXISTS "Owner can delete group" ON groups;
DROP POLICY IF EXISTS "Members can view group members" ON group_members;
DROP POLICY IF EXISTS "Group owner can add members" ON group_members;
DROP POLICY IF EXISTS "Owner or self can remove member" ON group_members;
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON profiles;
DROP POLICY IF EXISTS "Members can view group budgets" ON budgets;
DROP POLICY IF EXISTS "Members can create group budgets" ON budgets;
DROP POLICY IF EXISTS "Members can update group budgets" ON budgets;
DROP POLICY IF EXISTS "Members can delete group budgets" ON budgets;
DROP POLICY IF EXISTS "Members can view group budget transactions" ON transactions;
DROP POLICY IF EXISTS "Members can create group budget transactions" ON transactions;
DROP POLICY IF EXISTS "Members can delete group budget transactions" ON transactions;

-- Step 3: Recreate all policies

-- Profiles
CREATE POLICY "Authenticated users can view profiles"
  ON profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Groups
CREATE POLICY "Members can view group"
  ON groups FOR SELECT
  USING (is_group_member(id, auth.uid()));

CREATE POLICY "Authenticated users can create groups"
  ON groups FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Owner can update group"
  ON groups FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Owner can delete group"
  ON groups FOR DELETE
  USING (owner_user_id = auth.uid());

-- Group members
CREATE POLICY "Members can view group members"
  ON group_members FOR SELECT
  USING (is_group_member(group_id, auth.uid()));

CREATE POLICY "Group owner can add members"
  ON group_members FOR INSERT
  WITH CHECK (
    group_id IN (SELECT g.id FROM groups g WHERE g.owner_user_id = auth.uid())
  );

CREATE POLICY "Owner or self can remove member"
  ON group_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR group_id IN (SELECT g.id FROM groups g WHERE g.owner_user_id = auth.uid())
  );

-- Budgets (group supplementary)
CREATE POLICY "Members can view group budgets"
  ON budgets FOR SELECT
  USING (
    group_id IS NOT NULL
    AND is_group_member(group_id, auth.uid())
  );

CREATE POLICY "Members can create group budgets"
  ON budgets FOR INSERT
  WITH CHECK (
    (group_id IS NULL AND user_id = auth.uid())
    OR (
      group_id IS NOT NULL
      AND is_group_member(group_id, auth.uid())
    )
  );

CREATE POLICY "Members can update group budgets"
  ON budgets FOR UPDATE
  USING (
    group_id IS NOT NULL
    AND is_group_member(group_id, auth.uid())
  );

CREATE POLICY "Members can delete group budgets"
  ON budgets FOR DELETE
  USING (
    group_id IS NOT NULL
    AND is_group_member(group_id, auth.uid())
  );

-- Transactions (group supplementary)
CREATE POLICY "Members can view group budget transactions"
  ON transactions FOR SELECT
  USING (
    budget_id IN (
      SELECT b.id FROM budgets b
      WHERE b.group_id IS NOT NULL
        AND is_group_member(b.group_id, auth.uid())
    )
  );

CREATE POLICY "Members can create group budget transactions"
  ON transactions FOR INSERT
  WITH CHECK (
    budget_id IN (
      SELECT b.id FROM budgets b
      WHERE b.group_id IS NOT NULL
        AND is_group_member(b.group_id, auth.uid())
    )
  );

CREATE POLICY "Members can delete group budget transactions"
  ON transactions FOR DELETE
  USING (
    budget_id IN (
      SELECT b.id FROM budgets b
      WHERE b.group_id IS NOT NULL
        AND is_group_member(b.group_id, auth.uid())
    )
  );
