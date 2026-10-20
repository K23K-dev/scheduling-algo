import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from './App'
import * as generator from './scheduling/generator'
import { getSchedulingRule } from './scheduling/rules'
import type { Problem, SchedulingSettings } from './scheduling/types'

const fcfs = { algorithm: 'fcfs-course' } as const
const rr = { algorithm: 'round-robin', quantum: 2 } as const

function expectProcessTable(problem: Problem) {
  const table = within(screen.getByRole('table', { name: 'Processes' }))
  expect(table.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
    'Process',
    'Arrival',
    'CPU 1',
    'I/O',
    'CPU 2',
  ])

  const rows = table.getAllByRole('row').slice(1)
  expect(rows).toHaveLength(problem.processes.length)
  rows.forEach((row, index) => {
    const process = problem.processes[index]
    expect(Array.from(row.children).map((cell) => cell.textContent)).toEqual([
      process.id,
      String(process.arrival),
      String(process.cpu1),
      String(process.io),
      String(process.cpu2),
    ])
  })
}

function expectActiveRule(settings: SchedulingSettings) {
  expect(
    screen.getByRole('heading', { name: getSchedulingRule(settings).label }),
  ).toBeVisible()
}

function selectRoundRobin(quantum = '2') {
  fireEvent.change(screen.getByRole('combobox', { name: 'Algorithm' }), {
    target: { value: 'round-robin' },
  })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Time quantum' }), {
    target: { value: quantum },
  })
}

function getCell(resource: 'CPU' | 'I/O', time: number, answer = 'unanswered') {
  return screen.getByRole('button', {
    name: `${resource}, time ${time} to ${time + 1}: ${answer}`,
  })
}

