-- ============================================================
-- Goals: Add Investment Support
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Add new columns for investment goals
ALTER TABLE goals ADD COLUMN IF NOT EXISTS goal_type TEXT NOT NULL DEFAULT 'savings';
ALTER TABLE goals ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT NULL;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS invested_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS current_value NUMERIC NOT NULL DEFAULT 0;
