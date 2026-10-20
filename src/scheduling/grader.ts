import { simulate } from './simulator'
import {
  TIMELINE_LENGTH,
  type Attempt,
  type AttemptCell,
  type BoundarySnapshot,
  type Problem,
  type ProcessId,
  type ProcessState,
  type ReferenceCell,
  type Resource,
} from './types'
import { parseAttempt } from './validation'

export interface GradeIssue {
  readonly resource: Resource
  readonly actual: AttemptCell
  readonly expected: ReferenceCell
  readonly explanation: string
}

export type GradeResult =
  | { readonly status: 'correct' }
  | {
      readonly status: 'needs-correction'
      readonly time: number
      readonly issues: readonly GradeIssue[]
    }

type IntervalBoundary = Extract<BoundarySnapshot, { kind: 'interval-start' }>

function units(count: number, kind: 'CPU' | 'I/O'): string {
  return `${count} ${kind} ${count === 1 ? 'unit' : 'units'}`
}

function processState(boundary: BoundarySnapshot, id: ProcessId): ProcessState {
  const state = boundary.processes.find((process) => process.processId === id)
  if (state === undefined) throw new Error(`Missing simulation state for ${id}.`)
  return state
}

/** Describe eligibility at this boundary, not the learner's hypothetical schedule. */
function describeAssignment(
  problem: Problem,
  boundary: IntervalBoundary,
  resource: Resource,
  actual: AttemptCell,
): string {
  if (actual === null) return 'This cell is unanswered.'
  if (actual === 'idle') return 'You marked this interval Idle.'

  const state = processState(boundary, actual)
  switch (state.status) {
    case 'not-arrived':
      return `${actual} has not arrived yet; its arrival is at time ${problem.processes.find((process) => process.id === actual)!.arrival}.`
    case 'completed':
      return `${actual} completed at time ${state.completedAt} and has no work left.`
    case 'waiting-for-io':
      return resource === 'cpu'
        ? `${actual} is waiting for I/O with ${units(state.remainingIo, 'I/O')} remaining, so it cannot run on the CPU yet.`
        : `${actual} is waiting for I/O after requesting it at time ${state.requestedAt}.`
    case 'performing-io':
      return `${actual} is performing I/O with ${units(state.remainingIo, 'I/O')} remaining, so it cannot run on the CPU yet.`
    case 'ready':
    case 'running':
      if (resource === 'io') {
        return state.burst === 2
          ? `${actual} has already finished its I/O and is on CPU burst 2.`
          : `${actual} still has ${units(state.remainingCpu, 'CPU')} in CPU burst 1 before it can request I/O.`
      }
      return `${actual} is ready for CPU burst ${state.burst} with ${units(state.remainingCpu, 'CPU')} remaining.`
  }
}

function describeCpuEvents(
  problem: Problem,
  boundary: IntervalBoundary,
  previous: BoundarySnapshot | undefined,
): string[] {
  const descriptions: string[] = []
  for (const event of boundary.events) {
    if (event.type === 'cpu-burst-completed') {
      descriptions.push(
        event.burst === 1
          ? `${event.processId} completed CPU burst 1 and requested I/O at time ${boundary.time}.`
          : `${event.processId} completed CPU burst 2 and finished at time ${boundary.time}.`,
      )
      const priorState = previous?.processes.find(
        (process) => process.processId === event.processId,
      )
      if (
        problem.settings.algorithm === 'round-robin' &&
        priorState?.status === 'running' &&
        priorState.quantumRemaining === 1
      ) {
        descriptions.push(
          'The burst completed at the quantum boundary, so completion takes priority over expiration; the process is not requeued.',
        )
      }
    } else if (event.type === 'quantum-expired') {
      descriptions.push(
        `${event.processId}'s quantum expired with ${units(event.remainingCpu, 'CPU')} remaining. It joins the back of the ready queue, after existing waiters and this boundary's arrivals or I/O returns.`,
      )
    } else if (event.type === 'became-ready') {
      if (event.reason === 'io-completion') {
        descriptions.push(
          `${event.processId} finished I/O and became ready for CPU burst 2 at time ${boundary.time}.`,
        )
      } else if (boundary.time > 0) {
        descriptions.push(`${event.processId} arrived at time ${boundary.time}.`)
      }
    }
  }
  return descriptions
}

