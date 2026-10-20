import { describe, expect, test } from 'vitest'
import { gradeAttempt, type GradeIssue } from './grader'
import { createEmptyAttempt } from './timeline'
import {
  GENERATOR_VERSION,
  RULES_VERSION,
  TIMELINE_LENGTH,
  type Attempt,
  type AttemptCell,
  type Problem,
  type ProcessId,
  type ProcessInput,
  type ReferenceCell,
  type Resource,
  type SchedulingSettings,
} from './types'

function process(
  id: ProcessId,
  cpu1: number,
  io: number,
  cpu2: number,
  arrival = 0,
): ProcessInput {
  return { id, arrival, cpu1, io, cpu2 }
}

function problem(
  processes: readonly ProcessInput[],
  settings: SchedulingSettings = { algorithm: 'fcfs-course' },
): Problem {
  return {
    seed: 0,
    rulesVersion: RULES_VERSION,
    generatorVersion: GENERATOR_VERSION,
    settings,
    processes,
  }
}

/** Hand-calculated schedules, including explicit Idle padding. */
function row(...segments: readonly (readonly [ReferenceCell, number])[]): ReferenceCell[] {
  const cells = segments.flatMap(([value, count]) => Array<ReferenceCell>(count).fill(value))
  return cells.concat(Array<ReferenceCell>(TIMELINE_LENGTH - cells.length).fill('idle'))
}

function change(attempt: Attempt, resource: Resource, time: number, value: AttemptCell): Attempt {
  return {
    ...attempt,
    [resource]: attempt[resource].map((cell, index) => (index === time ? value : cell)),
  }
}

function issueAt(
  input: Problem,
  answer: Attempt,
  resource: Resource,
  time: number,
  actual: AttemptCell,
): GradeIssue {
  const result = gradeAttempt(input, change(answer, resource, time, actual))
  expect(result).toMatchObject({ status: 'needs-correction', time })
  if (result.status !== 'needs-correction') throw new Error('Expected a correction.')
  expect(result.issues).toHaveLength(1)
  expect(result.issues[0]).toMatchObject({
    resource,
    actual,
    expected: answer[resource][time],
  })
  return result.issues[0]
}

const single = problem([process('P1', 2, 3, 2)])
const singleAnswer: Attempt = {
  cpu: row(['P1', 2], ['idle', 3], ['P1', 2]),
  io: row(['idle', 2], ['P1', 3]),
}

const contended = problem([
  process('P1', 1, 4, 2),
  process('P2', 2, 1, 1),
  process('P3', 2, 1, 1),
])
const contendedAnswer: Attempt = {
  cpu: row(['P1', 1], ['P2', 2], ['P3', 2], ['P1', 2], ['P2', 1], ['P3', 1]),
  io: row(['idle', 1], ['P1', 4], ['P2', 1], ['P3', 1]),
}

const rr = problem(
  [process('P1', 5, 1, 1), process('P2', 3, 2, 1)],
  { algorithm: 'round-robin', quantum: 2 },
)
const rrAnswer: Attempt = {
  cpu: row(['P1', 2], ['P2', 2], ['P1', 2], ['P2', 1], ['P1', 1], ['idle', 1], ['P2', 1], ['P1', 1]),
  io: row(['idle', 7], ['P2', 2], ['P1', 1]),
}

