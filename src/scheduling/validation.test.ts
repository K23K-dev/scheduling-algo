import { describe, expect, test } from 'vitest'
import { parseAttempt, parseProblem } from './validation'
import type { AttemptCell } from './types'

function makeProblem() {
  return {
    seed: 42,
    rulesVersion: 1 as const,
    generatorVersion: 1 as const,
    settings: { algorithm: 'fcfs-course' as const },
    processes: [
      { id: 'P1' as const, arrival: 0, cpu1: 2, io: 3, cpu2: 4, priority: 3 },
      { id: 'P2' as const, arrival: 0, cpu1: 15, io: 2, cpu2: 6, priority: 2 },
      { id: 'P3' as const, arrival: 0, cpu1: 6, io: 6, cpu2: 2, priority: 1 },
    ],
  }
}

function makeAttempt() {
  return {
    cpu: Array<AttemptCell>(40).fill(null),
    io: Array<AttemptCell>(40).fill('idle'),
  }
}

describe('parseProblem', () => {
  test('accepts the course fixture without imposing generator ranges', () => {
    const input = makeProblem()
    expect(parseProblem(input)).toEqual({ valid: true, value: input })
  })

  test('keeps structural validity separate from simulation limits and defaults', () => {
    const input = {
      ...makeProblem(),
      seed: 0,
      settings: { algorithm: 'round-robin', quantum: 8 },
      processes: [
        { id: 'P10', arrival: 50, cpu1: 100, io: 1, cpu2: 1 },
        { id: 'P2', arrival: 0, cpu1: 1, io: 1, cpu2: 1 },
      ],
    }
    expect(parseProblem(input)).toEqual({ valid: true, value: input })
    expect(parseProblem({ ...input, processes: [input.processes[0]] }).valid).toBe(true)
    expect(parseProblem({ ...input, seed: 4_294_967_295 }).valid).toBe(true)
  })

  test.each([
    { algorithm: 'fcfs-course' },
    { algorithm: 'sjf' },
    { algorithm: 'srtf' },
    { algorithm: 'round-robin', quantum: 1 },
    { algorithm: 'priority', mode: 'preemptive' },
    { algorithm: 'priority', mode: 'non-preemptive' },
  ])('accepts settings %j', (settings) => {
    expect(parseProblem({ ...makeProblem(), settings }).valid).toBe(true)
  })

  test.each([
    null, [], {}, { algorithm: 'fifo-fcfs' },
    { algorithm: 'round-robin' },
    { algorithm: 'round-robin', quantum: '3' },
    { algorithm: 'round-robin', quantum: 0 },
    { algorithm: 'round-robin', quantum: 2, mode: 'preemptive' },
    { algorithm: 'priority' },
    { algorithm: 'priority', mode: true },
    { algorithm: 'priority', mode: 'preemptive', quantum: 2 },
    { algorithm: 'fcfs-course', quantum: 2 },
    { algorithm: 'sjf', mode: 'non-preemptive' },
  ])('rejects invalid or irrelevant settings %j', (settings) => {
    expect(parseProblem({ ...makeProblem(), settings }).valid).toBe(false)
  })

  test('priority is optional for other policies, but required for priority', () => {
    const processes = [{ id: 'P1', arrival: 0, cpu1: 1, io: 1, cpu2: 1 }]
    expect(parseProblem({ ...makeProblem(), processes }).valid).toBe(true)
    const settings = { algorithm: 'priority', mode: 'preemptive' }
    expect(parseProblem({ ...makeProblem(), processes, settings }).valid).toBe(false)
    for (const priority of [0, -5, Number.MAX_SAFE_INTEGER]) {
      expect(parseProblem({
        ...makeProblem(), settings,
        processes: [{ ...processes[0], priority }],
      }).valid).toBe(true)
    }
  })

  test.each([NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '2', null])(
    'rejects invalid numeric input %s without coercion',
    (value) => {
      for (const field of ['arrival', 'cpu1', 'io', 'cpu2', 'priority']) {
        const input = makeProblem()
        const processes = [{ ...input.processes[0], [field]: value }]
        expect(parseProblem({ ...input, processes }).valid, field).toBe(false)
      }
      expect(parseProblem({ ...makeProblem(), seed: value }).valid).toBe(false)
      expect(parseProblem({
        ...makeProblem(), settings: { algorithm: 'round-robin', quantum: value },
      }).valid).toBe(false)
    },
  )

  test('rejects negative arrival, nonpositive bursts, and seeds outside uint32', () => {
    for (const field of ['arrival', 'cpu1', 'io', 'cpu2']) {
      const input = makeProblem()
      expect(parseProblem({
        ...input, processes: [{ ...input.processes[0], [field]: -1 }],
      }).valid).toBe(false)
      if (field !== 'arrival') {
        expect(parseProblem({
          ...input, processes: [{ ...input.processes[0], [field]: 0 }],
        }).valid).toBe(false)
      }
    }
    for (const seed of [-1, 4_294_967_296]) {
      expect(parseProblem({ ...makeProblem(), seed }).valid).toBe(false)
    }
  })

  test.each(['P0', 'P01', 'P-1', 'P1.5', 'P1e2', 'p1', 'P1\n', 'P1\r', 'P9007199254740992', 1])(
    'rejects noncanonical process ID %s',
    (id) => {
      const input = makeProblem()
      expect(parseProblem({
        ...input, processes: [{ ...input.processes[0], id }],
      }).valid).toBe(false)
    },
  )

  test('rejects duplicate IDs and malformed or empty process collections', () => {
    const input = makeProblem()
    for (const processes of [[], null, {}, [null], Array(2), [input.processes[0], input.processes[0]]]) {
      expect(parseProblem({ ...input, processes }).valid).toBe(false)
    }
  })

  test('rejects absent fields, malformed roots, and unsupported versions', () => {
    for (const value of [null, undefined, [], 'problem', 1]) {
      expect(parseProblem(value).valid).toBe(false)
    }
    for (const field of ['seed', 'rulesVersion', 'generatorVersion', 'settings', 'processes']) {
      const input: Record<string, unknown> = { ...makeProblem() }
      delete input[field]
      expect(parseProblem(input).valid, field).toBe(false)
    }
    for (const field of ['rulesVersion', 'generatorVersion']) {
      for (const value of [0, 2, '1']) {
        expect(parseProblem({ ...makeProblem(), [field]: value }).valid).toBe(false)
      }
    }
  })

  test('returns detached data without mutating frozen input', () => {
    const input = makeProblem()
    input.processes.forEach(Object.freeze)
    Object.freeze(input.processes)
    Object.freeze(input.settings)
    Object.freeze(input)
    const result = parseProblem(input)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('Expected a valid problem')
    expect(result.value).toEqual(input)
    expect(result.value).not.toBe(input)
    expect(result.value.settings).not.toBe(input.settings)
    expect(result.value.processes).not.toBe(input.processes)
    expect(result.value.processes[0]).not.toBe(input.processes[0])
  })

  test('reports actionable paths and messages for invalid data', () => {
    const result = parseProblem({ ...makeProblem(), seed: 'invalid' })
    expect(result.valid).toBe(false)
    if (result.valid) throw new Error('Expected an invalid problem')
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues.some((issue) => issue.path.includes('seed'))).toBe(true)
    expect(result.issues.every((issue) => issue.message.trim().length > 0)).toBe(true)
  })
})

