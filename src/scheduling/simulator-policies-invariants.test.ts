import { expect, test } from 'vitest'
import { simulate } from './simulator'
import {
  GENERATOR_VERSION,
  RULES_VERSION,
  type CpuCandidate,
  type Problem,
  type ProcessId,
  type ProcessInput,
  type SchedulingSettings,
} from './types'

const policies = [
  { algorithm: 'sjf' },
  { algorithm: 'srtf' },
  { algorithm: 'priority', mode: 'non-preemptive' },
  { algorithm: 'priority', mode: 'preemptive' },
] as const satisfies readonly SchedulingSettings[]

function problem(index: number, settings: SchedulingSettings): Problem {
  // Varied deterministic workloads, including simultaneous events, staggered
  // arrivals, equal lengths/priorities, numeric IDs, and overflow.
  const processes = (['P10', 'P2', 'P1'] as const).map((id, offset) => ({
    id,
    arrival: (index * (offset + 2) + offset) % 6,
    cpu1: 1 + (index * 3 + offset * 5) % 9,
    io: 1 + (index + offset * 3) % 6,
    cpu2: 1 + (index * 5 + offset * 2) % 8,
    priority: (index + offset * 2) % 5 - 2,
  }))
  return {
    seed: index, rulesVersion: RULES_VERSION, generatorVersion: GENERATOR_VERSION,
    processes, settings,
  }
}

function rank(candidate: CpuCandidate, settings: SchedulingSettings): number {
  return settings.algorithm === 'priority' ? candidate.priority! : candidate.remainingCpu
}

function compare(a: CpuCandidate, b: CpuCandidate, settings: SchedulingSettings): number {
  return rank(a, settings) - rank(b, settings) ||
    a.enteredAt - b.enteredAt ||
    Number(a.processId.slice(1)) - Number(b.processId.slice(1))
}

