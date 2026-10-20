import { afterEach, describe, expect, test, vi } from 'vitest'
import { addMissingPriorities, createProblemSeed, generateProblem } from './generator'
import * as simulator from './simulator'
import type { Problem, ProcessInput, SchedulingSettings, SimulationResult } from './types'
import { parseProblem } from './validation'

const realSimulate = simulator.simulate
const fcfs = { algorithm: 'fcfs-course' } as const
const rr = { algorithm: 'round-robin', quantum: 2 } as const
const settingsCases: readonly SchedulingSettings[] = [
  fcfs,
  rr,
  { algorithm: 'sjf' },
  { algorithm: 'srtf' },
  { algorithm: 'priority', mode: 'non-preemptive' },
  { algorithm: 'priority', mode: 'preemptive' },
]
const overflow: SimulationResult = {
  status: 'limit-reached',
  completionTime: null,
  timeline: { cpu: [], io: [] },
  boundaries: [],
}

afterEach(() => vi.restoreAllMocks())

describe('generateProblem', () => {
  test.each([fcfs, rr])('preserves the version-1 seeded workload contract: %j', (settings) => {
    expect(generateProblem(42, settings)).toEqual({
      seed: 42,
      rulesVersion: 1,
      generatorVersion: 1,
      settings,
      processes: [
        { id: 'P1', arrival: 0, cpu1: 5, io: 3, cpu2: 7 },
        { id: 'P2', arrival: 0, cpu1: 6, io: 1, cpu2: 5 },
        { id: 'P3', arrival: 0, cpu1: 3, io: 4, cpu2: 7 },
      ],
    })
  })

  test('preserves the round-robin workload after rejecting earlier version-1 candidates', () => {
    expect(generateProblem(607, rr).processes).toEqual([
      { id: 'P1', arrival: 0, cpu1: 5, io: 3, cpu2: 6 },
      { id: 'P2', arrival: 0, cpu1: 3, io: 4, cpu2: 7 },
      { id: 'P3', arrival: 0, cpu1: 6, io: 5, cpu2: 8 },
    ])
  })

  test.each([-1, 0x1_0000_0000, 1.5, NaN, Infinity, '42', null, undefined, true])(
    'rejects an invalid seed %s before simulation',
    (seed) => {
      const simulation = vi.spyOn(simulator, 'simulate')
      expect(() => generateProblem(seed as number, fcfs)).toThrow(TypeError)
      expect(simulation).not.toHaveBeenCalled()
    },
  )

  test.each([
    null,
    undefined,
    {},
    { algorithm: 'unknown' },
    { algorithm: 'fcfs-course', quantum: 2 },
    { algorithm: 'round-robin' },
    { algorithm: 'round-robin', quantum: '2' },
    { algorithm: 'round-robin', quantum: 0 },
    { algorithm: 'round-robin', quantum: -1 },
    { algorithm: 'round-robin', quantum: 1.5 },
    { algorithm: 'round-robin', quantum: Infinity },
    { algorithm: 'round-robin', quantum: Number.MAX_SAFE_INTEGER + 1 },
    { algorithm: 'round-robin', quantum: 2, mode: 'preemptive' },
    { algorithm: 'priority' },
    { algorithm: 'priority', mode: 'unknown' },
    { algorithm: 'priority', mode: 'preemptive', quantum: 2 },
    { algorithm: 'sjf', mode: 'non-preemptive' },
  ])('rejects invalid settings %j before simulation', (settings) => {
    const simulation = vi.spyOn(simulator, 'simulate')
    expect(() => generateProblem(42, settings as SchedulingSettings)).toThrow(TypeError)
    expect(simulation).not.toHaveBeenCalled()
  })

  test.each(settingsCases)('reproduces fitting complete workloads for every policy: %j', (settings) => {
    for (const seed of [...Array.from({ length: 48 }, (_, index) => index), 0x8000_0000, 0xffff_ffff]) {
      const problem = generateProblem(seed, settings)
      expect(generateProblem(seed, settings)).toEqual(problem)
      expect(parseProblem(problem).valid).toBe(true)
      const result = realSimulate(problem)
      expect(result.status).toBe('complete')
      expect(result.completionTime).toBeGreaterThanOrEqual(28)
      expect(result.completionTime).toBeLessThanOrEqual(40)
      expect(result.timeline.cpu).toHaveLength(40)
      expect(result.timeline.io).toHaveLength(40)
      for (const process of problem.processes) {
        expect(result.timeline.cpu.filter((cell) => cell === process.id)).toHaveLength(
          process.cpu1 + process.cpu2,
        )
        expect(result.timeline.io.filter((cell) => cell === process.id)).toHaveLength(process.io)
        if (settings.algorithm === 'priority') {
          expect(process.priority).toBeGreaterThanOrEqual(1)
          expect(process.priority).toBeLessThanOrEqual(5)
        } else {
          expect(process).not.toHaveProperty('priority')
        }
      }
      result.timeline.cpu.forEach((cell, time) => {
        if (cell !== 'idle') expect(result.timeline.io[time]).not.toBe(cell)
      })
    }
  })

  test('keeps the CPU/I/O stream separate from priorities and uses stable values in both modes', () => {
    vi.spyOn(simulator, 'simulate').mockReturnValue({
      ...overflow,
      status: 'complete',
      completionTime: 28,
    })
    const first = generateProblem(42, fcfs)
    for (const settings of settingsCases) {
      const candidate = generateProblem(42, settings)
      expect(candidate.processes.map(({ id, arrival, cpu1, io, cpu2 }) => ({
        id, arrival, cpu1, io, cpu2,
      }))).toEqual(first.processes)
      if (settings.algorithm === 'priority') {
        expect(candidate.processes.map((process) => process.priority)).toEqual([3, 5, 4])
      }
    }
  })

  test('allows priority ties and keeps priorities stable after candidate rejection', () => {
    let sawTie = false
    for (let seed = 0; seed < 32; seed++) {
      const nonPreemptive = generateProblem(seed, { algorithm: 'priority', mode: 'non-preemptive' })
      const preemptive = generateProblem(seed, { algorithm: 'priority', mode: 'preemptive' })
      const priorities = nonPreemptive.processes.map((process) => process.priority)
      expect(preemptive.processes.map((process) => process.priority)).toEqual(priorities)
      if (new Set(priorities).size < priorities.length) sawTie = true
    }
    expect(sawTie).toBe(true)
    const evaluated: Problem[] = []
    vi.spyOn(simulator, 'simulate').mockImplementation((problem) => {
      evaluated.push(problem)
      return evaluated.length <= 3 ? overflow : realSimulate(problem)
    })
    const accepted = generateProblem(42, { algorithm: 'priority', mode: 'preemptive' })
    expect(evaluated.length).toBeGreaterThan(3)
    expect(evaluated.at(-1)).toBe(accepted)
    for (const candidate of evaluated) {
      expect(candidate.processes.map((process) => process.priority)).toEqual([3, 5, 4])
    }
  })

  test('generation does not use ambient randomness', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Unexpected ambient randomness')
    })
    const crypto = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('Unexpected ambient randomness')
    })
    expect(generateProblem(42, rr)).toEqual(generateProblem(42, rr))
    expect(random).not.toHaveBeenCalled()
    expect(crypto).not.toHaveBeenCalled()
  })

  test.each([
    { seed: 145, settings: fcfs },
    { seed: 185, settings: rr },
  ])('accepts a real schedule ending exactly at 40: %j', ({ seed, settings }) => {
    expect(realSimulate(generateProblem(seed, settings))).toMatchObject({
      status: 'complete',
      completionTime: 40,
    })
  })

  test('rejects short and overflowing samples whole, and keeps the first suitable one', () => {
    const evaluated: { problem: Problem; original: Problem; result: SimulationResult }[] = []
    vi.spyOn(simulator, 'simulate').mockImplementation((problem) => {
      const result = realSimulate(problem)
      evaluated.push({ problem, original: JSON.parse(JSON.stringify(problem)), result })
      return result
    })
    let rejectedOverflow = false
    let rejectedShort = false

    for (let seed = 0; seed < 50; seed++) {
      evaluated.length = 0
      const accepted = generateProblem(seed, rr)
      expect(evaluated.length).toBeLessThanOrEqual(101)
      expect(evaluated.at(-1)?.problem).toBe(accepted)
      for (const { problem, original, result } of evaluated.slice(0, -1)) {
        expect(problem).toEqual(original)
        expect(problem.processes).not.toBe(accepted.processes)
        if (result.status === 'limit-reached') rejectedOverflow = true
        else {
          expect(result.completionTime).toBeLessThan(28)
          rejectedShort = true
        }
      }
    }
    expect(rejectedOverflow).toBe(true)
    expect(rejectedShort).toBe(true)
  })

  test.each<SchedulingSettings>([
    ...settingsCases, { algorithm: 'round-robin', quantum: Number.MAX_SAFE_INTEGER },
  ])('stops after 100 rejected candidates and verifies a valid fallback: %j', (settings) => {
    const simulation = vi.spyOn(simulator, 'simulate').mockImplementation((problem) =>
      simulation.mock.calls.length <= 100 ? overflow : realSimulate(problem),
    )
    const result = generateProblem(0xffff_ffff, settings)

    expect(simulation).toHaveBeenCalledTimes(101)
    expect(result).toEqual({
      seed: 0xffff_ffff,
      rulesVersion: 1,
      generatorVersion: 1,
      settings,
      processes: [
        { id: 'P1', arrival: 0, cpu1: 5, io: 3, cpu2: 4 },
        { id: 'P2', arrival: 0, cpu1: 4, io: 4, cpu2: 5 },
        { id: 'P3', arrival: 0, cpu1: 6, io: 2, cpu2: 4 },
      ].map((process, index) => ({
        ...process,
        ...(settings.algorithm === 'priority'
          ? { priority: [5, 3, 2][index] }
          : {}),
      })),
    })
    const solution = realSimulate(result)
    expect(solution.status).toBe('complete')
    expect(solution.completionTime).toBeGreaterThanOrEqual(28)
    expect(solution.completionTime).toBeLessThanOrEqual(37)
  })

  test('fails loudly if even the known fallback stops fitting', () => {
    const simulation = vi.spyOn(simulator, 'simulate').mockReturnValue(overflow)
    expect(() => generateProblem(7, fcfs)).toThrow('fallback no longer fits')
    expect(simulation).toHaveBeenCalledTimes(101)
  })

  test('propagates simulator errors instead of silently treating bugs as rejections', () => {
    const simulation = vi.spyOn(simulator, 'simulate').mockImplementation(() => {
      throw new Error('Simulation failed')
    })
    expect(() => generateProblem(7, fcfs)).toThrow('Simulation failed')
    expect(simulation).toHaveBeenCalledTimes(1)
  })
})

