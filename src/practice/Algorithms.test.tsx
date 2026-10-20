import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../App'
import * as generator from '../scheduling/generator'
import { getSchedulingRule } from '../scheduling/rules'
import { simulate } from '../scheduling/simulator'
import type { Problem, SchedulingSettings } from '../scheduling/types'

const policies: readonly SchedulingSettings[] = [
  { algorithm: 'sjf' },
  { algorithm: 'srtf' },
  { algorithm: 'priority', mode: 'non-preemptive' },
  { algorithm: 'priority', mode: 'preemptive' },
]

// 28 CPU units + 9 I/O units guarantees that every policy can retain this workload.
const reusable: Problem = {
  seed: 42, rulesVersion: 1, generatorVersion: 1,
  settings: { algorithm: 'fcfs-course' },
  processes: [
    { id: 'P1', arrival: 0, cpu1: 5, io: 3, cpu2: 4 },
    { id: 'P2', arrival: 0, cpu1: 4, io: 4, cpu2: 5 },
    { id: 'P3', arrival: 0, cpu1: 6, io: 2, cpu2: 4 },
  ],
}

function press(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}

function choose(settings: SchedulingSettings) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Algorithm' }), {
    target: { value: settings.algorithm },
  })
  if (settings.algorithm === 'priority') {
    fireEvent.change(screen.getByRole('combobox', { name: 'Priority mode' }), {
      target: { value: settings.mode },
    })
  }
}

function tableValues() {
  return within(screen.getByRole('table', { name: 'Processes' })).getAllByRole('row')
    .slice(1).map((row) => Array.from(row.children).map((cell) => cell.textContent))
}

function expectRule(settings: SchedulingSettings) {
  expect(screen.getByRole('heading', { name: getSchedulingRule(settings).label })).toBeVisible()
}

beforeEach(() => vi.spyOn(generator, 'createProblemSeed').mockReturnValue(42))
afterEach(() => vi.restoreAllMocks())