describe('grading', () => {
  test.each([
    ['single process', single, singleAnswer],
    ['contended I/O', contended, contendedAnswer],
    ['round robin', rr, rrAnswer],
  ] as const)('accepts the complete hand-calculated %s answer', (_, input, answer) => {
    expect(gradeAttempt(input, answer)).toEqual({ status: 'correct' })
  })

  test('returns both unanswered resources at the first interval, with CPU first', () => {
    const result = gradeAttempt(single, createEmptyAttempt())
    expect(result).toEqual({
      status: 'needs-correction',
      time: 0,
      issues: [
        {
          resource: 'cpu',
          actual: null,
          expected: 'P1',
          explanation: expect.stringContaining('This cell is unanswered.'),
        },
        {
          resource: 'io',
          actual: null,
          expected: 'idle',
          explanation: expect.stringContaining('This cell is unanswered.'),
        },
      ],
    })
  })

  test('compares times before resources and does not reveal later mistakes', () => {
    let attempt = change(singleAnswer, 'cpu', 5, 'idle')
    attempt = change(attempt, 'io', 3, 'idle')
    attempt = change(attempt, 'io', 20, 'P1')
    const result = gradeAttempt(single, attempt)
    expect(result).toEqual({
      status: 'needs-correction',
      time: 3,
      issues: [{
        resource: 'io',
        actual: 'idle',
        expected: 'P1',
        explanation: expect.any(String),
      }],
    })
  })

  test('combines two wrong assignments at the same earliest time', () => {
    const attempt = change(change(singleAnswer, 'cpu', 2, 'P1'), 'io', 2, 'idle')
    const result = gradeAttempt(single, attempt)
    expect(result).toMatchObject({
      status: 'needs-correction',
      time: 2,
      issues: [
        { resource: 'cpu', actual: 'P1', expected: 'idle' },
        { resource: 'io', actual: 'idle', expected: 'P1' },
      ],
    })
  })

  test('requires explicit Idle even in the final cell of the completed tail', () => {
    const issue = issueAt(single, singleAnswer, 'io', 39, null)
    expect(issue.explanation).toContain('All processes have completed')
  })

  test('accepts completion exactly at the final boundary', () => {
    const input = problem([process('P1', 1, 1, 38)])
    expect(gradeAttempt(input, {
      cpu: row(['P1', 1], ['idle', 1], ['P1', 38]),
      io: row(['idle', 1], ['P1', 1]),
    })).toEqual({ status: 'correct' })
  })

  test('does not mutate frozen inputs and returns a deterministic result', () => {
    const input = Object.freeze({
      ...single,
      settings: Object.freeze({ ...single.settings }),
      processes: Object.freeze(single.processes.map((item) => Object.freeze({ ...item }))),
    })
    const attempt = Object.freeze({
      cpu: Object.freeze([...singleAnswer.cpu]),
      io: Object.freeze(singleAnswer.io.map((cell, time) => (time === 3 ? null : cell))),
    })
    const before = structuredClone({ input, attempt })
    expect(gradeAttempt(input, attempt)).toEqual(gradeAttempt(input, attempt))
    expect({ input, attempt }).toEqual(before)
  })

  test.each([
    { cpu: [], io: singleAnswer.io },
    { cpu: singleAnswer.cpu, io: Array(40).fill('P2') },
    { cpu: Array(40).fill(undefined), io: singleAnswer.io },
    null,
  ])('rejects malformed attempts instead of grading them', (attempt) => {
    expect(() => gradeAttempt(single, attempt as Attempt)).toThrow(/Invalid attempt/)
  })

  test('rejects an invalid problem through the shared simulator', () => {
    expect(() => gradeAttempt({ ...single, seed: -1 }, singleAnswer)).toThrow(
      /Invalid scheduling problem/,
    )
  })

  test.each([
    { algorithm: 'sjf' },
    { algorithm: 'srtf' },
    { algorithm: 'priority', mode: 'preemptive' },
    { algorithm: 'priority', mode: 'non-preemptive' },
  ] as const)('grades a single process under $algorithm $mode', (settings) => {
    const input = {
      ...single,
      settings,
      processes: single.processes.map((item) => ({ ...item, priority: 1 })),
    }
    expect(gradeAttempt(input, singleAnswer)).toEqual({ status: 'correct' })
  })

  test('rejects a truncated schedule even when all 40 visible cells match', () => {
    const input = problem([process('P1', 1, 1, 39)])
    expect(() => gradeAttempt(input, {
      cpu: row(['P1', 1], ['idle', 1], ['P1', 38]),
      io: row(['idle', 1], ['P1', 1]),
    })).toThrow(/does not finish within 40 intervals/)
  })
})

