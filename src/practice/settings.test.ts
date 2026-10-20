import { describe, expect, test } from 'vitest'
import { generateProblem } from '../scheduling/generator'
import { simulate } from '../scheduling/simulator'
import type { Problem, SchedulingSettings } from '../scheduling/types'
import { updateProblemSettings } from './settings'

const fcfs = { algorithm: 'fcfs-course' } as const
const rr = { algorithm: 'round-robin', quantum: 2 } as const

describe('updateProblemSettings', () => {
  test.each<SchedulingSettings>([
    fcfs,
    rr,
    { algorithm: 'round-robin', quantum: 1 },
    { algorithm: 'round-robin', quantum: 100 },
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
  ])(
    'replaces an overflowing worksheet after changing settings: %j',
    ({ seed, previous, next }) => {
      const original = generateProblem(seed, previous)
      const before = structuredClone(original)
      expect(simulate({ ...original, settings: next }).status).toBe('limit-reached')

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
  ])('rejects invalid settings instead of generating a replacement: %j', (settings) => {
    expect(() =>
      updateProblemSettings(generateProblem(42, fcfs), settings as SchedulingSettings, 99),
    ).toThrow(TypeError)
  })

  test.each<SchedulingSettings>([
    { algorithm: 'sjf' },
    { algorithm: 'srtf' },
    { algorithm: 'priority', mode: 'preemptive' },
    { algorithm: 'priority', mode: 'non-preemptive' },
  ])('rejects an unsupported policy explicitly: %j', (settings) => {
    expect(() =>
      updateProblemSettings(generateProblem(42, fcfs), settings, 99),
    ).toThrow('Unsupported scheduling algorithm')
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
