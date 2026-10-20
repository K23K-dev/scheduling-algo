import { expect, test } from 'vitest'
import { simulate } from './simulator'
import {
  GENERATOR_VERSION,
  RULES_VERSION,
  TIMELINE_LENGTH,
  type BoundarySnapshot,
  type Problem,
  type ProcessId,
  type ProcessInput,
  type ReferenceCell,
  type SimulationEvent,
} from './types'

function problem(processes: readonly ProcessInput[]): Problem {
  return {
    seed: 0,
    rulesVersion: RULES_VERSION,
    generatorVersion: GENERATOR_VERSION,
    settings: { algorithm: 'fcfs-course' },
    processes,
  }
}

// Fixed arithmetic cases exercise short/long work, delayed arrivals, and numeric
// ID ordering without depending on the future practice-problem generator.
const workloads = Array.from({ length: 48 }, (_, index) => {
  const ids: readonly ProcessId[] = ['P10', 'P2', 'P1', 'P7']
  const arrivals = [0, 0, 1, 3, 8, 25, 39, 40, 45]
  const processes = Array.from({ length: 1 + (index % 4) }, (_, offset) => ({
    id: ids[(index + offset) % ids.length],
    arrival:
      index < 24
        ? (index + offset * 2) % 4
        : arrivals[(index + offset * 3) % arrivals.length],
    cpu1: 1 + ((index * 3 + offset) % (index < 24 ? 4 : 12)),
    io: 1 + ((index + offset * 2) % (index < 24 ? 4 : 11)),
    cpu2: 1 + ((index * 2 + offset * 3) % (index < 24 ? 3 : 9)),
  }))
  return { index, problem: problem(processes) }
})

function workBefore(row: readonly ReferenceCell[], id: ProcessId, time: number) {
  return row.slice(0, time).filter((cell) => cell === id).length
}

function eventsOf<Type extends SimulationEvent['type']>(
  boundary: BoundarySnapshot,
  type: Type,
): Extract<SimulationEvent, { type: Type }>[] {
  return boundary.events.filter(
    (event): event is Extract<SimulationEvent, { type: Type }> => event.type === type,
  )
}