function createPartlyUndoneAttempt() {
  fireEvent.click(getCell('CPU', 0))
  fireEvent.click(getCell('I/O', 1))
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(getCell('CPU', 0, 'P1')).toBeVisible()
  expect(getCell('I/O', 1)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled()
}

function expectEmptyHistory() {
  expect(
    screen.getAllByLabelText(/^(CPU|I\/O), time \d+ to \d+: unanswered$/),
  ).toHaveLength(80)
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
}

beforeEach(() => {
  vi.spyOn(generator, 'createProblemSeed').mockReturnValue(42)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('practice workspace', () => {
  test('opens a generated course FCFS problem with its inputs', () => {
    render(<App />)

    const workspace = within(screen.getByRole('main'))
    expect(
      workspace.getByRole('heading', { level: 1, name: 'Scheduling Algo' }),
    ).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Algorithm' })).toHaveValue(
      'fcfs-course',
    )
    expect(screen.queryByRole('spinbutton', { name: 'Time quantum' })).not.toBeInTheDocument()
    expectActiveRule(fcfs)
    expectProcessTable(generator.generateProblem(42, fcfs))
  })

  test('makes all five scheduling algorithms available', () => {
    render(<App />)

    const options = within(
      screen.getByRole('combobox', { name: 'Algorithm' }),
    ).getAllByRole('option')
    expect(options).toHaveLength(5)
    for (const option of options) {
      const value = (option as HTMLOptionElement).value
      expect(['fcfs-course', 'round-robin', 'sjf', 'srtf', 'priority']).toContain(value)
      expect(option).toBeEnabled()
    }
  })

  test('starts with 40 unanswered intervals per resource and does not expose a solution', () => {
    render(<App />)

    const worksheet = within(
      screen.getByRole('table', { name: 'CPU and I/O worksheet' }),
    )
    const unanswered = worksheet.getAllByLabelText(
      /^(CPU|I\/O), time \d+ to \d+: unanswered$/,
    )
    expect(unanswered).toHaveLength(80)
    for (let time = 0; time <= 40; time++) {
      expect(worksheet.getByText(String(time), { exact: true })).toBeVisible()
    }
    for (const resource of ['CPU', 'I/O']) {
      for (let time = 0; time < 40; time++) {
        const cell = worksheet.getByLabelText(
          `${resource}, time ${time} to ${time + 1}: unanswered`,
        )
        expect(cell).not.toHaveTextContent(/P\d+|Idle/i)
      }
    }
    expect(screen.queryByText(/completion time/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reveal solution' })).toBeEnabled()
    expect(screen.queryByRole('table', { name: 'Reference solution' })).not.toBeInTheDocument()
  })

  test('keeps the current worksheet and active rules while settings are only a draft', () => {
    render(<App />)
    const original = generator.generateProblem(42, fcfs)

    selectRoundRobin('3')

    expect(screen.getByRole('spinbutton', { name: 'Time quantum' })).toHaveValue(3)
    expectActiveRule(fcfs)
    expect(
      screen.queryByRole('heading', {
        name: getSchedulingRule({ algorithm: 'round-robin', quantum: 3 }).label,
      }),
    ).not.toBeInTheDocument()
    expectProcessTable(original)
  })

  test('applies round robin to the existing workload when it still fits', () => {
    render(<App />)
    const original = generator.generateProblem(42, fcfs)
    vi.mocked(generator.createProblemSeed).mockReturnValue(99)

    selectRoundRobin()
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }))

    expectActiveRule(rr)
    expectProcessTable(original)
    expect(
      screen.getAllByLabelText(/^(CPU|I\/O), time \d+ to \d+: unanswered$/),
    ).toHaveLength(80)
  })

  test('replaces and announces a worksheet that overflows after a settings change', () => {
    vi.mocked(generator.createProblemSeed).mockReturnValueOnce(607).mockReturnValue(99)
    render(<App />)
    expectProcessTable(generator.generateProblem(607, fcfs))
    selectRoundRobin()
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }))

    expectActiveRule(rr)
    expectProcessTable(generator.generateProblem(99, rr))
    expect(screen.getByRole('status')).toHaveTextContent(
      /previous workload would exceed 40 blocks/i,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/new problem is ready/i)
  })

  test('uses the selected settings and a fresh seed when requesting a new problem', () => {
    render(<App />)
    vi.mocked(generator.createProblemSeed).mockReturnValue(99)

    selectRoundRobin('3')
    fireEvent.click(screen.getByRole('button', { name: 'New problem' }))

    const settings = { algorithm: 'round-robin', quantum: 3 } as const
    expectActiveRule(settings)
    expectProcessTable(generator.generateProblem(99, settings))
    expect(
      screen.getAllByLabelText(/^(CPU|I\/O), time \d+ to \d+: unanswered$/),
    ).toHaveLength(80)
  })

  test('applies a changed quantum while keeping a fitting round-robin workload', () => {
    render(<App />)
    selectRoundRobin()
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }))

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Time quantum' }), {
      target: { value: '4' },
    })
    expectActiveRule(rr)
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }))

    expectActiveRule({ algorithm: 'round-robin', quantum: 4 })
    expectProcessTable(generator.generateProblem(42, fcfs))
  })

  test('returns to FCFS without requiring or applying a hidden quantum', () => {
    render(<App />)
    selectRoundRobin()
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }))
    expectActiveRule(rr)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Time quantum' }), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Algorithm' }), {
      target: { value: 'fcfs-course' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }))

    expectActiveRule(fcfs)
    expect(screen.queryByRole('spinbutton', { name: 'Time quantum' })).not.toBeInTheDocument()
    expectProcessTable(generator.generateProblem(42, fcfs))
  })

  test.each(['', '0', '-1', '1.5', '9007199254740992'])(
    'does not change the active problem for invalid quantum %j',
    (quantum) => {
      render(<App />)
      const original = generator.generateProblem(42, fcfs)
      vi.mocked(generator.createProblemSeed).mockReturnValue(99)

      selectRoundRobin(quantum)
      fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }))

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Enter a whole number of at least 1.',
      )
      expectActiveRule(fcfs)
      expectProcessTable(original)
      fireEvent.click(screen.getByRole('button', { name: 'New problem' }))
      expectActiveRule(fcfs)
      expectProcessTable(original)
    },
  )
})