test.each(policies)(
  'conserves work, follows FIFO I/O, and records policy decisions ($algorithm)',
  (settings) => {
    for (let index = 0; index < 24; index++) {
      const input = problem(index, settings)
      const result = simulate(input)
      const inputs = new Map<ProcessId, ProcessInput>(input.processes.map((item) => [item.id, item]))
      const readyQueue: ProcessId[] = []
      const ioQueue: ProcessId[] = []
      const readyAt = new Map<ProcessId, number>()
      const requestedAt = new Map<ProcessId, number>()
      const completedAt = new Map<ProcessId, number>()
      const preemptive = settings.algorithm === 'srtf' ||
        (settings.algorithm === 'priority' && settings.mode === 'preemptive')
      expect(result.timeline.cpu).toHaveLength(40)
      expect(result.timeline.io).toHaveLength(40)
      expect(result.boundaries).toHaveLength(41)

      for (const [time, boundary] of result.boundaries.entries()) {
        expect(boundary.time).toBe(time)
        for (const event of boundary.events) {
          switch (event.type) {
            case 'became-ready':
              readyQueue.push(event.processId)
              readyAt.set(event.processId, time)
              break
            case 'cpu-preempted': {
              expect(preemptive).toBe(true)
              expect(time).toBeGreaterThan(0)
              const prior = result.boundaries[time - 1].processes
                .find(({ processId }) => processId === event.running.processId)!
              expect(prior.status).toBe('running')
              if (prior.status !== 'running') throw new Error('Preemption needs a running process.')
              expect(event.running).toEqual({
                processId: prior.processId, burst: prior.burst,
                remainingCpu: prior.remainingCpu - 1, enteredAt: prior.enteredAt,
                priority: inputs.get(prior.processId)!.priority,
              })
              expect(rank(event.challenger, settings)).toBeLessThan(rank(event.running, settings))
              expect(readyQueue).toContain(event.challenger.processId)
              expect(event.reason).toBe(settings.algorithm === 'srtf'
                ? 'shorter-remaining-burst' : 'higher-priority')
              readyQueue.push(event.running.processId)
              readyAt.set(event.running.processId, time)
              break
            }
            case 'cpu-dispatched': {
              expect(time).toBeLessThan(40)
              expect(event.candidates.map(({ processId }) => processId)).toEqual(readyQueue)
              expect(event.processId).toBe(
                [...event.candidates].sort((a, b) => compare(a, b, settings))[0].processId,
              )
              expect(event.criterion).toBe(settings.algorithm === 'sjf'
                ? 'shortest-current-burst'
                : settings.algorithm === 'srtf' ? 'shortest-remaining-burst' : 'highest-priority')
              for (const candidate of event.candidates) {
                const state = boundary.processes
                  .find(({ processId }) => processId === candidate.processId)!
                expect(state.status === 'running' || state.status === 'ready').toBe(true)
                if (state.status !== 'running' && state.status !== 'ready') {
                  throw new Error('Dispatch candidates must be ready or running.')
                }
                expect(candidate).toEqual({
                  processId: state.processId, burst: state.burst,
                  remainingCpu: state.remainingCpu, enteredAt: state.enteredAt,
                  priority: inputs.get(state.processId)!.priority,
                })
              }
              readyQueue.splice(readyQueue.indexOf(event.processId), 1)
              break
            }
            case 'io-requested':
              ioQueue.push(event.processId)
              requestedAt.set(event.processId, time)
              break
            case 'io-started':
              expect(time).toBeLessThan(40)
              expect(event.processId).toBe(ioQueue.shift())
              break
            case 'process-completed':
              expect(completedAt.has(event.processId)).toBe(false)
              completedAt.set(event.processId, time)
              break
            case 'quantum-expired':
              throw new Error('These policies do not use time slices.')
          }
        }

        expect(boundary.readyQueue).toEqual(readyQueue.map((processId) => ({
          processId, enteredAt: readyAt.get(processId),
        })))
        expect(boundary.ioQueue).toEqual(ioQueue.map((processId) => ({
          processId, requestedAt: requestedAt.get(processId),
        })))
        expect(new Set(boundary.processes.filter(({ status }) => status === 'ready')
          .map(({ processId }) => processId))).toEqual(new Set(readyQueue))
        expect(new Set(boundary.processes.filter(({ status }) => status === 'waiting-for-io')
          .map(({ processId }) => processId))).toEqual(new Set(ioQueue))

        for (const state of boundary.processes) {
          const item = inputs.get(state.processId)!
          const cpu = result.timeline.cpu.slice(0, time).filter((id) => id === item.id).length
          const io = result.timeline.io.slice(0, time).filter((id) => id === item.id).length
          expect(cpu).toBeLessThanOrEqual(item.cpu1 + item.cpu2)
          expect(io).toBeLessThanOrEqual(item.io)
          if (time < item.arrival) {
            expect(state.status).toBe('not-arrived')
            expect(cpu + io).toBe(0)
          }
          switch (state.status) {
            case 'not-arrived':
              expect(time).toBeLessThan(item.arrival)
              break
            case 'ready':
            case 'running':
              expect(state.remainingCpu).toBeGreaterThan(0)
              expect(state.remainingCpu).toBe(state.burst === 1
                ? item.cpu1 - cpu : item.cpu1 + item.cpu2 - cpu)
              expect(io).toBe(state.burst === 1 ? 0 : item.io)
              expect(state.enteredAt).toBe(readyAt.get(item.id))
              if (state.status === 'running') expect(state.quantumRemaining).toBeNull()
              break
            case 'waiting-for-io':
              expect(cpu).toBe(item.cpu1)
              expect(io).toBe(0)
              expect(state.remainingIo).toBe(item.io)
              break
            case 'performing-io':
              expect(cpu).toBe(item.cpu1)
              expect(state.remainingIo).toBe(item.io - io)
              expect(state.remainingIo).toBeGreaterThan(0)
              break
            case 'completed':
              expect(cpu).toBe(item.cpu1 + item.cpu2)
              expect(io).toBe(item.io)
              expect(state.completedAt).toBe(completedAt.get(item.id))
              break
          }
        }

        if (boundary.kind === 'terminal') {
          expect(time).toBe(40)
          expect(boundary).not.toHaveProperty('cpu')
          expect(boundary).not.toHaveProperty('io')
          expect(boundary.events.some(({ type }) =>
            type === 'cpu-dispatched' || type === 'io-started' || type === 'resource-idle',
          )).toBe(false)
          continue
        }
        expect(boundary.cpu).toBe(result.timeline.cpu[time])
        expect(boundary.io).toBe(result.timeline.io[time])
        if (boundary.cpu !== 'idle') expect(boundary.cpu).not.toBe(boundary.io)
        expect(boundary.processes.filter(({ status }) => status === 'running')
          .map(({ processId }) => processId))
          .toEqual(boundary.cpu === 'idle' ? [] : [boundary.cpu])
        expect(boundary.processes.filter(({ status }) => status === 'performing-io')
          .map(({ processId }) => processId))
          .toEqual(boundary.io === 'idle' ? [] : [boundary.io])
        if (boundary.cpu === 'idle') expect(readyQueue).toEqual([])
        if (boundary.io === 'idle') expect(ioQueue).toEqual([])
        const previousCpu = result.timeline.cpu[time - 1]
        const completedBurst = boundary.events.some(({ type }) => type === 'cpu-burst-completed')
        const preempted = boundary.events.some(({ type }) => type === 'cpu-preempted')
        if (time > 0 && previousCpu !== 'idle' && !completedBurst && !preempted) {
          expect(boundary.cpu).toBe(previousCpu)
          expect(boundary.events.some(({ type }) => type === 'cpu-dispatched')).toBe(false)
        }
        const previousIo = result.timeline.io[time - 1]
        if (time > 0 && previousIo !== 'idle' &&
          !boundary.events.some(({ type }) => type === 'io-completed')) {
          expect(boundary.io).toBe(previousIo)
          expect(boundary.events.some(({ type }) => type === 'io-started')).toBe(false)
        }
        if (preemptive && boundary.cpu !== 'idle') {
          const running = boundary.processes.find(({ status }) => status === 'running')!
          if (running.status !== 'running') throw new Error('Missing running process.')
          const runningRank = settings.algorithm === 'priority'
            ? inputs.get(running.processId)!.priority! : running.remainingCpu
          for (const ready of boundary.processes) {
            if (ready.status !== 'ready') continue
            const readyRank = settings.algorithm === 'priority'
              ? inputs.get(ready.processId)!.priority! : ready.remainingCpu
            expect(runningRank).toBeLessThanOrEqual(readyRank)
          }
        }
      }
      const allCompleted = completedAt.size === input.processes.length
      expect(result.status).toBe(allCompleted ? 'complete' : 'limit-reached')
      expect(result.completionTime).toBe(allCompleted ? Math.max(...completedAt.values()) : null)
      if (result.status === 'complete') {
        expect(result.timeline.cpu.slice(result.completionTime).every((id) => id === 'idle')).toBe(true)
        expect(result.timeline.io.slice(result.completionTime).every((id) => id === 'idle')).toBe(true)
      }
    }
  },
)

