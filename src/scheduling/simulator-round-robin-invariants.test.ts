import { expect, test } from 'vitest'
import { simulate } from './simulator'
import {
  GENERATOR_VERSION, RULES_VERSION, TIMELINE_LENGTH,
  type BoundarySnapshot, type CpuBurst, type Problem, type ProcessId,
  type ReadyQueueEntry, type ReferenceCell, type SimulationEvent,
} from './types'

// Fixed arithmetic workloads cover short/long bursts, out-of-order numeric IDs,
// and arrivals before, at, and beyond the final bookkeeping boundary.
const workloads = Array.from({ length: 30 }, (_, index) => {
  const ids: readonly ProcessId[] = ['P10', 'P2', 'P1', 'P7']
  const arrivals = [0, 0, 1, 3, 8, 25, 39, 40, 45]
  const quantum = [1, 2, 3, 4, 100][index % 5]
  const problem: Problem = {
    seed: index, rulesVersion: RULES_VERSION, generatorVersion: GENERATOR_VERSION,
    settings: { algorithm: 'round-robin', quantum },
    processes: Array.from({ length: 1 + (index % 4) }, (_, offset) => ({
      id: ids[(index + offset) % ids.length],
      arrival: index < 15 ? (index + offset) % 3 : arrivals[(index + offset * 2) % 9],
      cpu1: 1 + ((index * 3 + offset) % 9),
      io: 1 + ((index + offset * 2) % 7),
      cpu2: 1 + ((index * 2 + offset * 3) % 8),
    })),
  }
  return { index, quantum, problem }
})

function workBefore(row: readonly ReferenceCell[], id: ProcessId, time: number) {
  return row.slice(0, time).filter((cell) => cell === id).length
}

function eventsOf<Type extends SimulationEvent['type']>(boundary: BoundarySnapshot, type: Type) {
  return boundary.events.filter(
    (event): event is Extract<SimulationEvent, { type: Type }> => event.type === type,
  )
}