describe('addMissingPriorities', () => {
  const processes: readonly ProcessInput[] = [
    { id: 'P10', arrival: 0, cpu1: 1, io: 1, cpu2: 1 },
    { id: 'P2', arrival: 0, cpu1: 1, io: 1, cpu2: 1 },
    { id: 'P1', arrival: 0, cpu1: 1, io: 1, cpu2: 1 },
  ]

  test('draws by numeric process order while preserving the input order and burst data', () => {
    expect(addMissingPriorities(42, processes)).toEqual([
      { ...processes[0], priority: 4 },
      { ...processes[1], priority: 5 },
      { ...processes[2], priority: 3 },
    ])
    expect(addMissingPriorities(42, [...processes].reverse())).toEqual(
      [...addMissingPriorities(42, processes)].reverse(),
    )
  })

  test('retains existing priorities without shifting the missing values or mutating input', () => {
    const partial = processes.map((process) => Object.freeze(
      process.id === 'P2' ? { ...process, priority: -7 } : { ...process },
    ))
    Object.freeze(partial)
    const enriched = addMissingPriorities(42, partial)
    expect(enriched).toEqual([
      { ...processes[0], priority: 4 },
      { ...processes[1], priority: -7 },
      { ...processes[2], priority: 3 },
    ])
    expect(addMissingPriorities(42, enriched)).toEqual(enriched)
    expect(partial[0]).not.toHaveProperty('priority')
    expect(enriched[1]).not.toBe(partial[1])
  })
})