describe('practice with every scheduling algorithm', () => {
  test.each(policies)('generates, fills, and checks a complete $algorithm $mode problem', (settings) => {
    render(<App />)
    vi.mocked(generator.createProblemSeed).mockReturnValue(99)
    choose(settings)
    press('New problem')

    const input = generator.generateProblem(99, settings)
    expectRule(settings)
    expect(screen.getByText('Seed')).toHaveTextContent('Seed 99')
    expect(tableValues()).toEqual(input.processes.map((process) => [
      process.id, String(process.arrival), String(process.cpu1), String(process.io),
      String(process.cpu2), ...(settings.algorithm === 'priority' ? [String(process.priority)] : []),
    ]))

    const reference = simulate(input).timeline
    const tools = new Map(['P1', 'P2', 'P3', 'Idle'].map((name) => [
      name, screen.getByRole('button', { name }),
    ]))
    for (const resource of ['cpu', 'io'] as const) {
      const cells = screen.getAllByRole('button', {
        name: resource === 'cpu' ? /^CPU, time / : /^I\/O, time /,
      })
      reference[resource].forEach((value, time) => {
        fireEvent.click(tools.get(value === 'idle' ? 'Idle' : value)!)
        fireEvent.click(cells[time])
      })
    }
    press('Check answer')
    expect(screen.getByRole('heading', { name: 'Timeline correct' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    press('Undo')
    expect(screen.queryByRole('heading', { name: 'Timeline correct' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled()
  })

  test.each(policies)('applies $algorithm $mode without losing a fitting workload or attempt', (settings) => {
    vi.spyOn(generator, 'generateProblem').mockReturnValueOnce(reusable)
    render(<App />)
    const before = tableValues()
    press('CPU, time 0 to 1: unanswered')
    press('Check answer')
    choose(settings)

    expectRule(reusable.settings)
    expect(tableValues()).toEqual(before)
    expect(screen.getByRole('heading', { name: 'Review time 0–1' })).toBeVisible()
    expect(screen.queryByRole('columnheader', { name: 'Priority' })).not.toBeInTheDocument()
    press('Apply settings')

    expectRule(settings)
    expect(tableValues().map((row) => row.slice(0, 5))).toEqual(before)
    expect(screen.getByText('Seed')).toHaveTextContent('Seed 42')
    expect(screen.getByRole('button', { name: 'CPU, time 0 to 1: P1' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: /^Review time / })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
    press('Undo')
    expect(screen.getByRole('button', { name: 'CPU, time 0 to 1: unanswered' })).toBeVisible()
  })

  test('keeps priority values across draft modes, applied modes, and trips through other algorithms', () => {
    vi.spyOn(generator, 'generateProblem').mockReturnValueOnce(reusable)
    render(<App />)
    choose({ algorithm: 'priority', mode: 'non-preemptive' })
    expect(screen.queryByRole('spinbutton', { name: 'Time quantum' })).not.toBeInTheDocument()
    press('Apply settings')
    const withPriorities = tableValues()
    expect(withPriorities.every((row) => Number(row[5]) >= 1 && Number(row[5]) <= 5)).toBe(true)
    press('Check answer')

    choose({ algorithm: 'priority', mode: 'preemptive' })
    expectRule({ algorithm: 'priority', mode: 'non-preemptive' })
    expect(tableValues()).toEqual(withPriorities)
    expect(screen.getByRole('heading', { name: 'Review time 0–1' })).toBeVisible()
    press('Apply settings')
    expectRule({ algorithm: 'priority', mode: 'preemptive' })
    expect(tableValues()).toEqual(withPriorities)
    expect(screen.queryByRole('heading', { name: /^Review time / })).not.toBeInTheDocument()

    choose({ algorithm: 'sjf' })
    // The active problem remains priority until Apply settings.
    expect(screen.getByRole('columnheader', { name: 'Priority' })).toBeVisible()
    expect(screen.queryByRole('combobox', { name: 'Priority mode' })).not.toBeInTheDocument()
    press('Apply settings')
    expect(screen.queryByRole('columnheader', { name: 'Priority' })).not.toBeInTheDocument()
    choose({ algorithm: 'priority', mode: 'preemptive' })
    press('Apply settings')
    expect(tableValues()).toEqual(withPriorities)
    expectRule({ algorithm: 'priority', mode: 'preemptive' })
  })

  test('keeps the active priorities and answers unchanged until an overflowing switch is confirmed', () => {
    render(<App />)
    vi.mocked(generator.createProblemSeed).mockReturnValue(63)
    choose({ algorithm: 'round-robin', quantum: 2 })
    press('New problem')
    press('CPU, time 0 to 1: unanswered')
    press('Check answer')
    const before = tableValues()
    vi.mocked(generator.createProblemSeed).mockReturnValue(99)
    choose({ algorithm: 'priority', mode: 'preemptive' })
    press('Apply settings')

    expect(screen.getByRole('alertdialog')).toBeVisible()
    press('Keep current problem')
    expectRule({ algorithm: 'round-robin', quantum: 2 })
    expect(tableValues()).toEqual(before)
    expect(screen.queryByRole('columnheader', { name: 'Priority' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CPU, time 0 to 1: P1' })).toBeVisible()
    expect(screen.getByRole('heading', { name: /^Review time / })).toBeVisible()

    press('Apply settings')
    press('Start new problem')
    expectRule({ algorithm: 'priority', mode: 'preemptive' })
    expect(screen.getByRole('columnheader', { name: 'Priority' })).toBeVisible()
    expect(screen.getByText('Seed')).toHaveTextContent('Seed 99')
    expect(screen.getByRole('button', { name: 'CPU, time 0 to 1: unanswered' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.queryByRole('heading', { name: /^Review time / })).not.toBeInTheDocument()
  })
})