function freezeDeep(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  Object.values(value).forEach(freezeDeep)
  Object.freeze(value)
}

function collectObjects(value: unknown, objects = new Set<object>()): Set<object> {
  if (value === null || typeof value !== 'object') return objects
  objects.add(value)
  Object.values(value).forEach((child) => collectObjects(child, objects))
  return objects
}

test.each(policies)('isolates deterministic history and frozen inputs ($algorithm)', (settings) => {
  const input: Problem = {
    ...problem(0, settings),
    processes: [
      { id: 'P1', arrival: 0, cpu1: 7, io: 2, cpu2: 3, priority: 5 },
      { id: 'P2', arrival: 2, cpu1: 2, io: 1, cpu2: 1, priority: 1 },
    ],
  }
  const original = JSON.stringify(input)
  freezeDeep(input)
  const first = simulate(input)
  const second = simulate(input)
  expect(JSON.stringify(input)).toBe(original)
  expect(second).toEqual(first)
  const secondObjects = collectObjects(second)
  for (const object of collectObjects(first)) expect(secondObjects.has(object)).toBe(false)
  const priorObjects = new Set<object>()
  for (const boundary of first.boundaries) {
    for (const object of collectObjects(boundary)) {
      expect(priorObjects.has(object)).toBe(false)
      priorObjects.add(object)
    }
  }
})
