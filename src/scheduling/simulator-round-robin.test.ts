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
  type SimulationResult,
} from './types'

function process(
  id: ProcessId,
  cpu1: number,
  io: number,
  cpu2: number,
  arrival = 0,
): ProcessInput {
  return { id, cpu1, io, cpu2, arrival }
}

function problem(processes: readonly ProcessInput[], quantum = 2): Problem {
  return {
    seed: 123,
    rulesVersion: RULES_VERSION,
    generatorVersion: GENERATOR_VERSION,
    settings: { algorithm: 'round-robin', quantum },
    processes,
  }
}

/** Independently calculated runs; every remaining worksheet cell is Idle. */
function row(...runs: readonly (readonly [ReferenceCell, number])[]): ReferenceCell[] {
  const cells = runs.flatMap(([cell, duration]) => Array<ReferenceCell>(duration).fill(cell))
  if (cells.length > TIMELINE_LENGTH) throw new Error('Fixture exceeds the worksheet.')
  return cells.concat(Array<ReferenceCell>(TIMELINE_LENGTH - cells.length).fill('idle'))
}

function expectSchedule(
  result: SimulationResult,
  cpu: readonly ReferenceCell[],
  io: readonly ReferenceCell[],
  completionTime: number | null,
) {
  expect(result.timeline).toEqual({ cpu, io })
  expect(result.status).toBe(completionTime === null ? 'limit-reached' : 'complete')
  expect(result.completionTime).toBe(completionTime)
  expect(result.boundaries.map(({ time }) => time)).toEqual(
    Array.from({ length: 41 }, (_, time) => time),
  )
  for (const boundary of result.boundaries) {
    if (boundary.kind === 'interval-start') {
      expect(boundary.cpu).toBe(cpu[boundary.time])
      expect(boundary.io).toBe(io[boundary.time])
    } else {
      expect(boundary).not.toHaveProperty('cpu')
      expect(boundary).not.toHaveProperty('io')
      expect(boundary.events.some(({ type }) => type === 'cpu-dispatched')).toBe(false)
    }
    for (const event of boundary.events) {
      if (event.type === 'cpu-dispatched') expect(event.criterion).toBe('fifo-ready-queue')
    }
  }
}

