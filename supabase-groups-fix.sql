-- ============================================
-- NUCLEAR FIX: Groups RLS + create_group RPC
-- Safe to re-run. Run this in Supabase SQL Editor.
-- ============================================

-- 1. Create the SECURITY DEFINER helper (avoids infinite recursion)
CREATE OR REPLACE FUNCTION is_group_member(check_group_id UUID, check_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = check_group_id AND user_id = check_user_id
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 2. RPC function: create_group — bypasses RLS, creates group + adds member atomically
CREATE OR REPLACE FUNCTION create_group(group_name TEXT)
RETURNS JSON AS $$
DECLARE
  new_group RECORD;
BEGIN
  INSERT INTO groups (name, owner_user_id)
  VALUES (group_name, auth.uid())
  RETURNING * INTO new_group;

  INSERT INTO group_members (group_id, user_id)
  VALUES (new_group.id, auth.uid());

  RETURN json_build_object(
    'id', new_group.id,
    'name', new_group.name,
    'owner_user_id', new_group.owner_user_id,
    'created_at', new_group.created_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Dynamically drop ALL existing policies on groups and group_members
DO $$ DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'groups' LOOP
    EXECUTE format('DROP POLICY %I ON groups', pol.policyname);
  END LOOP;
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'group_members' LOOP
    EXECUTE format('DROP POLICY %I ON group_members', pol.policyname);
  END LOOP;
END $$;

-- 4. Make sure RLS is enabled
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- 5. Recreate groups policies (owner OR member can view — fixes RETURNING issue)
CREATE POLICY "groups_select" ON groups FOR SELECT
  USING (owner_user_id = auth.uid() OR is_group_member(id, auth.uid()));

CREATE POLICY "groups_insert" ON groups FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "groups_update" ON groups FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "groups_delete" ON groups FOR DELETE
  USING (owner_user_id = auth.uid());

-- 6. Recreate group_members policies
CREATE POLICY "gm_select" ON group_members FOR SELECT
  USING (is_group_member(group_id, auth.uid()));

CREATE POLICY "gm_insert" ON group_members FOR INSERT
  WITH CHECK (group_id IN (SELECT g.id FROM groups g WHERE g.owner_user_id = auth.uid()));

CREATE POLICY "gm_delete" ON group_members FOR DELETE
  USING (user_id = auth.uid() OR group_id IN (SELECT g.id FROM groups g WHERE g.owner_user_id = auth.uid()));
