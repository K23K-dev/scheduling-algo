import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../App'
import * as generator from '../scheduling/generator'
import * as grader from '../scheduling/grader'
import { simulate } from '../scheduling/simulator'
import type { AttemptCell, Resource } from '../scheduling/types'

const fcfs = { algorithm: 'fcfs-course' } as const

function cell(resource: Resource, time: number) {
  const label = resource === 'cpu' ? 'CPU' : 'I/O'
  return screen.getByRole('button', {
    name: new RegExp(`^${label}, time ${time} to ${time + 1}: `),
  })
}

function press(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}

function choose(value: AttemptCell) {
  press(value === null ? 'Erase' : value === 'idle' ? 'Idle' : value)
}

function assign(resource: Resource, time: number, value: AttemptCell) {
  choose(value)
  fireEvent.click(cell(resource, time))
}

function check() {
  press('Check answer')
}

function review(time = 0) {
  return screen.getByRole('heading', { name: `Review time ${time}–${time + 1}` })
}

function expectNoFeedback() {
  expect(screen.queryByRole('heading', { name: /^Review time / })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Timeline correct' })).not.toBeInTheDocument()
  expect(document.querySelectorAll('[data-feedback="true"]')).toHaveLength(0)
  expect(document.querySelectorAll('[aria-invalid="true"][data-resource]')).toHaveLength(0)
}

function issueFor(resource: Resource, time: number) {
  const descriptionId = cell(resource, time).getAttribute('aria-describedby')
  expect(descriptionId).toBeTruthy()
  const issue = document.getElementById(descriptionId!)
  expect(issue).toBeInTheDocument()
  return within(issue!)
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

describe('checking a practice attempt', () => {
  test('keeps correctness hidden until requested, even after assigning an impossible answer', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Check answer' })).toBeEnabled()
    expectNoFeedback()
    expect(screen.queryByText(/^Expected:/)).not.toBeInTheDocument()

    assign('io', 0, 'P3')

    expect(cell('io', 0)).toHaveAccessibleName('I/O, time 0 to 1: P3')
    expectNoFeedback()
    expect(screen.queryByText(/^Expected:/)).not.toBeInTheDocument()
  })

  test('groups both unanswered resources at the earliest interval without filling or flagging later cells', () => {
    render(<App />)
    check()

    expect(review()).toBeVisible()
    expect(review().closest('[aria-live="polite"]')).not.toBeNull()
    expect(document.querySelectorAll('[data-feedback="true"]')).toHaveLength(2)
    expect(cell('cpu', 0)).toHaveAttribute('aria-invalid', 'true')
    expect(cell('io', 0)).toHaveAttribute('aria-invalid', 'true')
    expect(issueFor('cpu', 0).getByText('Your answer:')).toHaveTextContent('Your answer: Unanswered')
    expect(issueFor('cpu', 0).getByText('Expected:')).toHaveTextContent('Expected: P1')
    expect(issueFor('io', 0).getByText('Your answer:')).toHaveTextContent('Your answer: Unanswered')
    expect(issueFor('io', 0).getByText('Expected:')).toHaveTextContent('Expected: Idle')
    expect(cell('cpu', 1)).not.toHaveAttribute('aria-invalid', 'true')
    expect(cell('io', 39)).not.toHaveAttribute('aria-describedby')
    expect(
      screen.getAllByRole('button', { name: /^(CPU|I\/O), time \d+ to \d+: unanswered$/ }),
    ).toHaveLength(80)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('flags only the wrong resource and lets the learner focus it without painting', () => {
    render(<App />)
    assign('cpu', 0, 'P1')
    assign('io', 0, 'P2')
    assign('cpu', 10, 'P3')
    check()

    expect(review()).toBeVisible()
    expect(document.querySelectorAll('[data-feedback="true"]')).toHaveLength(1)
    expect(cell('cpu', 0)).not.toHaveAttribute('aria-invalid', 'true')
    expect(cell('cpu', 10)).not.toHaveAttribute('aria-invalid', 'true')
    expect(issueFor('io', 0).getByText('Your answer:')).toHaveTextContent('Your answer: P2')
    expect(issueFor('io', 0).getByText('Expected:')).toHaveTextContent('Expected: Idle')
    expect(screen.queryByRole('button', { name: 'Edit CPU at time 0' })).not.toBeInTheDocument()

    press('Edit I/O at time 0')

    expect(cell('io', 0)).toHaveFocus()
    expect(cell('io', 0)).toHaveAccessibleName('I/O, time 0 to 1: P2')
    expect(review()).toBeVisible()
    press('Undo')
    expect(cell('cpu', 10)).toHaveAccessibleName('CPU, time 10 to 11: unanswered')
    expect(cell('io', 0)).toHaveAccessibleName('I/O, time 0 to 1: P2')
    expectNoFeedback()
  })

  test('requires another check after a correction before exposing the next mistake', () => {
    render(<App />)
    check()
    assign('cpu', 0, 'P1')
    expectNoFeedback()
    assign('io', 0, 'idle')
    expectNoFeedback()
    check()

    expect(review(1)).toBeVisible()
    expect(cell('cpu', 0)).not.toHaveAttribute('aria-invalid', 'true')
    expect(cell('io', 0)).not.toHaveAttribute('aria-invalid', 'true')
    expect(cell('cpu', 1)).toHaveAttribute('aria-invalid', 'true')
    expect(cell('io', 1)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('heading', { name: 'Review time 2–3' })).not.toBeInTheDocument()
  })

  test('preserves feedback when choosing tools or navigating the worksheet without changing answers', () => {
    render(<App />)
    check()
    choose('idle')
    cell('cpu', 0).focus()
    fireEvent.keyDown(cell('cpu', 0), { key: 'ArrowRight' })
    fireEvent.keyDown(cell('cpu', 1), { key: 'ArrowDown' })

    expect(cell('io', 1)).toHaveFocus()
    expect(review()).toBeVisible()
    expect(cell('cpu', 0)).toHaveAttribute('aria-invalid', 'true')
    expect(cell('io', 1)).toHaveAccessibleName('I/O, time 1 to 2: unanswered')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('clears feedback after filling, clearing, undoing, or redoing without checking automatically', () => {
    render(<App />)
    check()
    press('Fill remaining empty cells with Idle')
    expectNoFeedback()
    check()
    expect(review()).toBeVisible()
    press('Clear attempt')
    expectNoFeedback()
    check()
    expect(review()).toBeVisible()
    press('Undo')
    expectNoFeedback()
    check()
    expect(review()).toBeVisible()
    press('Redo')
    expectNoFeedback()
  })

  test('accepts a complete correct attempt while preserving its answers and undo history', () => {
    const reference = simulate(generator.generateProblem(42, fcfs)).timeline
    render(<App />)
    const tools = new Map(
      ['P1', 'P2', 'P3', 'Idle'].map((name) => [
        name,
        screen.getByRole('button', { name }),
      ]),
    )
    const rows = {
      cpu: screen.getAllByRole('button', { name: /^CPU, time / }),
      io: screen.getAllByRole('button', { name: /^I\/O, time / }),
    }
    for (const resource of ['cpu', 'io'] as const) {
      reference[resource].forEach((value, time) => {
        fireEvent.click(tools.get(value === 'idle' ? 'Idle' : value)!)
        fireEvent.click(rows[resource][time])
      })
    }
    expectNoFeedback()
    check()

    expect(screen.getByRole('heading', { name: 'Timeline correct' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: /^Review time / })).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-feedback="true"]')).toHaveLength(0)
    for (const resource of ['cpu', 'io'] as const) {
      expect(rows[resource].map((button) => button.dataset.value)).toEqual(reference[resource])
    }
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
    press('Undo')
    expectNoFeedback()
    expect(cell('io', 39)).toHaveAccessibleName('I/O, time 39 to 40: unanswered')
    press('Redo')
    expectNoFeedback()
    check()
    expect(screen.getByRole('heading', { name: 'Timeline correct' })).toBeVisible()
  })

  test('checks the active algorithm while drafts are pending and invalidates feedback when changed settings apply', () => {
    render(<App />)
    for (let time = 0; time < 3; time++) {
      assign('cpu', time, 'P1')
      assign('io', time, 'idle')
    }
    selectRoundRobin()
    check()

    expect(review(3)).toBeVisible()
    expect(cell('cpu', 2)).not.toHaveAttribute('aria-invalid', 'true')
    press('Apply settings')
    expectNoFeedback()
    expect(cell('cpu', 2)).toHaveAccessibleName('CPU, time 2 to 3: P1')
    check()
    expect(review(2)).toBeVisible()
    expect(issueFor('cpu', 2).getByText('Expected:')).toHaveTextContent('Expected: P2')
  })

  test('keeps existing feedback through unapplied drafts, invalid settings, unchanged settings, and failed generation', () => {
    render(<App />)
    check()
    press('Apply settings')
    expect(review()).toBeVisible()
    selectRoundRobin('0')
    expect(review()).toBeVisible()
    press('Apply settings')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number of at least 1.')
    expect(review()).toBeVisible()

    selectRoundRobin()
    vi.spyOn(generator, 'generateProblem').mockImplementationOnce(() => {
      throw new Error('Generation failed')
    })
    press('New problem')
    expect(screen.getByRole('alert')).toHaveTextContent('This problem could not be prepared.')
    expect(review()).toBeVisible()
    expect(cell('cpu', 0)).toHaveAttribute('aria-invalid', 'true')
  })

  test('preserves feedback when an overflowing settings change is canceled and clears it after confirmation', () => {
    vi.mocked(generator.createProblemSeed).mockReturnValueOnce(607).mockReturnValue(99)
    render(<App />)
    assign('cpu', 0, 'P1')
    check()
    selectRoundRobin()
    press('Apply settings')
    expect(screen.getByRole('alertdialog')).toBeVisible()
    press('Keep current problem')

    expect(review()).toBeVisible()
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: P1')
    press('Apply settings')
    press('Start new problem')
    expectNoFeedback()
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: unanswered')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('clears old feedback when starting a new problem', () => {
    render(<App />)
    assign('cpu', 0, 'P3')
    check()
    vi.mocked(generator.createProblemSeed).mockReturnValue(99)
    press('New problem')

    expectNoFeedback()
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: unanswered')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('removes stale feedback and keeps the attempt editable when checking fails', () => {
    render(<App />)
    assign('cpu', 0, 'P2')
    check()
    expect(review()).toBeVisible()
    vi.spyOn(grader, 'gradeAttempt').mockImplementationOnce(() => {
      throw new Error('Checking failed')
    })
    check()

    expectNoFeedback()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your answer could not be checked. Please try again.',
    )
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: P2')
    assign('cpu', 0, 'P1')
    expect(cell('cpu', 0)).toHaveAccessibleName('CPU, time 0 to 1: P1')
    check()
    expect(review()).toBeVisible()
    expect(cell('cpu', 0)).not.toHaveAttribute('aria-invalid', 'true')
    expect(cell('io', 0)).toHaveAttribute('aria-invalid', 'true')
  })
})
