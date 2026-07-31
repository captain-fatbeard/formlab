-- Single-row heartbeat table. A daily Vercel cron hits /api/keepalive which
-- stamps pinged_at, so the free-tier Supabase project always sees recent API
-- activity and never gets paused for inactivity (7-day threshold).

CREATE TABLE IF NOT EXISTS keepalive (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pinged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE keepalive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations" ON keepalive
  FOR ALL
  USING (true)
  WITH CHECK (true);

INSERT INTO keepalive (id) VALUES (1) ON CONFLICT DO NOTHING;
