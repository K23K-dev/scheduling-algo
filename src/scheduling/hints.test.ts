import { describe, expect, test } from 'vitest'
import { explainInterval, gradeAttempt } from './grader'
import { getHint, type HintLevel } from './hints'
import { simulate } from './simulator'
import { createEmptyAttempt } from './timeline'
import type {
  Attempt,
  AttemptCell,
  Problem,
  ProcessInput,
  ReferenceCell,
  Resource,
  SchedulingSettings,
} from './types'

function problem(
  processes: readonly ProcessInput[],
  settings: SchedulingSettings = { algorithm: 'fcfs-course' },
): Problem {
  return { seed: 0, rulesVersion: 1, generatorVersion: 1, settings, processes }
}

function process(
  id: ProcessInput['id'],
  cpu1: number,
  io: number,
  cpu2: number,
  arrival = 0,
  priority = 1,
): ProcessInput {
  return { id, cpu1, io, cpu2, arrival, priority }
}

function row(...segments: readonly (readonly [ReferenceCell, number])[]): ReferenceCell[] {
  const cells = segments.flatMap(([value, count]) => Array<ReferenceCell>(count).fill(value))
  return cells.concat(Array<ReferenceCell>(40 - cells.length).fill('idle'))
}

function change(answer: Attempt, resource: Resource, time: number, value: AttemptCell): Attempt {
  return { ...answer, [resource]: answer[resource].map((cell, index) => index === time ? value : cell) }
}