describe('round-robin simulator', () => {
  test('rotates FIFO, retaining unfinished work in both CPU bursts', () => {
    const result = simulate(problem([process('P1', 5, 2, 3), process('P2', 3, 1, 2)]))
    expectSchedule(
      result,
      row(['P1', 2], ['P2', 2], ['P1', 2], ['P2', 1], ['P1', 1], ['P2', 2], ['P1', 3]),
      row(['idle', 7], ['P2', 1], ['P1', 2]),
      13,
    )
    expect(result.boundaries[4].processes).toContainEqual({
      processId: 'P1', status: 'running', burst: 1,
      remainingCpu: 3, enteredAt: 2, quantumRemaining: 2,
    })
    expect(result.boundaries[4].readyQueue).toEqual([{ processId: 'P2', enteredAt: 4 }])
    expect(result.boundaries[12].events).toContainEqual({
      type: 'quantum-expired', processId: 'P1', remainingCpu: 1,
    })
    expect(result.boundaries[12].processes).toContainEqual({
      processId: 'P1', status: 'running', burst: 2,
      remainingCpu: 1, enteredAt: 12, quantumRemaining: 2,
    })
  })

  test('discards unused slices at blocking and completion and refreshes every dispatch', () => {
    const result = simulate(problem([process('P1', 1, 1, 4), process('P2', 1, 1, 1)], 3))
    expectSchedule(
      result,
      row(['P1', 1], ['P2', 1], ['P1', 3], ['P2', 1], ['P1', 1]),
      row(['idle', 1], ['P1', 1], ['P2', 1]),
      7,
    )
    for (const [time, processId, burst, remainingCpu, enteredAt] of [
      [1, 'P2', 1, 1, 0],
      [2, 'P1', 2, 4, 2],
      [5, 'P2', 2, 1, 3],
      [6, 'P1', 2, 1, 5],
    ] as const) {
      expect(result.boundaries[time].processes).toContainEqual({
        processId, status: 'running', burst, remainingCpu, enteredAt, quantumRemaining: 3,
      })
    }
    expect(result.boundaries[3].processes).toContainEqual(
      expect.objectContaining({ processId: 'P1', remainingCpu: 3, quantumRemaining: 2 }),
    )
    expect(
      result.boundaries.flatMap(({ events }) => events).filter(({ type }) => type === 'quantum-expired'),
    ).toEqual([{ type: 'quantum-expired', processId: 'P1', remainingCpu: 1 }])
  })

  test('completes either burst at a slice boundary without expiring or requeueing it', () => {
    const result = simulate(problem([process('P1', 2, 1, 2)]))
    expectSchedule(result, row(['P1', 2], ['idle', 1], ['P1', 2]), row(['idle', 2], ['P1', 1]), 5)
    expect(result.boundaries[2].events.slice(0, 3)).toEqual([
      { type: 'cpu-burst-completed', processId: 'P1', burst: 1 },
      { type: 'io-requested', processId: 'P1' },
      { type: 'io-started', processId: 'P1' },
    ])
    expect(result.boundaries[5].events.slice(0, 2)).toEqual([
      { type: 'cpu-burst-completed', processId: 'P1', burst: 2 },
      { type: 'process-completed', processId: 'P1' },
    ])
    expect(
      result.boundaries.flatMap(({ events }) => events).some(({ type }) => type === 'quantum-expired'),
    ).toBe(false)
    expect(result.boundaries[2].readyQueue).toEqual([])
    expect(result.boundaries[5].readyQueue).toEqual([])
  })

  test('orders an old waiter, simultaneous arrival and I/O return, then the expired process', () => {
    const result = simulate(problem([
      process('P4', 1, 1, 1),
      process('P3', 3, 1, 1),
      process('P2', 1, 2, 1),
      process('P1', 1, 1, 1, 3),
    ]))
    expectSchedule(
      result,
      row(['P2', 1], ['P3', 2], ['P4', 1], ['P1', 1], ['P2', 1], ['P3', 1], ['P4', 1], ['P1', 1], ['P3', 1]),
      row(['idle', 1], ['P2', 2], ['idle', 1], ['P4', 1], ['P1', 1], ['idle', 1], ['P3', 1]),
      10,
    )
    expect(result.boundaries[3].events.slice(0, 4)).toEqual([
      { type: 'io-completed', processId: 'P2' },
      { type: 'became-ready', processId: 'P1', reason: 'arrival' },
      { type: 'became-ready', processId: 'P2', reason: 'io-completion' },
      { type: 'quantum-expired', processId: 'P3', remainingCpu: 1 },
    ])
    expect(result.boundaries[3].events).toContainEqual({
      type: 'cpu-dispatched', processId: 'P4', burst: 1, criterion: 'fifo-ready-queue',
      candidates: [
        { processId: 'P4', burst: 1, remainingCpu: 1, enteredAt: 0 },
        { processId: 'P1', burst: 1, remainingCpu: 1, enteredAt: 3 },
        { processId: 'P2', burst: 2, remainingCpu: 1, enteredAt: 3 },
        { processId: 'P3', burst: 1, remainingCpu: 1, enteredAt: 3 },
      ],
    })
    expect(result.boundaries[3].readyQueue).toEqual([
      { processId: 'P1', enteredAt: 3 },
      { processId: 'P2', enteredAt: 3 },
      { processId: 'P3', enteredAt: 3 },
    ])
  })

  test('an I/O return waits until the active slice finishes', () => {
    const result = simulate(problem([process('P1', 1, 1, 1), process('P2', 5, 1, 1)], 3))
    expectSchedule(
      result,
      row(['P1', 1], ['P2', 3], ['P1', 1], ['P2', 2], ['idle', 1], ['P2', 1]),
      row(['idle', 1], ['P1', 1], ['idle', 5], ['P2', 1]),
      9,
    )
    expect(result.boundaries[2].readyQueue).toEqual([{ processId: 'P1', enteredAt: 2 }])
    expect(result.boundaries[2].processes).toContainEqual({
      processId: 'P2', status: 'running', burst: 1,
      remainingCpu: 4, enteredAt: 0, quantumRemaining: 2,
    })
    expect(result.boundaries[2].events.some(({ type }) => type === 'cpu-dispatched')).toBe(false)
    expect(result.boundaries[4].events).toContainEqual(
      expect.objectContaining({ type: 'cpu-dispatched', processId: 'P1' }),
    )
  })

  test('redispatches a solitary expired process immediately with a fresh slice', () => {
    const result = simulate(problem([process('P1', 5, 1, 5)]))
    expectSchedule(result, row(['P1', 5], ['idle', 1], ['P1', 5]), row(['idle', 5], ['P1', 1]), 11)
    const expirations = result.boundaries.flatMap(({ time, events }) =>
      events.filter(({ type }) => type === 'quantum-expired').map(() => time),
    )
    expect(expirations).toEqual([2, 4, 8, 10])
    for (const time of expirations) {
      expect(result.boundaries[time].events.slice(0, 2)).toEqual([
        expect.objectContaining({ type: 'quantum-expired', processId: 'P1' }),
        expect.objectContaining({ type: 'cpu-dispatched', processId: 'P1' }),
      ])
      expect(result.boundaries[time].readyQueue).toEqual([])
      expect(result.boundaries[time].processes).toContainEqual(
        expect.objectContaining({ status: 'running', enteredAt: time, quantumRemaining: 2 }),
      )
    }
  })

  test('supports quantum one and numeric initial ordering regardless of input order', () => {
    const result = simulate(problem([process('P10', 2, 1, 1), process('P2', 2, 1, 1)], 1))
    expectSchedule(
      result,
      row(['P2', 1], ['P10', 1], ['P2', 1], ['P10', 1], ['P2', 1], ['P10', 1]),
      row(['idle', 3], ['P2', 1], ['P10', 1]),
      6,
    )
    expect(result.boundaries[0].readyQueue).toEqual([{ processId: 'P10', enteredAt: 0 }])
    expect(
      result.boundaries.flatMap(({ events }) => events).filter(({ type }) => type === 'quantum-expired'),
    ).toEqual([
      { type: 'quantum-expired', processId: 'P2', remainingCpu: 1 },
      { type: 'quantum-expired', processId: 'P10', remainingCpu: 1 },
    ])
  })

  test('keeps FIFO precedence after I/O even when the quantum exceeds every burst', () => {
    const result = simulate(problem([
      process('P1', 1, 1, 1), process('P2', 2, 1, 1), process('P3', 1, 1, 1),
    ], 100))
    expectSchedule(
      result,
      row(['P1', 1], ['P2', 2], ['P3', 1], ['P1', 1], ['P2', 1], ['P3', 1]),
      row(['idle', 1], ['P1', 1], ['idle', 1], ['P2', 1], ['P3', 1]),
      7,
    )
    expect(result.boundaries[3].readyQueue).toEqual([{ processId: 'P1', enteredAt: 2 }])
    expect(result.boundaries[3].processes).toContainEqual(
      expect.objectContaining({ processId: 'P3', status: 'running', quantumRemaining: 100 }),
    )
    expect(
      result.boundaries.flatMap(({ events }) => events).some(({ type }) => type === 'quantum-expired'),
    ).toBe(false)
  })

  test.each([38, 39])('handles CPU2 duration %i at the terminal quantum boundary', (cpu2) => {
    const result = simulate(problem([process('P1', 1, 1, cpu2)]))
    expectSchedule(
      result,
      row(['P1', 1], ['idle', 1], ['P1', 38]),
      row(['idle', 1], ['P1', 1]),
      cpu2 === 38 ? 40 : null,
    )
    expect(result.boundaries[40]).toEqual(cpu2 === 38 ? {
      kind: 'terminal', time: 40,
      processes: [{ processId: 'P1', status: 'completed', completedAt: 40 }],
      readyQueue: [], ioQueue: [],
      events: [
        { type: 'cpu-burst-completed', processId: 'P1', burst: 2 },
        { type: 'process-completed', processId: 'P1' },
      ],
    } : {
      kind: 'terminal', time: 40,
      processes: [{ processId: 'P1', status: 'ready', burst: 2, remainingCpu: 1, enteredAt: 40 }],
      readyQueue: [{ processId: 'P1', enteredAt: 40 }], ioQueue: [],
      events: [{ type: 'quantum-expired', processId: 'P1', remainingCpu: 1 }],
    })
  })

  test('accepts frozen inputs, stays deterministic, and preserves earlier queue and quantum snapshots', () => {
    const input = Object.freeze({
      ...problem([]),
      settings: Object.freeze({ algorithm: 'round-robin' as const, quantum: 2 }),
      processes: Object.freeze([
        Object.freeze(process('P1', 5, 1, 1)),
        Object.freeze(process('P2', 1, 1, 1)),
      ]),
    })
    const original = structuredClone(input)
    const first = simulate(input)
    expect(simulate(input)).toEqual(first)
    expect(input).toEqual(original)
    expectSchedule(
      first,
      row(['P1', 2], ['P2', 1], ['P1', 2], ['P2', 1], ['P1', 1], ['idle', 1], ['P1', 1]),
      row(['idle', 3], ['P2', 1], ['idle', 3], ['P1', 1]),
      9,
    )
    expect(first.boundaries[0].readyQueue).toEqual([{ processId: 'P2', enteredAt: 0 }])
    expect(first.boundaries[2].readyQueue).toEqual([{ processId: 'P1', enteredAt: 2 }])
    expect(first.boundaries[0].processes).toContainEqual(
      expect.objectContaining({ processId: 'P1', remainingCpu: 5, quantumRemaining: 2 }),
    )
    expect(first.boundaries[1].processes).toContainEqual(
      expect.objectContaining({ processId: 'P1', remainingCpu: 4, quantumRemaining: 1 }),
    )
    expect(first.boundaries[0].processes).not.toBe(first.boundaries[1].processes)
  })
})
