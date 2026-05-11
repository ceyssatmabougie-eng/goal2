import { useState } from 'react'
import { ArrowRight, KeyRound, Link2, MapPinned, ShieldCheck, UserPlus } from 'lucide-react'
import { supabase } from '../lib/supabase'

type AuthMode = 'signin' | 'signup'

export function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{
    tone: 'idle' | 'error' | 'success'
    message: string
  }>({
    tone: 'idle',
    message: '',
  })

  const resetFeedback = () => {
    setFeedback({ tone: 'idle', message: '' })
  }

  const signIn = async () => {
    if (!supabase) {
      return
    }

    setSubmitting(true)
    resetFeedback()

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setFeedback({
        tone: 'error',
        message: error.message,
      })
      setSubmitting(false)
      return
    }

    setSubmitting(false)
  }

  const signUp = async () => {
    if (!supabase) {
      return
    }

    setSubmitting(true)
    resetFeedback()

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: {
          full_name: fullName.trim(),
        },
      },
    })

    if (error) {
      setFeedback({
        tone: 'error',
        message: error.message,
      })
      setSubmitting(false)
      return
    }

    setFeedback({
      tone: 'success',
      message:
        "Compte cree. Si une confirmation email est requise par Supabase, verifiez votre boite mail.",
    })
    setSubmitting(false)
  }

  const sendMagicLink = async () => {
    if (!supabase) {
      return
    }

    setSubmitting(true)
    resetFeedback()

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    })

    if (error) {
      setFeedback({
        tone: 'error',
        message: error.message,
      })
      setSubmitting(false)
      return
    }

    setFeedback({
      tone: 'success',
      message: 'Lien magique envoye. Verifiez la boite mail liee a ce compte.',
    })
    setSubmitting(false)
  }

  const canSubmit = email.trim().length > 3 && password.trim().length > 5
  const canSignUp = fullName.trim().length > 1 && canSubmit
  const canSendLink = email.trim().length > 3

  return (
    <main className="login-page">
      <section className="login-layout">
        <div className="login-copy">
          <div>
            <span className="eyebrow">Goal 2</span>
            <h1>Planifier les tournees mediateurs sans surcharge vehicule.</h1>
            <p>
              L'ancienne application affichait les croisements de service. Goal 2
              pose une version moderne, connectee a Supabase, structuree autour des
              feuilles de route, du GTFS T2C et de la contrainte metier de capacite.
            </p>
          </div>

          <ul className="feature-list">
            <li className="feature-item">
              <strong>GTFS T2C comme socle horaire</strong>
              <p className="muted">
                Exploitation des lignes, arrets, trips et stop_times pour preparer
                les rotations.
              </p>
            </li>
            <li className="feature-item">
              <strong>Deux mediateurs maximum par vehicule</strong>
              <p className="muted">
                Cette regle est portee jusque dans le schema SQL pour bloquer les
                depassements.
              </p>
            </li>
            <li className="feature-item">
              <strong>Connexion et creation de compte</strong>
              <p className="muted">
                L'ecran permet maintenant de se connecter, de s'inscrire ou
                d'utiliser un lien magique.
              </p>
            </li>
          </ul>

          <div className="pill-row">
            <span className="pill">
              <MapPinned size={16} />
              Clermont Metropole
            </span>
            <span className="pill">
              <ShieldCheck size={16} />
              Supabase Auth + RLS
            </span>
            <span className="pill warning">
              <KeyRound size={16} />
              GTFS statique T2C
            </span>
          </div>
        </div>

        <div className="login-panel">
          <span className="eyebrow">{mode === 'signin' ? 'Connexion' : 'Inscription'}</span>
          <div>
            <h2 className="section-title">
              {mode === 'signin'
                ? "Acceder a l'espace de regulation"
                : 'Creer un compte Goal 2'}
            </h2>
            <p className="panel-subtitle">
              {mode === 'signin'
                ? 'Connectez-vous avec un compte existant ou demandez un lien magique.'
                : "Creez un acces Supabase pour commencer a utiliser l'application."}
            </p>
          </div>

          <div className="mode-switch" role="tablist" aria-label="Mode de connexion">
            <button
              className={mode === 'signin' ? 'button-secondary is-active' : 'button-ghost'}
              type="button"
              onClick={() => {
                setMode('signin')
                resetFeedback()
              }}
            >
              Se connecter
            </button>
            <button
              className={mode === 'signup' ? 'button-secondary is-active' : 'button-ghost'}
              type="button"
              onClick={() => {
                setMode('signup')
                resetFeedback()
              }}
            >
              Creer un compte
            </button>
          </div>

          <div className="auth-form">
            {mode === 'signup' ? (
              <div className="field">
                <label htmlFor="fullName">Nom complet</label>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Prenom Nom"
                  autoComplete="name"
                />
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="prenom.nom@organisation.fr"
                autoComplete="email"
              />
            </div>

            <div className="field">
              <label htmlFor="password">Mot de passe</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 6 caracteres"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </div>

            <div className="actions">
              {mode === 'signin' ? (
                <>
                  <button
                    className="button"
                    type="button"
                    disabled={!canSubmit || submitting}
                    onClick={() => void signIn()}
                  >
                    Se connecter
                    <ArrowRight size={18} />
                  </button>
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={!canSendLink || submitting}
                    onClick={() => void sendMagicLink()}
                  >
                    Lien magique
                    <Link2 size={18} />
                  </button>
                </>
              ) : (
                <button
                  className="button"
                  type="button"
                  disabled={!canSignUp || submitting}
                  onClick={() => void signUp()}
                >
                  Creer mon compte
                  <UserPlus size={18} />
                </button>
              )}
            </div>

            <div
              className={`feedback ${
                feedback.tone === 'error'
                  ? 'error'
                  : feedback.tone === 'success'
                    ? 'success'
                    : ''
              }`}
            >
              {feedback.message}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
