import JSZip from 'jszip'
import { supabase } from './supabase'
import { T2C_GTFS_DOWNLOAD_URL, T2C_GTFS_FEED_WINDOW } from './constants'

interface CsvRow {
  [key: string]: string
}

export interface GtfsSyncResult {
  importId: string
  routes: number
  stops: number
  trips: number
  stopTimes: number
}

function splitCsvLine(line: string) {
  const values: string[] = []
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

function parseCsv(text: string) {
  const normalized = text.replace(/^\uFEFF/, '').trim()

  if (!normalized) {
    return []
  }

  const lines = normalized.split(/\r?\n/)
  const headers = splitCsvLine(lines.shift() ?? '')

  return lines.map<CsvRow>((line) => {
    const values = splitCsvLine(line)
    const row: CsvRow = {}

    headers.forEach((header, index) => {
      row[header] = values[index] ?? ''
    })

    return row
  })
}

function toNumber(value: string) {
  if (value === '' || value == null) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function insertInBatches<T>(table: string, rows: T[], batchSize = 500) {
  let inserted = 0

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize)
    const { error } = await supabase!
      .from(table)
      .insert(batch as never[])

    if (error) {
      throw new Error(`Insertion dans ${table} impossible: ${error.message}`)
    }

    inserted += batch.length
  }

  return inserted
}

export async function syncGtfsFeed(userId: string) {
  if (!supabase) {
    throw new Error('Supabase indisponible.')
  }

  const response = await fetch(T2C_GTFS_DOWNLOAD_URL)

  if (!response.ok) {
    throw new Error(`Telechargement GTFS impossible (${response.status}).`)
  }

  const archive = await JSZip.loadAsync(await response.arrayBuffer())
  const readFile = async (name: string) => {
    const entry = archive.file(name)

    if (!entry) {
      throw new Error(`Fichier GTFS manquant: ${name}`)
    }

    return entry.async('text')
  }

  const [routesText, stopsText, tripsText, stopTimesText] = await Promise.all([
    readFile('routes.txt'),
    readFile('stops.txt'),
    readFile('trips.txt'),
    readFile('stop_times.txt'),
  ])

  const routes = parseCsv(routesText)
  const stops = parseCsv(stopsText)
  const trips = parseCsv(tripsText)
  const stopTimes = parseCsv(stopTimesText)

  const { error: deleteError } = await supabase
    .from('gtfs_imports')
    .delete()
    .eq('owner_id', userId)

  if (deleteError) {
    throw new Error(`Nettoyage GTFS impossible: ${deleteError.message}`)
  }

  const { data: importRow, error: importError } = await supabase
    .from('gtfs_imports')
    .insert({
      owner_id: userId,
      source_url: T2C_GTFS_DOWNLOAD_URL,
      valid_from: T2C_GTFS_FEED_WINDOW.validFrom,
      valid_to: T2C_GTFS_FEED_WINDOW.validTo,
      note: `Synchronise depuis le feed T2C du ${T2C_GTFS_FEED_WINDOW.lastModified}`,
    })
    .select('id')
    .single()

  if (importError || !importRow) {
    throw new Error(`Creation de l'import GTFS impossible: ${importError?.message ?? 'sans details'}`)
  }

  const importId = importRow.id as string

  const routeRows = routes.map((route) => ({
    owner_id: userId,
    import_id: importId,
    route_id: route.route_id,
    agency_id: route.agency_id || null,
    route_short_name: route.route_short_name || null,
    route_long_name: route.route_long_name || null,
    route_desc: route.route_desc || null,
    route_type: toNumber(route.route_type),
    route_color: route.route_color || null,
    route_text_color: route.route_text_color || null,
    route_sort_order: toNumber(route.route_sort_order),
  }))

  const stopRows = stops.map((stop) => ({
    owner_id: userId,
    import_id: importId,
    stop_id: stop.stop_id,
    stop_code: stop.stop_code || null,
    stop_name: stop.stop_name,
    stop_lat: toNumber(stop.stop_lat),
    stop_lon: toNumber(stop.stop_lon),
    location_type: toNumber(stop.location_type),
    parent_station: stop.parent_station || null,
  }))

  const tripRows = trips.map((trip) => ({
    owner_id: userId,
    import_id: importId,
    trip_id: trip.trip_id,
    service_id: trip.service_id || null,
    route_id: trip.route_id || null,
    trip_headsign: trip.trip_headsign || null,
    trip_short_name: trip.trip_short_name || null,
    direction_id: toNumber(trip.direction_id),
    shape_id: trip.shape_id || null,
  }))

  const stopTimeRows = stopTimes.map((stopTime) => ({
    owner_id: userId,
    import_id: importId,
    trip_id: stopTime.trip_id,
    stop_id: stopTime.stop_id,
    stop_sequence: Number(stopTime.stop_sequence),
    arrival_time: stopTime.arrival_time || null,
    departure_time: stopTime.departure_time || null,
    stop_headsign: stopTime.stop_headsign || null,
    pickup_type: toNumber(stopTime.pickup_type),
    drop_off_type: toNumber(stopTime.drop_off_type),
    shape_dist_traveled: toNumber(stopTime.shape_dist_traveled),
  }))

  const [routesCount, stopsCount, tripsCount, stopTimesCount] = await Promise.all([
    insertInBatches('gtfs_routes', routeRows),
    insertInBatches('gtfs_stops', stopRows),
    insertInBatches('gtfs_trips', tripRows),
    insertInBatches('gtfs_stop_times', stopTimeRows),
  ])

  return {
    importId,
    routes: routesCount,
    stops: stopsCount,
    trips: tripsCount,
    stopTimes: stopTimesCount,
  } satisfies GtfsSyncResult
}
