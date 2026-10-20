import { expect, test } from 'vitest'
import { generateProblem } from './generator'
import { simulate } from './simulator'
import {
  GENERATOR_VERSION,
  RULES_VERSION,
  TIMELINE_LENGTH,
  type SchedulingSettings,
} from './types'

const configurations: { name: string; settings: SchedulingSettings }[] = [
  { name: 'course FCFS', settings: { algorithm: 'fcfs-course' } },
  ...[1, 2, 3, 4, 8, Number.MAX_SAFE_INTEGER].map((quantum) => ({
    name: `round robin with quantum ${quantum}`,
    settings: { algorithm: 'round-robin' as const, quantum },
  })),
]

// Exercise adjacent seeds and the signed/unsigned boundaries without relying on
// random test inputs or on the generator's own random-number implementation.
const seeds = [
  ...Array.from({ length: 64 }, (_, seed) => seed),
  0x1234_5678,
  0x7fff_ffff,
  0x8000_0000,
  0x9e37_79b9,
  0xffff_fffe,
  0xffff_ffff,
]

test.each(configurations)('$name generates bounded, varied, complete worksheets', ({ settings }) => {
  const workloads = new Set<string>()
  let overlap = false
  let ioContention = false
  let blockedCpuIdle = false
  let meaningfulExpiration = false

  for (const seed of seeds) {
    const problem = generateProblem(seed, settings)
    const original = JSON.stringify(problem)
    expect(problem.seed).toBe(seed)
    expect(problem.rulesVersion).toBe(RULES_VERSION)
    expect(problem.generatorVersion).toBe(GENERATOR_VERSION)
    expect(problem.settings).toEqual(settings)
    expect(problem.processes.map(({ id }) => id)).toEqual(['P1', 'P2', 'P3'])

    for (const process of problem.processes) {
      expect(process.arrival).toBe(0)
      expect(process).not.toHaveProperty('priority')
      for (const burst of [process.cpu1, process.cpu2]) {
        expect(Number.isInteger(burst)).toBe(true)
        expect(burst).toBeGreaterThanOrEqual(1)
        expect(burst).toBeLessThanOrEqual(8)
      }
      expect(Number.isInteger(process.io)).toBe(true)
      expect(process.io).toBeGreaterThanOrEqual(1)
      expect(process.io).toBeLessThanOrEqual(5)
    }

    workloads.add(JSON.stringify(problem.processes))
    const result = simulate(problem)
    expect(JSON.stringify(problem)).toBe(original)
    expect(result.status).toBe('complete')
    if (result.status !== 'complete') throw new Error(`Seed ${seed} does not fit.`)
    expect(result.completionTime).toBeGreaterThanOrEqual(28)
    expect(result.completionTime).toBeLessThanOrEqual(TIMELINE_LENGTH)
    expect(result.timeline.cpu).toHaveLength(TIMELINE_LENGTH)
    expect(result.timeline.io).toHaveLength(TIMELINE_LENGTH)
    expect(result.boundaries.at(-1)?.processes.every(({ status }) => status === 'completed'))
      .toBe(true)

    // Verify the accepted worksheet contains all the original work, including
    // the final burst, rather than obtaining a fit by clipping the answer.
    for (const process of problem.processes) {
      expect(result.timeline.cpu.filter((cell) => cell === process.id))
        .toHaveLength(process.cpu1 + process.cpu2)
      expect(result.timeline.io.filter((cell) => cell === process.id))
        .toHaveLength(process.io)
    }
    expect(result.timeline.cpu.slice(result.completionTime).every((cell) => cell === 'idle'))
      .toBe(true)
    expect(result.timeline.io.slice(result.completionTime).every((cell) => cell === 'idle'))
      .toBe(true)

    for (const boundary of result.boundaries) {
      if (boundary.kind !== 'interval-start' || boundary.time >= result.completionTime) continue
      overlap ||= boundary.cpu !== 'idle' && boundary.io !== 'idle'
      ioContention ||= boundary.ioQueue.length > 0
      blockedCpuIdle ||= boundary.cpu === 'idle' && boundary.processes.some((process) =>
        process.status === 'waiting-for-io' || process.status === 'performing-io')

      const expiration = boundary.events.find((event) => event.type === 'quantum-expired')
      const dispatch = boundary.events.find((event) => event.type === 'cpu-dispatched')
      meaningfulExpiration ||= expiration !== undefined && dispatch !== undefined &&
        dispatch.processId !== expiration.processId && dispatch.candidates.length > 1
      if (settings.algorithm !== 'round-robin' || settings.quantum >= 8) {
        expect(expiration).toBeUndefined()
      }
    }
  }

  // Diversity belongs to the set of generated exercises; an individual problem
  // need not include every teaching case.
  expect(workloads.size).toBeGreaterThan(seeds.length / 2)
  expect(overlap).toBe(true)
  expect(ioContention).toBe(true)
  expect(blockedCpuIdle).toBe(true)
  if (settings.algorithm === 'round-robin' && settings.quantum < 8) {
    expect(meaningfulExpiration).toBe(true)
  }
})

function objectsIn(value: unknown, objects = new Set<object>()): Set<object> {
  if (value === null || typeof value !== 'object' || objects.has(value)) return objects
  objects.add(value)
  for (const child of Object.values(value)) objectsIn(child, objects)
  return objects
}

test.each(configurations)('$name generation is reproducible and detached from other calls', ({ settings }) => {
  const frozenSettings = Object.freeze({ ...settings })
  const originalSettings = JSON.stringify(frozenSettings)
  for (const seed of [0, 0x8000_0000, 0xffff_ffff]) {
    const first = generateProblem(seed, frozenSettings)
    const originalProblem = JSON.stringify(first)
    generateProblem((seed ^ 0x1234) >>> 0, { algorithm: 'round-robin', quantum: 3 })
    const second = generateProblem(seed, frozenSettings)
    expect(second).toEqual(first)
    expect(JSON.stringify(frozenSettings)).toBe(originalSettings)
    expect(first.settings).not.toBe(frozenSettings)
    expect(second.settings).not.toBe(frozenSettings)

    const firstObjects = objectsIn(first)
    for (const object of objectsIn(second)) expect(firstObjects.has(object)).toBe(false)
    expect(new Set(first.processes).size).toBe(first.processes.length)

    // Runtime consumers can change their local copy despite the readonly API;
    // neither earlier results nor future reproduction may inherit that change.
    if (!Object.isFrozen(second.processes[0])) {
      Object.assign(second.processes[0], { cpu1: 99 })
    }
    if (!Object.isFrozen(second.settings)) {
      Object.assign(second.settings, { algorithm: 'sjf' })
    }
    expect(JSON.stringify(first)).toBe(originalProblem)
    expect(generateProblem(seed, frozenSettings)).toEqual(first)
  }
})
