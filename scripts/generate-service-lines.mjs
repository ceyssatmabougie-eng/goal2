import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const gtfsDir = path.join(repoRoot, 'tmp_t2c_gtfs')
const outputFile = path.join(repoRoot, 'src', 'lib', 'service-lines.generated.ts')

const scenarioDates = {
  weekday: '20260331',
  saturday: '20260411',
  sunday: '20260412',
  pvs: '20260414',
}

const lineLabels = {
  A: 'Tram A',
  B: 'Ligne B',
  C: 'Ligne C',
}

const lineModes = {
  A: 'tram',
  B: 'bus',
  C: 'bus',
}

const palette = ['#0f7bb5', '#d4631a', '#1e824c', '#7a3ff2', '#c03d66', '#1f2937']

function parseCsv(fileName) {
  const text = fs.readFileSync(path.join(gtfsDir, fileName), 'utf8').replace(/^\uFEFF/, '')
  const lines = text.trim().split(/\r?\n/)
  const headers = splitCsvLine(lines.shift())

  return lines.map((line) => {
    const values = splitCsvLine(line)
    const row = {}

    headers.forEach((header, index) => {
      row[header] = values[index] ?? ''
    })

    return row
  })
}

function splitCsvLine(line) {
  const values = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }

    if (character === ',' && !quoted) {
      values.push(current)
      current = ''
      continue
    }

    current += character
  }

  values.push(current)
  return values
}

function parseGtfsMinute(time) {
  const [hoursText, minutesText] = time.split(':')
  return Number(hoursText) * 60 + Number(minutesText)
}

function toSlug(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function activeServicesFor(date, calendar, calendarDates) {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(4, 6))
  const day = Number(date.slice(6, 8))
  const dateValue = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const dayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
    dateValue.getUTCDay()
  ]
  const active = new Set()

  for (const row of calendar) {
    if (date >= row.start_date && date <= row.end_date && row[dayKey] === '1') {
      active.add(row.service_id)
    }
  }

  for (const row of calendarDates) {
    if (row.date !== date) {
      continue
    }

    if (row.exception_type === '1') {
      active.add(row.service_id)
    } else if (row.exception_type === '2') {
      active.delete(row.service_id)
    }
  }

  return active
}

function mergeOrderedStops(baseStops, candidateStops) {
  const merged = [...baseStops]

  for (let index = 0; index < candidateStops.length; index += 1) {
    const stopName = candidateStops[index]

    if (merged.includes(stopName)) {
      continue
    }

    let previousKnown = null
    for (let left = index - 1; left >= 0; left -= 1) {
      if (merged.includes(candidateStops[left])) {
        previousKnown = candidateStops[left]
        break
      }
    }

    let nextKnown = null
    for (let right = index + 1; right < candidateStops.length; right += 1) {
      if (merged.includes(candidateStops[right])) {
        nextKnown = candidateStops[right]
        break
      }
    }

    if (previousKnown && nextKnown) {
      const previousIndex = merged.indexOf(previousKnown)
      const nextIndex = merged.indexOf(nextKnown)
      const insertionIndex = previousIndex < nextIndex ? previousIndex + 1 : nextIndex
      merged.splice(insertionIndex, 0, stopName)
      continue
    }

    if (previousKnown) {
      merged.splice(merged.indexOf(previousKnown) + 1, 0, stopName)
      continue
    }

    if (nextKnown) {
      merged.splice(merged.indexOf(nextKnown), 0, stopName)
      continue
    }

    merged.push(stopName)
  }

  return merged
}

function buildVisibleStops(stopIds, focusStopId) {
  if (stopIds.length <= 8) {
    return stopIds
  }

  const picked = new Set([stopIds[0], stopIds[stopIds.length - 1], focusStopId])
  const targets = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]

  for (const ratio of targets) {
    picked.add(stopIds[Math.min(stopIds.length - 1, Math.round((stopIds.length - 1) * ratio))])
  }

  return stopIds.filter((stopId) => picked.has(stopId)).slice(0, 8)
}

const calendar = parseCsv('calendar.txt')
const calendarDates = parseCsv('calendar_dates.txt')
const trips = parseCsv('trips.txt')
const stopTimes = parseCsv('stop_times.txt')
const stops = parseCsv('stops.txt')

const stopNameById = new Map(stops.map((stop) => [stop.stop_id, stop.stop_name]))
const stopTimesByTripId = new Map()

for (const stopTime of stopTimes) {
  if (!stopTimesByTripId.has(stopTime.trip_id)) {
    stopTimesByTripId.set(stopTime.trip_id, [])
  }

  stopTimesByTripId.get(stopTime.trip_id).push(stopTime)
}

for (const tripStopTimes of stopTimesByTripId.values()) {
  tripStopTimes.sort((left, right) => Number(left.stop_sequence) - Number(right.stop_sequence))
}

const routeIds = ['A', 'B', 'C']
const lineBlocks = []

