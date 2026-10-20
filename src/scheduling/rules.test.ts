import { describe, expect, it } from 'vitest'
import {
  compareLaunchOrder,
  compareProcessIds,
  compareReadyEntries,
  getBoundaryPhases,
  getSchedulingRule,
  shouldPreempt,
  shouldRequeueAfterQuantum,
} from './rules'
import type {
  CpuCandidate,
  ProcessId,
  ProcessInput,
  ReadyQueueEntry,
  SchedulingSettings,
} from './types'

function process(id: ProcessId, arrival: number): ProcessInput {
  return { id, arrival, cpu1: 3, io: 2, cpu2: 1 }
}

const running: CpuCandidate = {
  processId: 'P2',
  enteredAt: 4,
  burst: 1,
  remainingCpu: 5,
  priority: 3,
}

const challenger: CpuCandidate = {
  processId: 'P1',
  enteredAt: 2,
  burst: 2,
  remainingCpu: 5,
  priority: 3,
}

describe('boundary order', () => {
  it('orders every interval from completion through execution', () => {
    for (let time = 0; time < 40; time += 1) {
      expect(getBoundaryPhases(time)).toEqual([
        'completions',
        'newly-ready',
        'preemption',
        'dispatch',
        'execute',
      ])
    }
  })

  it('keeps final completions and queue bookkeeping at boundary 40 without new work', () => {
    expect(getBoundaryPhases(40)).toEqual(['completions', 'newly-ready', 'preemption'])
  })

  it.each([-1, 41, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid boundary %s',
    (time) => {
      expect(() => getBoundaryPhases(time)).toThrow(RangeError)
    },
  )
})

describe('selection tie-breaks', () => {
  it('compares process numbers numerically', () => {
    expect(compareProcessIds('P2', 'P10')).toBeLessThan(0)
    expect(compareProcessIds('P10', 'P2')).toBeGreaterThan(0)
    expect(compareProcessIds('P2', 'P2')).toBe(0)
  })

  it.each(['P0', 'P01', 'P-1', 'P1.5', 'P1e2', 'Q1', 'P9007199254740992'])(
    'rejects invalid process ID %s',
    (id) => {
      expect(() => compareProcessIds(id as ProcessId, 'P2')).toThrow(TypeError)
      expect(() => compareProcessIds('P2', id as ProcessId)).toThrow(TypeError)
    },
  )

  it('prioritizes arrival over process number for original launch order', () => {
    expect(compareLaunchOrder(process('P10', 0), process('P2', 1))).toBeLessThan(0)
    expect(compareLaunchOrder(process('P10', 0), process('P2', 0))).toBeGreaterThan(0)
  })

  it('distinguishes course launch order from ready-entry tie-breaking after I/O', () => {
    const earlierLaunch = process('P1', 0)
    const laterLaunch = process('P2', 1)
    const returning: ReadyQueueEntry = { processId: 'P1', enteredAt: 8 }
    const waiting: ReadyQueueEntry = { processId: 'P2', enteredAt: 3 }

    expect(compareLaunchOrder(earlierLaunch, laterLaunch)).toBeLessThan(0)
    expect(compareReadyEntries(returning, waiting)).toBeGreaterThan(0)
  })

  it('uses numeric process order for equal ready-entry times', () => {
    expect(
      compareReadyEntries(
        { processId: 'P10', enteredAt: 4 },
        { processId: 'P2', enteredAt: 4 },
      ),
    ).toBeGreaterThan(0)
  })

  it('keeps FIFO position distinct from ready-entry tie-breaking', () => {
    // P10 just arrived; P2 expired at the same boundary and was appended last.
    const queue: readonly ReadyQueueEntry[] = Object.freeze([
      { processId: 'P3', enteredAt: 1 },
      { processId: 'P10', enteredAt: 4 },
      { processId: 'P2', enteredAt: 4 },
    ])

    expect(compareReadyEntries(queue[1], queue[2])).toBeGreaterThan(0)
    expect(queue.map((entry) => entry.processId)).toEqual(['P3', 'P10', 'P2'])
  })
})

describe('preemption', () => {
  it('uses only strictly shorter remaining current CPU work under SRTF', () => {
    expect(shouldPreempt({ algorithm: 'srtf' }, running, challenger)).toBe(false)
    expect(
      shouldPreempt({ algorithm: 'srtf' }, running, { ...challenger, remainingCpu: 4 }),
    ).toBe(true)
    expect(
      shouldPreempt({ algorithm: 'srtf' }, running, { ...challenger, remainingCpu: 6 }),
    ).toBe(false)
  })

  it('requires a strictly better priority and preemptive mode', () => {
    const settings: SchedulingSettings = { algorithm: 'priority', mode: 'preemptive' }
    expect(shouldPreempt(settings, running, challenger)).toBe(false)
    expect(shouldPreempt(settings, running, { ...challenger, priority: 2 })).toBe(true)
    expect(shouldPreempt(settings, running, { ...challenger, priority: 4 })).toBe(false)
    expect(
      shouldPreempt(
        { algorithm: 'priority', mode: 'non-preemptive' },
        running,
        { ...challenger, priority: 2 },
      ),
    ).toBe(false)
  })

  it('does not let FCFS, SJF, or round robin preempt for a better challenger', () => {
    const settings: SchedulingSettings[] = [
      { algorithm: 'fcfs-course' },
      { algorithm: 'sjf' },
      { algorithm: 'round-robin', quantum: 3 },
    ]

    for (const setting of settings) {
      expect(
        shouldPreempt(setting, running, { ...challenger, remainingCpu: 1, priority: 1 }),
      ).toBe(false)
    }
  })

  it.each(['preemptive', 'non-preemptive'] as const)(
    'rejects missing priority instead of inventing one in %s mode',
    (mode) => {
      const settings: SchedulingSettings = { algorithm: 'priority', mode }
      expect(() =>
        shouldPreempt(settings, { ...running, priority: undefined }, challenger),
      ).toThrow(TypeError)
      expect(() =>
        shouldPreempt(settings, running, { ...challenger, priority: undefined }),
      ).toThrow(TypeError)
    },
  )
})

describe('round-robin completion precedence', () => {
  it('does not requeue a burst completing exactly at quantum expiration', () => {
    expect(shouldRequeueAfterQuantum(0, 0)).toBe(false)
  })

  it('requeues only unfinished work at expiration', () => {
    expect(shouldRequeueAfterQuantum(4, 0)).toBe(true)
    expect(shouldRequeueAfterQuantum(4, 1)).toBe(false)
    expect(shouldRequeueAfterQuantum(0, 2)).toBe(false)
  })

  it.each([
    [-1, 0],
    [1, -1],
    [0.5, 0],
    [1, Number.NaN],
  ])('rejects invalid remaining work %s or quantum %s', (remainingCpu, quantumRemaining) => {
    expect(() => shouldRequeueAfterQuantum(remainingCpu, quantumRemaining)).toThrow(RangeError)
  })
})

describe('visible rule metadata', () => {
  it('makes course FCFS, priority mode, and quantum explicit', () => {
    expect(getSchedulingRule({ algorithm: 'fcfs-course' }).label).toContain('course launch order')
    expect(getSchedulingRule({ algorithm: 'priority', mode: 'preemptive' }).label).toBe(
      'Priority — preemptive',
    )
    expect(getSchedulingRule({ algorithm: 'priority', mode: 'non-preemptive' }).label).toBe(
      'Priority — non-preemptive',
    )
    expect(getSchedulingRule({ algorithm: 'round-robin', quantum: 4 }).label).toContain('quantum 4')
  })
})
