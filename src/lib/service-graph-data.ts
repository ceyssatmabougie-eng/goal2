import {
  generatedServiceLines,
  type GeneratedServiceLine,
  type ServiceLineId,
  type ServiceScenarioId,
} from './service-lines.generated'

export interface ServiceStop {
  id: string
  label: string
}

export interface ServiceRun {
  id: string
  label: string
  vehicleLabel: string
  startMinute: number
  path: string[]
  offsets: number[]
  color: string
  kind: 'commercial' | 'depot'
}

export interface ServiceLine {
  id: string
  label: string
  mode: 'tram' | 'bus'
  termini: [string, string]
  defaultFocusStopId: string
  defaultVisibleStopIds: string[]
  stops: ServiceStop[]
}

export type TramScenarioId = ServiceScenarioId

export interface ServiceScenarioDefinition {
  id: ServiceScenarioId
  label: string
}

export const serviceScenarioDefinitions: readonly ServiceScenarioDefinition[] = [
  { id: 'weekday', label: 'Lundi au vendredi' },
  { id: 'saturday', label: 'Samedi' },
  { id: 'sunday', label: 'Dimanche' },
  { id: 'pvs', label: 'PVS' },
] as const

export const serviceLineDefinitions = Object.values(generatedServiceLines) as GeneratedServiceLine[]

export const tramLineA = generatedServiceLines.A
export const tramAScenarios = serviceScenarioDefinitions

export function getServiceLine(lineId: ServiceLineId) {
  return generatedServiceLines[lineId] ?? generatedServiceLines.A
}

export function getServiceLines() {
  return serviceLineDefinitions
}

export function getServiceScenarioDefinition(scenarioId: ServiceScenarioId) {
  return (
    serviceScenarioDefinitions.find((scenario) => scenario.id === scenarioId) ??
    serviceScenarioDefinitions[0]
  )
}

export function getServiceScenarioDescription(
  lineId: ServiceLineId,
  scenarioId: ServiceScenarioId,
) {
  const line = getServiceLine(lineId)
  const definition = getServiceScenarioDefinition(scenarioId)
  const referenceDate = line.scenarioReferenceDates[scenarioId]

  switch (scenarioId) {
    case 'weekday':
      return `${line.label} en semaine, base GTFS du ${referenceDate}.`
    case 'saturday':
      return `${line.label} du samedi, base GTFS du ${referenceDate}.`
    case 'sunday':
      return `${line.label} du dimanche, base GTFS du ${referenceDate}.`
    case 'pvs':
      return `${line.label} en PVS, base GTFS du ${referenceDate}.`
    default:
      return `${line.label} - ${definition.label}, base GTFS du ${referenceDate}.`
  }
}

export function getServiceScenarioRuns(lineId: ServiceLineId, scenarioId: ServiceScenarioId) {
  return getServiceLine(lineId).scenarios[scenarioId] ?? []
}

export function getServiceScenarioBounds(lineId: ServiceLineId, scenarioId: ServiceScenarioId) {
  const runs = getServiceScenarioRuns(lineId, scenarioId)

  return {
    firstDeparture: runs[0]?.startMinute ?? parseGtfsTime('04:00:00'),
    lastArrival:
      runs.length > 0
        ? Math.max(
            ...runs.map((run) => run.startMinute + run.offsets[run.offsets.length - 1]),
          )
        : parseGtfsTime('26:00:00'),
  }
}

export function getTramScenarioDefinition(scenarioId: TramScenarioId) {
  return getServiceScenarioDefinition(scenarioId)
}

export function getTramScenarioRuns(scenarioId: TramScenarioId) {
  return getServiceScenarioRuns('A', scenarioId)
}

export function getTramScenarioBounds(scenarioId: TramScenarioId) {
  return getServiceScenarioBounds('A', scenarioId)
}

function parseGtfsTime(time: string) {
  const [hoursText, minutesText] = time.split(':')
  const hours = Number(hoursText)
  const minutes = Number(minutesText)

  return hours * 60 + minutes
}

export function formatMinute(minute: number) {
  const normalized = Math.max(0, Math.floor(minute))
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function getArrivalMinute(run: ServiceRun, stopId: string) {
  const stopIndex = run.path.indexOf(stopId)

  if (stopIndex === -1) {
    return null
  }

  return run.startMinute + run.offsets[stopIndex]
}

export type { ServiceLineId, ServiceScenarioId }
