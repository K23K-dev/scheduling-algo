import { gradeAttempt } from './grader'
import { getSchedulingRule } from './rules'
import { simulate } from './simulator'
import type {
  Attempt,
  BoundarySnapshot,
  CpuCandidate,
  Problem,
  Resource,
} from './types'

export type HintLevel = 1 | 2 | 3

export type HintResult =
  | { readonly status: 'correct' }
  | {
      readonly status: 'hint'
      readonly time: number
      readonly level: HintLevel
      readonly resources: readonly Resource[]
      readonly messages: readonly { readonly resource: Resource; readonly text: string }[]
    }

type IntervalBoundary = Extract<BoundarySnapshot, { kind: 'interval-start' }>

function ruleHint(problem: Problem, resource: Resource): string {
  if (resource === 'io') {
    return 'I/O is nonpreemptive: an unfinished request keeps the device. When it becomes free, take the oldest outstanding request (FIFO). Use Idle only when no request remains.'
  }
  const rule = getSchedulingRule(problem.settings)
  return `Only ready processes can use the CPU; processes using or waiting for I/O are blocked. ${rule.selection} ${rule.preemption} ${rule.tieBreak} Use Idle only when no process can run.`
}

function candidateFacts(problem: Problem, candidate: CpuCandidate): string {
  if (problem.settings.algorithm === 'fcfs-course') {
    const process = problem.processes.find((input) => input.id === candidate.processId)!
    return `${candidate.processId} (original arrival ${process.arrival})`
  }
  if (problem.settings.algorithm === 'priority') {
    return `${candidate.processId} (priority ${candidate.priority}, ready since ${candidate.enteredAt})`
  }
  return `${candidate.processId} (${candidate.remainingCpu} CPU ${candidate.remainingCpu === 1 ? 'unit' : 'units'} remaining in burst ${candidate.burst}, ready since ${candidate.enteredAt})`
}

/** Facts stop before the decision: dispatch/started events never name a winner. */
function cpuFacts(
  problem: Problem,
  boundary: IntervalBoundary,
  previous: BoundarySnapshot | undefined,
): string {
  const facts: string[] = []
  for (const event of boundary.events) {
    switch (event.type) {
      case 'cpu-burst-completed':
        facts.push(event.burst === 1
          ? `${event.processId} finished CPU burst 1 and requested I/O at time ${boundary.time}.`
          : `${event.processId} finished CPU burst 2 at time ${boundary.time}.`)
        if (problem.settings.algorithm === 'round-robin') {
          const prior = previous?.processes.find((process) => process.processId === event.processId)
          if (prior?.status === 'running' && prior.quantumRemaining === 1) {
            facts.push('The burst completion coincides with its quantum boundary; a completed burst is not requeued.')
          }
        }
        break
      case 'became-ready':
        facts.push(event.reason === 'arrival'
          ? `${event.processId} arrived at time ${boundary.time}.`
          : `${event.processId} finished I/O and became ready for CPU burst 2 at time ${boundary.time}.`)
        break
      case 'quantum-expired':
        facts.push(`${event.processId}'s quantum expired with ${event.remainingCpu} CPU ${event.remainingCpu === 1 ? 'unit' : 'units'} remaining. Its new ready entry follows existing waiters and this boundary's arrivals or I/O returns.`)
        break
      case 'cpu-preempted':
        // Give the recorded comparison inputs, not the preemption outcome.
        facts.push(problem.settings.algorithm === 'priority'
          ? `Before the decision, the running process ${event.running.processId} had priority ${event.running.priority}; ready challenger ${event.challenger.processId} had priority ${event.challenger.priority}. Smaller numbers mean higher priority.`
          : `Before the decision, the running process ${event.running.processId} had ${event.running.remainingCpu} CPU units remaining; ready challenger ${event.challenger.processId} had ${event.challenger.remainingCpu} CPU ${event.challenger.remainingCpu === 1 ? 'unit' : 'units'} remaining in its current burst.`)
        break
    }
  }

  const dispatch = boundary.events.find((event) => event.type === 'cpu-dispatched')
  if (dispatch?.type === 'cpu-dispatched') {
    facts.push(dispatch.criterion === 'fifo-ready-queue'
      ? `Ready queue before dispatch, front to back: ${dispatch.candidates.map((candidate) => candidate.processId).join(' → ')}.`
      : `Candidates before dispatch: ${dispatch.candidates.map((candidate) => candidateFacts(problem, candidate)).join(', ')}.`)
  } else {
    // Earlier intervals are already correct, so the previous incumbent is known.
    // Use its prior snapshot and elapsed unit instead of exposing the new owner.
    const incumbent = previous?.processes.find((process) => process.status === 'running')
    if (incumbent?.status === 'running' && incumbent.remainingCpu > 1) {
      const remaining = incumbent.remainingCpu - 1
      facts.push(`${incumbent.processId} held the CPU before time ${boundary.time}; its unfinished burst ${incumbent.burst} now has ${remaining} CPU ${remaining === 1 ? 'unit' : 'units'} remaining.`)
      if (incumbent.quantumRemaining !== null) {
        const quantum = incumbent.quantumRemaining - 1
        facts.push(`Its quantum has ${quantum} ${quantum === 1 ? 'unit' : 'units'} left at this boundary.`)
      }
      if (problem.settings.algorithm === 'priority') {
        const input = problem.processes.find((process) => process.id === incumbent.processId)!
        facts.push(`Its priority is ${input.priority}; smaller numbers mean higher priority.`)
      }
    }
    const ready = boundary.processes.flatMap((state): CpuCandidate[] => {
      if (state.status !== 'ready') return []
      return [{
        processId: state.processId,
        burst: state.burst,
        remainingCpu: state.remainingCpu,
        enteredAt: state.enteredAt,
        priority: problem.processes.find((process) => process.id === state.processId)!.priority,
      }]
    })
    const other = incumbent?.status === 'running' && incumbent.remainingCpu > 1 ? 'other ' : ''
    facts.push(ready.length > 0
      ? `Other ready candidates: ${ready.map((candidate) => candidateFacts(problem, candidate)).join(', ')}.`
      : `There are no ${other}ready candidates at this boundary.`)
  }
  facts.push('Apply the CPU rule to these facts before assigning this interval.')
  return facts.join(' ')
}

