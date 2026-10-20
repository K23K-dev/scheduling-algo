import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../App'
import * as generator from '../scheduling/generator'
import * as hints from '../scheduling/hints'
import * as simulator from '../scheduling/simulator'
import type { AttemptCell, Resource } from '../scheduling/types'

function press(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}

function cell(resource: Resource, time: number) {
  const label = resource === 'cpu' ? 'CPU' : 'I/O'
  return screen.getByRole('button', {
    name: new RegExp(`^${label}, time ${time} to ${time + 1}: `),
  })
}

function assign(resource: Resource, time: number, value: AttemptCell) {
  press(value === null ? 'Erase' : value === 'idle' ? 'Idle' : value)
  fireEvent.click(cell(resource, time))
}

function hint(level = 1, time = 0) {
  return screen.getByRole('heading', {
    name: `Hint ${level} of 3 · time ${time}–${time + 1}`,
  })
}

function revealHint() {
  press('Hint')
  press('More detail')
  press('Show this assignment')
}

function expectNoHintOrFeedback() {
  expect(screen.queryByRole('heading', { name: /^Hint \d of 3/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /^Review time / })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Timeline correct' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Your timeline is already correct' }))
    .not.toBeInTheDocument()
}

function answers() {
  return {
    cpu: screen.getAllByRole('button', { name: /^CPU, time / }).map((button) => button.dataset.value),
    io: screen.getAllByRole('button', { name: /^I\/O, time / }).map((button) => button.dataset.value),
  }
}

function processRows() {
  return within(screen.getByRole('table', { name: 'Processes' }))
    .getAllByRole('row').map((row) => row.textContent)
}

function selectRoundRobin(quantum = '2') {
  fireEvent.change(screen.getByRole('combobox', { name: 'Algorithm' }), {
    target: { value: 'round-robin' },
  })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Time quantum' }), {
    target: { value: quantum },
  })
}

