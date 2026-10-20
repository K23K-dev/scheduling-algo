import { afterEach, describe, expect, test, vi } from 'vitest'
import { addMissingPriorities, generateProblem } from '../scheduling/generator'
import * as generator from '../scheduling/generator'
import { simulate } from '../scheduling/simulator'
import type { Problem, SchedulingSettings } from '../scheduling/types'
import { updateProblemSettings } from './settings'

const fcfs = { algorithm: 'fcfs-course' } as const
const rr = { algorithm: 'round-robin', quantum: 2 } as const

afterEach(() => vi.restoreAllMocks())

describe('updateProblemSettings', () => {
  test.each<SchedulingSettings>([
    fcfs,
    rr,
    { algorithm: 'round-robin', quantum: 1 },
    { algorithm: 'round-robin', quantum: 100 },
    { algorithm: 'sjf' },
    { algorithm: 'srtf' },
  ])('preserves a fitting workload and its seed with settings %j', (settings) => {
    const original = generateProblem(42, fcfs)
    const result = updateProblemSettings(original, settings, 99)

    expect(result).toEqual({
      problem: { ...original, settings },
      replaced: false,
    })
    expect(simulate(result.problem).status).toBe('complete')
  })

  test('keeps the same round-robin workload when its quantum is unchanged', () => {
    const original = generateProblem(42, rr)
    expect(updateProblemSettings(original, rr, 99)).toEqual({
      problem: original,
      replaced: false,
    })
  })

  test.each([
    { seed: 63, previous: rr, next: fcfs },
    { seed: 607, previous: fcfs, next: rr },
    { seed: 347, previous: rr, next: { algorithm: 'round-robin', quantum: 1 } as const },
    { seed: 89, previous: rr, next: { algorithm: 'sjf' } as const },
    { seed: 102, previous: rr, next: { algorithm: 'srtf' } as const },
    { seed: 63, previous: rr, next: { algorithm: 'priority', mode: 'non-preemptive' } as const },
    { seed: 63, previous: rr, next: { algorithm: 'priority', mode: 'preemptive' } as const },
  ])(
    'replaces an overflowing worksheet after changing settings: %j',
    ({ seed, previous, next }) => {
      const original = generateProblem(seed, previous)
      const before = structuredClone(original)
      expect(simulate({
        ...original,
        settings: next,
        processes: next.algorithm === 'priority'
          ? addMissingPriorities(original.seed, original.processes)
          : original.processes,
      }).status).toBe('limit-reached')

      const result = updateProblemSettings(original, next, 99)

      expect(result).toEqual({
        problem: generateProblem(99, next),
        replaced: true,
      })
      expect(simulate(result.problem).status).toBe('complete')
      expect(original).toEqual(before)
    },
  )

  test('accepts a workload completing exactly at time 40 after a settings change', () => {
    const original: Problem = {
      seed: 42,
      rulesVersion: 1,
      generatorVersion: 1,
      settings: fcfs,
      processes: [{ id: 'P1', arrival: 0, cpu1: 15, io: 5, cpu2: 20 }],
    }
    const result = updateProblemSettings(original, rr, 99)

    expect(simulate(result.problem)).toMatchObject({
      status: 'complete',
      completionTime: 40,
    })
    expect(result).toEqual({ problem: { ...original, settings: rr }, replaced: false })
  })

  test('returns detached data without mutating frozen input or settings', () => {
    const original = generateProblem(42, fcfs)
    Object.freeze(original.settings)
    original.processes.forEach(Object.freeze)
    Object.freeze(original.processes)
    Object.freeze(original)
    const next = Object.freeze({ algorithm: 'round-robin', quantum: 2 } as const)

    const result = updateProblemSettings(original, next, 99)

    expect(result.problem).not.toBe(original)
    expect(result.problem.settings).not.toBe(next)
    expect(result.problem.processes).not.toBe(original.processes)
    for (const [index, process] of result.problem.processes.entries()) {
      expect(process).not.toBe(original.processes[index])
      expect(process).toEqual(original.processes[index])
    }
    expect(original.settings).toEqual(fcfs)
  })

  test.each([
    { algorithm: 'round-robin', quantum: 0 },
    { algorithm: 'round-robin', quantum: 1.5 },
    { algorithm: 'fcfs-course', quantum: 2 },
    { algorithm: 'priority', mode: 'unknown' },
    { algorithm: 'priority', mode: 'preemptive', quantum: 1 },
    { algorithm: 'sjf', mode: 'non-preemptive' },
  ])('rejects invalid settings instead of generating a replacement: %j', (settings) => {
    const enrich = vi.spyOn(generator, 'addMissingPriorities')
    expect(() =>
      updateProblemSettings(generateProblem(42, fcfs), settings as SchedulingSettings, 99),
    ).toThrow(TypeError)
    expect(enrich).not.toHaveBeenCalled()
  })

  test.each(['preemptive', 'non-preemptive'] as const)(
    'adds stable priorities when a fitting workload switches to %s priority',
    (mode) => {
      const original = generateProblem(42, fcfs)
      const before = structuredClone(original)
      const settings = { algorithm: 'priority', mode } as const
      const result = updateProblemSettings(original, settings, 99)
      expect(result).toEqual({
        problem: {
          ...original,
          settings,
          processes: original.processes.map((process, index) => ({
            ...process,
            priority: [3, 5, 4][index],
          })),
        },
        replaced: false,
      })
      expect(updateProblemSettings(original, settings, 123).problem).toEqual(result.problem)
      expect(original).toEqual(before)
    },
  )

  test('preserves priorities, bursts and seed across mode changes and other algorithms', () => {
    const original: Problem = {
      ...generateProblem(42, fcfs),
      processes: [
        { id: 'P1', arrival: 0, cpu1: 4, io: 2, cpu2: 3, priority: -2 },
        { id: 'P2', arrival: 0, cpu1: 3, io: 2, cpu2: 4, priority: 7 },
        { id: 'P3', arrival: 0, cpu1: 4, io: 2, cpu2: 3, priority: 7 },
      ],
    }
    let current = original
    for (const settings of [
      { algorithm: 'priority', mode: 'preemptive' },
      { algorithm: 'priority', mode: 'non-preemptive' },
      { algorithm: 'sjf' },
      { algorithm: 'srtf' },
      rr,
      fcfs,
      { algorithm: 'priority', mode: 'preemptive' },
    ] satisfies SchedulingSettings[]) {
      const updated = updateProblemSettings(current, settings, 99)
      expect(updated.replaced).toBe(false)
      expect(updated.problem.seed).toBe(original.seed)
      expect(updated.problem.processes).toEqual(original.processes)
      current = updated.problem
    }
  })

  test('fills only missing priorities by numeric process order and keeps input order', () => {
    const original: Problem = {
      ...generateProblem(42, fcfs),
      processes: [
        { id: 'P10', arrival: 0, cpu1: 2, io: 1, cpu2: 2 },
        { id: 'P2', arrival: 0, cpu1: 2, io: 1, cpu2: 2, priority: 0 },
        { id: 'P1', arrival: 0, cpu1: 2, io: 1, cpu2: 2 },
      ],
    }
    const result = updateProblemSettings(
      original, { algorithm: 'priority', mode: 'preemptive' }, 99,
    )
    expect(result.replaced).toBe(false)
    expect(result.problem.processes).toEqual([
      { ...original.processes[0], priority: 4 },
      { ...original.processes[1], priority: 0 },
      { ...original.processes[2], priority: 3 },
    ])
    expect(original.processes[0]).not.toHaveProperty('priority')
  })

  test.each([undefined, null, NaN, 1.5, '2'])(
    'rejects an existing invalid priority %s instead of overwriting it',
    (priority) => {
      const original = generateProblem(42, fcfs)
      const invalid = {
        ...original,
        processes: original.processes.map((process) => ({ ...process, priority })),
      } as unknown as Problem
      const enrich = vi.spyOn(generator, 'addMissingPriorities')
      expect(() => updateProblemSettings(
        invalid, { algorithm: 'priority', mode: 'preemptive' }, 99,
      )).toThrow('priority')
      expect(enrich).not.toHaveBeenCalled()
    },
  )

  test('rejects an invalid original policy rather than repairing it through a settings change', () => {
    const original = generateProblem(42, fcfs)
    const invalid = { ...original, settings: { algorithm: 'priority', mode: 'preemptive' } } as const
    expect(() => updateProblemSettings(invalid, fcfs, 99)).toThrow('priority')
  })

  test('rejects malformed workload data instead of silently replacing it', () => {
    const original = generateProblem(42, fcfs)
    expect(() =>
      updateProblemSettings({ ...original, processes: [] }, rr, 99),
    ).toThrow('Provide at least one process')
  })

  test('validates the replacement seed when a replacement is needed', () => {
    expect(() =>
      updateProblemSettings(generateProblem(63, rr), fcfs, -1),
    ).toThrow('Invalid generator input')
  })
})
