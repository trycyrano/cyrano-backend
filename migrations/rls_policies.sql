-- Run this in Supabase Dashboard → SQL Editor

-- =====================
-- PROFILES
-- =====================
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can select own profile" ON profiles;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can select own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- =====================
-- VOICE_PROFILES
-- =====================
DROP POLICY IF EXISTS "Users can insert own voice profile" ON voice_profiles;
DROP POLICY IF EXISTS "Users can update own voice profile" ON voice_profiles;
DROP POLICY IF EXISTS "Users can select own voice profile" ON voice_profiles;

ALTER TABLE voice_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own voice profile" ON voice_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own voice profile" ON voice_profiles
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can select own voice profile" ON voice_profiles
  FOR SELECT USING (auth.uid() = user_id);

-- =====================
-- USAGE
-- =====================
DROP POLICY IF EXISTS "Users can insert own usage" ON usage;
DROP POLICY IF EXISTS "Users can update own usage" ON usage;
DROP POLICY IF EXISTS "Users can select own usage" ON usage;

ALTER TABLE usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own usage" ON usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own usage" ON usage
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can select own usage" ON usage
  FOR SELECT USING (auth.uid() = user_id);
