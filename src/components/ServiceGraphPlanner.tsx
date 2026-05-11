import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  Clock3,
  MapPinned,
  Search,
  ShieldCheck,
  TramFront,
  UserPlus,
  X,
  ZoomIn,
} from 'lucide-react'
import {
  formatMinute,
  getArrivalMinute,
  getServiceLine,
  getServiceLines,
  getServiceScenarioBounds,
  getServiceScenarioDefinition,
  getServiceScenarioDescription,
  getServiceScenarioRuns,
  serviceScenarioDefinitions,
  type ServiceLine,
  type ServiceLineId,
  type ServiceScenarioId,
  type TramScenarioId,
  type ServiceRun,
} from '../lib/service-graph-data'
import { supabase } from '../lib/supabase'
import type { Mediator } from '../types/domain'

interface SegmentAssignment {
  id: string
  scenarioId: TramScenarioId
  lineId: ServiceLineId
  runId: string
  startStopId: string
  endStopId: string
  startMinute: number
  endMinute: number
  mediatorCount: number
  mediatorIds: string[]
}

function isRunFromTerminus(run: ServiceRun, line: ServiceLine) {
  return run.path[0] === line.termini[0]
}

function getRunDirectionLabel(run: ServiceRun, line: ServiceLine) {
  const startStop = line.stops.find((stop) => stop.id === run.path[0])
  return `Depart ${startStop?.label ?? run.path[0]}`
}

function getRunPointIndex(run: ServiceRun, stopId: string) {
  return run.path.indexOf(stopId)
}

function normalizeSegment(run: ServiceRun, firstStopId: string, secondStopId: string) {
  const firstIndex = getRunPointIndex(run, firstStopId)
  const secondIndex = getRunPointIndex(run, secondStopId)

  if (firstIndex === -1 || secondIndex === -1 || firstIndex === secondIndex) {
    return null
  }

  return firstIndex < secondIndex
    ? { startStopId: firstStopId, endStopId: secondStopId, startIndex: firstIndex, endIndex: secondIndex }
    : { startStopId: secondStopId, endStopId: firstStopId, startIndex: secondIndex, endIndex: firstIndex }
}

function getSegmentWindow(
  run: ServiceRun,
  line: ServiceLine,
  startStopId: string,
  endStopId: string,
) {
  const segment = normalizeSegment(run, startStopId, endStopId)

  if (!segment) {
    return 'Selectionne deux arrets differents sur la course.'
  }

  const startStop = line.stops.find((stop) => stop.id === segment.startStopId)
  const endStop = line.stops.find((stop) => stop.id === segment.endStopId)
  const startMinute = getArrivalMinute(run, segment.startStopId)
  const endMinute = getArrivalMinute(run, segment.endStopId)

  return `${startStop?.label ?? segment.startStopId} ${startMinute === null ? '--:--' : formatMinute(startMinute)} -> ${
    endStop?.label ?? segment.endStopId
  } ${endMinute === null ? '--:--' : formatMinute(endMinute)}`
}

function segmentsOverlap(
  run: ServiceRun,
  leftStartStopId: string,
  leftEndStopId: string,
  rightStartStopId: string,
  rightEndStopId: string,
) {
  const left = normalizeSegment(run, leftStartStopId, leftEndStopId)
  const right = normalizeSegment(run, rightStartStopId, rightEndStopId)

  if (!left || !right) {
    return false
  }

  return Math.max(left.startIndex, right.startIndex) < Math.min(left.endIndex, right.endIndex)
}

function formatHourOption(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}

function getStopVisibilityPreferencesStorageKey(userId: string, scenarioId: ServiceScenarioId) {
  return `goal.timeline-stop-visibility:${userId}:${scenarioId}`
}

function readStopVisibilityPreferences(
  userId: string,
  scenarioId: ServiceScenarioId,
): Record<string, string[]> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(
      getStopVisibilityPreferencesStorageKey(userId, scenarioId),
    )

    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).map(([lineId, value]) => [
        lineId,
        Array.isArray(value)
          ? value.filter((stopId): stopId is string => typeof stopId === 'string')
          : [],
      ]),
    )
  } catch {
    return {}
  }
}

function writeStopVisibilityPreferences(
  userId: string,
  scenarioId: ServiceScenarioId,
  preferences: Record<string, string[]>,
) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    getStopVisibilityPreferencesStorageKey(userId, scenarioId),
    JSON.stringify(preferences),
  )
}

interface TimeBubblePlacement {
  pillCenterX: number
  pillCenterY: number
  leaderEndY: number
}

const GRAPH_DRAG_IGNORE_SELECTOR = [
  '.service-run-hitbox',
  '.service-run-line',
  '.service-time-pill-bg',
  '.service-time-pill-text',
].join(', ')

