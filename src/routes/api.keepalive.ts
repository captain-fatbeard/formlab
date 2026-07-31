import { createFileRoute } from '@tanstack/react-router'

// Heartbeat endpoint hit by a daily Vercel cron (see vercel.json). Stamps the
// single keepalive row so the free-tier Supabase project always has recent
// API activity and never gets auto-paused for inactivity.

export const Route = createFileRoute('/api/keepalive')({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env.VITE_SUPABASE_URL
        const key = process.env.VITE_SUPABASE_ANON_KEY
        if (!url || !key) {
          return Response.json({ ok: false, error: 'Supabase not configured' }, { status: 500 })
        }

        const pingedAt = new Date().toISOString()
        const res = await fetch(`${url}/rest/v1/keepalive?id=eq.1`, {
          method: 'PATCH',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ pinged_at: pingedAt }),
        })

        if (!res.ok) {
          const detail = await res.text()
          return Response.json({ ok: false, status: res.status, detail }, { status: 502 })
        }
        return Response.json({ ok: true, pingedAt })
      },
    },
  },
})