beforeEach(() => {
  vi.spyOn(generator, 'createProblemSeed').mockReturnValue(42)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('learning from hints and solution playback', () => {
  test('only reveals hints on request and asks before exposing the assignment', () => {
    render(<App />)
    expectNoHintOrFeedback()
    expect(screen.queryByRole('table', { name: 'Reference solution' })).not.toBeInTheDocument()
    expect(screen.queryByText('Assisted attempt')).not.toBeInTheDocument()
    assign('cpu', 0, 'P3')
    const before = answers()
    expectNoHintOrFeedback()

    press('Hint')
    expect(hint()).toBeVisible()
    expect(screen.queryByText(/^Expected:/)).not.toBeInTheDocument()
    expect(screen.queryByText('Assisted attempt')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More detail' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Show this assignment' })).not.toBeInTheDocument()

    press('More detail')
    expect(hint(2)).toBeVisible()
    expect(screen.queryByText(/^Expected:/)).not.toBeInTheDocument()
    expect(screen.queryByText('Assisted attempt')).not.toBeInTheDocument()
    press('Show this assignment')
    expect(hint(3)).toBeVisible()
    expect(screen.getByText('Assisted attempt')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Show this assignment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Reference solution' })).not.toBeInTheDocument()
    expect(answers()).toEqual(before)

    press('Undo')
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: unanswered')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByText('Assisted attempt')).toBeVisible()
  })

  test('keeps a hint while choosing tools or navigating, then restarts it after each kind of edit', () => {
    render(<App />)
    assign('cpu', 0, 'P2')
    press('Hint')
    press('More detail')
    press('Idle')
    cell('cpu', 0).focus()
    fireEvent.keyDown(cell('cpu', 0), { key: 'ArrowRight' })
    fireEvent.keyDown(cell('cpu', 1), { key: 'ArrowDown' })
    expect(cell('io', 1)).toHaveFocus()
    expect(hint(2)).toBeVisible()

    assign('cpu', 2, 'P3')
    expectNoHintOrFeedback()
    for (const action of ['Undo', 'Redo', 'Fill remaining empty cells with Idle', 'Clear attempt']) {
      press('Hint')
      expect(hint()).toBeVisible()
      press('More detail')
      expect(hint(2)).toBeVisible()
      press(action)
      expectNoHintOrFeedback()
    }
    press('Hint')
    expect(hint()).toBeVisible()
    expect(screen.queryByText('Assisted attempt')).not.toBeInTheDocument()
  })

  test('waits for another request before moving a hint to the next interval needing attention', () => {
    render(<App />)
    press('Hint')
    expect(hint()).toBeVisible()
    assign('cpu', 0, 'P1')
    assign('io', 0, 'idle')
    expectNoHintOrFeedback()
    press('Hint')

    expect(hint(1, 1)).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Hint 1 of 3 · time 2–3' })).not.toBeInTheDocument()
    expect(cell('cpu', 1)).toHaveAccessibleName('CPU, time 1 to 2: unanswered')
    expect(cell('io', 1)).toHaveAccessibleName('I/O, time 1 to 2: unanswered')
    expect(screen.queryByText(/^Expected:/)).not.toBeInTheDocument()
  })

  test('shows and hides a separate solution without replacing the attempt or its history', () => {
    render(<App />)
    assign('cpu', 0, 'P3')
    assign('io', 4, 'P2')
    const before = answers()
    press('Reveal solution')

    expect(screen.getByRole('heading', { name: /Solution playback$/ })).toBeVisible()
    const reference = screen.getByRole('table', { name: 'Reference solution' })
    expect(reference).toBeVisible()
    expect(within(reference).getAllByRole('cell')).toHaveLength(80)
    expect(screen.getByRole('button', { name: 'Reveal solution' })).toBeDisabled()
    expect(screen.getByText('Assisted attempt')).toBeVisible()
    expect(answers()).toEqual(before)
    expectNoHintOrFeedback()
    press('Undo')
    expect(cell('io', 4)).toHaveAccessibleName('I/O, time 4 to 5: unanswered')
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: P3')
    expect(screen.getByRole('table', { name: 'Reference solution' })).toBeVisible()
    press('Redo')
    expect(answers()).toEqual(before)

    press('Hide solution')
    expect(screen.queryByRole('table', { name: 'Reference solution' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reveal solution' })).toBeEnabled()
    expect(screen.getByText('Assisted attempt')).toBeVisible()
    press('Clear attempt')
    expect(answers().cpu.every((value) => value === 'empty')).toBe(true)
    expect(answers().io.every((value) => value === 'empty')).toBe(true)
    expect(screen.getByText('Assisted attempt')).toBeVisible()
  })

  test('retries the same active problem while clearing answers, history, help, and assistance', () => {
    render(<App />)
    const processes = processRows()
    assign('cpu', 0, 'P3')
    revealHint()
    press('Reveal solution')
    selectRoundRobin('0')
    press('Retry same problem')

    expect(screen.getByText('Seed')).toHaveTextContent('Seed 42')
    expect(processRows()).toEqual(processes)
    expect(screen.getByRole('heading', { name: 'FCFS — course launch order' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Algorithm' })).toHaveValue('round-robin')
    expect(screen.getByRole('spinbutton', { name: 'Time quantum' })).toHaveValue(0)
    expect(answers().cpu.every((value) => value === 'empty')).toBe(true)
    expect(answers().io.every((value) => value === 'empty')).toBe(true)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
    expect(screen.queryByText('Assisted attempt')).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Reference solution' })).not.toBeInTheDocument()
    expectNoHintOrFeedback()
    press('Hint')
    expect(hint()).toBeVisible()
  })

  test('clears help and playback after applying fitting settings while retaining the answers and assistance', () => {
    render(<App />)
    assign('cpu', 2, 'P1')
    revealHint()
    press('Reveal solution')
    const before = answers()
    selectRoundRobin()
    press('Apply settings')

    expect(screen.getByText('Seed')).toHaveTextContent('Seed 42')
    expect(answers()).toEqual(before)
    expect(screen.getByText('Assisted attempt')).toBeVisible()
    expect(screen.queryByRole('table', { name: 'Reference solution' })).not.toBeInTheDocument()
    expectNoHintOrFeedback()
    press('Undo')
    expect(cell('cpu', 2)).toHaveAccessibleName('CPU, time 2 to 3: unanswered')
    expect(screen.getByText('Assisted attempt')).toBeVisible()
    press('Hint')
    expect(hint()).toBeVisible()
  })

  test('preserves help through unchanged settings, drafts, invalid input, and failed new problems', () => {
    render(<App />)
    assign('cpu', 0, 'P2')
    press('Hint')
    press('More detail')
    press('Apply settings')
    expect(hint(2)).toBeVisible()
    selectRoundRobin('0')
    expect(hint(2)).toBeVisible()
    press('Apply settings')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number of at least 1.')
    expect(hint(2)).toBeVisible()

    press('Reveal solution')
    press('Apply settings')
    expect(screen.getByRole('table', { name: 'Reference solution' })).toBeVisible()
    const before = answers()
    selectRoundRobin()
    vi.spyOn(generator, 'generateProblem').mockImplementationOnce(() => {
      throw new Error('Generation failed')
    })
    press('New problem')
    expect(screen.getByRole('alert')).toHaveTextContent('This problem could not be prepared.')
    expect(screen.getByRole('table', { name: 'Reference solution' })).toBeVisible()
    expect(screen.getByText('Assisted attempt')).toBeVisible()
    expect(answers()).toEqual(before)
  })

  test('preserves assistance when an overflowing switch is canceled and resets it when confirmed', () => {
    vi.mocked(generator.createProblemSeed).mockReturnValueOnce(607).mockReturnValue(99)
    render(<App />)
    assign('cpu', 0, 'P2')
    press('Reveal solution')
    selectRoundRobin()
    press('Apply settings')
    expect(screen.getByRole('alertdialog')).toBeVisible()
    press('Keep current problem')

    expect(screen.getByText('Seed')).toHaveTextContent('Seed 607')
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: P2')
    expect(screen.getByRole('table', { name: 'Reference solution' })).toBeVisible()
    expect(screen.getByText('Assisted attempt')).toBeVisible()
    press('Apply settings')
    press('Start new problem')

    expect(screen.getByText('Seed')).toHaveTextContent('Seed 99')
    expect(screen.queryByRole('table', { name: 'Reference solution' })).not.toBeInTheDocument()
    expect(screen.queryByText('Assisted attempt')).not.toBeInTheDocument()
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: unanswered')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expectNoHintOrFeedback()
  })

  test('starts a fresh unassisted attempt with a new problem', () => {
    render(<App />)
    assign('cpu', 0, 'P3')
    revealHint()
    press('Reveal solution')
    vi.mocked(generator.createProblemSeed).mockReturnValue(99)
    press('New problem')

    expect(screen.getByText('Seed')).toHaveTextContent('Seed 99')
    expect(screen.queryByRole('table', { name: 'Reference solution' })).not.toBeInTheDocument()
    expect(screen.queryByText('Assisted attempt')).not.toBeInTheDocument()
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: unanswered')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expectNoHintOrFeedback()
  })

  test('recognizes an already correct timeline without offering more hints or marking it assisted', () => {
    const reference = simulator.simulate(generator.generateProblem(42, { algorithm: 'fcfs-course' })).timeline
    render(<App />)
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
    press('Hint')

    expect(screen.getByRole('heading', { name: 'Your timeline is already correct' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'More detail' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show this assignment' })).not.toBeInTheDocument()
    expect(screen.queryByText('Assisted attempt')).not.toBeInTheDocument()
    expect(answers()).toEqual(reference)
    press('Undo')
    expectNoHintOrFeedback()
    expect(cell('io', 39)).toHaveAccessibleName('I/O, time 39 to 40: unanswered')
  })

  test('keeps the attempt and history when preparing a hint fails, then allows retrying', () => {
    render(<App />)
    assign('cpu', 0, 'P2')
    press('Hint')
    expect(hint()).toBeVisible()
    vi.spyOn(hints, 'getHint').mockImplementationOnce(() => {
      throw new Error('Hint failed')
    })
    press('Hint')

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your hint could not be prepared. Please try again.',
    )
    expectNoHintOrFeedback()
    expect(screen.queryByText('Assisted attempt')).not.toBeInTheDocument()
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: P2')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
    press('Hint')
    expect(hint()).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    press('Undo')
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: unanswered')
  })

  test('keeps the attempt unassisted when revealing the solution fails', () => {
    render(<App />)
    assign('cpu', 0, 'P2')
    press('Check answer')
    vi.spyOn(simulator, 'simulate').mockImplementationOnce(() => {
      throw new Error('Solution failed')
    })
    press('Reveal solution')

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The solution could not be prepared. Please try again.',
    )
    expectNoHintOrFeedback()
    expect(screen.queryByRole('table', { name: 'Reference solution' })).not.toBeInTheDocument()
    expect(screen.queryByText('Assisted attempt')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reveal solution' })).toBeEnabled()
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: P2')
    press('Reveal solution')
    expect(screen.getByRole('table', { name: 'Reference solution' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Assisted attempt')).toBeVisible()
    press('Undo')
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: unanswered')
  })
})
