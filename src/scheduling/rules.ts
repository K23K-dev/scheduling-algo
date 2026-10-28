import { TIMELINE_LENGTH } from './types'
import { isProcessId } from './process-id'
import type {
  CpuCandidate,
  ProcessId,
  ProcessInput,
  ReadyQueueEntry,
  SchedulingSettings,
} from './types'

const BOUNDARY_PHASES = [
  'completions',
  'newly-ready',
  'preemption',
  'dispatch',
  'execute',
] as const

export type BoundaryPhase = (typeof BOUNDARY_PHASES)[number]

/**
 * Complete CPU and I/O work first, including blocking/completion when a CPU
 * burst and quantum end together. Then append the batch of arrivals and I/O
 * returns, sorted by process number, after processes already waiting.
 *
 * An unfinished expired/preempted process is appended last with enteredAt=t.
 * Dispatch starts queued I/O and selects CPU work before executing [t,t+1).
 * Boundary 40 performs bookkeeping only: there is no interval [40,41).
 */
export function getBoundaryPhases(time: number): readonly BoundaryPhase[] {
  if (!Number.isInteger(time) || time < 0 || time > TIMELINE_LENGTH) {
    throw new RangeError(`Boundary must be an integer from 0 to ${TIMELINE_LENGTH}.`)
  }

  return BOUNDARY_PHASES.slice(0, time === TIMELINE_LENGTH ? 3 : 5)
}

function processNumber(id: ProcessId): number {
  if (!isProcessId(id)) {
    throw new TypeError(`Invalid process ID: ${id}.`)
  }

  return Number(id.slice(1))
}

/** Compare numeric process IDs, so P2 precedes P10. */
export function compareProcessIds(a: ProcessId, b: ProcessId): number {
  return processNumber(a) - processNumber(b)
}

/** Course FCFS preserves original launch order, even after an I/O return. */
export function compareLaunchOrder(a: ProcessInput, b: ProcessInput): number {
  return a.arrival - b.arrival || compareProcessIds(a.id, b.id)
}

/**
 * Tie-break only after equal SJF/SRTF lengths or equal priorities.
 * Never sort the round-robin queue with this comparator: its array order is
 * FIFO, including an expired process appended after new entrants at time t.
 */
export function compareReadyEntries(a: ReadyQueueEntry, b: ReadyQueueEntry): number {
  return a.enteredAt - b.enteredAt || compareProcessIds(a.processId, b.processId)
}

function requiredPriority(candidate: CpuCandidate): number {
  if (candidate.priority === undefined || !Number.isSafeInteger(candidate.priority)) {
    throw new TypeError(`Process ${candidate.processId} requires a safe integer priority.`)
  }

  return candidate.priority
}

/** Evaluate a single challenger; selecting that challenger belongs to the simulator. */
export function shouldPreempt(
  settings: SchedulingSettings,
  running: CpuCandidate,
  challenger: CpuCandidate,
): boolean {
  switch (settings.algorithm) {
    case 'srtf':
      return challenger.remainingCpu < running.remainingCpu
    case 'priority': {
      const runningPriority = requiredPriority(running)
      const challengerPriority = requiredPriority(challenger)
      return settings.mode === 'preemptive' && challengerPriority < runningPriority
    }
    case 'fcfs-course':
    case 'sjf':
    case 'round-robin':
      return false
  }
}

/** A completed burst blocks or completes instead of being requeued. */
export function shouldRequeueAfterQuantum(
  remainingCpu: number,
  quantumRemaining: number,
): boolean {
  if (
    !Number.isSafeInteger(remainingCpu) ||
    remainingCpu < 0 ||
    !Number.isSafeInteger(quantumRemaining) ||
    quantumRemaining < 0
  ) {
    throw new RangeError('Remaining CPU and quantum must be non-negative safe integers.')
  }

  return remainingCpu > 0 && quantumRemaining === 0
}

export interface SchedulingRule {
  readonly label: string
  readonly selection: string
  readonly preemption: string
  readonly tieBreak: string
}

const READY_TIE_BREAK = 'Earlier ready-entry time, then lower process number.'
const NO_PREEMPTION = 'A running CPU burst finishes before another process runs.'

/** Display text and the pure policy helpers share the same settings union. */
export function getSchedulingRule(settings: SchedulingSettings): SchedulingRule {
  switch (settings.algorithm) {
    case 'fcfs-course':
      return {
        label: 'FCFS',
        selection: 'Choose the ready process with the earliest original arrival.',
        preemption: NO_PREEMPTION,
        tieBreak: 'Lower process number for equal arrivals; I/O returns retain launch order.',
      }
    case 'sjf':
      return {
        label: 'SJF',
        selection: 'Choose the shortest current CPU burst, excluding future CPU and I/O work.',
        preemption: NO_PREEMPTION,
        tieBreak: READY_TIE_BREAK,
      }
    case 'srtf':
      return {
        label: 'SRTF',
        selection: 'Choose the shortest remaining current CPU burst.',
        preemption: 'Preempt only for a strictly shorter remaining burst; preserve unfinished work.',
        tieBreak: `${READY_TIE_BREAK} Equal lengths do not preempt.`,
      }
    case 'priority':
      return {
        label: `Priority — ${settings.mode}`,
        selection: 'Choose the highest priority; smaller numbers mean higher priority.',
        preemption:
          settings.mode === 'preemptive'
            ? 'Preempt only for a strictly higher priority; preserve unfinished work.'
            : NO_PREEMPTION,
        tieBreak: `${READY_TIE_BREAK} Equal priorities do not preempt.`,
      }
    case 'round-robin':
      return {
        label: `Round robin — quantum ${settings.quantum}`,
        selection: 'Take the first process in the FIFO ready queue; give it a fresh quantum.',
        preemption: 'Requeue an unfinished burst when its quantum expires. Discard unused quantum.',
        tieBreak: 'Keep existing waiters, then new entrants by process number, then the expired process.',
      }
  }
}

export const SHARED_SCHEDULING_RULES = [
  'One CPU and one FIFO I/O device run in parallel, with no switching overhead.',
  'I/O runs to completion. Processes using or waiting for I/O are blocked from the CPU.',
  'A process can use only one resource at a time.',
  'Finish CPU and I/O work, add newly ready processes, handle preemption, then dispatch and execute.',
  'Append simultaneous arrivals and I/O returns by process number after existing waiters.',
  'Append preempted or expired processes last, using the current time as their ready-entry time.',
  'CPU burst completion takes precedence over quantum expiration.',
] as const
