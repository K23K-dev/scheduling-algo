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
  type SimulationResult,
} from './types'

function process(
  id: ProcessId,
  cpu1: number,
  io: number,
  cpu2: number,
  arrival = 0,
): ProcessInput {
  return { id, arrival, cpu1, io, cpu2 }
}

function problem(
  processes: readonly ProcessInput[],
  settings: SchedulingSettings = { algorithm: 'fcfs-course' },
): Problem {
  return {
    seed: 123,
    rulesVersion: RULES_VERSION,
    generatorVersion: GENERATOR_VERSION,
    settings,
    processes,
  }
}

/** Expand hand-calculated runs, then explicitly mark the unused tail Idle. */
function row(...segments: readonly (readonly [ReferenceCell, number])[]): ReferenceCell[] {
  const cells = segments.flatMap(([cell, length]) => Array<ReferenceCell>(length).fill(cell))
  if (cells.length > TIMELINE_LENGTH) throw new Error('Expected fixture exceeds 40 cells.')
  return cells.concat(Array<ReferenceCell>(TIMELINE_LENGTH - cells.length).fill('idle'))
}

function expectSchedule(
  input: Problem,
  result: SimulationResult,
  cpu: readonly ReferenceCell[],
  io: readonly ReferenceCell[],
  completionTime: number | null,
) {
  expect(result.timeline).toEqual({ cpu, io })
  expect(result.status).toBe(completionTime === null ? 'limit-reached' : 'complete')
  expect(result.completionTime).toBe(completionTime)
  expect(result.boundaries).toHaveLength(41)
  expect(result.boundaries.map((boundary) => boundary.time)).toEqual(
    Array.from({ length: 41 }, (_, time) => time),
  )

  for (const boundary of result.boundaries) {
    expect(boundary.processes.map(({ processId }) => processId).sort()).toEqual(
      input.processes.map(({ id }) => id).sort(),
    )
    if (boundary.kind === 'terminal') {
      expect(boundary.time).toBe(40)
      expect(boundary).not.toHaveProperty('cpu')
      expect(boundary).not.toHaveProperty('io')
      expect(
        boundary.events.some(({ type }) => type === 'cpu-dispatched' || type === 'io-started'),
      ).toBe(false)
      continue
    }

    expect(boundary.time).toBeLessThan(40)
    expect(boundary.cpu).toBe(cpu[boundary.time])
    expect(boundary.io).toBe(io[boundary.time])
    if (boundary.cpu !== 'idle') expect(boundary.cpu).not.toBe(boundary.io)
    expect(
      boundary.processes.filter(({ status }) => status === 'running').map(({ processId }) => processId),
    ).toEqual(boundary.cpu === 'idle' ? [] : [boundary.cpu])
    expect(
      boundary.processes
        .filter(({ status }) => status === 'performing-io')
        .map(({ processId }) => processId),
    ).toEqual(boundary.io === 'idle' ? [] : [boundary.io])
    expect(boundary.readyQueue.map(({ processId }) => processId).sort()).toEqual(
      boundary.processes
        .filter(({ status }) => status === 'ready')
        .map(({ processId }) => processId)
        .sort(),
    )
    expect(boundary.ioQueue.map(({ processId }) => processId).sort()).toEqual(
      boundary.processes
        .filter(({ status }) => status === 'waiting-for-io')
        .map(({ processId }) => processId)
        .sort(),
    )
    for (const item of input.processes) {
      if (boundary.time < item.arrival) {
        expect(boundary.cpu).not.toBe(item.id)
        expect(boundary.io).not.toBe(item.id)
      }
    }
  }

  if (completionTime !== null) {
    const events = result.boundaries.flatMap(({ events: boundaryEvents }) => boundaryEvents)
    for (const item of input.processes) {
      expect(cpu.filter((cell) => cell === item.id)).toHaveLength(item.cpu1 + item.cpu2)
      expect(io.filter((cell) => cell === item.id)).toHaveLength(item.io)
      expect(
        events.filter(
          (event) => event.type === 'process-completed' && event.processId === item.id,
        ),
      ).toHaveLength(1)
    }
    expect(cpu.slice(completionTime).every((cell) => cell === 'idle')).toBe(true)
    expect(io.slice(completionTime).every((cell) => cell === 'idle')).toBe(true)
  }
}

