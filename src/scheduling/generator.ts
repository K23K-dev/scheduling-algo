import { simulate } from './simulator'
import { compareProcessIds } from './rules'
import {
  GENERATOR_VERSION,
  RULES_VERSION,
  TIMELINE_LENGTH,
  type Problem,
  type ProcessId,
  type ProcessInput,
  type SchedulingSettings,
} from './types'
import { parseProblem } from './validation'

// These choices are part of generator version 1. Changing the PRNG, draw order,
// ranges, acceptance rules, attempt limit, or fallback requires a new version.
const MAX_ATTEMPTS = 100
const MIN_COMPLETION_TIME = 28
const PROCESS_IDS = ['P1', 'P2', 'P3'] as const satisfies readonly ProcessId[]
const FALLBACK_PROCESSES: readonly ProcessInput[] = [
  { id: 'P1', arrival: 0, cpu1: 5, io: 3, cpu2: 4 },
  { id: 'P2', arrival: 0, cpu1: 4, io: 4, cpu2: 5 },
  { id: 'P3', arrival: 0, cpu1: 6, io: 2, cpu2: 4 },
]

/** A local uint32 stream, including seed zero; never use ambient randomness. */
function seededIntegers(seed: number): (max: number) => number {
  let state = seed
  return (max) => {
    // Mulberry32: integer operations keep the stream identical across runtimes.
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    const fraction = ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000
    return 1 + Math.floor(fraction * max)
  }
}

/**
 * Add priorities to an already validated workload without changing its bursts.
 * Version 1 uses an independent Mulberry32 stream seeded by seed XOR 0x9e3779b9:
 * one draw in [1,5] per process in numeric ID order, including processes that
 * already have priorities. Keep existing values and the original array order.
 * The stream restarts for each candidate and the fallback, so modes and rejected
 * candidates never change a generated priority or the CPU/I/O draw stream.
 */
export function addMissingPriorities(
  seed: number,
  processes: readonly ProcessInput[],
): readonly ProcessInput[] {
  const nextPriority = seededIntegers((seed ^ 0x9e3779b9) >>> 0)
  const generated = new Map(
    [...processes]
      .sort((a, b) => compareProcessIds(a.id, b.id))
      .map((process) => [process.id, nextPriority(5)] as const),
  )
  return processes.map((process) => ({
    ...process,
    priority: process.priority ?? generated.get(process.id)!,
  }))
}

function fitsWorksheet(problem: Problem): boolean {
  const result = simulate(problem)
  return (
    result.status === 'complete' &&
    result.completionTime >= MIN_COMPLETION_TIME &&
    result.completionTime <= TIMELINE_LENGTH
  )
}

/**
 * Reproduce a version-1 workload from its seed and settings. Rejected candidates
 * are discarded whole; no burst is clipped or shortened to fit the worksheet.
 */
export function generateProblem(seed: number, settings: SchedulingSettings): Problem {
  // Reuse the model's seed/settings validation and obtain detached fallback data.
  const parsed = parseProblem({
    seed,
    settings,
    rulesVersion: RULES_VERSION,
    generatorVersion: GENERATOR_VERSION,
    processes:
      settings?.algorithm === 'priority'
        ? FALLBACK_PROCESSES.map((process) => ({ ...process, priority: 1 }))
        : FALLBACK_PROCESSES,
  })
  if (!parsed.valid) {
    throw new TypeError(
      `Invalid generator input: ${parsed.issues
        .map((issue) => `${issue.path || 'problem'}: ${issue.message}`)
        .join('; ')}`,
    )
  }

  const fallback: Problem = {
    ...parsed.value,
    processes:
      parsed.value.settings.algorithm === 'priority'
        ? addMissingPriorities(parsed.value.seed, FALLBACK_PROCESSES)
        : parsed.value.processes,
  }
  const nextInteger = seededIntegers(fallback.seed)
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const processes = PROCESS_IDS.map((id) => ({
      id,
      arrival: 0,
      cpu1: nextInteger(8),
      io: nextInteger(5),
      cpu2: nextInteger(8),
    }))
    const candidate: Problem = {
      ...fallback,
      processes:
        fallback.settings.algorithm === 'priority'
          ? addMissingPriorities(fallback.seed, processes)
          : processes,
    }
    if (fitsWorksheet(candidate)) return candidate
  }

  // All arrive at zero: 28 CPU units + 9 I/O units bound completion to [28,37]
  // under every work-conserving policy, even if none of that work overlaps.
  if (!fitsWorksheet(fallback)) {
    throw new Error('The generator fallback no longer fits the worksheet.')
  }
  return fallback
}

/** Use only for New problem; Retry should retain the existing Problem. */
export function createProblemSeed(previousSeed?: number): number {
  if (
    previousSeed !== undefined &&
    (!Number.isSafeInteger(previousSeed) || previousSeed < 0 || previousSeed > 0xffff_ffff)
  ) {
    throw new TypeError('The previous seed must be an unsigned 32-bit integer.')
  }
  const seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
  // Avoid repeating the current seed without a potentially unbounded retry loop.
  return seed === previousSeed ? (seed + 1) >>> 0 : seed
}
