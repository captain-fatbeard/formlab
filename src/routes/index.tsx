import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { storage } from '~/lib/storage'
import { verifyPassphrase } from '~/lib/server-functions'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const navigate = useNavigate()
  const [isChecking, setIsChecking] = useState(true)
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    async function checkAuth() {
      const [storedPassphrase, athlete] = await Promise.all([
        storage.auth.getPassphrase(),
        storage.auth.getAthlete(),
      ])

      if (storedPassphrase && athlete) {
        navigate({ to: '/overview' })
      } else {
        setIsChecking(false)
      }
    }

    checkAuth()
  }, [navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passphrase.trim() || isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    try {
      const athlete = await verifyPassphrase({ data: { passphrase } })
      await Promise.all([
        storage.auth.setPassphrase(passphrase),
        storage.auth.setAthlete(athlete),
      ])
      navigate({ to: '/overview' })
    } catch (err) {
      console.error('Login failed:', err)
      setError('Wrong passphrase. Try again.')
      setIsSubmitting(false)
    }
  }

  if (isChecking) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-8 text-center hero-gradient">
        <div className="size-12 border-3 border-border-subtle border-t-accent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-8 text-center hero-gradient relative overflow-hidden">
      {/* Animated orbs */}
      <div className="orb w-[500px] h-[500px] bg-accent/[0.07] top-[-10%] left-[-10%] animate-float" />
      <div className="orb w-[400px] h-[400px] bg-accent-secondary/[0.05] bottom-[-5%] right-[-5%] animate-float" style={{ animationDelay: '-3s' }} />
      <div className="orb w-[300px] h-[300px] bg-accent-muted/[0.06] top-[30%] right-[10%] animate-float" style={{ animationDelay: '-1.5s' }} />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8 animate-fade-in">
        <div className="relative">
          <svg width="72" height="72" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="url(#login-logo-gradient)"/>
            <path d="M8 22L12 14L16 18L20 10L24 16" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="12" cy="14" r="2" fill="white"/>
            <circle cx="16" cy="18" r="2" fill="white"/>
            <circle cx="20" cy="10" r="2" fill="white"/>
            <defs>
              <linearGradient id="login-logo-gradient" x1="0" y1="0" x2="32" y2="32">
                <stop stopColor="#14b8a6"/>
                <stop offset="1" stopColor="#0891b2"/>
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute -inset-4 bg-accent/20 rounded-[var(--radius-sm)] blur-2xl animate-pulse-glow" />
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="text-6xl font-extrabold tracking-tight bg-linear-to-br from-text-primary via-text-primary to-accent-light bg-clip-text text-transparent max-md:text-5xl">
            FormLab
          </h1>
          <p className="text-text-secondary text-lg max-w-[420px] font-light tracking-wide">
            Precision analytics for your training data
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4 w-full max-w-[320px]">
          {/* A visually-hidden label rather than a placeholder alone, and an
              autocomplete hint so the browser stops guessing. */}
          <label htmlFor="passphrase" className="sr-only">
            Passphrase
          </label>
          <input
            id="passphrase"
            name="passphrase"
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Passphrase"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'passphrase-error' : undefined}
            autoFocus
            className="w-full py-3.5 px-5 bg-bg-secondary/80 border border-border-subtle rounded-[var(--radius-md)] text-text-primary text-center text-base placeholder:text-text-muted focus:outline-none focus:border-accent/60 focus:shadow-[0_0_0_3px_rgba(20,184,166,0.15)] transition-all"
          />
          <button
            type="submit"
            disabled={!passphrase.trim() || isSubmitting}
            className="group relative flex items-center justify-center gap-3 w-full bg-accent text-bg-primary border border-accent py-3.5 px-10 text-base font-semibold rounded-[var(--radius-md)] cursor-pointer transition-all duration-300 shadow-[0_4px_16px_rgba(20,184,166,0.25)] hover:bg-accent-light hover:-translate-y-0.5 hover:shadow-[0_8px_32px_rgba(20,184,166,0.35)] active:translate-y-0 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            {isSubmitting ? 'Unlocking…' : 'Unlock'}
          </button>
          {/* Fixed-height slot: the form used to shift down when the error
              appeared, which moves the button under the pointer mid-click. */}
          <div className="min-h-[2.5rem] w-full flex items-start justify-center" aria-live="polite">
            {error && (
              <p
                id="passphrase-error"
                className="text-danger text-sm bg-danger-muted px-4 py-2 rounded-[var(--radius-sm)]"
              >
                {error}
              </p>
            )}
          </div>
        </form>
        <p className="text-text-muted text-xs tracking-wide mt-2">
          Training data synced from Garmin via intervals.icu
        </p>
      </div>
    </div>
  )
}