test.each(workloads)('FCFS conserves work and records a consistent history: case $index', ({ problem }) => {
  const result = simulate(problem)
  const { timeline, boundaries } = result
  const inputs = new Map(problem.processes.map((input) => [input.id, input]))
  const readyAt = new Map<ProcessId, number>()
  const requestedAt = new Map<ProcessId, number>()
  const startedAt = new Map<ProcessId, number>()
  const completedAt = new Map<ProcessId, number>()
  const requests: ProcessId[] = []
  const starts: ProcessId[] = []

  expect(timeline.cpu).toHaveLength(TIMELINE_LENGTH)
  expect(timeline.io).toHaveLength(TIMELINE_LENGTH)
  expect(boundaries.map(({ time }) => time)).toEqual(
    Array.from({ length: TIMELINE_LENGTH + 1 }, (_, time) => time),
  )

  for (const boundary of boundaries) {
    const { time } = boundary
    const previousCpu = timeline.cpu[time - 1]
    const previousIo = timeline.io[time - 1]
    const cpuCompletions = eventsOf(boundary, 'cpu-burst-completed')
    const ioCompletions = eventsOf(boundary, 'io-completed')
    const newlyReady = eventsOf(boundary, 'became-ready')
    const dispatches = eventsOf(boundary, 'cpu-dispatched')
    const ioStarts = eventsOf(boundary, 'io-started')

    expect(eventsOf(boundary, 'cpu-preempted')).toEqual([])
    expect(eventsOf(boundary, 'quantum-expired')).toEqual([])
    expect(cpuCompletions.length).toBeLessThanOrEqual(1)
    expect(ioCompletions.length).toBeLessThanOrEqual(1)
    expect(dispatches.length).toBeLessThanOrEqual(1)
    expect(ioStarts.length).toBeLessThanOrEqual(1)
    expect(newlyReady.map(({ processId }) => processId)).toEqual(
      newlyReady.map(({ processId }) => processId).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
    )

    for (const event of newlyReady) readyAt.set(event.processId, time)
    for (const event of eventsOf(boundary, 'io-requested')) {
      expect(requestedAt.has(event.processId)).toBe(false)
      requestedAt.set(event.processId, time)
      requests.push(event.processId)
    }
    for (const event of ioStarts) {
      expect(startedAt.has(event.processId)).toBe(false)
      startedAt.set(event.processId, time)
      starts.push(event.processId)
    }
    for (const event of eventsOf(boundary, 'process-completed')) {
      expect(completedAt.has(event.processId)).toBe(false)
      completedAt.set(event.processId, time)
    }
    expect(starts).toEqual(requests.slice(0, starts.length))

    // Completion bookkeeping must precede newly-ready events and dispatch.
    const completionTypes = new Set([
      'cpu-burst-completed', 'io-requested', 'io-completed', 'process-completed',
    ])
    const firstReady = boundary.events.findIndex((event) => event.type === 'became-ready')
    const firstDispatch = boundary.events.findIndex(
      (event) => event.type === 'cpu-dispatched' || event.type === 'io-started',
    )
    boundary.events.forEach((event, index) => {
      if (completionTypes.has(event.type)) {
        if (firstReady !== -1) expect(index).toBeLessThan(firstReady)
        if (firstDispatch !== -1) expect(index).toBeLessThan(firstDispatch)
      }
      if (event.type === 'became-ready' && firstDispatch !== -1) {
        expect(index).toBeLessThan(firstDispatch)
      }
    })

    expect(new Set(boundary.processes.map(({ processId }) => processId))).toEqual(
      new Set(inputs.keys()),
    )
    expect(boundary.processes).toHaveLength(inputs.size)
    for (const state of boundary.processes) {
      const input = inputs.get(state.processId)!
      const cpu = workBefore(timeline.cpu, input.id, time)
      const io = workBefore(timeline.io, input.id, time)
      const cpu1FinishedNow = previousCpu === input.id && cpu === input.cpu1
      const cpu2FinishedNow = previousCpu === input.id && cpu === input.cpu1 + input.cpu2
      const ioFinishedNow = previousIo === input.id && io === input.io
      const processCpuEvents = cpuCompletions.filter(({ processId }) => processId === input.id)
      expect(processCpuEvents.map(({ burst }) => burst)).toEqual(
        cpu1FinishedNow ? [1] : cpu2FinishedNow ? [2] : [],
      )
      expect(eventsOf(boundary, 'io-requested').some(({ processId }) => processId === input.id))
        .toBe(cpu1FinishedNow)
      expect(eventsOf(boundary, 'process-completed').some(({ processId }) => processId === input.id))
        .toBe(cpu2FinishedNow)
      expect(ioCompletions.some(({ processId }) => processId === input.id)).toBe(ioFinishedNow)
      expect(newlyReady.filter(({ processId }) => processId === input.id).map(({ reason }) => reason))
        .toEqual(time === input.arrival ? ['arrival'] : ioFinishedNow ? ['io-completion'] : [])
      expect(cpu).toBeLessThanOrEqual(input.cpu1 + input.cpu2)
      expect(io).toBeLessThanOrEqual(input.io)
      if (time < input.arrival) {
        expect(state.status).toBe('not-arrived')
        expect(cpu + io).toBe(0)
      } else {
        expect(state.status).not.toBe('not-arrived')
      }

      switch (state.status) {
        case 'not-arrived':
          expect(time).toBeLessThan(input.arrival)
          break
        case 'ready':
        case 'running':
          expect(state.remainingCpu).toBeGreaterThan(0)
          expect(state.remainingCpu).toBe(
            state.burst === 1 ? input.cpu1 - cpu : input.cpu1 + input.cpu2 - cpu,
          )
          expect(io).toBe(state.burst === 1 ? 0 : input.io)
          expect(state.enteredAt).toBe(readyAt.get(input.id))
          if (state.status === 'running') expect(state.quantumRemaining).toBeNull()
          break
        case 'waiting-for-io':
          expect(cpu).toBe(input.cpu1)
          expect(io).toBe(0)
          expect(state.remainingIo).toBe(input.io)
          expect(state.requestedAt).toBe(requestedAt.get(input.id))
          break
        case 'performing-io':
          expect(cpu).toBe(input.cpu1)
          expect(state.remainingIo).toBe(input.io - io)
          expect(state.remainingIo).toBeGreaterThan(0)
          expect(state.startedAt).toBe(startedAt.get(input.id))
          break
        case 'completed':
          expect(cpu).toBe(input.cpu1 + input.cpu2)
          expect(io).toBe(input.io)
          expect(state.completedAt).toBe(completedAt.get(input.id))
          break
      }
    }

    const readyStates = boundary.processes.filter((state) => state.status === 'ready')
    const waitingStates = boundary.processes.filter((state) => state.status === 'waiting-for-io')
    expect(boundary.readyQueue).toHaveLength(readyStates.length)
    expect(new Set(boundary.readyQueue.map(({ processId }) => processId))).toEqual(
      new Set(readyStates.map(({ processId }) => processId)),
    )
    for (const entry of boundary.readyQueue) expect(entry.enteredAt).toBe(readyAt.get(entry.processId))
    expect(boundary.readyQueue).toEqual([...boundary.readyQueue].sort(
      (a, b) => a.enteredAt - b.enteredAt || Number(a.processId.slice(1)) - Number(b.processId.slice(1)),
    ))
    expect(boundary.ioQueue).toEqual(requests.slice(starts.length).map((processId) => ({
      processId, requestedAt: requestedAt.get(processId),
    })))
    expect(new Set(boundary.ioQueue.map(({ processId }) => processId))).toEqual(
      new Set(waitingStates.map(({ processId }) => processId)),
    )

    if (boundary.kind === 'terminal') {
      expect(time).toBe(TIMELINE_LENGTH)
      expect(dispatches).toEqual([])
      expect(ioStarts).toEqual([])
      expect(eventsOf(boundary, 'resource-idle')).toEqual([])
      expect(boundary).not.toHaveProperty('cpu')
      expect(boundary).not.toHaveProperty('io')
      continue
    }
    expect(time).toBeLessThan(TIMELINE_LENGTH)
    expect(boundary.cpu).toBe(timeline.cpu[time])
    expect(boundary.io).toBe(timeline.io[time])
    if (boundary.cpu !== 'idle') expect(boundary.cpu).not.toBe(boundary.io)
    const idleEvents = eventsOf(boundary, 'resource-idle')
    for (const resource of ['cpu', 'io'] as const) {
      expect(idleEvents.filter((event) => event.resource === resource).map(({ reason }) => reason))
        .toEqual(boundary[resource] !== 'idle'
          ? []
          : [completedAt.size === inputs.size
              ? 'all-completed'
              : resource === 'cpu' ? 'no-ready-process' : 'no-io-request'])
    }
    expect(boundary.processes.filter((state) => state.status === 'running').map(({ processId }) => processId))
      .toEqual(boundary.cpu === 'idle' ? [] : [boundary.cpu])
    expect(boundary.processes.filter((state) => state.status === 'performing-io').map(({ processId }) => processId))
      .toEqual(boundary.io === 'idle' ? [] : [boundary.io])
    if (boundary.cpu === 'idle') expect(readyStates).toEqual([])
    if (boundary.io === 'idle') expect(waitingStates).toEqual([])
    if (time > 0 && previousCpu !== 'idle' && cpuCompletions.length === 0) {
      expect(boundary.cpu).toBe(previousCpu)
      expect(dispatches).toEqual([])
    } else {
      expect(dispatches).toHaveLength(boundary.cpu === 'idle' ? 0 : 1)
    }
    if (time > 0 && previousIo !== 'idle' && ioCompletions.length === 0) {
      expect(boundary.io).toBe(previousIo)
      expect(ioStarts).toEqual([])
    } else {
      expect(ioStarts).toHaveLength(boundary.io === 'idle' ? 0 : 1)
    }
    for (const event of dispatches) {
      expect(event.processId).toBe(boundary.cpu)
      expect(event.criterion).toBe('original-launch-order')
      const eligible = boundary.processes.filter(
        (state) => state.status === 'ready' || state.status === 'running',
      )
      expect(event.candidates).toHaveLength(eligible.length)
      expect(new Set(event.candidates.map(({ processId }) => processId))).toEqual(
        new Set(eligible.map(({ processId }) => processId)),
      )
      for (const candidate of event.candidates) {
        const state = eligible.find(({ processId }) => processId === candidate.processId)!
        expect(candidate.burst).toBe(state.burst)
        expect(candidate.remainingCpu).toBe(state.remainingCpu)
        expect(candidate.enteredAt).toBe(state.enteredAt)
      }
      const launchOrder = event.candidates.map(({ processId }) => inputs.get(processId)!)
        .sort((a, b) => a.arrival - b.arrival || Number(a.id.slice(1)) - Number(b.id.slice(1)))
      expect(event.processId).toBe(launchOrder[0].id)
    }
  }

  const allCompleted = completedAt.size === inputs.size
  expect(result.status).toBe(allCompleted ? 'complete' : 'limit-reached')
  expect(result.completionTime).toBe(allCompleted ? Math.max(...completedAt.values()) : null)
  if (result.status === 'complete') {
    expect(timeline.cpu.slice(result.completionTime).every((cell) => cell === 'idle')).toBe(true)
    expect(timeline.io.slice(result.completionTime).every((cell) => cell === 'idle')).toBe(true)
  }
})