describe('parseAttempt', () => {
  test('preserves blank and Idle, accepting even incorrect or impossible answers', () => {
    const input = makeAttempt()
    input.cpu[0] = 'P1'
    input.io[0] = 'P1'
    input.cpu[39] = 'idle'
    const result = parseAttempt(input, makeProblem())
    expect(result).toEqual({ valid: true, value: input })
    if (!result.valid) throw new Error('Expected a valid attempt')
    expect(result.value.cpu[1]).toBeNull()
    expect(result.value.io[1]).toBe('idle')
    expect(result.value.cpu).not.toBe(input.cpu)
    expect(result.value.io).not.toBe(input.io)
  })

  test.each([null, undefined, {}, [], 'attempt'])('rejects malformed root %j', (input) => {
    expect(parseAttempt(input, makeProblem()).valid).toBe(false)
  })

  test('rejects missing, short, long, sparse, or non-array rows', () => {
    for (const row of [undefined, null, {}, [], Array(39).fill(null), Array(41).fill(null), Array(40)]) {
      for (const resource of ['cpu', 'io']) {
        expect(parseAttempt({ ...makeAttempt(), [resource]: row }, makeProblem()).valid).toBe(false)
      }
    }
  })

  test.each(['P4', 'P01', 'Idle', '', undefined, 0, {}, ['P1']])(
    'rejects unknown process IDs and malformed cells %j',
    (cell) => {
      const cpu: unknown[] = makeAttempt().cpu
      cpu[12] = cell
      expect(parseAttempt({ ...makeAttempt(), cpu }, makeProblem()).valid).toBe(false)
    },
  )
})