function describeCpu(
  problem: Problem,
  boundary: IntervalBoundary,
  previous: BoundarySnapshot | undefined,
): string {
  const context = describeCpuEvents(problem, boundary, previous)
  if (boundary.cpu === 'idle') {
    const idle = boundary.events.find(
      (event) => event.type === 'resource-idle' && event.resource === 'cpu',
    )
    context.push(
      idle?.type === 'resource-idle' && idle.reason === 'all-completed'
        ? 'All processes have completed, so the CPU must be Idle.'
        : 'The CPU must be Idle because no process is ready to run.',
    )
    return context.join(' ')
  }

  const state = processState(boundary, boundary.cpu)
  if (state.status !== 'running') throw new Error('The CPU owner must be running.')
  const dispatched = boundary.events.find((event) => event.type === 'cpu-dispatched')
  if (dispatched?.type === 'cpu-dispatched') {
    // The snapshot's ready queue excludes the selected process. The recorded
    // candidates preserve the complete queue at the moment of the decision.
    if (dispatched.criterion === 'original-launch-order') {
      const arrivals = dispatched.candidates.map((candidate) => {
        const input = problem.processes.find((process) => process.id === candidate.processId)!
        return `${candidate.processId} (arrival ${input.arrival})`
      })
      context.push(
        `Ready candidates: ${arrivals.join(', ')}. Course FCFS selects ${state.processId} by original launch order: earliest arrival, then lowest numeric process ID. This order is retained after I/O.`,
        `${state.processId} starts CPU burst ${state.burst} with ${units(state.remainingCpu, 'CPU')} remaining.`,
      )
    } else if (dispatched.criterion === 'fifo-ready-queue') {
      context.push(
        `Ready queue before dispatch: ${dispatched.candidates.map((candidate) => candidate.processId).join(' → ')}.`,
        `Round robin selects ${state.processId} from the front for CPU burst ${state.burst}, with ${units(state.remainingCpu, 'CPU')} remaining and a fresh ${state.quantumRemaining}-unit quantum.`,
      )
    } else {
      throw new Error(`Unsupported grading criterion: ${dispatched.criterion}.`)
    }
  } else {
    context.push(
      `${state.processId} continues CPU burst ${state.burst} with ${units(state.remainingCpu, 'CPU')} remaining.`,
      state.quantumRemaining === null
        ? 'Course FCFS does not preempt an unfinished CPU burst.'
        : `Its current quantum still has ${state.quantumRemaining} ${state.quantumRemaining === 1 ? 'unit' : 'units'} left, so it keeps the CPU.`,
    )
  }
  return context.join(' ')
}

function describeIo(boundary: IntervalBoundary): string {
  const completed = boundary.events.find((event) => event.type === 'io-completed')
  if (boundary.io === 'idle') {
    const idle = boundary.events.find(
      (event) => event.type === 'resource-idle' && event.resource === 'io',
    )
    const reason = idle?.type === 'resource-idle' && idle.reason === 'all-completed'
      ? 'All processes have completed, so the I/O device must be Idle.'
      : 'The I/O device must be Idle because there is no outstanding I/O request.'
    return completed?.type === 'io-completed'
      ? `${completed.processId} finished I/O at time ${boundary.time} and became ready for CPU burst 2. ${reason}`
      : reason
  }

  const state = processState(boundary, boundary.io)
  if (state.status !== 'performing-io') throw new Error('The I/O owner must be performing I/O.')
  const started = boundary.events.some(
    (event) => event.type === 'io-started' && event.processId === state.processId,
  )
  if (started) {
    const completion =
      completed?.type === 'io-completed'
        ? `${completed.processId} finished I/O at time ${boundary.time}, freeing the device. `
        : ''
    const requested = boundary.events.some(
      (event) => event.type === 'io-requested' && event.processId === state.processId,
    )
    const request = requested
      ? `${state.processId} completed CPU burst 1 and requested I/O at time ${boundary.time}. `
      : ''
    return `${completion}${request}${state.processId} starts I/O with ${units(state.remainingIo, 'I/O')} remaining. It has the oldest outstanding request; the I/O device serves requests in FIFO order.`
  }
  return `The I/O device is still busy with ${state.processId}, which started at time ${state.startedAt} and has ${units(state.remainingIo, 'I/O')} remaining. I/O is nonpreemptive, so this request must finish before another starts.`
}

/** Check both resources at each time and reveal only the earliest divergence. */
export function gradeAttempt(problem: Problem, attempt: Attempt): GradeResult {
  // The shared simulator validates the problem and rejects unsupported policies.
  const solution = simulate(problem)
  if (solution.status !== 'complete') {
    throw new RangeError('Cannot grade a problem that does not finish within 40 intervals.')
  }
  const parsed = parseAttempt(attempt, problem)
  if (!parsed.valid) {
    throw new TypeError(
      `Invalid attempt: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    )
  }

  for (let time = 0; time < TIMELINE_LENGTH; time++) {
    const issues: GradeIssue[] = []
    const boundary = solution.boundaries[time]
    if (boundary.kind !== 'interval-start') {
      throw new Error('Grading requires an interval-start boundary.')
    }
    for (const resource of ['cpu', 'io'] as const) {
      const actual = parsed.value[resource][time]
      const expected = solution.timeline[resource][time]
      if (actual === expected) continue
      const reason =
        resource === 'cpu'
          ? describeCpu(problem, boundary, solution.boundaries[time - 1])
          : describeIo(boundary)
      issues.push({
        resource,
        actual,
        expected,
        explanation: `${describeAssignment(problem, boundary, resource, actual)} ${reason}`,
      })
    }
    if (issues.length > 0) return { status: 'needs-correction', time, issues }
  }
  return { status: 'correct' }
}