function ioFacts(
  boundary: IntervalBoundary,
  previous: BoundarySnapshot | undefined,
): string {
  const facts: string[] = []
  const incumbent = previous?.processes.find((process) => process.status === 'performing-io')
  if (incumbent?.status === 'performing-io') {
    const remaining = incumbent.remainingIo - 1
    facts.push(remaining > 0
      ? `${incumbent.processId}'s I/O request began at time ${incumbent.startedAt}; after the preceding interval, it still has ${remaining} I/O ${remaining === 1 ? 'unit' : 'units'} remaining.`
      : `${incumbent.processId}'s I/O request finished at time ${boundary.time}, freeing the device.`)
  } else {
    facts.push('The I/O device had no unfinished request entering this boundary.')
  }

  // Reconstruct only the request list, not the scheduling decision. The prior
  // queue retains every waiter, including the one removed by this dispatch.
  const requests = [...(previous?.ioQueue ?? [])]
  for (const event of boundary.events) {
    if (event.type === 'io-requested') {
      requests.push({ processId: event.processId, requestedAt: boundary.time })
    }
  }
  facts.push(requests.length > 0
    ? `Waiting requests in FIFO order before dispatch: ${requests.map((request) => `${request.processId} (requested at ${request.requestedAt})`).join(' → ')}.`
    : 'There are no queued I/O requests at this boundary.')
  facts.push('Apply the I/O rule to these facts before assigning this interval.')
  return facts.join(' ')
}

/** Escalate help at the first divergence without returning later assignments. */
export function getHint(problem: Problem, attempt: Attempt, level: HintLevel): HintResult {
  if (level !== 1 && level !== 2 && level !== 3) {
    throw new RangeError('Hint level must be 1, 2, or 3.')
  }
  const grade = gradeAttempt(problem, attempt)
  if (grade.status === 'correct') return grade

  const solution = level === 2 ? simulate(problem) : undefined
  const boundary = solution?.boundaries[grade.time]
  const messages = grade.issues.map((issue) => {
    let text: string
    if (level === 1) {
      text = ruleHint(problem, issue.resource)
    } else if (level === 2) {
      if (boundary?.kind !== 'interval-start') throw new Error('A hint requires an interval-start boundary.')
      text = issue.resource === 'cpu'
        ? cpuFacts(problem, boundary, solution!.boundaries[grade.time - 1])
        : ioFacts(boundary, solution!.boundaries[grade.time - 1])
    } else {
      const assignment = issue.expected === 'idle' ? 'Idle' : issue.expected
      text = `Assign ${assignment} to ${issue.resource === 'cpu' ? 'CPU' : 'I/O'} for time ${grade.time} to ${grade.time + 1}. ${issue.explanation}`
    }
    return { resource: issue.resource, text }
  })
  return {
    status: 'hint',
    time: grade.time,
    level,
    resources: grade.issues.map((issue) => issue.resource),
    messages,
  }
}