function hintAt(input: Problem, resource: Resource, time: number, level: HintLevel): string {
  const attempt = change(simulate(input).timeline, resource, time, null)
  const hint = getHint(input, attempt, level)
  expect(hint).toMatchObject({ status: 'hint', time, level, resources: [resource] })
  if (hint.status !== 'hint') throw new Error('Expected a hint.')
  expect(hint.messages).toHaveLength(1)
  return hint.messages[0].text
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
const policies = [
  { algorithm: 'fcfs-course' },
  { algorithm: 'round-robin', quantum: 2 },
  { algorithm: 'sjf' },
  { algorithm: 'srtf' },
  { algorithm: 'priority', mode: 'non-preemptive' },
  { algorithm: 'priority', mode: 'preemptive' },
] as const satisfies readonly SchedulingSettings[]

describe('progressive hint boundaries', () => {
  test.each([1, 2, 3] as const)('returns both earliest resources in CPU-first order at level %s', (level) => {
    const hint = getHint(single, createEmptyAttempt(), level)
    expect(hint).toMatchObject({
      status: 'hint', time: 0, level, resources: ['cpu', 'io'],
      messages: [
        { resource: 'cpu', text: expect.any(String) },
        { resource: 'io', text: expect.any(String) },
      ],
    })
    expect(Object.keys(hint).sort()).toEqual(['level', 'messages', 'resources', 'status', 'time'])
  })

  test.each([1, 2, 3] as const)('does not reveal later mistakes or a correct row at level %s', (level) => {
    let attempt = change(singleAnswer, 'cpu', 5, 'idle')
    attempt = change(attempt, 'io', 3, null)
    const hint = getHint(single, attempt, level)
    expect(hint).toMatchObject({ status: 'hint', time: 3, level, resources: ['io'] })
    if (hint.status !== 'hint') throw new Error('Expected a hint.')
    expect(hint.messages).toHaveLength(1)
    expect(hint.messages[0].resource).toBe('io')
    expect(hint.messages[0].text).not.toMatch(/time 5|time 6/)
  })

  test('distinguishes a marked Idle cell from an unanswered cell', () => {
    const attempted = change(singleAnswer, 'cpu', 0, 'idle')
    const hint = getHint(single, attempted, 3)
    expect(hint).toMatchObject({ status: 'hint', resources: ['cpu'] })
    if (hint.status !== 'hint') throw new Error('Expected a hint.')
    expect(hint.messages[0].text).toContain('You marked this interval Idle.')
  })

  test.each([1, 2, 3] as const)('requires the last tail cell to be explicitly answered at level %s', (level) => {
    const hint = getHint(single, change(singleAnswer, 'io', 39, null), level)
    expect(hint).toMatchObject({ status: 'hint', time: 39, resources: ['io'] })
  })

  test.each([1, 2, 3] as const)('returns only correct status for a complete correct answer at level %s', (level) => {
    expect(getHint(single, singleAnswer, level)).toEqual({ status: 'correct' })
  })

  test('only the final level names the assignment and includes the grader explanation', () => {
    const attempt = change(singleAnswer, 'cpu', 0, null)
    for (const level of [1, 2] as const) {
      const hint = getHint(single, attempt, level)
      expect(hint.status).toBe('hint')
      if (hint.status !== 'hint') throw new Error('Expected a hint.')
      expect(hint.messages[0].text).not.toMatch(/Assign P1|selects P1|P1 starts|P1 continues|must be Idle/)
    }
    const grade = gradeAttempt(single, attempt)
    if (grade.status !== 'needs-correction') throw new Error('Expected a correction.')
    expect(getHint(single, attempt, 3)).toMatchObject({
      messages: [{
        resource: 'cpu',
        text: `Assign P1 to CPU for time 0 to 1. ${grade.issues[0].explanation}`,
      }],
    })
  })

  test.each(policies)('does not reveal decisions in level 1 or 2 for $algorithm $mode', (settings) => {
    const input = problem([
      process('P1', 5, 2, 2, 0, 4),
      process('P2', 2, 3, 1, 1, 2),
      process('P3', 1, 1, 3, 2, 1),
    ], settings)
    for (let time = 0; time < 40; time++) {
      for (const resource of ['cpu', 'io'] as const) {
        for (const level of [1, 2] as const) {
          expect(hintAt(input, resource, time, level)).not.toMatch(
            /Assign (?:P\d+|Idle)|selects P\d+|P\d+ (?:starts|continues)|must be Idle|preempts P\d+/,
          )
        }
      }
    }
  })
})

describe('rule hints', () => {
  test.each([
    [{ algorithm: 'fcfs-course' }, 'earliest original arrival', 'I/O returns retain launch order'],
    [{ algorithm: 'round-robin', quantum: 2 }, 'FIFO ready queue', 'then the expired process'],
    [{ algorithm: 'sjf' }, 'shortest current CPU burst', 'excluding future CPU and I/O work'],
    [{ algorithm: 'srtf' }, 'shortest remaining current CPU burst', 'strictly shorter remaining burst'],
    [{ algorithm: 'priority', mode: 'preemptive' }, 'smaller numbers mean higher priority', 'strictly higher priority'],
    [{ algorithm: 'priority', mode: 'non-preemptive' }, 'highest priority', 'running CPU burst finishes'],
  ] as const)('uses the active $0.algorithm policy without process assignments', (settings, selection, preemption) => {
    const text = hintAt({ ...single, settings }, 'cpu', 0, 1)
    expect(text).toContain(selection)
    expect(text).toContain(preemption)
    expect(text).not.toMatch(/P\d+/)
  })

  test('explains shared I/O eligibility and FIFO without naming a process', () => {
    const text = hintAt(contended, 'io', 5, 1)
    expect(text).toContain('I/O is nonpreemptive')
    expect(text).toContain('oldest outstanding request (FIFO)')
    expect(text).not.toMatch(/P\d+/)
  })
})

describe('boundary facts before the answer is revealed', () => {
  test('includes every dispatch candidate, even the selected process absent from the final queue', () => {
    const input = problem([process('P1', 2, 2, 2), process('P2', 1, 1, 1)])
    const text = hintAt(input, 'cpu', 0, 2)
    expect(text).toContain('Candidates before dispatch: P1 (original arrival 0), P2 (original arrival 0)')
    expect(text).not.toContain('selects')
  })

  test('retains original arrivals in course FCFS after I/O return', () => {
    const text = hintAt(contended, 'cpu', 5, 2)
    expect(text).toContain('P1 finished I/O and became ready')
    expect(text).toContain('P1 (original arrival 0)')
    expect(text).not.toContain('original arrival 5')
  })

  test('reports the previous incumbent and elapsed work without exposing a new assignment', () => {
    const input = problem([process('P1', 1, 1, 1), process('P2', 4, 1, 1)])
    const text = hintAt(input, 'cpu', 2, 2)
    expect(text).toContain('P1 finished I/O and became ready')
    expect(text).toContain('P2 held the CPU before time 2')
    expect(text).toContain('3 CPU units remaining')
    expect(text).toContain('Other ready candidates: P1')
  })

  test('reports RR remaining quantum from the preceding interval', () => {
    const input = problem([process('P1', 3, 1, 1)], { algorithm: 'round-robin', quantum: 2 })
    const text = hintAt(input, 'cpu', 1, 2)
    expect(text).toContain('unfinished burst 1 now has 2 CPU units remaining')
    expect(text).toContain('quantum has 1 unit left')
  })

  test('reports existing waiters before simultaneous RR arrivals, returns, and expired work', () => {
    const input = problem([
      process('P2', 1, 2, 1),
      process('P3', 3, 1, 1),
      process('P4', 1, 1, 1, 1),
      process('P1', 1, 1, 1, 3),
    ], { algorithm: 'round-robin', quantum: 2 })
    const text = hintAt(input, 'cpu', 3, 2)
    expect(text).toContain('P1 arrived at time 3')
    expect(text).toContain('P2 finished I/O and became ready')
    expect(text).toContain("P3's quantum expired with 1 CPU unit remaining")
    expect(text).toContain('front to back: P4 → P1 → P2 → P3')
    expect(text).not.toContain('selects P4')
  })

  test('explains RR burst completion at a quantum boundary without requeueing', () => {
    const input = problem([process('P1', 2, 1, 2)], { algorithm: 'round-robin', quantum: 2 })
    const text = hintAt(input, 'cpu', 2, 2)
    expect(text).toContain('finished CPU burst 1 and requested I/O')
    expect(text).toContain('completed burst is not requeued')
    expect(text).not.toContain("P1's quantum expired")
  })

  test('SJF presents current bursts and ready-entry ties, excluding future work', () => {
    const input = problem([process('P1', 2, 1, 9), process('P2', 2, 1, 1)], { algorithm: 'sjf' })
    const text = hintAt(input, 'cpu', 0, 2)
    expect(text).toContain('P1 (2 CPU units remaining in burst 1, ready since 0)')
    expect(text).toContain('P2 (2 CPU units remaining in burst 1, ready since 0)')
    expect(text).not.toContain('11 CPU')
  })

  test('SRTF reports recorded comparison quantities without saying which process preempts', () => {
    const input = problem([process('P1', 5, 1, 1), process('P2', 1, 1, 1, 1)], { algorithm: 'srtf' })
    const text = hintAt(input, 'cpu', 1, 2)
    expect(text).toContain('running process P1 had 4 CPU units remaining')
    expect(text).toContain('ready challenger P2 had 1 CPU unit remaining')
    expect(text).toContain('Candidates before dispatch: P2 (1 CPU unit')
    expect(text).toContain('P1 (4 CPU units')
    expect(text).not.toContain('preempts')
  })

  test('SRTF equal lengths show the incumbent and challenger without a dispatch outcome', () => {
    const input = problem([process('P1', 3, 1, 1), process('P2', 2, 1, 1, 1)], { algorithm: 'srtf' })
    const text = hintAt(input, 'cpu', 1, 2)
    expect(text).toContain('P1 held the CPU before time 1')
    expect(text).toContain('now has 2 CPU units remaining')
    expect(text).toContain('P2 (2 CPU units remaining')
    expect(text).not.toContain('Candidates before dispatch')
  })

  test('priority presents recorded priorities at preemption without revealing the winner', () => {
    const input = problem([
      process('P1', 5, 1, 1, 0, 4), process('P2', 1, 1, 1, 1, -2),
    ], { algorithm: 'priority', mode: 'preemptive' })
    const text = hintAt(input, 'cpu', 1, 2)
    expect(text).toContain('running process P1 had priority 4')
    expect(text).toContain('ready challenger P2 had priority -2')
    expect(text).toContain('P2 (priority -2, ready since 1)')
    expect(text).toContain('P1 (priority 4, ready since 1)')
    expect(text).not.toContain('preempts')
  })

  test('nonpreemptive priority presents the incumbent and higher-priority arrival', () => {
    const input = problem([
      process('P1', 5, 1, 1, 0, 4), process('P2', 1, 1, 1, 1, -2),
    ], { algorithm: 'priority', mode: 'non-preemptive' })
    const text = hintAt(input, 'cpu', 1, 2)
    expect(text).toContain('P1 held the CPU before time 1')
    expect(text).toContain('Its priority is 4')
    expect(text).toContain('Other ready candidates: P2 (priority -2')
    expect(text).not.toContain('Candidates before dispatch')
  })

  test('shows I/O work remaining alongside a new pending request', () => {
    const text = hintAt(contended, 'io', 3, 2)
    expect(text).toContain("P1's I/O request began at time 1")
    expect(text).toContain('still has 2 I/O units remaining')
    expect(text).toContain('P2 (requested at 3)')
    expect(text).not.toContain('P1 continues')
  })

  test('includes the selected I/O request and the simultaneous new request before dispatch', () => {
    const text = hintAt(contended, 'io', 5, 2)
    expect(text).toContain("P1's I/O request finished at time 5")
    expect(text).toContain('P2 (requested at 3) → P3 (requested at 5)')
    expect(text).not.toContain('P2 starts')
  })

  test('reports lack of ready work and I/O requests without directly assigning Idle', () => {
    const input = problem([process('P1', 1, 1, 1, 2)])
    expect(hintAt(input, 'cpu', 0, 2)).toContain('There are no ready candidates')
    expect(hintAt(input, 'io', 0, 2)).toContain('There are no queued I/O requests')
    expect(hintAt(input, 'cpu', 0, 2)).not.toContain('Idle')
    expect(hintAt(input, 'io', 0, 2)).not.toContain('Idle')
  })
})

describe('input safety and shared explanations', () => {
  test.each([0, 4, 1.5, NaN, Infinity, '1', null])('rejects invalid hint level %s', (level) => {
    expect(() => getHint(single, singleAnswer, level as HintLevel)).toThrow(/Hint level/)
  })

  test.each([null, { cpu: [], io: singleAnswer.io }, { cpu: Array(40).fill('P9'), io: singleAnswer.io }])(
    'rejects malformed attempts',
    (attempt) => {
      expect(() => getHint(single, attempt as Attempt, 1)).toThrow(/Invalid attempt/)
    },
  )

  test('validates the problem and rejects incomplete schedules', () => {
    expect(() => getHint({ ...single, seed: -1 }, singleAnswer, 1)).toThrow(/Invalid scheduling problem/)
    const long = problem([process('P1', 1, 1, 39)])
    expect(() => getHint(long, createEmptyAttempt(), 1)).toThrow(/does not finish within 40 intervals/)
  })

  test('does not mutate frozen inputs or put reference state in the result', () => {
    const input = Object.freeze({
      ...single,
      settings: Object.freeze({ ...single.settings }),
      processes: Object.freeze(single.processes.map((item) => Object.freeze({ ...item }))),
    })
    const attempt = Object.freeze({
      cpu: Object.freeze([...singleAnswer.cpu]),
      io: Object.freeze(singleAnswer.io.map((cell, time) => time === 3 ? null : cell)),
    })
    const before = structuredClone({ input, attempt })
    for (const level of [1, 2, 3] as const) {
      const hint = getHint(input, attempt, level)
      expect(hint).toEqual(getHint(input, attempt, level))
      expect(hint).not.toHaveProperty('timeline')
      expect(hint).not.toHaveProperty('boundaries')
      expect(hint).not.toHaveProperty('expected')
    }
    expect({ input, attempt }).toEqual(before)
  })

  test.each(policies)('playback shares grader reasoning for $algorithm $mode', (settings) => {
    const input = problem([process('P1', 3, 1, 1), process('P2', 1, 1, 1, 1, 2)], settings)
    const solution = simulate(input)
    for (let time = 0; time < 40; time++) {
      const explanation = explainInterval(input, solution, time)
      const attempt = change(change(solution.timeline, 'cpu', time, null), 'io', time, null)
      const grade = gradeAttempt(input, attempt)
      if (grade.status !== 'needs-correction') throw new Error('Expected a correction.')
      for (const issue of grade.issues) {
        expect(issue.explanation).toBe(`This cell is unanswered. ${explanation[issue.resource]}`)
      }
    }
  })

  test.each([-1, 40, 41, 0.5, NaN, Infinity])('does not explain invalid interval %s or terminal boundary 40 as an interval', (time) => {
    expect(() => explainInterval(single, simulate(single), time)).toThrow(RangeError)
  })
})