test.each(workloads)('RR conserves work and follows FIFO time slices: case $index', ({ problem, quantum }) => {
  const result = simulate(problem)
  const { timeline, boundaries } = result
  const inputs = new Map(problem.processes.map((input) => [input.id, input]))
  const ready: ReadyQueueEntry[] = []
  const ioQueue: { processId: ProcessId; requestedAt: number }[] = []
  const bursts = new Map<ProcessId, CpuBurst>(problem.processes.map(({ id }) => [id, 1]))
  let running: { processId: ProcessId; quantumRemaining: number } | undefined
  let performingIo: ProcessId | undefined
  expect(timeline.cpu).toHaveLength(TIMELINE_LENGTH)
  expect(timeline.io).toHaveLength(TIMELINE_LENGTH)
  expect(boundaries.map(({ time }) => time)).toEqual(Array.from({ length: 41 }, (_, time) => time))

  for (const boundary of boundaries) {
    const { time } = boundary
    const cpuWork = (id: ProcessId) => workBefore(timeline.cpu, id, time)
    const ioWork = (id: ProcessId) => workBefore(timeline.io, id, time)
    const remaining = (id: ProcessId) => {
      const input = inputs.get(id)!
      return input.cpu1 + (bursts.get(id) === 2 ? input.cpu2 : 0) - cpuWork(id)
    }
    const previousRunning = running
    if (running) running.quantumRemaining--
    const finishedCpu = running && remaining(running.processId) === 0 ? running.processId : undefined
    const expired = running && !finishedCpu && running.quantumRemaining === 0
      ? running.processId : undefined
    const finishedIo = performingIo && ioWork(performingIo) === inputs.get(performingIo)!.io
      ? performingIo : undefined
    expect(eventsOf(boundary, 'cpu-burst-completed')).toEqual(finishedCpu
      ? [{ type: 'cpu-burst-completed', processId: finishedCpu, burst: bursts.get(finishedCpu) }] : [])
    expect(eventsOf(boundary, 'quantum-expired')).toEqual(expired
      ? [{ type: 'quantum-expired', processId: expired, remainingCpu: remaining(expired) }] : [])
    expect(eventsOf(boundary, 'cpu-preempted')).toEqual([])
    expect(eventsOf(boundary, 'io-completed').map(({ processId }) => processId))
      .toEqual(finishedIo ? [finishedIo] : [])
    const requested = finishedCpu && bursts.get(finishedCpu) === 1 ? finishedCpu : undefined
    expect(eventsOf(boundary, 'io-requested').map(({ processId }) => processId))
      .toEqual(requested ? [requested] : [])
    if (requested) ioQueue.push({ processId: requested, requestedAt: time })
    if (finishedCpu || expired) running = undefined
    if (finishedIo) performingIo = undefined

    const newlyReady = problem.processes.filter(({ id, arrival }) => arrival === time || id === finishedIo)
      .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    expect(eventsOf(boundary, 'became-ready')).toEqual(newlyReady.map(({ id }) => ({
      type: 'became-ready', processId: id, reason: id === finishedIo ? 'io-completion' : 'arrival',
    })))
    for (const { id } of newlyReady) {
      if (id === finishedIo) bursts.set(id, 2)
      ready.push({ processId: id, enteredAt: time })
    }
    if (expired) {
      ready.push({ processId: expired, enteredAt: time })
      const expiryIndex = boundary.events.findIndex((event) => event.type === 'quantum-expired')
      boundary.events.forEach((event, index) => {
        if (event.type === 'became-ready') expect(index).toBeLessThan(expiryIndex)
        if (event.type === 'cpu-dispatched') expect(index).toBeGreaterThan(expiryIndex)
      })
    }

    const dispatches = eventsOf(boundary, 'cpu-dispatched')
    const ioStarts = eventsOf(boundary, 'io-started')
    if (time < TIMELINE_LENGTH) {
      const candidates = ready.map((entry) => ({
        ...entry, burst: bursts.get(entry.processId), remainingCpu: remaining(entry.processId),
      }))
      const selected = running ? undefined : ready.shift()
      expect(dispatches).toEqual(selected ? [{
        type: 'cpu-dispatched', processId: selected.processId, burst: bursts.get(selected.processId),
        candidates, criterion: 'fifo-ready-queue',
      }] : [])
      if (selected) running = { processId: selected.processId, quantumRemaining: quantum }
      const ioSelected = performingIo ? undefined : ioQueue.shift()
      expect(ioStarts.map(({ processId }) => processId)).toEqual(ioSelected ? [ioSelected.processId] : [])
      if (ioSelected) performingIo = ioSelected.processId
      expect(boundary.kind).toBe('interval-start')
      if (boundary.kind !== 'interval-start') throw new Error('Expected an interval snapshot.')
      expect(boundary.cpu).toBe(running?.processId ?? 'idle')
      expect(boundary.io).toBe(performingIo ?? 'idle')
      expect(timeline.cpu[time]).toBe(boundary.cpu)
      expect(timeline.io[time]).toBe(boundary.io)
      if (running) {
        const id = running.processId
        const input = inputs.get(id)!
        expect(id).not.toBe(performingIo)
        expect(time).toBeGreaterThanOrEqual(input.arrival)
        expect(ioWork(id)).toBe(cpuWork(id) < input.cpu1 ? 0 : input.io)
      } else expect(ready).toEqual([])
      if (performingIo) {
        expect(cpuWork(performingIo)).toBe(inputs.get(performingIo)!.cpu1)
        expect(ioWork(performingIo)).toBeLessThan(inputs.get(performingIo)!.io)
      } else expect(ioQueue).toEqual([])
      // New arrivals or I/O returns cannot interrupt an unexpired CPU slice.
      if (previousRunning && !finishedCpu && !expired) {
        expect(boundary.cpu).toBe(previousRunning.processId)
        expect(dispatches).toEqual([])
      }
    } else {
      expect(boundary.kind).toBe('terminal')
      expect(dispatches).toEqual([])
      expect(ioStarts).toEqual([])
      expect(eventsOf(boundary, 'resource-idle')).toEqual([])
      expect(boundary).not.toHaveProperty('cpu')
      expect(boundary).not.toHaveProperty('io')
    }

    expect(boundary.readyQueue).toEqual(ready)
    expect(boundary.ioQueue).toEqual(ioQueue)
    expect(boundary.processes.filter(({ status }) => status === 'running').map(({ processId }) => processId))
      .toEqual(running ? [running.processId] : [])
    expect(boundary.processes.filter(({ status }) => status === 'ready').map(({ processId }) => processId).sort())
      .toEqual(ready.map(({ processId }) => processId).sort())
    for (const state of boundary.processes) {
      const input = inputs.get(state.processId)!
      expect(cpuWork(input.id)).toBeLessThanOrEqual(input.cpu1 + input.cpu2)
      expect(ioWork(input.id)).toBeLessThanOrEqual(input.io)
      if (state.status === 'running' || state.status === 'ready') {
        expect(state.burst).toBe(bursts.get(input.id))
        expect(state.remainingCpu).toBe(remaining(input.id))
        expect(state.remainingCpu).toBeGreaterThan(0)
      }
      if (state.status === 'running') expect(state.quantumRemaining).toBe(running?.quantumRemaining)
      if (state.status === 'waiting-for-io' || state.status === 'performing-io') {
        expect(cpuWork(input.id)).toBe(input.cpu1)
        expect(state.remainingIo).toBe(input.io - ioWork(input.id))
        expect(running?.processId).not.toBe(input.id)
      }
      if (state.status === 'completed') {
        expect(cpuWork(input.id)).toBe(input.cpu1 + input.cpu2)
        expect(ioWork(input.id)).toBe(input.io)
      }
    }
  }
  const finished = problem.processes.every(({ id, cpu1, cpu2, io }) =>
    workBefore(timeline.cpu, id, 40) === cpu1 + cpu2 && workBefore(timeline.io, id, 40) === io)
  expect(result.status).toBe(finished ? 'complete' : 'limit-reached')
  if (result.status === 'complete') {
    const lastWork = Math.max(timeline.cpu.findLastIndex((cell) => cell !== 'idle'),
      timeline.io.findLastIndex((cell) => cell !== 'idle'))
    expect(result.completionTime).toBe(lastWork + 1)
  } else expect(result.completionTime).toBeNull()
})

function freezeDeep(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  Object.values(value).forEach(freezeDeep)
  Object.freeze(value)
}

function mutableObjects(value: unknown, found = new Set<object>()): Set<object> {
  if (typeof value !== 'object' || value === null) return found
  if (!Object.isFrozen(value)) found.add(value)
  for (const child of Object.values(value)) mutableObjects(child, found)
  return found
}

test('RR accepts frozen inputs, is deterministic, and isolates mutable snapshots', () => {
  const problem = workloads[7].problem
  const original = JSON.stringify(problem)
  freezeDeep(problem)
  const first = simulate(problem)
  const second = simulate(problem)
  expect(JSON.stringify(problem)).toBe(original)
  expect(second).toEqual(first)
  expect(first.timeline.cpu).not.toBe(first.timeline.io)
  const secondObjects = mutableObjects(second)
  for (const object of mutableObjects(first)) expect(secondObjects.has(object)).toBe(false)
  const previousSnapshots = new Set<object>()
  for (const boundary of first.boundaries) {
    for (const object of mutableObjects(boundary)) {
      expect(previousSnapshots.has(object)).toBe(false)
      previousSnapshots.add(object)
    }
  }
})