describe('course FCFS simulator', () => {
  test('moves one process through both bursts with immediate boundary transitions', () => {
    const input = problem([process('P1', 2, 3, 2)])
    const result = simulate(input)

    expectSchedule(
      input,
      result,
      row(['P1', 2], ['idle', 3], ['P1', 2]),
      row(['idle', 2], ['P1', 3]),
      7,
    )
    expect(result.boundaries[0].processes).toEqual([
      {
        processId: 'P1',
        status: 'running',
        burst: 1,
        remainingCpu: 2,
        enteredAt: 0,
        quantumRemaining: null,
      },
    ])
    expect(result.boundaries[1].processes).toEqual([
      expect.objectContaining({ processId: 'P1', status: 'running', remainingCpu: 1 }),
    ])
    expect(result.boundaries[2].events).toEqual(
      expect.arrayContaining([
        { type: 'cpu-burst-completed', processId: 'P1', burst: 1 },
        { type: 'io-requested', processId: 'P1' },
        { type: 'io-started', processId: 'P1' },
      ]),
    )
    expect(result.boundaries[5].events).toEqual(
      expect.arrayContaining([
        { type: 'io-completed', processId: 'P1' },
        { type: 'became-ready', processId: 'P1', reason: 'io-completion' },
        expect.objectContaining({ type: 'cpu-dispatched', processId: 'P1', burst: 2 }),
      ]),
    )
    expect(result.boundaries[7].processes).toEqual([
      { processId: 'P1', status: 'completed', completedAt: 7 },
    ])
    expect(result.boundaries[7].events).toEqual(
      expect.arrayContaining([
        { type: 'resource-idle', resource: 'cpu', reason: 'all-completed' },
        { type: 'resource-idle', resource: 'io', reason: 'all-completed' },
      ]),
    )
  })

  test('overlaps CPU and I/O and starts both newly available resources at one boundary', () => {
    const input = problem([process('P1', 2, 3, 2), process('P2', 3, 2, 1)])
    const result = simulate(input)

    expectSchedule(
      input,
      result,
      row(['P1', 2], ['P2', 3], ['P1', 2], ['P2', 1]),
      row(['idle', 2], ['P1', 3], ['P2', 2]),
      8,
    )
    expect(result.boundaries[5].events).toEqual([
      { type: 'cpu-burst-completed', processId: 'P2', burst: 1 },
      { type: 'io-requested', processId: 'P2' },
      { type: 'io-completed', processId: 'P1' },
      { type: 'became-ready', processId: 'P1', reason: 'io-completion' },
      { type: 'io-started', processId: 'P2' },
      {
        type: 'cpu-dispatched',
        processId: 'P1',
        burst: 2,
        criterion: 'original-launch-order',
        candidates: [{ processId: 'P1', burst: 2, remainingCpu: 2, enteredAt: 5 }],
      },
    ])
    expect(result.boundaries[5].processes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ processId: 'P1', status: 'running', remainingCpu: 2 }),
        { processId: 'P2', status: 'performing-io', remainingIo: 2, startedAt: 5 },
      ]),
    )
  })

  test('serves existing I/O waiters before a request made when the device becomes free', () => {
    const input = problem([
      process('P1', 1, 4, 1),
      process('P2', 1, 2, 1),
      process('P3', 3, 1, 1),
    ])
    const result = simulate(input)

    expectSchedule(
      input,
      result,
      row(['P1', 1], ['P2', 1], ['P3', 3], ['P1', 1], ['idle', 1], ['P2', 1], ['P3', 1]),
      row(['idle', 1], ['P1', 4], ['P2', 2], ['P3', 1]),
      9,
    )
    expect(result.boundaries[2].ioQueue).toEqual([{ processId: 'P2', requestedAt: 2 }])
    expect(result.boundaries[4].ioQueue).toEqual([{ processId: 'P2', requestedAt: 2 }])
    expect(result.boundaries[5].ioQueue).toEqual([{ processId: 'P3', requestedAt: 5 }])
    expect(result.boundaries[5].processes).toEqual(
      expect.arrayContaining([
        { processId: 'P2', status: 'performing-io', remainingIo: 2, startedAt: 5 },
        { processId: 'P3', status: 'waiting-for-io', remainingIo: 1, requestedAt: 5 },
      ]),
    )
    expect(result.boundaries[7].ioQueue).toEqual([])
  })

  test('idles the CPU while every unfinished process is blocked, including I/O waiters', () => {
    const input = problem([process('P1', 1, 5, 1), process('P2', 1, 2, 1)])
    const result = simulate(input)

    expectSchedule(
      input,
      result,
      row(['P1', 1], ['P2', 1], ['idle', 4], ['P1', 1], ['idle', 1], ['P2', 1]),
      row(['idle', 1], ['P1', 5], ['P2', 2]),
      9,
    )
    expect(result.boundaries[2].readyQueue).toEqual([])
    expect(result.boundaries[2].processes).toEqual(
      expect.arrayContaining([
        { processId: 'P1', status: 'performing-io', remainingIo: 4, startedAt: 1 },
        { processId: 'P2', status: 'waiting-for-io', remainingIo: 2, requestedAt: 2 },
      ]),
    )
    expect(result.boundaries[2].events).toContainEqual({
      type: 'resource-idle',
      resource: 'cpu',
      reason: 'no-ready-process',
    })
  })

  test('preserves launch precedence after I/O without preempting the current CPU burst', () => {
    const input = problem([
      process('P1', 1, 1, 1),
      process('P2', 2, 1, 1),
      process('P3', 1, 1, 1),
    ])
    const result = simulate(input)

    expectSchedule(
      input,
      result,
      row(['P1', 1], ['P2', 2], ['P1', 1], ['P2', 1], ['P3', 1], ['idle', 1], ['P3', 1]),
      row(['idle', 1], ['P1', 1], ['idle', 1], ['P2', 1], ['idle', 2], ['P3', 1]),
      8,
    )
    expect(result.boundaries[2].readyQueue).toEqual([
      { processId: 'P3', enteredAt: 0 },
      { processId: 'P1', enteredAt: 2 },
    ])
    expect(result.boundaries[2].events.some(({ type }) => type === 'cpu-dispatched')).toBe(false)
    expect(result.boundaries[3].events).toContainEqual({
      type: 'cpu-dispatched',
      processId: 'P1',
      burst: 2,
      criterion: 'original-launch-order',
      candidates: [
        { processId: 'P3', burst: 1, remainingCpu: 1, enteredAt: 0 },
        { processId: 'P1', burst: 2, remainingCpu: 1, enteredAt: 2 },
      ],
    })
    expect(
      result.boundaries.flatMap(({ events }) => events).some(({ type }) => type === 'cpu-preempted'),
    ).toBe(false)
  })

  test('uses numeric launch ties independently of input array order', () => {
    const input = problem([process('P10', 1, 1, 1), process('P2', 1, 1, 1)])
    const result = simulate(input)

    expectSchedule(
      input,
      result,
      row(['P2', 1], ['P10', 1], ['P2', 1], ['P10', 1]),
      row(['idle', 1], ['P2', 1], ['P10', 1]),
      4,
    )
    expect(result.boundaries[0].events.slice(0, 2)).toEqual([
      { type: 'became-ready', processId: 'P2', reason: 'arrival' },
      { type: 'became-ready', processId: 'P10', reason: 'arrival' },
    ])
  })

  test('uses original arrival before process number or latest ready-entry time', () => {
    const input = problem([
      process('P1', 1, 1, 1, 2),
      process('P2', 3, 1, 1, 1),
      process('P10', 2, 2, 1),
    ])
    const result = simulate(input)

    expectSchedule(
      input,
      result,
      row(['P10', 2], ['P2', 3], ['P10', 1], ['P2', 1], ['P1', 1], ['idle', 1], ['P1', 1]),
      row(['idle', 2], ['P10', 2], ['idle', 1], ['P2', 1], ['idle', 2], ['P1', 1]),
      10,
    )
    expect(result.boundaries[4].readyQueue).toEqual([
      { processId: 'P1', enteredAt: 2 },
      { processId: 'P10', enteredAt: 4 },
    ])
    expect(result.boundaries[5].events).toContainEqual(
      expect.objectContaining({ type: 'cpu-dispatched', processId: 'P10' }),
    )
  })

  test('batches simultaneous arrivals and I/O returns after waiters, before dispatch', () => {
    const input = problem([
      process('P4', 1, 1, 1),
      process('P3', 3, 1, 1),
      process('P2', 1, 3, 1),
      process('P1', 1, 1, 1, 4),
    ])
    const result = simulate(input)

    expectSchedule(
      input,
      result,
      row(['P2', 1], ['P3', 3], ['P2', 1], ['P3', 1], ['P4', 1], ['P1', 1], ['P4', 1], ['P1', 1]),
      row(['idle', 1], ['P2', 3], ['P3', 1], ['idle', 2], ['P4', 1], ['P1', 1]),
      10,
    )
    expect(result.boundaries[4].events).toEqual([
      { type: 'cpu-burst-completed', processId: 'P3', burst: 1 },
      { type: 'io-requested', processId: 'P3' },
      { type: 'io-completed', processId: 'P2' },
      { type: 'became-ready', processId: 'P1', reason: 'arrival' },
      { type: 'became-ready', processId: 'P2', reason: 'io-completion' },
      { type: 'io-started', processId: 'P3' },
      {
        type: 'cpu-dispatched',
        processId: 'P2',
        burst: 2,
        criterion: 'original-launch-order',
        candidates: [
          { processId: 'P4', burst: 1, remainingCpu: 1, enteredAt: 0 },
          { processId: 'P1', burst: 1, remainingCpu: 1, enteredAt: 4 },
          { processId: 'P2', burst: 2, remainingCpu: 1, enteredAt: 4 },
        ],
      },
    ])
    expect(result.boundaries[4].readyQueue).toEqual([
      { processId: 'P4', enteredAt: 0 },
      { processId: 'P1', enteredAt: 4 },
    ])
  })

  test('waits for a future arrival without treating the empty system as completed', () => {
    const input = problem([process('P1', 2, 1, 1, 3)])
    const result = simulate(input)

    expectSchedule(
      input,
      result,
      row(['idle', 3], ['P1', 2], ['idle', 1], ['P1', 1]),
      row(['idle', 5], ['P1', 1]),
      7,
    )
    expect(result.boundaries[0].processes).toEqual([
      { processId: 'P1', status: 'not-arrived' },
    ])
    expect(result.boundaries[0].events).toContainEqual({
      type: 'resource-idle',
      resource: 'cpu',
      reason: 'no-ready-process',
    })
    expect(result.boundaries[3].events).toContainEqual({
      type: 'became-ready',
      processId: 'P1',
      reason: 'arrival',
    })
  })

  test('records final CPU completion exactly at 40 without executing a 41st interval', () => {
    const input = problem([process('P1', 1, 1, 38)])
    const result = simulate(input)

    expectSchedule(
      input,
      result,
      row(['P1', 1], ['idle', 1], ['P1', 38]),
      row(['idle', 1], ['P1', 1]),
      40,
    )
    expect(result.boundaries[40]).toEqual({
      kind: 'terminal',
      time: 40,
      processes: [{ processId: 'P1', status: 'completed', completedAt: 40 }],
      readyQueue: [],
      ioQueue: [],
      events: [
        { type: 'cpu-burst-completed', processId: 'P1', burst: 2 },
        { type: 'process-completed', processId: 'P1' },
      ],
    })
  })

  test('retains unfinished CPU work at the limit instead of reporting a clipped success', () => {
    const input = problem([process('P1', 1, 1, 39)])
    const result = simulate(input)

    expectSchedule(
      input,
      result,
      row(['P1', 1], ['idle', 1], ['P1', 38]),
      row(['idle', 1], ['P1', 1]),
      null,
    )
    expect(result.boundaries[40].processes).toEqual([
      {
        processId: 'P1',
        status: 'running',
        burst: 2,
        remainingCpu: 1,
        enteredAt: 2,
        quantumRemaining: null,
      },
    ])
    expect(result.boundaries[40].events).toEqual([])
  })

  test('adds an arrival at 40 without dispatch and leaves later arrivals untouched', () => {
    const input = problem([process('P1', 1, 1, 1, 40), process('P2', 1, 1, 1, 41)])
    const result = simulate(input)

    expectSchedule(input, result, row(), row(), null)
    expect(result.boundaries[40]).toEqual({
      kind: 'terminal',
      time: 40,
      processes: [
        { processId: 'P1', status: 'ready', burst: 1, remainingCpu: 1, enteredAt: 40 },
        { processId: 'P2', status: 'not-arrived' },
      ],
      readyQueue: [{ processId: 'P1', enteredAt: 40 }],
      ioQueue: [],
      events: [{ type: 'became-ready', processId: 'P1', reason: 'arrival' }],
    })
  })

  test('makes an I/O completion at 40 ready without starting its second CPU burst', () => {
    const input = problem([process('P1', 1, 39, 1)])
    const result = simulate(input)

    expectSchedule(input, result, row(['P1', 1]), row(['idle', 1], ['P1', 39]), null)
    expect(result.boundaries[40]).toEqual({
      kind: 'terminal',
      time: 40,
      processes: [
        { processId: 'P1', status: 'ready', burst: 2, remainingCpu: 1, enteredAt: 40 },
      ],
      readyQueue: [{ processId: 'P1', enteredAt: 40 }],
      ioQueue: [],
      events: [
        { type: 'io-completed', processId: 'P1' },
        { type: 'became-ready', processId: 'P1', reason: 'io-completion' },
      ],
    })
  })

  test('queues an I/O request at 40 without starting the device', () => {
    const input = problem([process('P1', 40, 1, 1)])
    const result = simulate(input)

    expectSchedule(input, result, row(['P1', 40]), row(), null)
    expect(result.boundaries[40]).toEqual({
      kind: 'terminal',
      time: 40,
      processes: [
        { processId: 'P1', status: 'waiting-for-io', remainingIo: 1, requestedAt: 40 },
      ],
      readyQueue: [],
      ioQueue: [{ processId: 'P1', requestedAt: 40 }],
      events: [
        { type: 'cpu-burst-completed', processId: 'P1', burst: 1 },
        { type: 'io-requested', processId: 'P1' },
      ],
    })
  })

  test('correctly identifies that the README workload needs 41 units under course FCFS', () => {
    const input = problem([
      { ...process('P1', 2, 3, 4), priority: 3 },
      { ...process('P2', 15, 2, 6), priority: 2 },
      { ...process('P3', 6, 6, 2), priority: 1 },
    ])
    const result = simulate(input)

    // 35 CPU units plus the six-unit idle gap [33,39) gives completion at 41.
    expectSchedule(
      input,
      result,
      row(['P1', 2], ['P2', 15], ['P1', 4], ['P2', 6], ['P3', 6], ['idle', 6], ['P3', 1]),
      row(['idle', 2], ['P1', 3], ['idle', 12], ['P2', 2], ['idle', 14], ['P3', 6]),
      null,
    )
    expect(result.boundaries[40].processes).toEqual(
      expect.arrayContaining([
        { processId: 'P1', status: 'completed', completedAt: 21 },
        { processId: 'P2', status: 'completed', completedAt: 27 },
        {
          processId: 'P3',
          status: 'running',
          burst: 2,
          remainingCpu: 1,
          enteredAt: 39,
          quantumRemaining: null,
        },
      ]),
    )
  })

  test('is deterministic, accepts frozen input, and retains independent historical snapshots', () => {
    const processes = Object.freeze([
      Object.freeze(process('P2', 2, 1, 1)),
      Object.freeze(process('P1', 1, 2, 1)),
    ])
    const input = Object.freeze({
      ...problem(processes),
      settings: Object.freeze({ algorithm: 'fcfs-course' as const }),
    })
    const original = structuredClone(input)
    const first = simulate(input)
    const second = simulate(input)

    expect(first).toEqual(second)
    expect(input).toEqual(original)
    expect(first).not.toBe(second)
    expect(first.timeline.cpu).not.toBe(second.timeline.cpu)
    expect(first.boundaries[0].processes).not.toBe(first.boundaries[1].processes)
    expect(first.boundaries[0].readyQueue).not.toBe(first.boundaries[1].readyQueue)
    expect(first.boundaries[0].events).not.toBe(first.boundaries[1].events)
    expect(first.boundaries[0].readyQueue).toEqual([{ processId: 'P2', enteredAt: 0 }])
    expect(first.boundaries[1].readyQueue).toEqual([])
    expect(first.boundaries[0].processes).toContainEqual({
      processId: 'P2',
      status: 'ready',
      burst: 1,
      remainingCpu: 2,
      enteredAt: 0,
    })
  })
})

describe('simulator input boundaries', () => {
  test('rejects malformed problems with the invalid field identified', () => {
    expect(() => simulate(problem([process('P1', 0, 1, 1)]))).toThrow(/processes\[0\]\.cpu1/)
    expect(() => simulate(problem([process('P1', 1, 1, 1), process('P1', 2, 2, 2)]))).toThrow(
      /processes\[1\]\.id/,
    )
  })

  test('rejects missing priorities and unknown algorithms through structural validation', () => {
    expect(() => simulate(problem([process('P1', 1, 1, 1)], {
      algorithm: 'priority', mode: 'preemptive',
    }))).toThrow(/processes\[0\]\.priority/)
    expect(() => simulate(problem([process('P1', 1, 1, 1)], {
      algorithm: 'unknown',
    } as unknown as SchedulingSettings))).toThrow(/settings\.algorithm/)
  })
})