describe('attempt lifecycle', () => {
  test('preserves answers and both history directions through drafts and fitting settings changes', () => {
    render(<App />)
    createPartlyUndoneAttempt()

    selectRoundRobin()

    expectActiveRule(fcfs)
    expect(getCell('CPU', 0, 'P1')).toBeVisible()
    expect(getCell('I/O', 1)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }))

    expectActiveRule(rr)
    expectProcessTable(generator.generateProblem(42, fcfs))
    expect(getCell('CPU', 0, 'P1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(getCell('I/O', 1, 'P1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(getCell('CPU', 0)).toBeVisible()
    expect(getCell('I/O', 1)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('keeps the current attempt and redo history when applying unchanged settings', () => {
    render(<App />)
    createPartlyUndoneAttempt()

    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }))

    expectActiveRule(fcfs)
    expectProcessTable(generator.generateProblem(42, fcfs))
    expect(getCell('CPU', 0, 'P1')).toBeVisible()
    expect(getCell('I/O', 1)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(getCell('I/O', 1, 'P1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(getCell('CPU', 0)).toBeVisible()
  })

  test('keeps answers and history when invalid settings prevent applying or generating', () => {
    render(<App />)
    createPartlyUndoneAttempt()
    vi.mocked(generator.createProblemSeed).mockReturnValue(99)

    selectRoundRobin('0')
    for (const action of ['Apply settings', 'New problem']) {
      fireEvent.click(screen.getByRole('button', { name: action }))

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Enter a whole number of at least 1.',
      )
      expectActiveRule(fcfs)
      expectProcessTable(generator.generateProblem(42, fcfs))
      expect(getCell('CPU', 0, 'P1')).toBeVisible()
      expect(getCell('I/O', 1)).toBeVisible()
      expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled()
    }

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(getCell('I/O', 1, 'P1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(getCell('I/O', 1)).toBeVisible()
  })

  test('retains answers and history if preparing a new problem fails', () => {
    render(<App />)
    createPartlyUndoneAttempt()
    selectRoundRobin()
    vi.spyOn(generator, 'generateProblem').mockImplementationOnce(() => {
      throw new Error('Problem generation failed')
    })

    fireEvent.click(screen.getByRole('button', { name: 'New problem' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This problem could not be prepared. Please try again.',
    )
    expectActiveRule(fcfs)
    expectProcessTable(generator.generateProblem(42, fcfs))
    expect(getCell('CPU', 0, 'P1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(getCell('I/O', 1, 'P1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(getCell('CPU', 0)).toBeVisible()
  })

  test('starts a new workload with blank answers and no history from the previous problem', () => {
    render(<App />)
    createPartlyUndoneAttempt()
    vi.mocked(generator.createProblemSeed).mockReturnValue(99)
    selectRoundRobin('3')

    fireEvent.click(screen.getByRole('button', { name: 'New problem' }))

    const settings = { algorithm: 'round-robin', quantum: 3 } as const
    expectActiveRule(settings)
    expectProcessTable(generator.generateProblem(99, settings))
    expectEmptyHistory()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    fireEvent.click(getCell('CPU', 4))
    expect(getCell('CPU', 4, 'P1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(
      screen.getAllByLabelText(/^(CPU|I\/O), time \d+ to \d+: unanswered$/),
    ).toHaveLength(80)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('lets the learner cancel an overflowing settings change without losing answers or history', () => {
    vi.mocked(generator.createProblemSeed).mockReturnValueOnce(607).mockReturnValue(99)
    render(<App />)
    createPartlyUndoneAttempt()
    selectRoundRobin()

    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }))

    const dialog = within(screen.getByRole('alertdialog', { name: 'Start a new problem?' }))
    expect(dialog.getByRole('heading', { name: 'Start a new problem?' })).toBeVisible()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/40 blocks/i)
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/attempt/i)
    expectActiveRule(fcfs)
    expect(getCell('CPU', 0, 'P1')).toBeVisible()

    fireEvent.click(dialog.getByRole('button', { name: 'Keep current problem' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expectActiveRule(fcfs)
    expectProcessTable(generator.generateProblem(607, fcfs))
    expect(screen.getByRole('combobox', { name: 'Algorithm' })).toHaveValue('round-robin')
    expect(screen.getByRole('spinbutton', { name: 'Time quantum' })).toHaveValue(2)
    expect(getCell('CPU', 0, 'P1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(getCell('I/O', 1, 'P1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(getCell('CPU', 0)).toBeVisible()
  })

  test('clears the attempt and both history directions after confirming an overflow replacement', () => {
    vi.mocked(generator.createProblemSeed).mockReturnValueOnce(607).mockReturnValue(99)
    render(<App />)
    createPartlyUndoneAttempt()
    selectRoundRobin()
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }))

    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Start new problem',
    }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expectActiveRule(rr)
    expectProcessTable(generator.generateProblem(99, rr))
    expectEmptyHistory()
    fireEvent.click(getCell('I/O', 4))
    expect(getCell('I/O', 4, 'P1')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(
      screen.getAllByLabelText(/^(CPU|I\/O), time \d+ to \d+: unanswered$/),
    ).toHaveLength(80)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test.each([
    { emptyWith: 'Undo', restoreWith: 'Redo' },
    { emptyWith: 'Clear attempt', restoreWith: 'Undo' },
  ])('protects recoverable answers after $emptyWith leaves an empty worksheet', ({
    emptyWith,
    restoreWith,
  }) => {
    vi.mocked(generator.createProblemSeed).mockReturnValueOnce(607).mockReturnValue(99)
    render(<App />)
    fireEvent.click(getCell('CPU', 0))
    fireEvent.click(screen.getByRole('button', { name: emptyWith }))
    expect(
      screen.getAllByLabelText(/^(CPU|I\/O), time \d+ to \d+: unanswered$/),
    ).toHaveLength(80)
    selectRoundRobin()

    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }))

    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Keep current problem',
    }))
    expectActiveRule(fcfs)
    expectProcessTable(generator.generateProblem(607, fcfs))
    fireEvent.click(screen.getByRole('button', { name: restoreWith }))
    expect(getCell('CPU', 0, 'P1')).toBeVisible()
  })
})
