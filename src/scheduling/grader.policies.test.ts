import { describe, expect, test } from 'vitest'
import { gradeAttempt } from './grader'
import {
  GENERATOR_VERSION,
  RULES_VERSION,
  TIMELINE_LENGTH,
  type Attempt,
  type Problem,
  type ProcessId,
  type ProcessInput,
  type ReferenceCell,
  type SchedulingSettings,
} from './types'

function process(
  id: ProcessId,
  cpu1: number,
  io: number,
  cpu2: number,
  arrival = 0,
  priority = 1,
): ProcessInput {
  return { id, cpu1, io, cpu2, arrival, priority }
}

function problem(processes: readonly ProcessInput[], settings: SchedulingSettings): Problem {
  return { seed: 0, rulesVersion: RULES_VERSION, generatorVersion: GENERATOR_VERSION, processes, settings }
}

/** These complete schedules are calculated independently of the simulator. */
function row(...segments: readonly (readonly [ReferenceCell, number])[]): ReferenceCell[] {
  const cells = segments.flatMap(([value, length]) => Array<ReferenceCell>(length).fill(value))
  return cells.concat(Array<ReferenceCell>(TIMELINE_LENGTH - cells.length).fill('idle'))
}

function explanation(input: Problem, answer: Attempt, time: number, actual: ReferenceCell): string {
  // Validate the full fixture as well as the targeted earliest error.
  expect(gradeAttempt(input, answer)).toEqual({ status: 'correct' })
  const result = gradeAttempt(input, {
    ...answer,
    cpu: answer.cpu.map((cell, index) => index === time ? actual : cell),
  })
  expect(result).toMatchObject({
    status: 'needs-correction',
    time,
    issues: [{ resource: 'cpu', actual, expected: answer.cpu[time] }],
  })
  if (result.status !== 'needs-correction') throw new Error('Expected a correction.')
  expect(result.issues).toHaveLength(1)
  expect(result.issues[0].explanation).not.toContain('Course FCFS')
  return result.issues[0].explanation
}

const sjf = problem([
  process('P1', 2, 1, 6),
  process('P2', 3, 1, 1),
], { algorithm: 'sjf' })
const sjfAnswer: Attempt = {
  cpu: row(['P1', 2], ['P2', 3], ['P1', 6], ['P2', 1]),
  io: row(['idle', 2], ['P1', 1], ['idle', 2], ['P2', 1]),
}

const srtf = problem([
  process('P1', 6, 1, 1),
  process('P2', 2, 1, 1, 1),
], { algorithm: 'srtf' })
const srtfAnswer: Attempt = {
  cpu: row(['P1', 1], ['P2', 2], ['P1', 1], ['P2', 1], ['P1', 4], ['idle', 1], ['P1', 1]),
  io: row(['idle', 3], ['P2', 1], ['idle', 5], ['P1', 1]),
}

const priorities = [
  process('P1', 5, 1, 1, 0, 5),
  process('P2', 2, 1, 1, 1, -1),
]
const priorityPreemptive = problem(priorities, { algorithm: 'priority', mode: 'preemptive' })
const priorityPreemptiveAnswer: Attempt = {
  cpu: row(['P1', 1], ['P2', 2], ['P1', 1], ['P2', 1], ['P1', 3], ['idle', 1], ['P1', 1]),
  io: row(['idle', 3], ['P2', 1], ['idle', 4], ['P1', 1]),
}
const priorityNonpreemptive = problem(priorities, { algorithm: 'priority', mode: 'non-preemptive' })
const priorityNonpreemptiveAnswer: Attempt = {
  cpu: row(['P1', 5], ['P2', 2], ['P1', 1], ['P2', 1]),
  io: row(['idle', 5], ['P1', 1], ['idle', 1], ['P2', 1]),
}

