export interface GoalMetric {
  label: string
  value: string
  detail: string
}

export interface Mediator {
  id: string
  fullName: string
  sector: string
  canDrive: boolean
  status: 'assigned' | 'available'
  preferredWindow: string
}

export interface Vehicle {
  id: string
  label: string
  maxMediators: number
  assignedMediators: number
  status: 'ready' | 'draft' | 'issue'
  area: string
}

export interface RoadmapEntry {
  id: string
  title: string
  line: string
  origin: string
  destination: string
  departure: string
  arrival: string
  vehicleLabel: string
  mediatorNames: string[]
  occupancy: number
  progress: number
  status: 'ready' | 'draft' | 'issue'
  risk?: string
}

export interface GoalAlert {
  id: string
  tag: string
  title: string
  description: string
}

export interface GoalSnapshot {
  source: 'mock' | 'supabase'
  metrics: GoalMetric[]
  mediators: Mediator[]
  vehicles: Vehicle[]
  roadmaps: RoadmapEntry[]
  alerts: GoalAlert[]
  gtfsImportCount: number
  fallbackReason?: string
}
