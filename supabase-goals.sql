-- Goals table
CREATE TABLE goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL DEFAULT auth.uid(),
  name TEXT NOT NULL,
  image_url TEXT,
  target_amount NUMERIC NOT NULL DEFAULT 0,
  saved_amount NUMERIC NOT NULL DEFAULT 0,
  period TEXT,
  contribution_amount NUMERIC DEFAULT 0,
  contribution_paused BOOLEAN DEFAULT false,
  renew_anchor TEXT,
  collect_leftovers BOOLEAN DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  last_contribution_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own goals" ON goals FOR ALL USING (auth.uid() = user_id);

-- Track leftover collection per budget
ALTER TABLE budgets ADD COLUMN leftover_collected_until TIMESTAMPTZ;

-- Storage bucket for goal images
INSERT INTO storage.buckets (id, name, public) VALUES ('goal-images', 'goal-images', true);
CREATE POLICY "Upload goal images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'goal-images' AND auth.uid() IS NOT NULL);
CREATE POLICY "View goal images" ON storage.objects FOR SELECT USING (bucket_id = 'goal-images');
CREATE POLICY "Delete goal images" ON storage.objects FOR DELETE USING (bucket_id = 'goal-images' AND auth.uid() IS NOT NULL);
