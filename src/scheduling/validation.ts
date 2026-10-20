import { isProcessId } from './process-id'
import {
  GENERATOR_VERSION,
  RULES_VERSION,
  TIMELINE_LENGTH,
  type Attempt,
  type AttemptCell,
  type Problem,
  type ProcessId,
  type ProcessInput,
  type SchedulingSettings,
} from './types'

export interface ValidationIssue {
  readonly path: string
  readonly message: string
}

export type ValidationResult<T> =
  | { readonly valid: true; readonly value: T }
  | { readonly valid: false; readonly issues: readonly ValidationIssue[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readInteger(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    issues.push({ path, message: 'Expected a safe integer.' })
  } else if (value < min || value > max) {
    issues.push({ path, message: `Expected a value from ${min} to ${max}.` })
  } else {
    return value
  }
}

function readSettings(
  input: unknown,
  issues: ValidationIssue[],
): SchedulingSettings | undefined {
  if (!isRecord(input)) {
    issues.push({ path: 'settings', message: 'Expected scheduling settings.' })
    return
  }

  if ('quantum' in input && input.algorithm !== 'round-robin') {
    issues.push({
      path: 'settings.quantum',
      message: 'A quantum is only valid for round robin.',
    })
  }
  if ('mode' in input && input.algorithm !== 'priority') {
    issues.push({
      path: 'settings.mode',
      message: 'A preemption mode is only valid for priority scheduling.',
    })
  }

  switch (input.algorithm) {
    case 'fcfs-course':
    case 'sjf':
    case 'srtf':
      return { algorithm: input.algorithm }
    case 'round-robin': {
      const quantum = readInteger(input.quantum, 'settings.quantum', issues, 1)
      return quantum === undefined ? undefined : { algorithm: 'round-robin', quantum }
    }
    case 'priority':
      if (input.mode === 'preemptive' || input.mode === 'non-preemptive') {
        return { algorithm: 'priority', mode: input.mode }
      }
      issues.push({
        path: 'settings.mode',
        message: 'Choose preemptive or non-preemptive priority scheduling.',
      })
      return
    default:
      issues.push({
        path: 'settings.algorithm',
        message: 'Unknown scheduling algorithm.',
      })
  }
}

function readProcess(
  input: unknown,
  index: number,
  requiresPriority: boolean,
  issues: ValidationIssue[],
): ProcessInput | undefined {
  const path = `processes[${index}]`
  if (!isRecord(input)) {
    issues.push({ path, message: 'Expected a process.' })
    return
  }

  const id = isProcessId(input.id) ? input.id : undefined
  if (id === undefined) {
    issues.push({
      path: `${path}.id`,
      message: 'Use P followed by a positive safe integer, such as P1.',
    })
  }
  const arrival = readInteger(input.arrival, `${path}.arrival`, issues, 0)
  const cpu1 = readInteger(input.cpu1, `${path}.cpu1`, issues, 1)
  const io = readInteger(input.io, `${path}.io`, issues, 1)
  const cpu2 = readInteger(input.cpu2, `${path}.cpu2`, issues, 1)
  const hasPriority = 'priority' in input
  const priority =
    hasPriority || requiresPriority
      ? readInteger(input.priority, `${path}.priority`, issues)
      : undefined

  if (
    id === undefined ||
    arrival === undefined ||
    cpu1 === undefined ||
    io === undefined ||
    cpu2 === undefined ||
    ((hasPriority || requiresPriority) && priority === undefined)
  ) {
    return
  }

  return {
    id,
    arrival,
    cpu1,
    io,
    cpu2,
    ...(priority === undefined ? {} : { priority }),
  }
}

/**
 * Validate input data, not schedulability. A simulator must separately reject
 * workloads that exceed 40 intervals. Generator ranges are not model limits.
 */
export function parseProblem(input: unknown): ValidationResult<Problem> {
  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [{ path: '', message: 'Expected a scheduling problem.' }],
    }
  }

  const issues: ValidationIssue[] = []
  const seed = readInteger(input.seed, 'seed', issues, 0, 0xffff_ffff)
  if (input.rulesVersion !== RULES_VERSION) {
    issues.push({ path: 'rulesVersion', message: 'Unsupported scheduling rules version.' })
  }
  if (input.generatorVersion !== GENERATOR_VERSION) {
    issues.push({ path: 'generatorVersion', message: 'Unsupported generator version.' })
  }
  const settings = readSettings(input.settings, issues)
  const processes: ProcessInput[] = []
  const seen = new Set<ProcessId>()
  if (!Array.isArray(input.processes) || input.processes.length === 0) {
    issues.push({ path: 'processes', message: 'Provide at least one process.' })
  } else {
    for (let index = 0; index < input.processes.length; index++) {
      const process = readProcess(
        input.processes[index],
        index,
        settings?.algorithm === 'priority',
        issues,
      )
      if (process === undefined) continue
      if (seen.has(process.id)) {
        issues.push({
          path: `processes[${index}].id`,
          message: `Process ${process.id} is already defined.`,
        })
      }
      seen.add(process.id)
      processes.push(process)
    }
  }

  if (issues.length > 0 || seed === undefined || settings === undefined) {
    return { valid: false, issues }
  }
  return {
    valid: true,
    value: {
      seed,
      rulesVersion: RULES_VERSION,
      generatorVersion: GENERATOR_VERSION,
      settings,
      processes,
    },
  }
}

/** Validate saved answer structure without judging the learner's assignments. */
export function parseAttempt(
  input: unknown,
  problem: Problem,
): ValidationResult<Attempt> {
  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [{ path: '', message: 'Expected CPU and I/O answer rows.' }],
    }
  }

  const issues: ValidationIssue[] = []
  const processIds = new Set(problem.processes.map((process) => process.id))
  function readRow(value: unknown, path: 'cpu' | 'io'): AttemptCell[] {
    if (!Array.isArray(value) || value.length !== TIMELINE_LENGTH) {
      issues.push({ path, message: `Expected exactly ${TIMELINE_LENGTH} cells.` })
      return []
    }

    const cells: AttemptCell[] = []
    for (let index = 0; index < value.length; index++) {
      const cell: unknown = value[index]
      if (cell === null || cell === 'idle' || (isProcessId(cell) && processIds.has(cell))) {
        cells.push(cell)
      } else {
        issues.push({
          path: `${path}[${index}]`,
          message: 'Expected an unanswered cell, Idle, or a process in this problem.',
        })
      }
    }
    return cells
  }

  const cpu = readRow(input.cpu, 'cpu')
  const io = readRow(input.io, 'io')
  return issues.length > 0
    ? { valid: false, issues }
    : { valid: true, value: { cpu, io } }
}
