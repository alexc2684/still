CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, password_hash text NOT NULL, name text NOT NULL, timezone text NOT NULL DEFAULT 'UTC', weekly_target int NOT NULL DEFAULT 7 CHECK (weekly_target BETWEEN 1 AND 7), weekly_minutes_target int CHECK (weekly_minutes_target BETWEEN 5 AND 10080), avatar_key text, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_minutes_target int;
CREATE TABLE IF NOT EXISTS sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS meditation_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, started_at timestamptz NOT NULL, completed_at timestamptz, completed_local_date date, planned_seconds int NOT NULL CHECK(planned_seconds>0), elapsed_seconds int NOT NULL DEFAULT 0, name text, goal_days_snapshot int, goal_minutes_snapshot int, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE meditation_sessions ADD COLUMN IF NOT EXISTS goal_days_snapshot int;
ALTER TABLE meditation_sessions ADD COLUMN IF NOT EXISTS goal_minutes_snapshot int;
ALTER TABLE meditation_sessions ADD COLUMN IF NOT EXISTS shared_sit_id uuid;
CREATE TABLE IF NOT EXISTS shared_sits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), host_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, invite_token text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','running','completed','cancelled')), planned_seconds int NOT NULL CHECK(planned_seconds BETWEEN 60 AND 86400), started_at timestamptz, ends_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS shared_sit_members (shared_sit_id uuid NOT NULL REFERENCES shared_sits(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, meditation_session_id uuid REFERENCES meditation_sessions(id) ON DELETE SET NULL, left_at timestamptz, joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(shared_sit_id,user_id));
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meditation_sessions_shared_sit_fk' AND conrelid='meditation_sessions'::regclass) THEN
    ALTER TABLE meditation_sessions ADD CONSTRAINT meditation_sessions_shared_sit_fk FOREIGN KEY(shared_sit_id) REFERENCES shared_sits(id) ON DELETE SET NULL;
  END IF;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS meditation_shared_sit_member_unique ON meditation_sessions(shared_sit_id,user_id) WHERE shared_sit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_completion_per_start ON meditation_sessions(user_id,started_at);
CREATE TABLE IF NOT EXISTS reflections (session_id uuid PRIMARY KEY REFERENCES meditation_sessions(id) ON DELETE CASCADE, before_mood int CHECK(before_mood BETWEEN 1 AND 5), during_mood int CHECK(during_mood BETWEEN 1 AND 5), after_mood int CHECK(after_mood BETWEEN 1 AND 5), before_note text, during_note text, after_note text);
CREATE TABLE IF NOT EXISTS kudos (session_id uuid REFERENCES meditation_sessions(id) ON DELETE CASCADE, user_id uuid REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,user_id));
CREATE TABLE IF NOT EXISTS comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES meditation_sessions(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, body text NOT NULL CHECK(length(body) BETWEEN 1 AND 500), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS auth_attempts (id bigserial PRIMARY KEY, attempt_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS auth_attempts_key_time ON auth_attempts(attempt_key, created_at);
CREATE TABLE IF NOT EXISTS reminder_settings (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, enabled boolean NOT NULL DEFAULT false, reminder_hour smallint NOT NULL DEFAULT 19 CHECK(reminder_hour BETWEEN 0 AND 23), reminder_days smallint[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]::smallint[], updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS push_subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint text NOT NULL, p256dh text NOT NULL, auth text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, endpoint));
CREATE TABLE IF NOT EXISTS reminder_delivery_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE, local_date date NOT NULL, reminder_type text NOT NULL DEFAULT 'practice', status text NOT NULL DEFAULT 'sending' CHECK(status IN ('sending','sent','failed')), attempts smallint NOT NULL DEFAULT 1, claimed_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, last_error text, UNIQUE(user_id, subscription_id, local_date, reminder_type));
CREATE INDEX IF NOT EXISTS reminder_ledger_due ON reminder_delivery_ledger(status, claimed_at);
CREATE TABLE IF NOT EXISTS password_reset_tokens (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, password_hash_snapshot text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS password_reset_tokens_user ON password_reset_tokens(user_id);
