import { describe, expect, test } from 'vitest'
import { simulate } from './simulator'
import {
  GENERATOR_VERSION,
  RULES_VERSION,
  TIMELINE_LENGTH,
  type Problem,
  type ProcessId,
  type ProcessInput,
  type ReferenceCell,
  type SchedulingSettings,
} from './types'

const policies = [
  { algorithm: 'sjf' },
  { algorithm: 'srtf' },
  { algorithm: 'priority', mode: 'non-preemptive' },
  { algorithm: 'priority', mode: 'preemptive' },
] as const satisfies readonly SchedulingSettings[]

const preemptivePolicies = [
  { algorithm: 'srtf' },
  { algorithm: 'priority', mode: 'preemptive' },
] as const satisfies readonly SchedulingSettings[]

function process(
  id: ProcessId, cpu1: number, io: number, cpu2: number, arrival = 0, priority = 1,
): ProcessInput {
  return { id, cpu1, io, cpu2, arrival, priority }
}

function problem(
  processes: readonly ProcessInput[], settings: SchedulingSettings,
): Problem {
  return {
    seed: 123, rulesVersion: RULES_VERSION, generatorVersion: GENERATOR_VERSION,
    processes, settings,
  }
}

/** Hand-calculated runs followed by Idle through the end of the worksheet. */
function row(...runs: readonly (readonly [ReferenceCell, number])[]): ReferenceCell[] {
  const cells = runs.flatMap(([cell, count]) => Array<ReferenceCell>(count).fill(cell))
  if (cells.length > TIMELINE_LENGTH) throw new Error('Fixture exceeds the worksheet.')
  return cells.concat(Array<ReferenceCell>(TIMELINE_LENGTH - cells.length).fill('idle'))
}

describe('SJF', () => {
  test('compares the current burst only and lets it finish despite shorter I/O returns', () => {
    const result = simulate(problem([
      process('P1', 2, 8, 8), process('P2', 3, 1, 1), process('P3', 1, 2, 7),
    ], { algorithm: 'sjf' }))

    expect(result.timeline).toEqual({
      cpu: row(['P3', 1], ['P1', 2], ['P2', 3], ['P3', 7], ['P2', 1], ['P1', 8]),
      io: row(['idle', 1], ['P3', 2], ['P1', 8], ['P2', 1]),
    })
    expect(result.completionTime).toBe(22)
    expect(result.boundaries[0].events).toContainEqual(expect.objectContaining({
      type: 'cpu-dispatched', processId: 'P3', criterion: 'shortest-current-burst',
    }))
    expect(result.boundaries[3].events).toContainEqual(expect.objectContaining({
      type: 'cpu-dispatched', processId: 'P2', criterion: 'shortest-current-burst',
    }))
    expect(result.boundaries[12].processes).toContainEqual(expect.objectContaining({
      processId: 'P2', status: 'ready', burst: 2, remainingCpu: 1, enteredAt: 12,
    }))
    expect(result.boundaries[12]).toMatchObject({ cpu: 'P3' })
    expect(result.boundaries.flatMap(({ events }) => events)
      .filter(({ type }) => type === 'cpu-preempted')).toEqual([])
  })

  test('breaks equal lengths by ready-entry time, then numeric process ID', () => {
    const result = simulate(problem([
      process('P10', 2, 1, 1), process('P2', 2, 1, 1), process('P1', 1, 1, 2),
    ], { algorithm: 'sjf' }))

    expect(result.timeline).toEqual({
      cpu: row(['P1', 1], ['P2', 2], ['P10', 2], ['P2', 1], ['P10', 1], ['P1', 2]),
      io: row(['idle', 1], ['P1', 1], ['idle', 1], ['P2', 1], ['idle', 1], ['P10', 1]),
    })
    expect(result.completionTime).toBe(9)
    expect(result.boundaries[3].events).toContainEqual({
      type: 'cpu-dispatched', processId: 'P10', burst: 1,
      criterion: 'shortest-current-burst',
      candidates: [
        { processId: 'P10', burst: 1, remainingCpu: 2, enteredAt: 0, priority: 1 },
        { processId: 'P1', burst: 2, remainingCpu: 2, enteredAt: 2, priority: 1 },
      ],
    })
  })
})