function freezeDeep(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  Object.values(value).forEach(freezeDeep)
  Object.freeze(value)
}

function mutableObjects(value: unknown, objects = new Set<object>()): Set<object> {
  if (typeof value !== 'object' || value === null) return objects
  if (!Object.isFrozen(value)) objects.add(value)
  for (const child of Object.values(value)) mutableObjects(child, objects)
  return objects
}

test('simulation is deterministic, accepts frozen inputs, and isolates mutable history', () => {
  const input = problem([
    { id: 'P2', arrival: 0, cpu1: 4, io: 2, cpu2: 3 },
    { id: 'P1', arrival: 0, cpu1: 2, io: 7, cpu2: 2 },
    { id: 'P10', arrival: 1, cpu1: 2, io: 3, cpu2: 1 },
  ])
  const original = JSON.stringify(input)
  freezeDeep(input)
  const first = simulate(input)
  const second = simulate(input)
  expect(JSON.stringify(input)).toBe(original)
  expect(second).toEqual(first)
  expect(first.timeline.cpu).not.toBe(first.timeline.io)

  const secondObjects = mutableObjects(second)
  for (const object of mutableObjects(first)) expect(secondObjects.has(object)).toBe(false)
  const previousSnapshots = new Set<object>()
  for (const boundary of first.boundaries) {
    const objects = mutableObjects(boundary)
    for (const object of objects) {
      expect(previousSnapshots.has(object)).toBe(false)
      previousSnapshots.add(object)
    }
  }
})
