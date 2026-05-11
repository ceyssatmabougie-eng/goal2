import type { Session } from '@supabase/supabase-js'
import {
  ArrowUpRight,
  BusFront,
  CalendarClock,
  Clock3,
  Database,
  LogOut,
  Plus,
  RefreshCcw,
  Route,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import {
  T2C_GTFS_DATASET_URL,
  T2C_GTFS_DOWNLOAD_URL,
  T2C_GTFS_FEED_WINDOW,
  T2C_REQUIRED_GTFS_FILES,
} from '../lib/constants'
import { ServiceGraphPlanner } from '../components/ServiceGraphPlanner'
import { useWorkspaceSnapshot } from '../hooks/useWorkspaceSnapshot'
import { syncGtfsFeed } from '../lib/gtfs-sync'
import { supabase } from '../lib/supabase'
import type { RoadmapEntry, Vehicle } from '../types/domain'

function getCapacityTone(vehicle: Vehicle) {
  if (vehicle.assignedMediators > vehicle.maxMediators) {
    return 'danger'
  }

  if (vehicle.assignedMediators === vehicle.maxMediators) {
    return 'ok'
  }

  return 'warning'
}

function getRoadmapTone(roadmap: RoadmapEntry) {
  if (roadmap.status === 'issue') {
    return 'issue'
  }

  if (roadmap.status === 'draft') {
    return 'draft'
  }

  return 'ready'
}

export function DashboardPage({ session }: { session: Session }) {
  const { loading, snapshot, refresh } = useWorkspaceSnapshot(session.user.id)
  const [newMediatorServiceNumber, setNewMediatorServiceNumber] = useState('')
  const [mediatorSaving, setMediatorSaving] = useState(false)
  const [mediatorFeedback, setMediatorFeedback] = useState('')
  const [gtfsSyncing, setGtfsSyncing] = useState(false)
  const [gtfsFeedback, setGtfsFeedback] = useState('')

  const signOut = async () => {
    if (!supabase) {
      return
    }

    await supabase.auth.signOut()
  }

  const createMediator = async () => {
    if (!supabase) {
      return
    }

    const serviceNumber = newMediatorServiceNumber.trim()

    if (!serviceNumber) {
      setMediatorFeedback('Le numero de service est obligatoire.')
      return
    }

    setMediatorSaving(true)
    setMediatorFeedback('')

    const { error } = await supabase.from('mediators').insert({
      owner_id: session.user.id,
      full_name: serviceNumber,
      home_sector: null,
      can_drive: false,
      shift_start: null,
      shift_end: null,
    })

    if (error) {
      setMediatorSaving(false)
      setMediatorFeedback(`Creation impossible : ${error.message}`)
      return
    }

    setNewMediatorServiceNumber('')
    setMediatorSaving(false)
    setMediatorFeedback('Agent ajoute avec son numero de service.')
    await refresh()
  }

  const refreshGtfs = async () => {
    if (!supabase) {
      setGtfsFeedback('Supabase indisponible.')
      return
    }

    setGtfsSyncing(true)
    setGtfsFeedback('')

    try {
      const result = await syncGtfsFeed(session.user.id)
      setGtfsFeedback(
        `GTFS synchronise: ${result.routes} routes, ${result.stops} arrets, ${result.trips} courses, ${result.stopTimes} horaires.`,
      )
      await refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Synchronisation impossible.'
      setGtfsFeedback(`GTFS non synchronise: ${message}`)
    } finally {
      setGtfsSyncing(false)
    }
  }

  return (
    <main className="app-shell">
      <div className="dashboard-grid">
        <section className="hero-panel">
          <div className="hero-copy">
            <span className="eyebrow">Goal 2 / Tableau de bord</span>
            <h1>Feuilles de route mediateurs pilotees par le reseau T2C.</h1>
            <p>
              Priorite metier actuelle : optimiser les rotations et empecher toute
              affectation a plus de deux mediateurs dans le meme vehicule.
            </p>

            <div className="hero-actions">
              <button className="button" type="button" onClick={() => void refresh()}>
                <RefreshCcw size={18} />
                Recharger le tableau
              </button>
              <button
                className="button-secondary"
                type="button"
                onClick={() => void refreshGtfs()}
                disabled={gtfsSyncing}
              >
                <RefreshCcw size={18} />
                {gtfsSyncing ? 'Synchronisation GTFS...' : 'Synchroniser GTFS'}
              </button>
              <a
                className="button-secondary"
                href={T2C_GTFS_DOWNLOAD_URL}
                target="_blank"
                rel="noreferrer"
              >
                <Database size={18} />
                Ouvrir le GTFS T2C
              </a>
              <button className="button-ghost" type="button" onClick={() => void signOut()}>
                <LogOut size={18} />
                Deconnexion
              </button>
            </div>

            {gtfsFeedback ? <div className="feedback info">{gtfsFeedback}</div> : null}

            <div className="pill-row">
              <span className="pill">
                <Users size={16} />
                {session.user.email}
              </span>
              <span className="pill">
                <Clock3 size={16} />
                Derniere publication GTFS : {T2C_GTFS_FEED_WINDOW.lastModified}
              </span>
              <span className={`pill ${snapshot.source === 'mock' ? 'warning' : ''}`}>
                <Route size={16} />
                Source des donnees : {snapshot.source === 'supabase' ? 'Supabase' : 'Apercu'}
              </span>
            </div>
          </div>

          <div className="hero-meta">
            <div className="hero-kpi">
              <span className="eyebrow">Capacite flotte</span>
              <strong>
                {snapshot.vehicles.filter((vehicle) => vehicle.assignedMediators >= 2).length}/
                {snapshot.vehicles.length || 1}
              </strong>
              <p className="muted">
                vehicules deja satures sur la grille actuellement visible
              </p>
            </div>
            <div className="hero-kpi">
              <span className="eyebrow">Controle metier</span>
              <strong>
                {snapshot.roadmaps.filter((roadmap) => roadmap.occupancy <= 2).length}/
                {snapshot.roadmaps.length || 1}
              </strong>
              <p className="muted">
                feuilles conformes a la regle des 2 mediateurs maximum
              </p>
            </div>
            {snapshot.fallbackReason ? (
              <div className="hero-kpi">
                <span className="eyebrow">Etat courant</span>
                <p className="muted">{snapshot.fallbackReason}</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="metric-grid">
          {snapshot.metrics.map((metric) => (
            <article key={metric.label} className="metric-card">
              <p className="metric-label">{metric.label}</p>
              <p className="metric-value">{loading ? '...' : metric.value}</p>
              <p className="metric-detail">{metric.detail}</p>
            </article>
          ))}
        </section>

        <ServiceGraphPlanner mediators={snapshot.mediators} userId={session.user.id} />

        <section className="panel-grid">
          <article className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Grille des feuilles de route</h2>
                <p className="panel-subtitle">
                  Vue simplifiee du futur moteur d'ordonnancement.
                </p>
              </div>
              <span className="pill">
                <CalendarClock size={16} />
                {snapshot.roadmaps.length} feuille(s) visibles
              </span>
            </div>

            <div className="timeline-board">
              {snapshot.roadmaps.map((roadmap) => (
                <article key={roadmap.id} className="timeline-card">
                  <div className="timeline-row">
                    <div>
                      <strong>{roadmap.title}</strong>
                      <div className="timeline-times">
                        <span>{roadmap.departure}</span>
                        <span>{'->'}</span>
                        <span>{roadmap.arrival}</span>
                        <span className="timeline-line">Ligne {roadmap.line}</span>
                      </div>
                    </div>
                    <span className={`status-chip ${getRoadmapTone(roadmap)}`}>
                      {roadmap.status === 'ready'
                        ? 'Prete'
                        : roadmap.status === 'draft'
                          ? 'Brouillon'
                          : 'A revoir'}
                    </span>
                  </div>

                  <div className="timeline-bar">
                    <div
                      className="timeline-progress"
                      style={{ width: `${roadmap.progress}%` }}
                    />
                  </div>

                  <div className="detail-list">
                    <div className="detail-row">
                      <span>Trajet</span>
                      <strong>
                        {roadmap.origin} {'->'} {roadmap.destination}
                      </strong>
                    </div>
                    <div className="detail-row">
                      <span>Vehicule</span>
                      <strong>{roadmap.vehicleLabel}</strong>
                    </div>
                    <div className="detail-row">
                      <span>Occupation</span>
                      <strong>{roadmap.occupancy}/2 mediateurs</strong>
                    </div>
                  </div>

                  {roadmap.mediatorNames.length > 0 ? (
                    <div className="roadmap-mediator-list">
                      {roadmap.mediatorNames.map((name) => (
                        <span key={`${roadmap.id}-${name}`} className="pill">
                          {name}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {roadmap.risk ? <div className="timeline-risk">{roadmap.risk}</div> : null}
                </article>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Alertes de regulation</h2>
                <p className="panel-subtitle">
                  Ce bloc met en avant les situations a arbitrer.
                </p>
              </div>
            </div>

            <ul className="alert-list">
              {snapshot.alerts.map((alert) => (
                <li key={alert.id} className="alert-item">
                  <span className="alert-tag">{alert.tag}</span>
                  <strong>{alert.title}</strong>
                  <p className="muted">{alert.description}</p>
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className="panel-grid">
          <article className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Equipe mediateurs</h2>
                <p className="panel-subtitle">
                  Base initiale pour les affectations et disponibilites.
                </p>
              </div>
              <span className="pill">
                <Users size={16} />
                {snapshot.mediators.length} profil(s)
              </span>
            </div>

            <div className="mediator-create-box">
              <div className="panel-header">
                <div>
                  <strong>Ajouter un agent</strong>
                  <p className="panel-subtitle">
                    Creation minimale a partir du numero de service uniquement.
                  </p>
                </div>
              </div>

              <div className="mediator-create-grid">
                <div className="field">
                  <label htmlFor="mediator-service-number">Numero de service</label>
                  <input
                    id="mediator-service-number"
                    type="text"
                    value={newMediatorServiceNumber}
                    onChange={(event) => setNewMediatorServiceNumber(event.target.value)}
                    placeholder="Ex: 1542"
                  />
                </div>
              </div>

              <div className="actions">
                <button
                  className="button"
                  type="button"
                  disabled={mediatorSaving}
                  onClick={() => void createMediator()}
                >
                  <Plus size={18} />
                  {mediatorSaving ? 'Ajout...' : 'Ajouter l agent'}
                </button>
              </div>

              {mediatorFeedback ? <div className="feedback success">{mediatorFeedback}</div> : null}
            </div>

            <div className="mediator-list">
              {snapshot.mediators.map((mediator) => (
                <article key={mediator.id} className="mediator-card">
                  <div className="mediator-row">
                    <strong className="mediator-name">{mediator.fullName}</strong>
                    <span
                      className={`status-chip ${
                        mediator.status === 'assigned' ? 'ready' : 'draft'
                      }`}
                    >
                      {mediator.status === 'assigned' ? 'Affecte' : 'Disponible'}
                    </span>
                  </div>
                  <div className="detail-list">
                    <div className="detail-row">
                      <span>Secteur</span>
                      <strong>{mediator.sector}</strong>
                    </div>
                    <div className="detail-row">
                      <span>Fenetre</span>
                      <strong>{mediator.preferredWindow}</strong>
                    </div>
                    <div className="detail-row">
                      <span>Conduite</span>
                      <strong>{mediator.canDrive ? 'Oui' : 'Non'}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Parc vehicules</h2>
                <p className="panel-subtitle">
                  Verification instantanee de la contrainte de capacite.
                </p>
              </div>
              <span className="pill">
                <BusFront size={16} />
                plafond 2 mediateurs
              </span>
            </div>

            <div className="vehicle-list">
              {snapshot.vehicles.map((vehicle) => (
                <article key={vehicle.id} className="vehicle-card">
                  <div className="vehicle-row">
                    <strong className="vehicle-name">{vehicle.label}</strong>
                    <span className={`capacity-chip ${getCapacityTone(vehicle)}`}>
                      {vehicle.assignedMediators}/{vehicle.maxMediators}
                    </span>
                  </div>
                  <div className="detail-list">
                    <div className="detail-row">
                      <span>Zone</span>
                      <strong>{vehicle.area}</strong>
                    </div>
                    <div className="detail-row">
                      <span>Etat</span>
                      <strong>
                        {vehicle.status === 'ready'
                          ? 'Pret'
                          : vehicle.status === 'draft'
                            ? 'En attente'
                            : 'Incident'}
                      </strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </article>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Referentiel GTFS T2C</h2>
              <p className="panel-subtitle">
                Source officielle utilisee pour le futur import des lignes, arrets et
                horaires.
              </p>
            </div>
            <a
              className="button-ghost"
              href={T2C_GTFS_DATASET_URL}
              target="_blank"
              rel="noreferrer"
            >
              Voir la fiche source
              <ArrowUpRight size={18} />
            </a>
          </div>

          <div className="gtfs-grid">
            <article className="gtfs-box">
              <strong>Etat de la publication</strong>
              <div className="detail-list">
                <div className="detail-row">
                  <span>Derniere modification</span>
                  <strong>{T2C_GTFS_FEED_WINDOW.lastModified}</strong>
                </div>
                <div className="detail-row">
                  <span>Valide du</span>
                  <strong>{T2C_GTFS_FEED_WINDOW.validFrom}</strong>
                </div>
                <div className="detail-row">
                  <span>Valide jusqu'au</span>
                  <strong>{T2C_GTFS_FEED_WINDOW.validTo}</strong>
                </div>
                <div className="detail-row">
                  <span>Imports enregistres</span>
                  <strong>{snapshot.gtfsImportCount}</strong>
                </div>
              </div>
            </article>

            <article className="gtfs-box">
              <strong>Fichiers reperes dans le feed</strong>
              <ul className="gtfs-file-list">
                {T2C_REQUIRED_GTFS_FILES.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <p className="footer-note">
          Base posee pour la suite : import GTFS automatique, generation d'itineraires
          et proposition d'affectation optimisee.
        </p>
      </div>
    </main>
  )
}