describe('SRTF', () => {
  test('preempts for arrivals and I/O returns while preserving unfinished CPU work', () => {
    const result = simulate(problem([
      process('P1', 7, 2, 3), process('P2', 2, 1, 1, 2),
    ], { algorithm: 'srtf' }))

    expect(result.timeline).toEqual({
      cpu: row(['P1', 2], ['P2', 2], ['P1', 1], ['P2', 1], ['P1', 4], ['idle', 2], ['P1', 3]),
      io: row(['idle', 4], ['P2', 1], ['idle', 5], ['P1', 2]),
    })
    expect(result.completionTime).toBe(15)
    expect(result.boundaries[2].events).toContainEqual({
      type: 'cpu-preempted', reason: 'shorter-remaining-burst',
      running: { processId: 'P1', burst: 1, remainingCpu: 5, enteredAt: 0, priority: 1 },
      challenger: { processId: 'P2', burst: 1, remainingCpu: 2, enteredAt: 2, priority: 1 },
    })
    expect(result.boundaries[5].events).toContainEqual({
      type: 'cpu-preempted', reason: 'shorter-remaining-burst',
      running: { processId: 'P1', burst: 1, remainingCpu: 4, enteredAt: 2, priority: 1 },
      challenger: { processId: 'P2', burst: 2, remainingCpu: 1, enteredAt: 5, priority: 1 },
    })
    expect(result.boundaries[6].processes).toContainEqual({
      processId: 'P1', status: 'running', burst: 1, remainingCpu: 4,
      enteredAt: 5, quantumRemaining: null,
    })
  })

  test('does not preempt for equal lengths on arrival or I/O return', () => {
    const result = simulate(problem([
      process('P1', 4, 1, 2), process('P2', 3, 1, 1, 1),
    ], { algorithm: 'srtf' }))

    expect(result.timeline).toEqual({
      cpu: row(['P1', 4], ['P2', 3], ['P1', 2], ['P2', 1]),
      io: row(['idle', 4], ['P1', 1], ['idle', 2], ['P2', 1]),
    })
    expect(result.completionTime).toBe(10)
    for (const time of [1, 5, 8]) {
      expect(result.boundaries[time].events
        .some(({ type }) => type === 'cpu-preempted')).toBe(false)
    }
  })

  test('uses a fresh ready-entry timestamp after preemption when breaking later ties', () => {
    const result = simulate(problem([
      process('P10', 4, 1, 1),
      process('P2', 3, 1, 1, 1),
      process('P1', 1, 10, 1, 1),
    ], { algorithm: 'srtf' }))

    expect(result.timeline.cpu.slice(0, 5)).toEqual(['P10', 'P1', 'P2', 'P2', 'P2'])
    expect(result.boundaries[1].readyQueue).toEqual([
      { processId: 'P2', enteredAt: 1 }, { processId: 'P10', enteredAt: 1 },
    ])
    expect(result.boundaries[2].events).toContainEqual({
      type: 'cpu-dispatched', processId: 'P2', burst: 1,
      criterion: 'shortest-remaining-burst',
      candidates: [
        { processId: 'P2', burst: 1, remainingCpu: 3, enteredAt: 1, priority: 1 },
        { processId: 'P10', burst: 1, remainingCpu: 3, enteredAt: 1, priority: 1 },
      ],
    })
  })

  test('can interrupt the second CPU burst without restarting it', () => {
    const result = simulate(problem([
      process('P1', 1, 1, 6), process('P2', 1, 1, 1, 4),
    ], { algorithm: 'srtf' }))
    expect(result.timeline).toEqual({
      cpu: row(['P1', 1], ['idle', 1], ['P1', 2], ['P2', 1], ['P1', 1], ['P2', 1], ['P1', 3]),
      io: row(['idle', 1], ['P1', 1], ['idle', 3], ['P2', 1]),
    })
    expect(result.boundaries[4].events).toContainEqual(expect.objectContaining({
      type: 'cpu-preempted',
      running: { processId: 'P1', burst: 2, remainingCpu: 4, enteredAt: 2, priority: 1 },
    }))
    expect(result.completionTime).toBe(10)
  })
})