for (const routeId of routeIds) {
  const routeTrips = trips.filter((trip) => trip.route_id === routeId)
  const patternCountsByDirection = new Map()

  for (const trip of routeTrips) {
    const stopNames = (stopTimesByTripId.get(trip.trip_id) ?? []).map((stopTime) =>
      stopNameById.get(stopTime.stop_id),
    )
    const key = `${trip.direction_id}|${stopNames.join('>')}`
    patternCountsByDirection.set(key, (patternCountsByDirection.get(key) ?? 0) + 1)
  }

  const sortedPatterns = [...patternCountsByDirection.entries()].sort((left, right) => right[1] - left[1])
  const forwardBase =
    sortedPatterns
      .find(([key]) => key.startsWith('0|'))
      ?.[0]
      ?.slice(2)
      .split('>') ?? []

  let canonicalStopNames = [...forwardBase]

  for (const [key] of sortedPatterns) {
    const [directionId, sequence] = key.split('|')
    const orientedNames = directionId === '0' ? sequence.split('>') : sequence.split('>').reverse()
    canonicalStopNames = mergeOrderedStops(canonicalStopNames, orientedNames)
  }

  const stopIds = canonicalStopNames.map((stopName) => toSlug(stopName))
  const stopsBlock = canonicalStopNames.map((stopName) => ({
    id: toSlug(stopName),
    label: stopName,
  }))
  const focusStopId = stopIds.includes('jaude') ? 'jaude' : stopIds[Math.floor(stopIds.length / 2)]
  const defaultVisibleStopIds = buildVisibleStops(stopIds, focusStopId)

  const scenarios = {}

  for (const [scenarioId, date] of Object.entries(scenarioDates)) {
    const activeServices = activeServicesFor(date, calendar, calendarDates)
    const scenarioTrips = routeTrips
      .filter((trip) => activeServices.has(trip.service_id))
      .map((trip, index) => {
        const tripStopTimes = stopTimesByTripId.get(trip.trip_id) ?? []
        const tripStopNames = tripStopTimes.map((stopTime) => stopNameById.get(stopTime.stop_id))
        const canonicalPath = tripStopNames.map((stopName) => toSlug(stopName))
        const firstMinute = parseGtfsMinute(tripStopTimes[0].departure_time)

        return {
          id: `${scenarioId}-${routeId}-${trip.trip_id}`,
          label: `${routeId} ${trip.trip_headsign || tripStopTimes[0].departure_time.slice(0, 5)}`,
          vehicleLabel: `${routeId === 'A' ? 'Rame' : 'Vehicule'} ${String(index + 1).padStart(3, '0')}`,
          startMinute: firstMinute,
          path: canonicalPath,
          offsets: tripStopTimes.map((stopTime) => parseGtfsMinute(stopTime.arrival_time) - firstMinute),
          color: palette[index % palette.length],
          kind: 'commercial',
        }
      })
      .filter((trip) => trip.path.length > 1)
      .sort((left, right) => left.startMinute - right.startMinute)

    scenarios[scenarioId] = scenarioTrips
  }

  const referenceDatesBlock = Object.entries(scenarioDates)
    .map(([scenarioId, date]) => `${scenarioId}: '${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}'`)
    .join(', ')

  const scenariosBlock = Object.entries(scenarios)
    .map(
      ([scenarioId, runs]) => `    ${scenarioId}: ${JSON.stringify(runs, null, 6)
        .replace(/^/gm, '    ')
        .replace(/\n {10}\]/g, '\n    ]')},`,
    )
    .join('\n')

  lineBlocks.push(`  ${routeId}: {
    id: '${routeId}',
    label: '${lineLabels[routeId]}',
    mode: '${lineModes[routeId]}',
    termini: ['${stopIds[0]}', '${stopIds[stopIds.length - 1]}'],
    defaultFocusStopId: '${focusStopId}',
    defaultVisibleStopIds: ${JSON.stringify(defaultVisibleStopIds)},
    stops: ${JSON.stringify(stopsBlock, null, 4).replace(/^/gm, '    ')},
    scenarioReferenceDates: { ${referenceDatesBlock} },
    scenarios: {
${scenariosBlock}
    },
  },`)
}

const fileContents = `import type { ServiceLine, ServiceRun } from './service-graph-data'

export type ServiceLineId = 'A' | 'B' | 'C'
export type ServiceScenarioId = 'weekday' | 'saturday' | 'sunday' | 'pvs'

export interface GeneratedServiceLine extends ServiceLine {
  mode: 'tram' | 'bus'
  scenarioReferenceDates: Record<ServiceScenarioId, string>
  scenarios: Record<ServiceScenarioId, ServiceRun[]>
}

export const generatedServiceLines: Record<ServiceLineId, GeneratedServiceLine> = {
${lineBlocks.join('\n')}
}
`

fs.writeFileSync(outputFile, fileContents)
console.log(`Generated ${outputFile}`)