describe('explanations from recorded process states and decisions', () => {
  test('names a future arrival and distinguishes waiting from completion', () => {
    const input = problem([process('P1', 1, 1, 1, 2)])
    const answer = {
      cpu: row(['idle', 2], ['P1', 1], ['idle', 1], ['P1', 1]),
      io: row(['idle', 3], ['P1', 1]),
    }
    const issue = issueAt(input, answer, 'cpu', 0, 'P1')
    expect(issue.explanation).toContain('has not arrived yet; its arrival is at time 2')
    expect(issue.explanation).toContain('no process is ready')
    expect(issue.explanation).not.toContain('All processes have completed')
  })

  test('explains why a process actively performing I/O cannot run on the CPU', () => {
    const issue = issueAt(single, singleAnswer, 'cpu', 3, 'P1')
    expect(issue.explanation).toContain('performing I/O with 2 I/O units remaining')
    expect(issue.explanation).toContain('cannot run on the CPU yet')
    expect(issue.explanation).toContain('CPU must be Idle')
  })

  test('explains why a process queued for I/O cannot run on the CPU', () => {
    const issue = issueAt(contended, contendedAnswer, 'cpu', 3, 'P2')
    expect(issue.explanation).toContain('P2 is waiting for I/O with 1 I/O unit remaining')
    expect(issue.explanation).toContain('P3 starts CPU burst 1 with 2 CPU units remaining')
  })

  test('keeps the unfinished FCFS CPU burst running when an earlier process returns', () => {
    const input = problem([process('P1', 1, 1, 1), process('P2', 4, 1, 1)])
    const answer = {
      cpu: row(['P1', 1], ['P2', 4], ['P1', 1], ['P2', 1]),
      io: row(['idle', 1], ['P1', 1], ['idle', 3], ['P2', 1]),
    }
    const issue = issueAt(input, answer, 'cpu', 2, 'P1')
    expect(issue.explanation).toContain('P1 finished I/O and became ready')
    expect(issue.explanation).toContain('P2 continues CPU burst 1 with 3 CPU units remaining')
    expect(issue.explanation).toContain('does not preempt an unfinished CPU burst')
  })

  test('uses original launch order after I/O, including the chosen candidate removed by dispatch', () => {
    const input = problem([
      process('P1', 1, 2, 1),
      process('P2', 4, 1, 1),
      process('P3', 1, 1, 1),
    ])
    const answer = {
      cpu: row(['P1', 1], ['P2', 4], ['P1', 1], ['P2', 1], ['P3', 1], ['idle', 1], ['P3', 1]),
      io: row(['idle', 1], ['P1', 2], ['idle', 2], ['P2', 1], ['idle', 2], ['P3', 1]),
    }
    const issue = issueAt(input, answer, 'cpu', 5, 'P3')
    expect(issue.explanation).toContain('Ready candidates: P3 (arrival 0), P1 (arrival 0)')
    expect(issue.explanation).toContain('Course FCFS selects P1 by original launch order')
    expect(issue.explanation).toContain('retained after I/O')
    expect(issue.explanation).toContain('P1 starts CPU burst 2 with 1 CPU unit remaining')
  })

  test('explains RR expiration with remaining work and the full pre-dispatch FIFO queue', () => {
    const issue = issueAt(rr, rrAnswer, 'cpu', 2, 'P1')
    expect(issue.explanation).toContain("P1's quantum expired with 3 CPU units remaining")
    expect(issue.explanation).toContain('Ready queue before dispatch: P2 → P1')
    expect(issue.explanation).toContain('Round robin selects P2 from the front')
    expect(issue.explanation).toContain('fresh 2-unit quantum')
  })

  test('reports remaining quantum before executing this interval', () => {
    const issue = issueAt(rr, rrAnswer, 'cpu', 3, 'P1')
    expect(issue.explanation).toContain('P2 continues CPU burst 1 with 2 CPU units remaining')
    expect(issue.explanation).toContain('current quantum still has 1 unit left')
    expect(issue.explanation).not.toContain('expired')
  })

  test('explains existing waiters, same-time arrivals and I/O returns before an expired process', () => {
    const input = problem([
      process('P4', 1, 1, 1),
      process('P3', 3, 1, 1),
      process('P2', 1, 2, 1),
      process('P1', 1, 1, 1, 3),
    ], { algorithm: 'round-robin', quantum: 2 })
    const answer = {
      cpu: row(['P2', 1], ['P3', 2], ['P4', 1], ['P1', 1], ['P2', 1], ['P3', 1], ['P4', 1], ['P1', 1], ['P3', 1]),
      io: row(['idle', 1], ['P2', 2], ['idle', 1], ['P4', 1], ['P1', 1], ['idle', 1], ['P3', 1]),
    }
    const issue = issueAt(input, answer, 'cpu', 3, 'P3')
    expect(issue.explanation).toContain('P1 arrived at time 3')
    expect(issue.explanation).toContain('P2 finished I/O and became ready for CPU burst 2 at time 3')
    expect(issue.explanation).toContain("P3's quantum expired with 1 CPU unit remaining")
    expect(issue.explanation).toContain('after existing waiters')
    expect(issue.explanation).toContain('Ready queue before dispatch: P4 → P1 → P2 → P3')
  })

  test('explains completion winning over simultaneous quantum expiration', () => {
    const input = problem(
      [process('P1', 2, 1, 2)],
      { algorithm: 'round-robin', quantum: 2 },
    )
    const answer = {
      cpu: row(['P1', 2], ['idle', 1], ['P1', 2]),
      io: row(['idle', 2], ['P1', 1]),
    }
    const issue = issueAt(input, answer, 'cpu', 2, 'P1')
    expect(issue.explanation).toContain('completed CPU burst 1 and requested I/O at time 2')
    expect(issue.explanation).toContain('completion takes priority over expiration')
    expect(issue.explanation).toContain('the process is not requeued')
    expect(issue.explanation).not.toContain("P1's quantum expired")
  })

  test('explains redispatch to the same process when nobody else is ready', () => {
    const input = problem(
      [process('P1', 3, 1, 1)],
      { algorithm: 'round-robin', quantum: 2 },
    )
    const answer = {
      cpu: row(['P1', 3], ['idle', 1], ['P1', 1]),
      io: row(['idle', 3], ['P1', 1]),
    }
    const issue = issueAt(input, answer, 'cpu', 2, 'idle')
    expect(issue.explanation).toContain("P1's quantum expired with 1 CPU unit remaining")
    expect(issue.explanation).toContain('Ready queue before dispatch: P1.')
    expect(issue.explanation).toContain('Round robin selects P1 from the front')
  })

  test('keeps I/O nonpreemptive when another process has a pending request', () => {
    const issue = issueAt(contended, contendedAnswer, 'io', 3, 'P2')
    expect(issue.explanation).toContain('P2 is waiting for I/O after requesting it at time 3')
    expect(issue.explanation).toContain('still busy with P1')
    expect(issue.explanation).toContain('2 I/O units remaining')
    expect(issue.explanation).toContain('I/O is nonpreemptive')
  })

  test('explains FIFO I/O selection after completion, with a new request at the same boundary', () => {
    const issue = issueAt(contended, contendedAnswer, 'io', 5, 'P3')
    expect(issue.explanation).toContain('P3 is waiting for I/O after requesting it at time 5')
    expect(issue.explanation).toContain('P1 finished I/O at time 5, freeing the device')
    expect(issue.explanation).toContain('P2 starts I/O with 1 I/O unit remaining')
    expect(issue.explanation).toContain('oldest outstanding request')
  })

  test('does not allow I/O before the first CPU burst finishes', () => {
    const issue = issueAt(single, singleAnswer, 'io', 1, 'P1')
    expect(issue.explanation).toContain('1 CPU unit in CPU burst 1 before it can request I/O')
    expect(issue.explanation).toContain('no outstanding I/O request')
  })

  test('names the CPU completion that causes an immediate I/O start', () => {
    const issue = issueAt(single, singleAnswer, 'io', 2, 'idle')
    expect(issue.explanation).toContain('P1 completed CPU burst 1 and requested I/O at time 2')
    expect(issue.explanation).toContain('P1 starts I/O with 3 I/O units remaining')
  })

  test('does not repeat I/O after it has completed', () => {
    const issue = issueAt(single, singleAnswer, 'io', 5, 'P1')
    expect(issue.explanation).toContain('P1 has already finished its I/O and is on CPU burst 2')
    expect(issue.explanation).toContain('P1 finished I/O at time 5 and became ready for CPU burst 2')
    expect(issue.explanation).toContain('no outstanding I/O request')
  })

  test.each(['cpu', 'io'] as const)('does not schedule completed work on %s', (resource) => {
    const issue = issueAt(single, singleAnswer, resource, 7, 'P1')
    expect(issue.explanation).toContain('P1 completed at time 7 and has no work left')
    expect(issue.explanation).toContain('All processes have completed')
  })
})