describe('priority', () => {
  test('preemptive mode interrupts for higher priorities on arrival and I/O return', () => {
    const result = simulate(problem([
      process('P1', 4, 1, 2, 0, 5), process('P2', 1, 2, 1, 1, -2),
    ], { algorithm: 'priority', mode: 'preemptive' }))
    expect(result.timeline).toEqual({
      cpu: row(['P1', 1], ['P2', 1], ['P1', 2], ['P2', 1], ['P1', 1], ['idle', 1], ['P1', 2]),
      io: row(['idle', 2], ['P2', 2], ['idle', 2], ['P1', 1]),
    })
    expect(result.completionTime).toBe(9)
    expect(result.boundaries[1].events).toContainEqual({
      type: 'cpu-preempted', reason: 'higher-priority',
      running: { processId: 'P1', burst: 1, remainingCpu: 3, enteredAt: 0, priority: 5 },
      challenger: { processId: 'P2', burst: 1, remainingCpu: 1, enteredAt: 1, priority: -2 },
    })
    expect(result.boundaries[4].events).toContainEqual({
      type: 'cpu-preempted', reason: 'higher-priority',
      running: { processId: 'P1', burst: 1, remainingCpu: 1, enteredAt: 1, priority: 5 },
      challenger: { processId: 'P2', burst: 2, remainingCpu: 1, enteredAt: 4, priority: -2 },
    })
  })

  test('non-preemptive mode lets the running burst finish before a higher priority runs', () => {
    const result = simulate(problem([
      process('P1', 4, 1, 2, 0, 5), process('P2', 1, 2, 1, 1, -2),
    ], { algorithm: 'priority', mode: 'non-preemptive' }))
    expect(result.timeline).toEqual({
      cpu: row(['P1', 4], ['P2', 1], ['P1', 2], ['P2', 1]),
      io: row(['idle', 4], ['P1', 1], ['P2', 2]),
    })
    expect(result.completionTime).toBe(8)
    expect(result.boundaries.flatMap(({ events }) => events)
      .some(({ type }) => type === 'cpu-preempted')).toBe(false)
  })

  test.each(['preemptive', 'non-preemptive'] as const)(
    '%s mode chooses smaller priority values before shorter CPU bursts',
    (mode) => {
      const result = simulate(problem([
        process('P1', 1, 1, 1, 0, 5),
        process('P10', 2, 1, 1, 0, -1),
        process('P2', 3, 1, 1, 0, -1),
      ], { algorithm: 'priority', mode }))
      // Equal priority uses numeric IDs rather than burst size or lexical order.
      expect(result.timeline.cpu.slice(0, 3)).toEqual(['P2', 'P2', 'P2'])
      expect(result.boundaries[0].events).toContainEqual(expect.objectContaining({
        type: 'cpu-dispatched', processId: 'P2', criterion: 'highest-priority',
      }))
    },
  )

  test('an equal priority never preempts, even when its burst is shorter', () => {
    const result = simulate(problem([
      process('P1', 4, 1, 2, 0, 1), process('P2', 1, 1, 1, 1, 1),
    ], { algorithm: 'priority', mode: 'preemptive' }))
    expect(result.timeline).toEqual({
      cpu: row(['P1', 4], ['P2', 1], ['P1', 2], ['P2', 1]),
      io: row(['idle', 4], ['P1', 1], ['P2', 1]),
    })
    expect(result.boundaries.flatMap(({ events }) => events)
      .some(({ type }) => type === 'cpu-preempted')).toBe(false)
  })

  test('an old equal-priority waiter goes before a preempted process with a lower ID', () => {
    const result = simulate(problem([
      process('P1', 4, 1, 1, 0, 2),
      process('P2', 1, 1, 1, 0, 2),
      process('P3', 1, 5, 1, 1, 1),
    ], { algorithm: 'priority', mode: 'preemptive' }))
    expect(result.timeline).toEqual({
      cpu: row(['P1', 1], ['P3', 1], ['P2', 1], ['P1', 3], ['idle', 1], ['P3', 1], ['P2', 1], ['P1', 1]),
      io: row(['idle', 2], ['P3', 5], ['P2', 1], ['P1', 1]),
    })
    expect(result.completionTime).toBe(10)
    expect(result.boundaries[1].readyQueue).toEqual([
      { processId: 'P2', enteredAt: 0 }, { processId: 'P1', enteredAt: 1 },
    ])
    expect(result.boundaries[2].events).toContainEqual(expect.objectContaining({
      type: 'cpu-dispatched', processId: 'P2',
    }))
  })
})

