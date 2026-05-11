export const T2C_GTFS_DATASET_URL =
  'https://transport.data.gouv.fr/datasets/syndicat-mixte-des-transports-en-commun-de-lagglomeration-clermontoise-smtc-ac-reseau-t2c-gtfs-gtfs-rt'

export const T2C_GTFS_DOWNLOAD_URL =
  'https://opendata.clermontmetropole.eu/api/v2/catalog/datasets/gtfs-smtc/alternative_exports/gtfs'

export const T2C_GTFS_FEED_WINDOW = {
  validFrom: '2026-03-26',
  validTo: '2026-06-26',
  lastModified: '2026-03-30',
}

export const T2C_REQUIRED_GTFS_FILES = [
  'agency.txt',
  'routes.txt',
  'stops.txt',
  'trips.txt',
  'stop_times.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'shapes.txt',
  'frequencies.txt',
] as const
