import { useCallback, useEffect, useState } from 'react'
import { mockSnapshot } from '../lib/mock-data'
import { supabase } from '../lib/supabase'
import type { GoalSnapshot, RoadmapEntry, Vehicle } from '../types/domain'

interface WorkspaceState {
  loading: boolean
  snapshot: GoalSnapshot
}

const buildFallback = (reason?: string): GoalSnapshot => ({
  ...mockSnapshot,
  fallbackReason: reason,
})

export function useWorkspaceSnapshot(userId: string) {
  const [state, setState] = useState<WorkspaceState>({
    loading: true,
    snapshot: buildFallback(),
  })

  const load = useCallback(async () => {
    if (!supabase) {
      setState({
        loading: false,
        snapshot: buildFallback('Supabase client indisponible.'),
      })
      return
    }

    setState((current) => ({ ...current, loading: true }))

    try {
      const [
        mediatorsResult,
        mediatorCountResult,
        vehiclesResult,
        vehicleCountResult,
        roadmapsResult,
        roadmapCountResult,
        assignmentsResult,
        gtfsImportsResult,
      ] = await Promise.all([
        supabase
          .from('mediators')
          .select('id, full_name, home_sector, can_drive, shift_start, shift_end')
          .eq('owner_id', userId)
          .order('full_name', { ascending: true })
          .limit(100),
        supabase
          .from('mediators')
          .select('*', { count: 'exact', head: true })
          .eq('owner_id', userId),
        supabase
          .from('vehicles')
          .select('id, label, area_label, max_mediators, status')
          .eq('owner_id', userId)
          .order('label', { ascending: true })
          .limit(6),
        supabase
          .from('vehicles')
          .select('*', { count: 'exact', head: true })
          .eq('owner_id', userId),
        supabase
          .from('roadmaps')
          .select(
            'id, title, line_hint, origin_label, destination_label, start_time, end_time, status, vehicle_id',
          )
          .eq('owner_id', userId)
          .order('service_date', { ascending: false })
          .limit(6),
        supabase
          .from('roadmaps')
          .select('*', { count: 'exact', head: true })
          .eq('owner_id', userId),
        supabase
          .from('roadmap_assignments')
          .select('roadmap_id, vehicle_id, mediator_id')
          .eq('owner_id', userId),
        supabase
          .from('gtfs_imports')
          .select('id')
          .eq('owner_id', userId)
          .order('imported_at', { ascending: false }),
      ])

      const errors = [
        mediatorsResult.error,
        mediatorCountResult.error,
        vehiclesResult.error,
        vehicleCountResult.error,
        roadmapsResult.error,
        roadmapCountResult.error,
        assignmentsResult.error,
        gtfsImportsResult.error,
      ].filter(Boolean)

      if (errors.length > 0) {
        throw new Error(errors[0]?.message ?? 'Erreur de lecture Supabase.')
      }

      const assignments = assignmentsResult.data ?? []
      const assignmentCountByRoadmap = new Map<string, number>()

      assignments.forEach((assignment) => {
        assignmentCountByRoadmap.set(
          assignment.roadmap_id,
          (assignmentCountByRoadmap.get(assignment.roadmap_id) ?? 0) + 1,
        )
      })

      const vehicles = (vehiclesResult.data ?? []).map<Vehicle>((vehicle) => {
        const assignedMediators = assignments.filter(
          (assignment) => assignment.vehicle_id === vehicle.id,
        ).length

        return {
          id: vehicle.id,
          label: vehicle.label,
          maxMediators: vehicle.max_mediators,
          assignedMediators,
          status:
            vehicle.status === 'published'
              ? 'ready'
              : vehicle.status === 'draft'
                ? 'draft'
                : 'issue',
          area: vehicle.area_label ?? 'Zone a definir',
        }
      })

      const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))

      const roadmaps = (roadmapsResult.data ?? []).map<RoadmapEntry>((roadmap) => {
        const occupancy = assignmentCountByRoadmap.get(roadmap.id) ?? 0
        const vehicle = roadmap.vehicle_id ? vehicleMap.get(roadmap.vehicle_id) : undefined

        return {
          id: roadmap.id,
          title: roadmap.title,
          line: roadmap.line_hint ?? 'T2C',
          origin: roadmap.origin_label ?? 'Origine a renseigner',
          destination: roadmap.destination_label ?? 'Destination a renseigner',
          departure: roadmap.start_time?.slice(0, 5) ?? '--:--',
          arrival: roadmap.end_time?.slice(0, 5) ?? '--:--',
          vehicleLabel: vehicle?.label ?? 'Vehicule a affecter',
          mediatorNames: [],
          occupancy,
          progress: Math.min(100, Math.max(18, 25 + occupancy * 25)),
          status:
            roadmap.status === 'published'
              ? 'ready'
              : roadmap.status === 'draft'
                ? 'draft'
                : 'issue',
          risk:
            occupancy > 2
              ? 'Plus de deux mediateurs detectes, verifier les affectations.'
              : undefined,
        }
      })

      setState({
        loading: false,
        snapshot: {
          source: 'supabase',
          metrics: [
            {
              label: 'Mediateurs actifs',
              value: String(mediatorCountResult.count ?? 0),
              detail: 'Donnees issues des affectations Supabase',
            },
            {
              label: 'Vehicules suivis',
              value: String(vehicleCountResult.count ?? 0),
              detail: 'Capacite metier bornee a 2',
            },
            {
              label: 'Feuilles enregistrees',
              value: String(roadmapCountResult.count ?? 0),
              detail: 'Feuilles de route presentes en base',
            },
            {
              label: 'Imports GTFS',
              value: String(gtfsImportsResult.data?.length ?? 0),
              detail: 'Historique des imports GTFS T2C',
            },
          ],
          mediators: (mediatorsResult.data ?? []).map((mediator) => ({
            id: mediator.id,
            fullName: mediator.full_name,
            sector: mediator.home_sector ?? '--',
            canDrive: mediator.can_drive,
            status: 'available',
            preferredWindow:
              mediator.shift_start && mediator.shift_end
                ? `${mediator.shift_start.slice(0, 5)} - ${mediator.shift_end.slice(0, 5)}`
                : '--',
          })),
          vehicles,
          roadmaps,
          alerts:
            roadmaps.length === 0
              ? [
                  {
                    id: 'empty-roadmaps',
                    tag: 'Initialisation',
                    title: 'Aucune feuille de route enregistree',
                    description:
                      'Le schema est pret. Vous pouvez maintenant creer les premieres feuilles et affectations.',
                  },
                ]
              : roadmaps
                  .filter((roadmap) => roadmap.status !== 'ready' || roadmap.occupancy < 2)
                  .map((roadmap) => ({
                    id: `alert-${roadmap.id}`,
                    tag: roadmap.status === 'draft' ? 'Brouillon' : 'Controle',
                    title: roadmap.title,
                    description:
                      roadmap.risk ??
                      `${roadmap.occupancy}/2 mediateurs affectes pour ${roadmap.vehicleLabel}.`,
                  })),
          gtfsImportCount: gtfsImportsResult.data?.length ?? 0,
        },
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Lecture Supabase impossible.'

      setState({
        loading: false,
        snapshot: buildFallback(
          `Les tables ne sont pas encore pretes ou vides. Motif: ${message}`,
        ),
      })
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  return {
    loading: state.loading,
    snapshot: state.snapshot,
    refresh: load,
  }
}