export function ServiceGraphPlanner({
  mediators,
  userId,
}: {
  mediators: Mediator[]
  userId: string
}) {
  const graphScrollRef = useRef<HTMLDivElement | null>(null)
  const compareScrollRefs = useRef<Array<HTMLDivElement | null>>([])
  const compareScrollSyncingRef = useRef(false)
  const graphDragStateRef = useRef<{
    pointerId: number
    startX: number
    startScrollLeft: number
    isDragging: boolean
  } | null>(null)
  const graphClickSuppressionRef = useRef(false)
  const [lineId, setLineId] = useState<ServiceLineId>('A')
  const [scenarioId, setScenarioId] = useState<ServiceScenarioId>('weekday')
  const [compareLineIds, setCompareLineIds] = useState<ServiceLineId[]>(['A', 'B', 'C'])
  const [compareVisibleSlots, setCompareVisibleSlots] = useState<boolean[]>([true, true, true])
  const lineOptions = useMemo(() => getServiceLines(), [])
  const currentLine = useMemo(() => getServiceLine(lineId), [lineId])
  const scenarioDefinition = getServiceScenarioDefinition(scenarioId)
  const scenarioDescription = getServiceScenarioDescription(lineId, scenarioId)
  const scenarioRuns = useMemo(
    () => getServiceScenarioRuns(lineId, scenarioId),
    [lineId, scenarioId],
  )
  const scenarioBounds = useMemo(
    () => getServiceScenarioBounds(lineId, scenarioId),
    [lineId, scenarioId],
  )
  const firstHour = Math.floor(scenarioBounds.firstDeparture / 60)
  const lastHour = Math.ceil(scenarioBounds.lastArrival / 60)

  const [selectedStopId, setSelectedStopId] = useState(currentLine.defaultFocusStopId)
  const [selectedRunId, setSelectedRunId] = useState('')
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [plannerTab, setPlannerTab] = useState<'reserve' | 'recap'>('reserve')
  const [segmentDraftStartStopId, setSegmentDraftStartStopId] = useState('')
  const [segmentDraftEndStopId, setSegmentDraftEndStopId] = useState('')
  const [segmentMediatorCount, setSegmentMediatorCount] = useState(1)
  const [selectedMediatorIds, setSelectedMediatorIds] = useState<string[]>([])
  const [recapMediatorId, setRecapMediatorId] = useState(mediators[0]?.id ?? '')
  const [visibleStopIds, setVisibleStopIds] = useState(currentLine.defaultVisibleStopIds)
  const [stopVisibilityPreferencesByLineId, setStopVisibilityPreferencesByLineId] = useState<
    Record<string, string[]>
  >({})
  const [stopSearch, setStopSearch] = useState('')
  const [zoom, setZoom] = useState(1)
  const [verticalZoom, setVerticalZoom] = useState(2)
  const [lineWeight, setLineWeight] = useState(2.2)
  const [windowStartHour, setWindowStartHour] = useState(firstHour)
  const [windowEndHour, setWindowEndHour] = useState(lastHour)
  const [assignments, setAssignments] = useState<SegmentAssignment[]>([])
  const [assignmentsLoading, setAssignmentsLoading] = useState(false)
  const [assignmentsSaving, setAssignmentsSaving] = useState(false)
  const [plannerMessage, setPlannerMessage] = useState('')

  const selectedStop =
    currentLine.stops.find((stop) => stop.id === selectedStopId) ??
    currentLine.stops.find((stop) => stop.id === currentLine.defaultFocusStopId) ??
    currentLine.stops[0]

  const graphStopIds = useMemo(() => {
    const required = new Set([...visibleStopIds, selectedStop.id, ...currentLine.termini])
    return currentLine.stops.filter((stop) => required.has(stop.id)).map((stop) => stop.id)
  }, [currentLine, selectedStop.id, visibleStopIds])

  const graphStops = currentLine.stops.filter((stop) => graphStopIds.includes(stop.id))
  const graphStopIdSet = new Set(graphStopIds)
  const windowStartMinute = windowStartHour * 60
  const windowEndMinute = windowEndHour * 60
  const getVisibleStopIdsForLine = useCallback(
    (nextLineId: ServiceLineId) => {
      if (nextLineId === lineId) {
        return visibleStopIds
      }

      return (
        stopVisibilityPreferencesByLineId[nextLineId] ??
        getServiceLine(nextLineId).defaultVisibleStopIds
      )
    },
    [lineId, stopVisibilityPreferencesByLineId, visibleStopIds],
  )

  const runCandidates = scenarioRuns
    .filter((run) => {
      const runStart = run.startMinute
      const runEnd = run.startMinute + run.offsets[run.offsets.length - 1]
      return (
        getArrivalMinute(run, selectedStop.id) !== null &&
        runEnd >= windowStartMinute &&
        runStart <= windowEndMinute
      )
    })
    .map((run) => ({
      run,
      visiblePoints: run.path
        .map((stopId, index) => ({
          stopId,
          minute: run.startMinute + run.offsets[index],
          stopIndex: index,
        }))
        .filter((point) => graphStopIdSet.has(point.stopId)),
    }))
    .filter((item) => item.visiblePoints.length > 1)
    .sort((left, right) => left.run.startMinute - right.run.startMinute)

  const visibleRuns = useMemo(() => runCandidates.map((item) => item.run), [runCandidates])
  const visibleRunIds = useMemo(() => visibleRuns.map((run) => run.id), [visibleRuns])
  const visibleRunIdSet = useMemo(() => new Set(visibleRunIds), [visibleRunIds])
  const selectedRunIdsForGraph = useMemo(
    () => {
      const kept = selectedRunIds.filter((runId) => visibleRunIdSet.has(runId))

      if (kept.length) {
        return kept
      }

      return visibleRuns[0] ? [visibleRuns[0].id] : []
    },
    [selectedRunIds, visibleRunIdSet, visibleRuns],
  )
  const activeRunId =
    (selectedRunId && visibleRunIdSet.has(selectedRunId) ? selectedRunId : '') ||
    selectedRunIdsForGraph[0] ||
    ''
  const selectedRun =
    visibleRuns.find((run) => run.id === activeRunId) ??
    visibleRuns.find((run) => run.id === selectedRunIdsForGraph[0]) ??
    visibleRuns[0] ??
    scenarioRuns[0]

  const graphMinuteBounds = runCandidates.length
    ? runCandidates.reduce(
        (bounds, item) => {
          const itemStart = item.visiblePoints[0]?.minute ?? bounds.start
          const itemEnd = item.visiblePoints[item.visiblePoints.length - 1]?.minute ?? bounds.end

          return {
            start: Math.min(bounds.start, itemStart),
            end: Math.max(bounds.end, itemEnd),
          }
        },
        {
          start: runCandidates[0].visiblePoints[0]?.minute ?? windowStartMinute,
          end:
            runCandidates[0].visiblePoints[runCandidates[0].visiblePoints.length - 1]?.minute ??
            windowEndMinute,
        },
      )
    : { start: windowStartMinute, end: windowEndMinute }

  const graphStartMinute = Math.max(windowStartMinute, graphMinuteBounds.start)
  const graphEndMinute = Math.min(windowEndMinute, graphMinuteBounds.end)
  const horizontalSpan = Math.max(1, graphEndMinute - graphStartMinute)
  const graphBodyHeight = Math.round(360 + verticalZoom * 90)
  const graphFooterHeight = 48
  const graphViewportHeight = graphBodyHeight + graphFooterHeight
  const lineZoom = zoom + 11
  const pixelsPerMinute = 1.8 + lineZoom * 0.95
  const svgWidth = Math.max(900, Math.round(horizontalSpan * pixelsPerMinute))
  const svgHeight = graphViewportHeight
  const stopLabelFontSize = 14
  const gridTimeFontSize = 16
  const timePillFontSize = 12
  const timePillWidth = 72
  const timePillHeight = 24
  const paddingTop = 52
  const paddingBottom = 34
  const gridLabelTopY = paddingTop - 30
  const gridLabelBottomY = graphBodyHeight + 10
  const gridLineBottomY = graphBodyHeight - paddingBottom + 6

  const xForMinute = (minute: number) => (minute - graphStartMinute) * pixelsPerMinute

  const yForStop = (stopId: string) => {
    const index = graphStops.findIndex((stop) => stop.id === stopId)
    const step =
      graphStops.length > 1
        ? (graphBodyHeight - paddingTop - paddingBottom) / (graphStops.length - 1)
        : 0

    return paddingTop + Math.max(index, 0) * step
  }

  const ticks: number[] = []
  const tickStart = Math.ceil(graphStartMinute / 5) * 5
  const tickEnd = Math.floor(graphEndMinute / 5) * 5

  for (let minute = tickStart; minute <= tickEnd; minute += 5) {
    ticks.push(minute)
  }

  const compareStartMinute = windowStartMinute
  const compareEndMinute = windowEndMinute
  const compareHorizontalSpan = Math.max(1, compareEndMinute - compareStartMinute)
  const compareSvgWidth = Math.max(900, Math.round(compareHorizontalSpan * pixelsPerMinute))
  const compareBodyHeight = Math.round(170 + verticalZoom * 45)
  const compareFooterHeight = 24
  const compareViewportHeight = compareBodyHeight + compareFooterHeight
  const compareSvgHeight = compareViewportHeight
  const comparePaddingTop = 34
  const comparePaddingBottom = 22
  const compareGridLabelBottomY = compareBodyHeight + 12
  const compareGridTimeFontSize = 14
  const compareStopLabelFontSize = 11
  const compareTicks: number[] = []
  const compareTickStart = Math.ceil(compareStartMinute / 5) * 5
  const compareTickEnd = Math.floor(compareEndMinute / 5) * 5

  for (let minute = compareTickStart; minute <= compareTickEnd; minute += 5) {
    compareTicks.push(minute)
  }

  const xForCompareMinute = (minute: number) => (minute - compareStartMinute) * pixelsPerMinute

  const compareTimelines = useMemo(
    () =>
      compareLineIds.map((compareLineId) => {
        const compareLine = getServiceLine(compareLineId)
        const compareVisibleStopIds = Array.from(
          new Set([...getVisibleStopIdsForLine(compareLineId), ...compareLine.termini]),
        )
        const compareStops = compareLine.stops.filter((stop) =>
          compareVisibleStopIds.includes(stop.id),
        )
        const compareStopIdSet = new Set(compareStops.map((stop) => stop.id))
        const compareRuns = getServiceScenarioRuns(compareLineId, scenarioId)
          .filter((run) => {
            const runEnd = run.startMinute + run.offsets[run.offsets.length - 1]
            return runEnd >= compareStartMinute && run.startMinute <= compareEndMinute
          })
          .map((run) => ({
            run,
            visiblePoints: run.path
              .map((stopId, index) => ({
                stopId,
                minute: run.startMinute + run.offsets[index],
                stopIndex: index,
              }))
              .filter((point) => compareStopIdSet.has(point.stopId)),
          }))
          .filter((item) => item.visiblePoints.length > 1)

        const yForCompareStop = (stopId: string) => {
          const index = compareStops.findIndex((stop) => stop.id === stopId)
          const step =
            compareStops.length > 1
              ? (compareBodyHeight - comparePaddingTop - comparePaddingBottom) /
                (compareStops.length - 1)
              : 0

          return comparePaddingTop + Math.max(index, 0) * step
        }

        return {
          line: compareLine,
          runs: compareRuns,
          stops: compareStops,
          yForStop: yForCompareStop,
        }
      }),
    [
      compareEndMinute,
      compareLineIds,
      comparePaddingBottom,
      comparePaddingTop,
      compareBodyHeight,
      compareStartMinute,
      scenarioId,
      getVisibleStopIdsForLine,
    ],
  )

  const runsForGraph = runCandidates
  const timeBubblePlacements = (() => {
    const placements = new Map<string, TimeBubblePlacement>()
    const occupiedBoxes: Array<{ left: number; right: number; top: number; bottom: number }> = []
    const laneOffset = timePillHeight + 8
    const minGap = 6
    const horizontalPadding = 6
    const topLimit = paddingTop
    const bottomLimit = svgHeight - paddingBottom

    const selectedRuns = runsForGraph
      .filter(({ run }) => selectedRunIdsForGraph.includes(run.id))
      .sort((left, right) => {
        if (left.run.id === activeRunId) {
          return -1
        }
        if (right.run.id === activeRunId) {
          return 1
        }
        return left.run.startMinute - right.run.startMinute
      })

    const intersects = (candidate: { left: number; right: number; top: number; bottom: number }) =>
      occupiedBoxes.some(
        (box) =>
          candidate.left < box.right + minGap &&
          candidate.right > box.left - minGap &&
          candidate.top < box.bottom + minGap &&
          candidate.bottom > box.top - minGap,
      )

    for (const { run, visiblePoints } of selectedRuns) {
      visiblePoints.forEach((point, index) => {
        const pointX = xForMinute(point.minute)
        const pointY = yForStop(point.stopId)
        const prefersBelow =
          index === 0 ? false : index === visiblePoints.length - 1 ? true : index % 2 === 1
        const preferredDirection =
          prefersBelow && pointY + timePillHeight + 20 < bottomLimit
            ? 1
            : pointY - timePillHeight - 20 > topLimit
              ? -1
              : 1
        const directionOrder = [preferredDirection, preferredDirection * -1].filter(
          (direction, position, list) => list.indexOf(direction) === position,
        )
        const xShift =
          index === 0
            ? timePillWidth / 2 + 10
            : index === visiblePoints.length - 1
              ? -(timePillWidth / 2 + 10)
              : 0
        const pillCenterX = Math.max(
          timePillWidth / 2 + horizontalPadding,
          Math.min(svgWidth - timePillWidth / 2 - horizontalPadding, pointX + xShift),
        )

        let chosenPlacement: TimeBubblePlacement | null = null

        for (const direction of directionOrder) {
          for (let lane = 0; lane < 6; lane += 1) {
            const pillCenterY =
              pointY + direction * (timePillHeight / 2 + 14 + lane * laneOffset)
            const top = pillCenterY - timePillHeight / 2
            const bottom = pillCenterY + timePillHeight / 2

            if (top < topLimit || bottom > bottomLimit) {
              continue
            }

            const candidateBox = {
              left: pillCenterX - timePillWidth / 2,
              right: pillCenterX + timePillWidth / 2,
              top,
              bottom,
            }

            if (intersects(candidateBox)) {
              continue
            }

            occupiedBoxes.push(candidateBox)
            chosenPlacement = {
              pillCenterX,
              pillCenterY,
              leaderEndY: pillCenterY - direction * (timePillHeight / 2),
            }
            break
          }

          if (chosenPlacement) {
            break
          }
        }

        if (!chosenPlacement) {
          const fallbackDirection = directionOrder[0] ?? 1
          const fallbackCenterY = Math.max(
            topLimit + timePillHeight / 2,
            Math.min(
              bottomLimit - timePillHeight / 2,
              pointY + fallbackDirection * (timePillHeight / 2 + 14),
            ),
          )
          chosenPlacement = {
            pillCenterX,
            pillCenterY: fallbackCenterY,
            leaderEndY: fallbackCenterY - fallbackDirection * (timePillHeight / 2),
          }
        }

        placements.set(`${run.id}-${point.stopId}`, chosenPlacement)
      })
    }

    return placements
  })()

  const initialScrollLeft = 0

  useEffect(() => {
    if (graphScrollRef.current) {
      graphScrollRef.current.scrollLeft = initialScrollLeft
    }
  }, [
    initialScrollLeft,
    graphStartMinute,
    graphEndMinute,
    zoom,
    scenarioId,
    selectedStopId,
    windowStartHour,
    windowEndHour,
  ])

  useEffect(() => {
    compareScrollRefs.current.forEach((node) => {
      if (node) {
        node.scrollLeft = 0
      }
    })
  }, [compareEndMinute, compareLineIds, compareStartMinute, pixelsPerMinute, scenarioId])

  useEffect(() => {
    const client = supabase

    if (!client) {
      return
    }

    let alive = true
    const assignmentLineIds = Array.from(
      new Set([
        lineId,
        ...compareLineIds.filter((_, index) => compareVisibleSlots[index]),
      ]),
    )

    const loadAssignments = async () => {
      setAssignmentsLoading(true)

      const { data, error } = await client
        .from('tram_segment_reservations')
        .select(
          'id, scenario_id, line_id, run_id, start_stop_id, end_stop_id, start_minute, end_minute, mediator_count, tram_segment_reservation_mediators(mediator_id)',
        )
        .eq('owner_id', userId)
        .eq('scenario_id', scenarioId)
        .in('line_id', assignmentLineIds)
        .order('start_minute', { ascending: true })

      if (!alive) {
        return
      }

      if (error) {
        setAssignmentsLoading(false)
        setPlannerMessage(`Lecture Supabase impossible: ${error.message}`)
        return
      }

      setAssignments(
        (data ?? []).map((item) => ({
          id: item.id,
          scenarioId: item.scenario_id as TramScenarioId,
          lineId: item.line_id as ServiceLineId,
          runId: item.run_id,
          startStopId: item.start_stop_id,
          endStopId: item.end_stop_id,
          startMinute: item.start_minute,
          endMinute: item.end_minute,
          mediatorCount: item.mediator_count,
          mediatorIds:
            item.tram_segment_reservation_mediators?.map((link) => link.mediator_id) ?? [],
        })),
      )
      setAssignmentsLoading(false)
    }

    void loadAssignments()

    return () => {
      alive = false
    }
  }, [compareLineIds, compareVisibleSlots, lineId, scenarioId, userId])

  const filteredStops = currentLine.stops.filter((stop) =>
    stop.label.toLowerCase().includes(stopSearch.trim().toLowerCase()),
  )
  const visibleStopSummary = graphStops.map((stop) => stop.label).join(', ')

  const selectedRunAssignments = selectedRun
    ? assignments.filter((assignment) => assignment.runId === selectedRun.id)
    : []

  const draftSegment =
    selectedRun && segmentDraftStartStopId && segmentDraftEndStopId
      ? normalizeSegment(selectedRun, segmentDraftStartStopId, segmentDraftEndStopId)
      : null

  const effectiveRecapMediatorId =
    (recapMediatorId && mediators.some((mediator) => mediator.id === recapMediatorId)
      ? recapMediatorId
      : mediators[0]?.id) ?? ''

  const recapAssignments = useMemo(
    () =>
      assignments
        .filter((assignment) => assignment.scenarioId === scenarioId && assignment.lineId === lineId)
        .filter((assignment) =>
          effectiveRecapMediatorId
            ? assignment.mediatorIds.includes(effectiveRecapMediatorId)
            : true,
        )
        .sort((left, right) => left.startMinute - right.startMinute),
    [assignments, effectiveRecapMediatorId, lineId, scenarioId],
  )

  const recapMediator =
    mediators.find((mediator) => mediator.id === effectiveRecapMediatorId) ?? mediators[0] ?? null

  const recapTotalMinutes = recapAssignments.reduce(
    (sum, assignment) => sum + Math.max(0, assignment.endMinute - assignment.startMinute),
    0,
  )

  const hourOptions = Array.from(
    { length: lastHour - firstHour + 1 },
    (_, index) => firstHour + index,
  )

  useEffect(() => {
    const client = supabase

    let alive = true
    const localPreferences = readStopVisibilityPreferences(userId, scenarioId)

    queueMicrotask(() => {
      if (!alive) {
        return
      }

      setStopVisibilityPreferencesByLineId(localPreferences)
      setVisibleStopIds(localPreferences[lineId] ?? getServiceLine(lineId).defaultVisibleStopIds)
    })

    const loadStopPreferences = async () => {
      if (!client) {
        return
      }

      const lineIds = lineOptions.map((line) => line.id)

      const { data, error } = await client
        .from('timeline_stop_visibility_preferences')
        .select('line_id, visible_stop_ids')
        .eq('owner_id', userId)
        .eq('scenario_id', scenarioId)
        .in('line_id', lineIds)

      if (!alive) {
        return
      }

      if (error) {
        return
      }

      const nextPreferences: Record<string, string[]> = {}
      const preferenceRows = (data ?? []) as Array<{
        line_id: string
        visible_stop_ids: unknown
      }>

      preferenceRows.forEach((row) => {
        const rawVisibleStopIds = Array.isArray(row.visible_stop_ids)
          ? row.visible_stop_ids
          : []
        nextPreferences[row.line_id] = rawVisibleStopIds.filter(
          (stopId): stopId is string => typeof stopId === 'string',
        )
      })

      const mergedPreferences = {
        ...localPreferences,
        ...nextPreferences,
      }

      setStopVisibilityPreferencesByLineId(mergedPreferences)
      setVisibleStopIds(
        mergedPreferences[lineId] ?? getServiceLine(lineId).defaultVisibleStopIds,
      )
    }

    void loadStopPreferences()

    return () => {
      alive = false
    }
  }, [lineId, lineOptions, scenarioId, userId])

  const saveVisibleStopIds = async (targetLineId: ServiceLineId, nextVisibleStopIds: string[]) => {
    const client = supabase

    const nextPreferences = {
      ...readStopVisibilityPreferences(userId, scenarioId),
      [targetLineId]: nextVisibleStopIds,
    }

    writeStopVisibilityPreferences(userId, scenarioId, nextPreferences)

    setStopVisibilityPreferencesByLineId(nextPreferences)

    if (!client) {
      return
    }

    const { error } = await client
      .from('timeline_stop_visibility_preferences')
      .upsert(
        {
          owner_id: userId,
          line_id: targetLineId,
          scenario_id: scenarioId,
          visible_stop_ids: nextVisibleStopIds,
        },
        { onConflict: 'owner_id,line_id,scenario_id' },
      )

    if (error) {
      setPlannerMessage(`Sauvegarde des arrets impossible: ${error.message}`)
      return
    }

    setStopVisibilityPreferencesByLineId((current) => ({
      ...current,
      [targetLineId]: nextVisibleStopIds,
    }))
  }

  const applyVisibleStopIds = (nextVisibleStopIds: string[]) => {
    setVisibleStopIds(nextVisibleStopIds)
    void saveVisibleStopIds(lineId, nextVisibleStopIds)
  }

  const toggleStopVisibility = (stopId: string) => {
    if (stopId === selectedStop.id || currentLine.termini.includes(stopId)) {
      return
    }

    setVisibleStopIds((current) => {
      const nextVisibleStopIds = current.includes(stopId)
        ? current.filter((id) => id !== stopId)
        : [...current, stopId]

      void saveVisibleStopIds(lineId, nextVisibleStopIds)
      return nextVisibleStopIds
    })
  }

  const handleLineChange = (nextLineId: ServiceLineId) => {
    const nextLine = getServiceLine(nextLineId)
    const nextBounds = getServiceScenarioBounds(nextLineId, scenarioId)
    const nextRuns = getServiceScenarioRuns(nextLineId, scenarioId)
    const nextStopId = nextLine.defaultFocusStopId
    const nextRun =
      nextRuns.find((run) => getArrivalMinute(run, nextStopId) !== null) ?? nextRuns[0]

    setLineId(nextLineId)
    setSelectedStopId(nextStopId)
    setVisibleStopIds(nextLine.defaultVisibleStopIds)
    setWindowStartHour(Math.floor(nextBounds.firstDeparture / 60))
    setWindowEndHour(Math.ceil(nextBounds.lastArrival / 60))
    setSelectedRunId(nextRun?.id ?? '')
    setSelectedRunIds(nextRun ? [nextRun.id] : [])
    setPlannerTab('reserve')
    setSegmentDraftStartStopId('')
    setSegmentDraftEndStopId('')
    setSelectedMediatorIds([])
    setPlannerMessage('')
  }

  const handleScenarioChange = (nextScenarioId: ServiceScenarioId) => {
    const nextBounds = getServiceScenarioBounds(lineId, nextScenarioId)
    const nextRuns = getServiceScenarioRuns(lineId, nextScenarioId)
    const nextRun =
      nextRuns.find((run) => getArrivalMinute(run, selectedStopId) !== null) ?? nextRuns[0]

    setScenarioId(nextScenarioId)
    setWindowStartHour(Math.floor(nextBounds.firstDeparture / 60))
    setWindowEndHour(Math.ceil(nextBounds.lastArrival / 60))
    setSelectedRunId(nextRun?.id ?? '')
    setSelectedRunIds(nextRun ? [nextRun.id] : [])
    setPlannerTab('reserve')
    setSegmentDraftStartStopId('')
    setSegmentDraftEndStopId('')
    setSelectedMediatorIds([])
    setPlannerMessage('')
  }

  const handleCompareLineChange = (slotIndex: number, nextLineId: ServiceLineId) => {
    setCompareLineIds((current) =>
      current.map((line, index) => (index === slotIndex ? nextLineId : line)),
    )
  }

  const toggleCompareSlotVisibility = (slotIndex: number) => {
    setCompareVisibleSlots((current) => {
      const visibleCount = current.filter(Boolean).length

      if (current[slotIndex] && visibleCount === 1) {
        return current
      }

      return current.map((isVisible, index) =>
        index === slotIndex ? !isVisible : isVisible,
      )
    })
  }

  const handleCompareScroll = (sourceIndex: number, scrollLeft: number) => {
    if (compareScrollSyncingRef.current) {
      return
    }

    compareScrollSyncingRef.current = true

    compareScrollRefs.current.forEach((node, index) => {
      if (index !== sourceIndex && node) {
        node.scrollLeft = scrollLeft
      }
    })

    requestAnimationFrame(() => {
      compareScrollSyncingRef.current = false
    })
  }

  const handleGraphPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    const eventTarget = event.target
    if (eventTarget instanceof Element && eventTarget.closest(GRAPH_DRAG_IGNORE_SELECTOR)) {
      return
    }

    const container = event.currentTarget
    graphDragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: container.scrollLeft,
      isDragging: false,
    }
    container.setPointerCapture(event.pointerId)
  }

  const handleGraphPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = graphDragStateRef.current

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    const target = graphScrollRef.current

    if (!target) {
      return
    }

    const deltaX = event.clientX - dragState.startX

    if (!dragState.isDragging && Math.abs(deltaX) < 6) {
      return
    }

    if (!dragState.isDragging) {
      dragState.isDragging = true
      target.classList.add('is-dragging')
    }

    event.preventDefault()
    target.scrollLeft = dragState.startScrollLeft - deltaX
  }

  const finishGraphDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = graphDragStateRef.current

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    const target = graphScrollRef.current
    if (target) {
      target.classList.remove('is-dragging')
    }

    if (dragState.isDragging) {
      graphClickSuppressionRef.current = true
      requestAnimationFrame(() => {
        graphClickSuppressionRef.current = false
      })
    }

    graphDragStateRef.current = null
  }

  const handleStopChange = (stopId: string) => {
    setSelectedStopId(stopId)
    setVisibleStopIds((current) =>
      current.includes(stopId) ? current : [...current, stopId],
    )

    const nextRun = scenarioRuns.find((run) => getArrivalMinute(run, stopId) !== null)
    setSelectedRunId(nextRun?.id ?? '')
    setSelectedRunIds(nextRun ? [nextRun.id] : [])
    setSegmentDraftStartStopId('')
    setSegmentDraftEndStopId('')
    setSelectedMediatorIds([])
    setPlannerMessage('')
  }

  const toggleRunSelection = (runId: string) => {
    setSelectedRunIds((current) => {
      if (current.includes(runId)) {
        if (current.length === 1) {
          setSelectedRunId(runId)
          return current
        }

        const next = current.filter((id) => id !== runId)
        setSelectedRunId((currentRunId) =>
          currentRunId === runId ? next[next.length - 1] ?? '' : currentRunId,
        )
        setSegmentDraftStartStopId('')
        setSegmentDraftEndStopId('')
        setSelectedMediatorIds([])
        return next
      }

      setSelectedRunId(runId)
      setSegmentDraftStartStopId('')
      setSegmentDraftEndStopId('')
      setSelectedMediatorIds([])
      return [...current, runId]
    })
  }

  const toggleMediatorSelection = (mediatorId: string) => {
    setSelectedMediatorIds((current) => {
      if (current.includes(mediatorId)) {
        return current.filter((id) => id !== mediatorId)
      }

      if (current.length >= segmentMediatorCount) {
        return current
      }

      return [...current, mediatorId]
    })
  }

  const handleWindowStartChange = (nextStartHour: number) => {
    const safeStart = Math.min(nextStartHour, windowEndHour - 1)
    setWindowStartHour(safeStart)
  }

  const handleWindowEndChange = (nextEndHour: number) => {
    const safeEnd = Math.max(nextEndHour, windowStartHour + 1)
    setWindowEndHour(safeEnd)
  }

  const setPresetWindow = (startHour: number, endHour: number) => {
    const safeStart = Math.max(firstHour, Math.min(startHour, lastHour - 1))
    const safeEnd = Math.min(lastHour, Math.max(endHour, safeStart + 1))

    setWindowStartHour(safeStart)
    setWindowEndHour(safeEnd)
  }

  const handleTimeBubbleClick = (run: ServiceRun, stopId: string) => {
    setSelectedRunId(run.id)
    setSelectedRunIds((current) => (current.includes(run.id) ? current : [...current, run.id]))

    if (!selectedRun || selectedRun.id !== run.id) {
      setSegmentDraftStartStopId(stopId)
      setSegmentDraftEndStopId('')
      return
    }

    if (!segmentDraftStartStopId) {
      setSegmentDraftStartStopId(stopId)
      setSegmentDraftEndStopId('')
      return
    }

    if (!segmentDraftEndStopId && segmentDraftStartStopId === stopId) {
      setSegmentDraftStartStopId('')
      setSegmentDraftEndStopId('')
      return
    }

    if (!segmentDraftEndStopId) {
      setSegmentDraftEndStopId(stopId)
      return
    }

    if (segmentDraftStartStopId === stopId) {
      setSegmentDraftStartStopId(segmentDraftEndStopId)
      setSegmentDraftEndStopId('')
      return
    }

    if (segmentDraftEndStopId === stopId) {
      setSegmentDraftEndStopId('')
      return
    }

    setSegmentDraftStartStopId(stopId)
    setSegmentDraftEndStopId('')
  }

  const assignMediatorSegment = async () => {
    if (!selectedRun || !draftSegment) {
      return
    }

    if (selectedMediatorIds.length !== segmentMediatorCount) {
      setPlannerMessage(
        `Selectionne ${segmentMediatorCount} agent(s) pour enregistrer ce troncon.`,
      )
      return
    }

    const overlappingCount = assignments
      .filter((assignment) => assignment.runId === selectedRun.id)
      .filter((assignment) =>
        segmentsOverlap(
          selectedRun,
          assignment.startStopId,
          assignment.endStopId,
          draftSegment.startStopId,
          draftSegment.endStopId,
        ),
      )
      .reduce((sum, assignment) => sum + assignment.mediatorCount, 0)

    if (overlappingCount + segmentMediatorCount > 2) {
      setPlannerMessage(
        'Ce troncon depasserait la limite de 2 mediateurs simultanes sur la meme course.',
      )
      return
    }

    if (!supabase) {
      setPlannerMessage('Supabase n est pas disponible pour enregistrer cette reservation.')
      return
    }

    const client = supabase
    setAssignmentsSaving(true)

    const startMinute = getArrivalMinute(selectedRun, draftSegment.startStopId)
    const endMinute = getArrivalMinute(selectedRun, draftSegment.endStopId)

    if (startMinute === null || endMinute === null) {
      setAssignmentsSaving(false)
      setPlannerMessage('Impossible de calculer les horaires exacts du troncon.')
      return
    }

    const { data: reservation, error: reservationError } = await client
      .from('tram_segment_reservations')
      .upsert(
        {
          owner_id: userId,
          scenario_id: scenarioId,
          line_id: lineId,
          run_id: selectedRun.id,
          run_label: selectedRun.label,
          vehicle_label: selectedRun.vehicleLabel,
          direction_label: getRunDirectionLabel(selectedRun, currentLine),
          start_stop_id: draftSegment.startStopId,
          start_stop_label:
            currentLine.stops.find((stop) => stop.id === draftSegment.startStopId)?.label ??
            draftSegment.startStopId,
          end_stop_id: draftSegment.endStopId,
          end_stop_label:
            currentLine.stops.find((stop) => stop.id === draftSegment.endStopId)?.label ??
            draftSegment.endStopId,
          start_minute: startMinute,
          end_minute: endMinute,
          mediator_count: segmentMediatorCount,
        },
        {
          onConflict: 'owner_id,scenario_id,line_id,run_id,start_stop_id,end_stop_id',
        },
      )
      .select('id')
      .single()

    if (reservationError || !reservation) {
      setAssignmentsSaving(false)
      setPlannerMessage(
        `Enregistrement Supabase impossible: ${reservationError?.message ?? 'reservation absente'}.`,
      )
      return
    }

    const reservationId = reservation.id

    const { error: deleteLinksError } = await client
      .from('tram_segment_reservation_mediators')
      .delete()
      .eq('reservation_id', reservationId)

    if (deleteLinksError) {
      setAssignmentsSaving(false)
      setPlannerMessage(`Nettoyage des agents impossible: ${deleteLinksError.message}`)
      return
    }

    const { error: linksError } = await client
      .from('tram_segment_reservation_mediators')
      .insert(
        selectedMediatorIds.map((mediatorId) => ({
          owner_id: userId,
          reservation_id: reservationId,
          mediator_id: mediatorId,
        })),
      )

    if (linksError) {
      setAssignmentsSaving(false)
      setPlannerMessage(`Affectation des agents impossible: ${linksError.message}`)
      return
    }

    const nextAssignment: SegmentAssignment = {
      id: reservationId,
      scenarioId,
      lineId,
      runId: selectedRun.id,
      startStopId: draftSegment.startStopId,
      endStopId: draftSegment.endStopId,
      startMinute,
      endMinute,
      mediatorCount: segmentMediatorCount,
      mediatorIds: selectedMediatorIds,
    }

    setAssignments((current) => {
      const filtered = current.filter((assignment) => assignment.id !== reservationId)
      return [...filtered, nextAssignment].sort((left, right) => left.startMinute - right.startMinute)
    })

    setPlannerMessage(
      `${segmentMediatorCount} mediateur(s) reserve(s) sur ${getSegmentWindow(
        selectedRun,
        currentLine,
        draftSegment.startStopId,
        draftSegment.endStopId,
      )}.`,
    )
    setSegmentDraftStartStopId('')
    setSegmentDraftEndStopId('')
    setSelectedMediatorIds([])
    setAssignmentsSaving(false)
  }

  const removeAssignment = async (assignmentId: string) => {
    if (!supabase) {
      setPlannerMessage('Supabase n est pas disponible pour supprimer cette reservation.')
      return
    }

    const client = supabase
    const { error } = await client
      .from('tram_segment_reservations')
      .delete()
      .eq('id', assignmentId)
      .eq('owner_id', userId)

    if (error) {
      setPlannerMessage(`Suppression impossible: ${error.message}`)
      return
    }

    setAssignments((current) => current.filter((assignment) => assignment.id !== assignmentId))
    setPlannerMessage('Reservation retiree du scenario courant.')
  }

  return (
    <section className="panel service-planner-panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">{currentLine.label} : timeline complete par scenario</h2>
          <p className="panel-subtitle">
            Scenario actif : {scenarioDefinition.label}. La ligne couvre le premier
            depart a {formatMinute(scenarioBounds.firstDeparture)} et le dernier
            passage jusqu a {formatMinute(scenarioBounds.lastArrival)}.
          </p>
        </div>
        <div className="pill-row">
          <span className="pill">
            <TramFront size={16} />
            {currentLine.label} uniquement
          </span>
          <span className="pill">
            <ShieldCheck size={16} />
            Pose mediateurs sur troncons cliquables
          </span>
          <span className="pill">
            <MapPinned size={16} />
            {mediators.length} mediateur(s) disponibles
          </span>
          <span className="pill service-direction-pill service-direction-pill--forward">
            Depart {currentLine.stops.find((stop) => stop.id === currentLine.termini[0])?.label}
          </span>
          <span className="pill service-direction-pill service-direction-pill--reverse">
            Depart {currentLine.stops.find((stop) => stop.id === currentLine.termini[1])?.label}
          </span>
        </div>
      </div>

      <div className="service-controls service-controls--tram">
        <div className="field">
          <label htmlFor="line-select">Ligne</label>
          <select
            id="line-select"
            value={lineId}
            onChange={(event) => handleLineChange(event.target.value as ServiceLineId)}
          >
            {lineOptions.map((line) => (
              <option key={line.id} value={line.id}>
                {line.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="scenario-select">Scenario</label>
          <select
            id="scenario-select"
            value={scenarioId}
            onChange={(event) => handleScenarioChange(event.target.value as ServiceScenarioId)}
          >
            {serviceScenarioDefinitions.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.label}
              </option>
            ))}
          </select>
          <span className="muted service-scenario-help">{scenarioDescription}</span>
        </div>

        <div className="field">
          <label htmlFor="stop-select">Arret de reference</label>
          <select
            id="stop-select"
            value={selectedStop.id}
            onChange={(event) => handleStopChange(event.target.value)}
          >
            {currentLine.stops.map((stop) => (
              <option key={stop.id} value={stop.id}>
                {stop.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="zoom-range">Zoom horizontal</label>
          <input
            id="zoom-range"
            type="range"
            min="1"
            max="24"
            step="0.1"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <span className="muted service-zoom-label">
            <ZoomIn size={14} /> x{zoom.toFixed(1)}
          </span>
        </div>

        <div className="field">
          <label htmlFor="vertical-zoom-range">Hauteur des lignes</label>
          <input
            id="vertical-zoom-range"
            type="range"
            min="1"
            max="4"
            step="0.1"
            value={verticalZoom}
            onChange={(event) => setVerticalZoom(Number(event.target.value))}
          />
          <span className="muted service-zoom-label">
            <ZoomIn size={14} /> y{verticalZoom.toFixed(1)}
          </span>
        </div>

        <div className="field">
          <label htmlFor="line-weight-range">Epaisseur des lignes</label>
          <input
            id="line-weight-range"
            type="range"
            min="1"
            max="4"
            step="0.1"
            value={lineWeight}
            onChange={(event) => setLineWeight(Number(event.target.value))}
          />
          <span className="muted service-zoom-label">
            <ZoomIn size={14} /> {lineWeight.toFixed(1)} px
          </span>
        </div>
      </div>

      <div className="service-time-window-box">
        <div className="service-stop-selector-head">
          <div>
            <strong>Creneau horaire affiche</strong>
            <p className="muted">
              La timeline reste defilable horizontalement. Tu peux aussi cibler une
              plage comme 14h - 18h pour resserrer l analyse du scenario selectionne.
            </p>
          </div>
          <div className="service-stop-selector-actions">
            <button
              type="button"
              className="button-ghost service-mini-button"
              onClick={() => setPresetWindow(firstHour, lastHour)}
            >
              Journee complete
            </button>
            <button
              type="button"
              className="button-ghost service-mini-button"
              onClick={() => setPresetWindow(14, 18)}
            >
              14h - 18h
            </button>
            <button
              type="button"
              className="button-ghost service-mini-button"
              onClick={() => setPresetWindow(18, 22)}
            >
              18h - 22h
            </button>
          </div>
        </div>

        <div className="service-time-window-grid">
          <div className="field">
            <label htmlFor="window-start">Debut</label>
            <select
              id="window-start"
              value={windowStartHour}
              onChange={(event) => handleWindowStartChange(Number(event.target.value))}
            >
              {hourOptions.slice(0, -1).map((hour) => (
                <option key={hour} value={hour}>
                  {formatHourOption(hour)}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="window-end">Fin</label>
            <select
              id="window-end"
              value={windowEndHour}
              onChange={(event) => handleWindowEndChange(Number(event.target.value))}
            >
              {hourOptions.slice(1).map((hour) => (
                <option key={hour} value={hour}>
                  {formatHourOption(hour)}
                </option>
              ))}
            </select>
          </div>

          <div className="service-time-window-summary">
            <span className="pill">
              <Clock3 size={16} />
              Fenetre {formatHourOption(windowStartHour)} {'->'} {formatHourOption(windowEndHour)}
            </span>
          </div>
        </div>
      </div>

      <div className="service-compare-box">
        <div className="service-graph-header">
          <div>
            <strong>Comparaison multi-lignes</strong>
            <p className="muted">
              Trois timelines peuvent etre affichees l une sous l autre. Le scroll
              horizontal reste synchronise entre elles pour comparer les departs sur la
              meme plage horaire.
            </p>
          </div>
          <div className="pill-row">
            <span className="pill">
              <Clock3 size={16} />
              {formatHourOption(windowStartHour)} {'->'} {formatHourOption(windowEndHour)}
            </span>
          </div>
        </div>

        <div className="service-compare-controls">
          {compareLineIds.map((compareLineId, index) => (
            <div key={`compare-select-${index}`} className="field">
              <label htmlFor={`compare-line-${index}`}>Timeline {index + 1}</label>
              <div className="service-compare-control-card">
                <select
                  id={`compare-line-${index}`}
                  value={compareLineId}
                  onChange={(event) =>
                    handleCompareLineChange(index, event.target.value as ServiceLineId)
                  }
                >
                  {lineOptions.map((line) => (
                    <option
                      key={`${index}-${line.id}`}
                      value={line.id}
                      disabled={
                        compareLineIds.includes(line.id as ServiceLineId) &&
                        compareLineIds[index] !== line.id
                      }
                    >
                      {line.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`button-ghost service-mini-button ${
                    compareVisibleSlots[index] ? '' : 'is-muted'
                  }`}
                  onClick={() => toggleCompareSlotVisibility(index)}
                >
                  {compareVisibleSlots[index] ? 'Masquer' : 'Afficher'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="service-compare-stack">
          {compareTimelines.map((timeline, index) =>
            compareVisibleSlots[index] ? (
            <article
              key={`compare-${timeline.line.id}-${index}`}
              className="service-graph-box service-graph-box--compare"
            >
              <div className="service-graph-header">
                <div>
                  <strong>{timeline.line.label}</strong>
                  <p className="muted">
                    {timeline.runs.length} course(s) visibles sur la fenetre courante.
                  </p>
                </div>
                <div className="pill-row">
                  <span className="pill service-direction-pill service-direction-pill--forward">
                    {timeline.line.stops.find((stop) => stop.id === timeline.line.termini[0])?.label}
                  </span>
                  <span className="pill service-direction-pill service-direction-pill--reverse">
                    {timeline.line.stops.find((stop) => stop.id === timeline.line.termini[1])?.label}
                  </span>
                </div>
              </div>

              <div className="service-graph-stage service-graph-stage--compare">
                <div
                  className="service-stop-rail"
                  style={{ height: `${compareViewportHeight}px` }}
                >
                  {timeline.stops.map((stop) => (
                    <div
                      key={`${timeline.line.id}-${stop.id}-left`}
                      className="service-stop-rail-label"
                      style={{
                        top: `${timeline.yForStop(stop.id)}px`,
                        fontSize: `${compareStopLabelFontSize}px`,
                      }}
                    >
                      {stop.label}
                    </div>
                  ))}
                </div>

                <div
                  ref={(node) => {
                    compareScrollRefs.current[index] = node
                  }}
                  className="service-graph-scroll service-graph-scroll--compare"
                  style={{ height: `${compareViewportHeight}px` }}
                  onScroll={(event) =>
                    handleCompareScroll(index, event.currentTarget.scrollLeft)
                  }
                >
                  <svg
                    className="service-graph"
                    viewBox={`0 0 ${compareSvgWidth} ${compareSvgHeight}`}
                    style={{ width: `${compareSvgWidth}px`, height: `${compareViewportHeight}px` }}
                    role="img"
                    aria-label={`Timeline comparee ${timeline.line.label}`}
                  >
                    {compareTicks.map((minute) => (
                      <g key={`${timeline.line.id}-${minute}`}>
                        <line
                          x1={xForCompareMinute(minute)}
                          x2={xForCompareMinute(minute)}
                          y1={comparePaddingTop - 18}
                          y2={compareSvgHeight - comparePaddingBottom + 4}
                          className={`service-grid-line ${
                            minute % 15 === 0 ? 'is-quarter' : 'is-minute'
                          } ${minute % 60 === 0 ? 'is-hour' : ''}`}
                        />
                        {minute % 15 === 0 ? (
                          <text
                            x={xForCompareMinute(minute)}
                            y={comparePaddingTop - 22}
                            textAnchor={minute === compareTickStart ? 'start' : 'middle'}
                            dx={minute === compareTickStart ? 2 : 0}
                            className="service-grid-time"
                            style={{ fontSize: `${compareGridTimeFontSize}px` }}
                          >
                            {formatMinute(minute)}
                          </text>
                        ) : null}
                        {minute % 15 === 0 ? (
                          <text
                            x={xForCompareMinute(minute)}
                            y={compareGridLabelBottomY}
                            textAnchor={minute === compareTickStart ? 'start' : 'middle'}
                            dx={minute === compareTickStart ? 2 : 0}
                            className="service-grid-time"
                            style={{ fontSize: `${compareGridTimeFontSize}px` }}
                          >
                            {formatMinute(minute)}
                          </text>
                        ) : (
                          <text
                            x={xForCompareMinute(minute)}
                            y={compareGridLabelBottomY}
                            textAnchor="middle"
                            className="service-grid-minute"
                          >
                            {String(minute % 60).padStart(2, '0')}
                          </text>
                        )}
                      </g>
                    ))}

                    {timeline.stops.map((stop) => (
                      <line
                        key={`${timeline.line.id}-${stop.id}-line`}
                        x1={0}
                        x2={compareSvgWidth}
                        y1={timeline.yForStop(stop.id)}
                        y2={timeline.yForStop(stop.id)}
                        className="service-stop-line"
                      />
                    ))}

                    {timeline.runs.map(({ run, visiblePoints }) => {
                      const points = visiblePoints
                        .map(
                          (point) =>
                            `${xForCompareMinute(point.minute)},${timeline.yForStop(point.stopId)}`,
                        )
                        .join(' ')
                      const fromPrimaryTerminus = isRunFromTerminus(run, timeline.line)
                      const compareAssignments = assignments.filter(
                        (assignment) =>
                          assignment.lineId === timeline.line.id && assignment.runId === run.id,
                      )

                      return (
                        <g key={`${timeline.line.id}-${run.id}`}>
                          {compareAssignments.map((assignment) => {
                            const segment = normalizeSegment(
                              run,
                              assignment.startStopId,
                              assignment.endStopId,
                            )

                            if (!segment) {
                              return null
                            }

                            const segmentVisiblePoints = visiblePoints.filter(
                              (point) =>
                                point.stopIndex >= segment.startIndex &&
                                point.stopIndex <= segment.endIndex,
                            )

                            if (segmentVisiblePoints.length < 2) {
                              return null
                            }

                            const segmentPoints = segmentVisiblePoints
                              .map(
                                (point) =>
                                  `${xForCompareMinute(point.minute)},${timeline.yForStop(point.stopId)}`,
                              )
                              .join(' ')
                            const middlePoint =
                              segmentVisiblePoints[Math.floor(segmentVisiblePoints.length / 2)]

                            return (
                              <g key={`compare-assignment-${assignment.id}`}>
                                <polyline
                                  points={segmentPoints}
                                  fill="none"
                                  stroke="#b4232d"
                                  strokeWidth={Math.max(2.6, lineWeight + 1)}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  opacity={0.95}
                                />
                                <rect
                                  x={xForCompareMinute(middlePoint.minute) - 10}
                                  y={timeline.yForStop(middlePoint.stopId) - 9}
                                  width={20}
                                  height={18}
                                  rx={9}
                                  fill="#ffffff"
                                  stroke="#b4232d"
                                  strokeWidth={1.2}
                                />
                                <text
                                  x={xForCompareMinute(middlePoint.minute)}
                                  y={timeline.yForStop(middlePoint.stopId) + 3}
                                  textAnchor="middle"
                                  style={{ fill: '#b4232d', fontSize: '10px', fontWeight: 800 }}
                                >
                                  {assignment.mediatorCount}
                                </text>
                              </g>
                            )
                          })}
                          <polyline
                            points={points}
                            fill="none"
                            stroke={fromPrimaryTerminus ? '#0f7bb5' : '#d4631a'}
                            strokeWidth={Math.max(1.2, lineWeight - 0.2)}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={0.7}
                          />
                        </g>
                      )
                    })}
                  </svg>
                </div>

                <div
                  className="service-stop-rail service-stop-rail--right"
                  style={{ height: `${compareViewportHeight}px` }}
                >
                  {timeline.stops.map((stop) => (
                    <div
                      key={`${timeline.line.id}-${stop.id}-right`}
                      className="service-stop-rail-label service-stop-rail-label--right"
                      style={{
                        top: `${timeline.yForStop(stop.id)}px`,
                        fontSize: `${compareStopLabelFontSize}px`,
                      }}
                    >
                      {stop.label}
                    </div>
                  ))}
                </div>
              </div>
            </article>
            ) : null,
          )}
        </div>
      </div>

      <details className="service-stop-dropdown">
        <summary className="service-stop-dropdown-toggle">
          <div>
            <strong>Arrets affiches sur le graphique</strong>
            <p className="muted">
              {graphStops.length} arret(s) visibles. Arret de reference et terminus verrouilles.
            </p>
          </div>
          <span className="pill">Ouvrir le menu</span>
        </summary>

        <div className="service-stop-dropdown-panel">
          <div className="service-stop-selector-head">
            <div className="field service-stop-search">
              <label htmlFor="stop-search">Recherche arret</label>
              <div className="service-search-input">
                <Search size={16} />
                <input
                  id="stop-search"
                  type="text"
                  value={stopSearch}
                  onChange={(event) => setStopSearch(event.target.value)}
                  placeholder="Ex: Jaude, Delille, Cezeaux..."
                />
              </div>
            </div>

            <div className="service-stop-selector-actions">
              <button
                type="button"
                className="button-ghost service-mini-button"
                onClick={() => applyVisibleStopIds(currentLine.stops.map((stop) => stop.id))}
              >
                Tout afficher
              </button>
              <button
                type="button"
                className="button-ghost service-mini-button"
                onClick={() => applyVisibleStopIds(currentLine.defaultVisibleStopIds)}
              >
                Profil utile
              </button>
            </div>
          </div>

          <div className="service-stop-check-grid">
            {filteredStops.map((stop) => {
              const isLocked =
                stop.id === selectedStop.id || currentLine.termini.includes(stop.id)
              const isVisible = graphStopIdSet.has(stop.id)

              return (
                <label
                  key={stop.id}
                  className={`service-stop-check ${isVisible ? 'is-active' : ''} ${isLocked ? 'is-locked' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => toggleStopVisibility(stop.id)}
                    disabled={isLocked}
                  />
                  <span>{stop.label}</span>
                </label>
              )
            })}
          </div>

          <p className="muted service-stop-summary">{visibleStopSummary}</p>
        </div>
      </details>

      <div className="service-graph-box service-graph-box--full">
        <div className="service-graph-header">
          <div>
            <strong>Timeline Tram A</strong>
            <p className="muted">
              Vue horizontale sur la plage selectionnee. Le scroll permet de parcourir
              la timeline. Clique sur une ou plusieurs courses, et la course active
              affiche ses horaires de passage.
            </p>
          </div>
          <div className="pill-row">
            <span className="pill">
              <Clock3 size={16} />
              {visibleRuns.length} course(s) visibles sur ce creneau
            </span>
            <span className="pill">
              <MapPinned size={16} />
              {selectedRunIdsForGraph.length} course(s) selectionnee(s)
            </span>
          </div>
        </div>

        <div className="service-graph-stage">
          <div className="service-stop-rail" style={{ height: `${graphViewportHeight}px` }}>
            {graphStops.map((stop) => (
              <div
                key={stop.id}
                className={`service-stop-rail-label ${stop.id === selectedStop.id ? 'is-highlighted' : ''}`}
                style={{
                  top: `${yForStop(stop.id)}px`,
                  fontSize: `${stopLabelFontSize}px`,
                }}
              >
                {stop.label}
              </div>
            ))}
          </div>

          <div
            ref={graphScrollRef}
            className="service-graph-scroll"
            style={{ height: `${graphViewportHeight}px` }}
            onPointerDown={handleGraphPointerDown}
            onPointerMove={handleGraphPointerMove}
            onPointerUp={finishGraphDrag}
            onPointerCancel={finishGraphDrag}
            onClickCapture={(event) => {
              if (!graphClickSuppressionRef.current) {
                return
              }

              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <svg
              className="service-graph"
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              style={{ width: `${svgWidth}px`, height: `${graphViewportHeight}px` }}
              role="img"
              aria-label="Timeline horaire Tram A"
            >
            <g>
              <line
                x1={xForMinute(graphStartMinute)}
                x2={xForMinute(graphStartMinute)}
                y1={paddingTop - 24}
                y2={gridLineBottomY}
                className="service-grid-line is-hour"
              />
              <text
                x={xForMinute(graphStartMinute)}
                y={gridLabelTopY}
                textAnchor="start"
                dx={2}
                className="service-grid-time"
                style={{ fontSize: `${gridTimeFontSize}px` }}
              >
                {formatMinute(graphStartMinute)}
              </text>
              <text
                x={xForMinute(graphStartMinute)}
                y={gridLabelBottomY}
                textAnchor="start"
                dx={2}
                className="service-grid-time"
                style={{ fontSize: `${gridTimeFontSize}px` }}
              >
                {formatMinute(graphStartMinute)}
              </text>
            </g>

            {ticks.map((minute) => (
              <g key={minute}>
                <line
                  x1={xForMinute(minute)}
                  x2={xForMinute(minute)}
                  y1={paddingTop - 24}
                  y2={gridLineBottomY}
                  className={`service-grid-line ${
                    minute % 15 === 0 ? 'is-quarter' : 'is-minute'
                  } ${minute % 60 === 0 ? 'is-hour' : ''}`}
                />
                {minute % 15 === 0 ? (
                  <>
                    <text
                      x={xForMinute(minute)}
                      y={gridLabelTopY}
                      textAnchor={minute === tickStart ? 'start' : 'middle'}
                      className="service-grid-time"
                      dx={minute === tickStart ? 2 : 0}
                      style={{ fontSize: `${gridTimeFontSize}px` }}
                    >
                      {formatMinute(minute)}
                    </text>
                    <text
                      x={xForMinute(minute)}
                      y={gridLabelBottomY}
                      textAnchor={minute === tickStart ? 'start' : 'middle'}
                      className="service-grid-time"
                      dx={minute === tickStart ? 2 : 0}
                      style={{ fontSize: `${gridTimeFontSize}px` }}
                    >
                      {formatMinute(minute)}
                    </text>
                  </>
                ) : (
                  <>
                    <text
                      x={xForMinute(minute)}
                      y={gridLabelTopY}
                      textAnchor="middle"
                      className="service-grid-minute"
                    >
                      {String(minute % 60).padStart(2, '0')}
                    </text>
                    <text
                      x={xForMinute(minute)}
                      y={gridLabelBottomY}
                      textAnchor="middle"
                      className="service-grid-minute"
                    >
                      {String(minute % 60).padStart(2, '0')}
                    </text>
                  </>
                )}
              </g>
            ))}

            {graphStops.map((stop) => (
              <g key={stop.id}>
                <line
                  x1={0}
                  x2={svgWidth}
                  y1={yForStop(stop.id)}
                  y2={yForStop(stop.id)}
                  className="service-stop-line"
                />
              </g>
            ))}

            {runsForGraph.map(({ run, visiblePoints }) => {
              const points = visiblePoints
                .map((point) => `${xForMinute(point.minute)},${yForStop(point.stopId)}`)
                .join(' ')
              const isActive = selectedRun?.id === run.id
              const isSelected = selectedRunIdsForGraph.includes(run.id)
              const fromPrimaryTerminus = isRunFromTerminus(run, currentLine)
              const strokeColor = fromPrimaryTerminus ? '#0f7bb5' : '#d4631a'
              const draftColor = '#cf2f3f'
              const lockedColor = '#b4232d'
              const hitAreaWidth = Math.max(12, lineWeight * 5)
              const runAssignments = assignments.filter((assignment) => assignment.runId === run.id)
              const runDraftSegment =
                isActive && draftSegment
                  ? normalizeSegment(run, draftSegment.startStopId, draftSegment.endStopId)
                  : null

              return (
                <g key={run.id}>
                  {runAssignments.map((assignment) => {
                    const segment = normalizeSegment(
                      run,
                      assignment.startStopId,
                      assignment.endStopId,
                    )

                    if (!segment) {
                      return null
                    }

                    const segmentVisiblePoints = visiblePoints.filter(
                      (point) =>
                        point.stopIndex >= segment.startIndex &&
                        point.stopIndex <= segment.endIndex,
                    )

                    if (segmentVisiblePoints.length < 2) {
                      return null
                    }

                    const segmentPoints = segmentVisiblePoints
                      .map((point) => `${xForMinute(point.minute)},${yForStop(point.stopId)}`)
                      .join(' ')
                    const middlePoint =
                      segmentVisiblePoints[Math.floor(segmentVisiblePoints.length / 2)]

                    return (
                      <g key={assignment.id}>
                        <polyline
                          points={segmentPoints}
                          fill="none"
                          stroke={lockedColor}
                          strokeWidth={Math.max(4.5, lineWeight + 1.4)}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity={0.96}
                        />
                        <rect
                          x={xForMinute(middlePoint.minute) - 14}
                          y={yForStop(middlePoint.stopId) - 12}
                          width={28}
                          height={24}
                          rx={12}
                          fill="#ffffff"
                          stroke={lockedColor}
                          strokeWidth={1.6}
                        />
                        <text
                          x={xForMinute(middlePoint.minute)}
                          y={yForStop(middlePoint.stopId) + 4}
                          textAnchor="middle"
                          style={{ fill: lockedColor, fontSize: '12px', fontWeight: 800 }}
                        >
                          {assignment.mediatorCount}
                        </text>
                      </g>
                    )
                  })}
                  {runDraftSegment ? (
                    <g>
                      <polyline
                        points={visiblePoints
                          .filter(
                            (point) =>
                              point.stopIndex >= runDraftSegment.startIndex &&
                              point.stopIndex <= runDraftSegment.endIndex,
                          )
                          .map((point) => `${xForMinute(point.minute)},${yForStop(point.stopId)}`)
                          .join(' ')}
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth={Math.max(11, lineWeight * 3.8)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.85}
                      />
                      <polyline
                        points={visiblePoints
                          .filter(
                            (point) =>
                              point.stopIndex >= runDraftSegment.startIndex &&
                              point.stopIndex <= runDraftSegment.endIndex,
                          )
                          .map((point) => `${xForMinute(point.minute)},${yForStop(point.stopId)}`)
                          .join(' ')}
                        fill="none"
                        stroke={draftColor}
                        strokeWidth={Math.max(8, lineWeight * 3)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.94}
                      />
                    </g>
                  ) : null}
                  <polyline
                    points={points}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={hitAreaWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="service-run-hitbox"
                    onClick={() => toggleRunSelection(run.id)}
                  />
                  <polyline
                    points={points}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isActive ? lineWeight + 1.6 : isSelected ? lineWeight + 0.8 : lineWeight}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={isActive ? 1 : isSelected ? 0.86 : 0.48}
                    className={`service-run-line ${isSelected ? 'is-selected' : ''} ${isActive ? 'is-active' : ''}`}
                    onClick={() => toggleRunSelection(run.id)}
                  />
                  {fromPrimaryTerminus ? (
                    <circle
                      cx={xForMinute(visiblePoints[0].minute)}
                      cy={yForStop(visiblePoints[0].stopId)}
                      r={isActive ? 5 : isSelected ? 4 : 3}
                      fill={strokeColor}
                    />
                  ) : (
                    <rect
                      x={xForMinute(visiblePoints[0].minute) - (isActive ? 4.5 : isSelected ? 4 : 3)}
                      y={yForStop(visiblePoints[0].stopId) - (isActive ? 4.5 : isSelected ? 4 : 3)}
                      width={isActive ? 9 : isSelected ? 8 : 6}
                      height={isActive ? 9 : isSelected ? 8 : 6}
                      transform={`rotate(45 ${xForMinute(visiblePoints[0].minute)} ${yForStop(visiblePoints[0].stopId)})`}
                      fill={strokeColor}
                    />
                  )}

                  {isSelected
                    ? visiblePoints.map((point) => {
                        const pointX = xForMinute(point.minute)
                        const pointY = yForStop(point.stopId)
                        const pointIndex = point.stopIndex
                        const placement = timeBubblePlacements.get(`${run.id}-${point.stopId}`)
                        const pillCenterX = placement?.pillCenterX ?? pointX
                        const pillCenterY = placement?.pillCenterY ?? pointY
                        const leaderEndY = placement?.leaderEndY ?? pointY
                        const isDraftStart =
                          isActive && segmentDraftStartStopId === point.stopId
                        const isDraftEnd =
                          isActive && segmentDraftEndStopId === point.stopId
                        const isDraftPoint =
                          isActive &&
                          draftSegment !== null &&
                          pointIndex >= draftSegment.startIndex &&
                          pointIndex <= draftSegment.endIndex
                        const pillFill = isDraftStart || isDraftEnd || isDraftPoint
                          ? draftColor
                          : 'rgba(255, 255, 255, 0.94)'
                        const pillStroke = isDraftStart || isDraftEnd
                          ? '#ffffff'
                          : isDraftPoint
                            ? '#ffd4d9'
                            : `${strokeColor}66`
                        const leaderStroke = isDraftStart || isDraftEnd || isDraftPoint
                          ? `${draftColor}BB`
                          : isActive
                            ? 'rgba(45, 52, 60, 0.45)'
                            : `${strokeColor}99`

                        return (
                          <g key={`${run.id}-${point.stopId}`}>
                            <line
                              x1={pointX}
                              y1={pointY}
                              x2={pillCenterX}
                              y2={leaderEndY}
                              className="service-time-pill-leader"
                              style={{ stroke: leaderStroke }}
                            />
                            <rect
                              x={pillCenterX - timePillWidth / 2}
                              y={pillCenterY - timePillHeight / 2}
                              width={timePillWidth}
                              height={timePillHeight}
                              rx={timePillHeight / 2}
                              className="service-time-pill-bg"
                              style={{
                                fill: pillFill,
                                stroke: pillStroke,
                                strokeWidth: isDraftStart || isDraftEnd ? 2.2 : 1.2,
                                cursor: 'pointer',
                              }}
                              onClick={() => handleTimeBubbleClick(run, point.stopId)}
                            />
                            <text
                              x={pillCenterX}
                              y={pillCenterY + timePillFontSize / 3}
                              textAnchor="middle"
                              className="service-time-pill-text"
                              style={{
                                fontSize: `${timePillFontSize}px`,
                                fill:
                                  isDraftStart || isDraftEnd || isDraftPoint
                                    ? '#ffffff'
                                    : '#1f2933',
                                cursor: 'pointer',
                                fontWeight: isDraftStart || isDraftEnd ? 900 : 800,
                              }}
                              onClick={() => handleTimeBubbleClick(run, point.stopId)}
                            >
                              {formatMinute(point.minute)}
                            </text>
                          </g>
                        )
                      })
                    : null}

                </g>
              )
            })}
            </svg>
          </div>

          <div className="service-stop-rail service-stop-rail--right" style={{ height: `${graphViewportHeight}px` }}>
            {graphStops.map((stop) => (
              <div
                key={`${stop.id}-right`}
                className={`service-stop-rail-label service-stop-rail-label--right ${stop.id === selectedStop.id ? 'is-highlighted' : ''}`}
                style={{
                  top: `${yForStop(stop.id)}px`,
                  fontSize: `${stopLabelFontSize}px`,
                }}
              >
                {stop.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="service-bottom-grid">
        {selectedRun ? (
          <div className="service-assignment-box">
            <div className="service-side-header">
              <strong>Réserver ce trajet</strong>
              <p className="muted">
                {selectedRun.vehicleLabel} {formatMinute(selectedRun.startMinute)} -{' '}
                {getRunDirectionLabel(selectedRun, currentLine)}
              </p>
            </div>

            <div className="service-tab-row">
              <button
                type="button"
                className={`button-secondary ${plannerTab === 'reserve' ? 'is-active' : ''}`}
                onClick={() => setPlannerTab('reserve')}
              >
                Reservation
              </button>
              <button
                type="button"
                className={`button-secondary ${plannerTab === 'recap' ? 'is-active' : ''}`}
                onClick={() => setPlannerTab('recap')}
              >
                Recap agent
              </button>
            </div>

            {plannerTab === 'reserve' ? (
              <>
                <div className="service-selected-summary">
                  <div className="detail-row">
                    <span>Direction</span>
                    <strong>{getRunDirectionLabel(selectedRun, currentLine)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Course</span>
                    <strong>
                      {getSegmentWindow(
                        selectedRun,
                        currentLine,
                        selectedRun.path[0],
                        selectedRun.path[selectedRun.path.length - 1],
                      )}
                    </strong>
                  </div>
                  <div className="detail-row">
                    <span>Passage a {selectedStop.label}</span>
                    <strong>
                      {(() => {
                        const minute = getArrivalMinute(selectedRun, selectedStop.id)
                        return minute === null ? '--:--' : formatMinute(minute)
                      })()}
                    </strong>
                  </div>
                </div>

                <div className="service-selected-summary">
                  <div className="detail-row">
                    <span>Selection de troncon</span>
                    <strong>
                      {draftSegment
                        ? getSegmentWindow(
                            selectedRun,
                            currentLine,
                            draftSegment.startStopId,
                            draftSegment.endStopId,
                          )
                        : segmentDraftStartStopId
                          ? 'Choisis maintenant le second horaire.'
                          : 'Clique deux bulles horaires sur la course active.'}
                    </strong>
                  </div>
                  <div className="detail-row">
                    <span>Point de depart</span>
                    <strong>
                      {segmentDraftStartStopId
                        ? currentLine.stops.find((stop) => stop.id === segmentDraftStartStopId)
                            ?.label ?? segmentDraftStartStopId
                        : '--'}
                    </strong>
                  </div>
                  <div className="detail-row">
                    <span>Point d'arrivee</span>
                    <strong>
                      {segmentDraftEndStopId
                        ? currentLine.stops.find((stop) => stop.id === segmentDraftEndStopId)
                            ?.label ?? segmentDraftEndStopId
                        : '--'}
                    </strong>
                  </div>
                </div>

                <div className="service-assignment-actions">
                  <div className="field">
                    <label htmlFor="segment-mediator-count">Nombre de mediateurs</label>
                    <select
                      id="segment-mediator-count"
                      value={segmentMediatorCount}
                      onChange={(event) => {
                        const nextCount = Number(event.target.value)
                        setSegmentMediatorCount(nextCount)
                        setSelectedMediatorIds((current) => current.slice(0, nextCount))
                      }}
                    >
                      <option value={1}>1 mediateur</option>
                      <option value={2}>2 mediateurs</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    className="button"
                    disabled={!draftSegment || assignmentsSaving}
                    onClick={() => void assignMediatorSegment()}
                  >
                    <UserPlus size={18} />
                    {assignmentsSaving ? 'Enregistrement...' : 'Réserver ce trajet'}
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      setSegmentDraftStartStopId('')
                      setSegmentDraftEndStopId('')
                      setSelectedMediatorIds([])
                    }}
                  >
                    Effacer la selection
                  </button>
                </div>

                <div className="service-selected-summary">
                  <div className="detail-row">
                    <span>Agents choisis</span>
                    <strong>
                      {selectedMediatorIds.length}/{segmentMediatorCount} selectionne(s)
                    </strong>
                  </div>
                  <div className="service-mediator-pick-grid">
                    {mediators.map((mediator) => {
                      const isChosen = selectedMediatorIds.includes(mediator.id)

                      return (
                        <button
                          key={mediator.id}
                          type="button"
                          className={`service-mediator-pick ${isChosen ? 'is-selected' : ''}`}
                          disabled={!isChosen && selectedMediatorIds.length >= segmentMediatorCount}
                          onClick={() => toggleMediatorSelection(mediator.id)}
                        >
                          <strong>{mediator.fullName}</strong>
                          <span>{mediator.preferredWindow}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="service-segment-list">
                  {assignmentsLoading ? (
                    <article className="service-segment-card">
                      <p className="muted">Chargement des reservations du scenario...</p>
                    </article>
                  ) : selectedRunAssignments.length ? (
                    selectedRunAssignments.map((assignment) => (
                      <article key={assignment.id} className="service-segment-card">
                        <div className="service-segment-head">
                          <strong>Troncon reserve</strong>
                          <span className="status-chip ready">
                            {assignment.mediatorCount} mediateur(s)
                          </span>
                        </div>
                        <p className="muted">
                          {getSegmentWindow(
                            selectedRun,
                            currentLine,
                            assignment.startStopId,
                            assignment.endStopId,
                          )}
                        </p>
                        <div className="service-assignment-pill">
                          {assignment.mediatorIds.map((mediatorId) => {
                            const mediator = mediators.find((item) => item.id === mediatorId)
                            return (
                              <span key={`${assignment.id}-${mediatorId}`} className="pill">
                                <MapPinned size={16} />
                                {mediator?.fullName ?? mediatorId}
                              </span>
                            )
                          })}
                          <button
                            type="button"
                            className="button-ghost service-remove-button"
                            onClick={() => void removeAssignment(assignment.id)}
                          >
                            <X size={16} />
                            Retirer
                          </button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <article className="service-segment-card">
                      <div className="service-segment-head">
                        <strong>Aucun troncon reserve</strong>
                        <span className="status-chip issue">Libre</span>
                      </div>
                      <p className="muted">
                        Clique deux bulles horaires de la course active pour definir le debut et
                        la fin du trajet a couvrir.
                      </p>
                    </article>
                  )}
                </div>

                {plannerMessage ? <div className="feedback success">{plannerMessage}</div> : null}
              </>
            ) : (
              <>
                <div className="service-selected-summary">
                  <div className="field">
                    <label htmlFor="recap-mediator-select">Agent</label>
                    <select
                      id="recap-mediator-select"
                      value={effectiveRecapMediatorId}
                      onChange={(event) => setRecapMediatorId(event.target.value)}
                    >
                      {mediators.map((mediator) => (
                        <option key={mediator.id} value={mediator.id}>
                          {mediator.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="detail-row">
                    <span>Scenario</span>
                    <strong>{scenarioDefinition.label}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Temps cumule</span>
                    <strong>{Math.floor(recapTotalMinutes / 60)}h {String(recapTotalMinutes % 60).padStart(2, '0')}</strong>
                  </div>
                </div>

                <div className="service-segment-list">
                  {recapAssignments.length ? (
                    recapAssignments.map((assignment) => {
                      const run = scenarioRuns.find((item) => item.id === assignment.runId)
                      return (
                        <article key={`recap-${assignment.id}`} className="service-segment-card">
                          <div className="service-segment-head">
                            <strong>{run?.vehicleLabel ?? 'Service'} {formatMinute(assignment.startMinute)}</strong>
                            <span className="status-chip ready">
                              {assignment.mediatorCount} mediateur(s)
                            </span>
                          </div>
                          <p className="muted">{run ? getRunDirectionLabel(run, currentLine) : 'Direction'}</p>
                          <p className="muted">
                            {run
                              ? getSegmentWindow(
                                  run,
                                  currentLine,
                                  assignment.startStopId,
                                  assignment.endStopId,
                                )
                              : `${formatMinute(assignment.startMinute)} -> ${formatMinute(assignment.endMinute)}`}
                          </p>
                        </article>
                      )
                    })
                  ) : (
                    <article className="service-segment-card">
                      <div className="service-segment-head">
                        <strong>Aucun service enregistre</strong>
                        <span className="status-chip issue">Vide</span>
                      </div>
                      <p className="muted">
                        {recapMediator
                          ? `${recapMediator.fullName} n a encore aucune reservation sur ce scenario.`
                          : 'Aucun agent disponible.'}
                      </p>
                    </article>
                  )}
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