describe('createProblemSeed', () => {
  test('uses an unsigned 32-bit random seed for a new problem', () => {
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const seed = createProblemSeed()
    expect(Number.isSafeInteger(seed)).toBe(true)
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThanOrEqual(0xffff_ffff)
    expect(random).toHaveBeenCalledTimes(1)
    expect(random.mock.calls[0][0]).toBeInstanceOf(Uint32Array)
    expect(random.mock.calls[0][0]).toHaveLength(1)
  })

  test.each([
    { previous: 42, random: 42, expected: 43 },
    { previous: 0xffff_ffff, random: 0xffff_ffff, expected: 0 },
    { previous: 42, random: 9, expected: 9 },
  ])('avoids the current seed in one bounded draw: %j', ({ previous, random, expected }) => {
    const draw = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((buffer) => {
      if (!(buffer instanceof Uint32Array)) throw new Error('Expected a uint32 seed buffer')
      buffer[0] = random
      return buffer
    })
    expect(createProblemSeed(previous)).toBe(expected)
    expect(draw).toHaveBeenCalledTimes(1)
  })

  test.each([-1, 0x1_0000_0000, 0.5, NaN, Infinity, '42', null])(
    'rejects an invalid previous seed %s',
    (seed) => {
      expect(() => createProblemSeed(seed as number)).toThrow(TypeError)
    },
  )
})
