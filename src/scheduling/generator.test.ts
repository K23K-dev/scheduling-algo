import { afterEach, describe, expect, test, vi } from 'vitest'
import { createProblemSeed, generateProblem } from './generator'
import * as simulator from './simulator'
import type { Problem, SchedulingSettings, SimulationResult } from './types'

const realSimulate = simulator.simulate
const fcfs = { algorithm: 'fcfs-course' } as const
const rr = { algorithm: 'round-robin', quantum: 2 } as const
const overflow: SimulationResult = {
  status: 'limit-reached',
  completionTime: null,
  timeline: { cpu: [], io: [] },
  boundaries: [],
}

afterEach(() => vi.restoreAllMocks())

describe('generateProblem', () => {
  test('preserves the version-1 seeded workload contract', () => {
    expect(generateProblem(42, fcfs)).toEqual({
      seed: 42,
      rulesVersion: 1,
      generatorVersion: 1,
      settings: fcfs,
      processes: [
        { id: 'P1', arrival: 0, cpu1: 5, io: 3, cpu2: 7 },
        { id: 'P2', arrival: 0, cpu1: 6, io: 1, cpu2: 5 },
        { id: 'P3', arrival: 0, cpu1: 3, io: 4, cpu2: 7 },
      ],
    })
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
  ])('rejects invalid settings %j before simulation', (settings) => {
    const simulation = vi.spyOn(simulator, 'simulate')
    expect(() => generateProblem(42, settings as SchedulingSettings)).toThrow(TypeError)
    expect(simulation).not.toHaveBeenCalled()
  })

  test.each<SchedulingSettings>([
    { algorithm: 'sjf' },
    { algorithm: 'srtf' },
    { algorithm: 'priority', mode: 'preemptive' },
    { algorithm: 'priority', mode: 'non-preemptive' },
  ])('rejects an unimplemented policy %j explicitly', (settings) => {
    expect(() => generateProblem(42, settings)).toThrow('Unsupported scheduling algorithm')
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
    fcfs, rr, { algorithm: 'round-robin', quantum: Number.MAX_SAFE_INTEGER },
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
      ],
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
