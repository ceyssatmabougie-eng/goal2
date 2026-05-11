import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, Route, Routes } from 'react-router-dom'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { supabase, supabaseConfigured } from './lib/supabase'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(supabaseConfigured)

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      return
    }

    const client = supabase
    let alive = true

    const bootstrap = async () => {
      const { data, error } = await client.auth.getSession()

      if (error) {
        console.error('Unable to restore Supabase session', error)
      }

      if (!alive) {
        return
      }

      setSession(data.session ?? null)
      setLoading(false)
    }

    void bootstrap()

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!alive) {
        return
      }

      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [])

  if (!supabaseConfigured) {
    return (
      <main className="config-screen">
        <div className="config-panel">
          <span className="eyebrow">Goal 2</span>
          <h1>Configuration Supabase requise</h1>
          <p>
            Ajoutez <code>VITE_SUPABASE_URL</code> et{' '}
            <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> dans{' '}
            <code>.env.local</code> pour activer la connexion.
          </p>
          <p className="config-note">
            Un fichier <code>.env.example</code> est fourni comme base.
          </p>
        </div>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="loading-screen">
        <div className="loading-panel">
          <span className="eyebrow">Goal 2</span>
          <h1>Chargement de l'espace de planification</h1>
          <p>Connexion a Supabase et recuperation de la session en cours.</p>
        </div>
      </main>
    )
  }

  return (
    <Routes>
      <Route
        path="/"
        element={session ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route
        path="/dashboard"
        element={
          session ? <DashboardPage session={session} /> : <Navigate to="/" replace />
        }
      />
      <Route
        path="*"
        element={<Navigate to={session ? '/dashboard' : '/'} replace />}
      />
    </Routes>
  )
}

export default App