describe('grading the remaining scheduling policies', () => {
  test.each([
    ['SJF', sjf, sjfAnswer],
    ['SRTF', srtf, srtfAnswer],
    ['preemptive priority', priorityPreemptive, priorityPreemptiveAnswer],
    ['nonpreemptive priority', priorityNonpreemptive, priorityNonpreemptiveAnswer],
  ] as const)('accepts a complete hand-calculated %s schedule', (_, input, answer) => {
    expect(gradeAttempt(input, answer)).toEqual({ status: 'correct' })
  })

  test('SJF compares the current burst rather than all remaining work', () => {
    const text = explanation(sjf, sjfAnswer, 0, 'P2')
    expect(text).toContain('P1 (2 CPU units remaining in burst 1, ready since 0)')
    expect(text).toContain('P2 (3 CPU units remaining in burst 1, ready since 0)')
    expect(text).toContain('SJF selects P1 with the shortest current CPU burst')
    expect(text).toContain('Future CPU bursts and I/O work are excluded')
  })

  test('SJF keeps the current burst running when shorter work returns from I/O', () => {
    const text = explanation(sjf, sjfAnswer, 6, 'P2')
    expect(text).toContain('P2 finished I/O and became ready for CPU burst 2 at time 6')
    expect(text).toContain('P1 continues CPU burst 2 with 5 CPU units remaining')
    expect(text).toContain('SJF does not preempt an unfinished CPU burst')
  })

  test('SRTF explains arrival preemption using current remaining work', () => {
    const text = explanation(srtf, srtfAnswer, 1, 'P1')
    expect(text).toContain('P2 arrived at time 1')
    expect(text).toContain('SRTF preempts P1')
    expect(text).toContain("P2 has 2 CPU units remaining in its current burst, strictly less than P1's 5 CPU units")
    expect(text).toContain('P1 keeps its 5 CPU units of unfinished CPU burst 1')
    expect(text).toContain('returns to the ready queue at time 1')
    expect(text).toContain('P1 (5 CPU units remaining in burst 1, ready since 1)')
    expect(text).toContain('SRTF selects P2')
  })

  test('SRTF explains I/O return preemption and preserves a previously interrupted burst', () => {
    const text = explanation(srtf, srtfAnswer, 4, 'P1')
    expect(text).toContain('P2 finished I/O and became ready for CPU burst 2 at time 4')
    expect(text).toContain("P2 has 1 CPU unit remaining in its current burst, strictly less than P1's 4 CPU units")
    expect(text).toContain('P1 keeps its 4 CPU units of unfinished CPU burst 1')
    expect(text).toContain('P2 starts CPU burst 2 with 1 CPU unit remaining')
    const resumed = explanation(srtf, srtfAnswer, 5, 'idle')
    expect(resumed).toContain('P1 starts CPU burst 1 with 4 CPU units remaining')
  })

  test('SRTF continues on equal lengths despite the arriving process having a lower ID', () => {
    const input = problem([
      process('P10', 4, 1, 1),
      process('P2', 2, 1, 1, 2),
    ], { algorithm: 'srtf' })
    const answer = {
      cpu: row(['P10', 4], ['P2', 2], ['P10', 1], ['P2', 1]),
      io: row(['idle', 4], ['P10', 1], ['idle', 1], ['P2', 1]),
    }
    const text = explanation(input, answer, 2, 'P2')
    expect(text).toContain('P2 arrived at time 2')
    expect(text).toContain('P10 continues CPU burst 1 with 2 CPU units remaining')
    expect(text).toContain('P2 (2 CPU units remaining in burst 1, ready since 2)')
    expect(text).toContain('Equal remaining lengths do not preempt')
    const returned = explanation(input, answer, 5, 'P10')
    expect(returned).toContain('P10 finished I/O and became ready')
    expect(returned).toContain('P2 continues CPU burst 1 with 1 CPU unit remaining')
    expect(returned).toContain('P10 (1 CPU unit remaining in burst 2, ready since 5)')
    expect(returned).toContain('Equal remaining lengths do not preempt')
  })

  test('preemptive priority explains both compared priorities and remaining CPU work', () => {
    const text = explanation(priorityPreemptive, priorityPreemptiveAnswer, 1, 'P1')
    expect(text).toContain('P2 arrived at time 1')
    expect(text).toContain("P2's priority -1 is higher than P1's priority 5")
    expect(text).toContain('smaller numbers mean higher priority')
    expect(text).toContain('P1 keeps its 4 CPU units of unfinished CPU burst 1')
    expect(text).toContain('P2 (priority -1, ready since 1)')
    expect(text).toContain('Priority scheduling selects P2 with the highest priority')
  })

  test('preemptive priority explains an I/O return interrupting a resumed burst', () => {
    const text = explanation(priorityPreemptive, priorityPreemptiveAnswer, 4, 'P1')
    expect(text).toContain('P2 finished I/O and became ready for CPU burst 2 at time 4')
    expect(text).toContain('Preemptive priority preempts P1')
    expect(text).toContain('P1 keeps its 3 CPU units of unfinished CPU burst 1')
    expect(text).toContain('P2 starts CPU burst 2 with 1 CPU unit remaining')
  })

  test('nonpreemptive priority lets a lower-priority unfinished burst complete', () => {
    const text = explanation(priorityNonpreemptive, priorityNonpreemptiveAnswer, 1, 'P2')
    expect(text).toContain('P2 arrived at time 1')
    expect(text).toContain('P1 continues CPU burst 1 with 4 CPU units remaining')
    expect(text).toContain("P1's priority is 5")
    expect(text).toContain('P2 (priority -1, ready since 1)')
    expect(text).toContain('Nonpreemptive priority does not preempt an unfinished CPU burst')
    expect(text).toContain('even when a higher-priority process becomes ready')
  })

  test.each(['preemptive', 'non-preemptive'] as const)('priority %s chooses a higher priority despite a longer burst', (mode) => {
    const input = problem([
      process('P1', 2, 1, 1, 0, 5),
      process('P2', 5, 1, 1, 0, 0),
    ], { algorithm: 'priority', mode })
    const answer = mode === 'preemptive'
      ? {
          cpu: row(['P2', 5], ['P1', 1], ['P2', 1], ['P1', 1], ['idle', 1], ['P1', 1]),
          io: row(['idle', 5], ['P2', 1], ['idle', 2], ['P1', 1]),
        }
      : {
          cpu: row(['P2', 5], ['P1', 2], ['P2', 1], ['P1', 1]),
          io: row(['idle', 5], ['P2', 1], ['idle', 1], ['P1', 1]),
        }
    const text = explanation(input, answer, 0, 'P1')
    expect(text).toContain('P1 (priority 5, ready since 0)')
    expect(text).toContain('P2 (priority 0, ready since 0)')
    expect(text).toContain('Priority scheduling selects P2 with the highest priority')
    expect(text).toContain('P2 starts CPU burst 1 with 5 CPU units remaining')
  })

  test('equal priorities preserve the running process in preemptive mode', () => {
    const input = problem([
      process('P10', 4, 1, 1),
      process('P2', 2, 1, 1, 2),
    ], { algorithm: 'priority', mode: 'preemptive' })
    const answer = {
      cpu: row(['P10', 4], ['P2', 2], ['P10', 1], ['P2', 1]),
      io: row(['idle', 4], ['P10', 1], ['idle', 1], ['P2', 1]),
    }
    const text = explanation(input, answer, 2, 'P2')
    expect(text).toContain('P10 continues CPU burst 1 with 2 CPU units remaining')
    expect(text).toContain("P10's priority is 1")
    expect(text).toContain('P2 (priority 1, ready since 2)')
    expect(text).toContain('Equal priorities do not preempt')
  })

  test.each([
    { algorithm: 'sjf' },
    { algorithm: 'srtf' },
    { algorithm: 'priority', mode: 'preemptive' },
    { algorithm: 'priority', mode: 'non-preemptive' },
  ] as const)('$algorithm uses numeric process IDs when dispatch quantities and entry times tie', (settings) => {
    const input = problem([process('P10', 2, 1, 1), process('P2', 2, 1, 1)], settings)
    const answer = {
      cpu: row(['P2', 2], ['P10', 2], ['P2', 1], ['P10', 1]),
      io: row(['idle', 2], ['P2', 1], ['idle', 1], ['P10', 1]),
    }
    const text = explanation(input, answer, 0, 'P10')
    expect(text).toContain('tie at')
    expect(text).toContain('They share ready-entry time 0')
    expect(text).toContain('P2 has the lowest numeric process ID')
  })

  test('SJF explains earlier ready-entry time before numeric process ID', () => {
    const input = problem([
      process('P1', 1, 3, 2),
      process('P2', 5, 1, 1),
      process('P3', 2, 1, 1, 2),
    ], { algorithm: 'sjf' })
    const answer = {
      cpu: row(['P1', 1], ['P2', 5], ['P3', 2], ['P2', 1], ['P3', 1], ['P1', 2]),
      io: row(['idle', 1], ['P1', 3], ['idle', 2], ['P2', 1], ['idle', 1], ['P3', 1]),
    }
    const text = explanation(input, answer, 6, 'P1')
    expect(text).toContain('tie at 2 CPU units remaining')
    expect(text).toContain('P3 has the earliest ready-entry time (2)')
    expect(text).not.toContain('lowest numeric process ID')
  })

  test('SRTF explains earlier ready-entry time when remaining lengths tie at dispatch', () => {
    const input = problem([
      process('P3', 2, 1, 1),
      process('P2', 3, 1, 1),
      process('P1', 3, 1, 1, 1),
    ], { algorithm: 'srtf' })
    const answer = {
      cpu: row(['P3', 2], ['P2', 1], ['P3', 1], ['P2', 2], ['P1', 1], ['P2', 1], ['P1', 2], ['idle', 1], ['P1', 1]),
      io: row(['idle', 2], ['P3', 1], ['idle', 3], ['P2', 1], ['idle', 3], ['P1', 1]),
    }
    const text = explanation(input, answer, 2, 'P1')
    expect(text).toContain('tie at 3 CPU units remaining')
    expect(text).toContain('P2 has the earliest ready-entry time (0)')
    expect(text).not.toContain('lowest numeric process ID')
  })

  test.each(['preemptive', 'non-preemptive'] as const)('priority %s explains earlier ready-entry time for equal priorities', (mode) => {
    const input = problem([
      process('P1', 1, 3, 2),
      process('P2', 5, 1, 1),
      process('P3', 2, 1, 1, 2),
    ], { algorithm: 'priority', mode })
    const answer = {
      cpu: row(['P1', 1], ['P2', 5], ['P3', 2], ['P1', 2], ['P2', 1], ['P3', 1]),
      io: row(['idle', 1], ['P1', 3], ['idle', 2], ['P2', 1], ['idle', 1], ['P3', 1]),
    }
    const text = explanation(input, answer, 6, 'P1')
    expect(text).toContain('tie at priority 1')
    expect(text).toContain('P3 has the earliest ready-entry time (2)')
  })
})
