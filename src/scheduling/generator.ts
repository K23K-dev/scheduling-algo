import { simulate } from './simulator'
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
  if (
    settings?.algorithm === 'sjf' ||
    settings?.algorithm === 'srtf' ||
    settings?.algorithm === 'priority'
  ) {
    throw new Error(
      `Unsupported scheduling algorithm: ${settings.algorithm}. Only course FCFS and round robin are implemented.`,
    )
  }

  // Reuse the model's seed/settings validation and obtain detached fallback data.
  const parsed = parseProblem({
    seed,
    settings,
    rulesVersion: RULES_VERSION,
    generatorVersion: GENERATOR_VERSION,
    processes: FALLBACK_PROCESSES,
  })
  if (!parsed.valid) {
    throw new TypeError(
      `Invalid generator input: ${parsed.issues
        .map((issue) => `${issue.path || 'problem'}: ${issue.message}`)
        .join('; ')}`,
    )
  }

  const fallback = parsed.value
  const nextInteger = seededIntegers(fallback.seed)
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate: Problem = {
      ...fallback,
      processes: PROCESS_IDS.map((id) => ({
        id,
        arrival: 0,
        cpu1: nextInteger(8),
        io: nextInteger(5),
        cpu2: nextInteger(8),
      })),
    }
    if (fitsWorksheet(candidate)) return candidate
  }

  // All arrive at zero: 28 CPU units + 9 I/O units bound completion to [28,37]
  // under either work-conserving policy, even if none of that work overlaps.
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
