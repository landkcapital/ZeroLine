-- ============================================
-- Groups Expenses Migration
-- Run AFTER supabase-groups-fix.sql
-- Run in Supabase SQL Editor
-- ============================================

-- 1. Allow non-user members + add display_name
ALTER TABLE group_members ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Backfill display_name for existing members
UPDATE group_members gm
SET display_name = split_part(p.email, '@', 1)
FROM profiles p
WHERE gm.user_id = p.id AND gm.display_name IS NULL;

-- 2. Group expenses table
CREATE TABLE IF NOT EXISTS group_expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  paid_by_member_id UUID REFERENCES group_members(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  note TEXT,
  occurred_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE group_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ge_select" ON group_expenses FOR SELECT
  USING (is_group_member(group_id, auth.uid()));

CREATE POLICY "ge_insert" ON group_expenses FOR INSERT
  WITH CHECK (is_group_member(group_id, auth.uid()));

CREATE POLICY "ge_delete" ON group_expenses FOR DELETE
  USING (is_group_member(group_id, auth.uid()));

-- 3. Update create_group to set display_name for creator
CREATE OR REPLACE FUNCTION create_group(group_name TEXT)
RETURNS JSON AS $$
DECLARE
  new_group RECORD;
  creator_email TEXT;
BEGIN
  SELECT email INTO creator_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO groups (name, owner_user_id)
  VALUES (group_name, auth.uid())
  RETURNING * INTO new_group;

  INSERT INTO group_members (group_id, user_id, display_name)
  VALUES (new_group.id, auth.uid(), split_part(COALESCE(creator_email, 'You'), '@', 1));

  RETURN json_build_object(
    'id', new_group.id,
    'name', new_group.name,
    'owner_user_id', new_group.owner_user_id,
    'created_at', new_group.created_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Add named member function (non-user)
CREATE OR REPLACE FUNCTION add_named_member(p_group_id UUID, p_name TEXT)
RETURNS JSON AS $$
DECLARE
  new_member RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM groups WHERE id = p_group_id AND owner_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the group owner can add members';
  END IF;

  INSERT INTO group_members (group_id, display_name)
  VALUES (p_group_id, p_name)
  RETURNING * INTO new_member;

  RETURN json_build_object(
    'id', new_member.id,
    'group_id', new_member.group_id,
    'display_name', new_member.display_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Add user member function (by email)
CREATE OR REPLACE FUNCTION add_user_member(p_group_id UUID, p_email TEXT)
RETURNS JSON AS $$
DECLARE
  target_profile RECORD;
  new_member RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM groups WHERE id = p_group_id AND owner_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the group owner can add members';
  END IF;

  SELECT id, email INTO target_profile FROM profiles WHERE email = lower(p_email);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No user found with that email';
  END IF;

  IF EXISTS (SELECT 1 FROM group_members WHERE group_id = p_group_id AND user_id = target_profile.id) THEN
    RAISE EXCEPTION 'User is already a member';
  END IF;

  INSERT INTO group_members (group_id, user_id, display_name)
  VALUES (p_group_id, target_profile.id, split_part(target_profile.email, '@', 1))
  RETURNING * INTO new_member;

  RETURN json_build_object(
    'id', new_member.id,
    'group_id', new_member.group_id,
    'user_id', new_member.user_id,
    'display_name', new_member.display_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