describe.each(preemptivePolicies)('preemption boundary ordering ($algorithm)', (settings) => {
  test('considers simultaneous I/O returns and arrivals before requeueing and dispatching', () => {
    const result = simulate(problem([
      process('P4', 9, 1, 1, 0, 3),
      process('P3', 10, 1, 1, 0, 4),
      process('P2', 1, 2, 1, 0, 1),
      process('P1', 1, 1, 1, 3, 1),
    ], settings))
    const events = result.boundaries[3].events
    expect(events.slice(0, 3)).toEqual([
      { type: 'io-completed', processId: 'P2' },
      { type: 'became-ready', processId: 'P1', reason: 'arrival' },
      { type: 'became-ready', processId: 'P2', reason: 'io-completion' },
    ])
    expect(events[3]).toEqual({
      type: 'cpu-preempted',
      reason: settings.algorithm === 'srtf' ? 'shorter-remaining-burst' : 'higher-priority',
      running: { processId: 'P4', burst: 1, remainingCpu: 7, enteredAt: 0, priority: 3 },
      challenger: { processId: 'P1', burst: 1, remainingCpu: 1, enteredAt: 3, priority: 1 },
    })
    expect(events[4]).toEqual({
      type: 'cpu-dispatched', processId: 'P1', burst: 1,
      criterion: settings.algorithm === 'srtf' ? 'shortest-remaining-burst' : 'highest-priority',
      candidates: [
        { processId: 'P3', burst: 1, remainingCpu: 10, enteredAt: 0, priority: 4 },
        { processId: 'P1', burst: 1, remainingCpu: 1, enteredAt: 3, priority: 1 },
        { processId: 'P2', burst: 2, remainingCpu: 1, enteredAt: 3, priority: 1 },
        { processId: 'P4', burst: 1, remainingCpu: 7, enteredAt: 3, priority: 3 },
      ],
    })
    expect(result.boundaries[3].readyQueue).toEqual([
      { processId: 'P3', enteredAt: 0 },
      { processId: 'P2', enteredAt: 3 },
      { processId: 'P4', enteredAt: 3 },
    ])
  })

  test('records terminal preemption and queue changes without dispatching or executing', () => {
    const result = simulate(problem([
      process('P1', 50, 1, 1, 0, 5), process('P2', 1, 1, 1, 40, 1),
    ], settings))
    expect(result.status).toBe('limit-reached')
    expect(result.completionTime).toBeNull()
    expect(result.timeline.cpu).toEqual(row(['P1', 40]))
    const terminal = result.boundaries[40]
    expect(terminal).toMatchObject({
      kind: 'terminal',
      readyQueue: [
        { processId: 'P2', enteredAt: 40 }, { processId: 'P1', enteredAt: 40 },
      ],
    })
    expect(terminal.events.map(({ type }) => type)).toEqual(['became-ready', 'cpu-preempted'])
    expect(terminal.processes).toContainEqual({
      processId: 'P1', status: 'ready', burst: 1, remainingCpu: 10, enteredAt: 40,
    })
    expect(terminal).not.toHaveProperty('cpu')
    expect(terminal).not.toHaveProperty('io')
  })

  test('handles completion before a better arrival at boundary 40', () => {
    const result = simulate(problem([
      process('P1', 38, 1, 1, 0, 5), process('P2', 1, 1, 1, 40, 1),
    ], settings))
    const terminal = result.boundaries[40]
    expect(terminal.events).toEqual([
      { type: 'cpu-burst-completed', processId: 'P1', burst: 2 },
      { type: 'process-completed', processId: 'P1' },
      { type: 'became-ready', processId: 'P2', reason: 'arrival' },
    ])
    expect(terminal.processes).toContainEqual({
      processId: 'P1', status: 'completed', completedAt: 40,
    })
    expect(result.status).toBe('limit-reached')
  })
})

test.each(policies)('accepts completion exactly at 40 ($algorithm)', (settings) => {
  const result = simulate(problem([process('P1', 19, 1, 20)], settings))
  expect(result.status).toBe('complete')
  expect(result.completionTime).toBe(40)
  expect(result.timeline).toEqual({
    cpu: row(['P1', 19], ['idle', 1], ['P1', 20]),
    io: row(['idle', 19], ['P1', 1]),
  })
  expect(result.boundaries[40].events).toEqual([
    { type: 'cpu-burst-completed', processId: 'P1', burst: 2 },
    { type: 'process-completed', processId: 'P1' },
  ])
})
