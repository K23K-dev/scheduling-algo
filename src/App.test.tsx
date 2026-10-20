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

function expectSeed(seed: number) {
  expect(screen.getByText('Seed')).toHaveTextContent(`Seed ${seed}`)
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

describe('practice workspace', () => {
  test('opens a generated course FCFS problem with its inputs and project link', () => {
    render(<App />)

    const workspace = within(screen.getByRole('main'))
    expect(
      workspace.getByRole('heading', { level: 1, name: 'Scheduling Algo' }),
    ).toBeVisible()
    expect(workspace.getByRole('link', { name: 'View the project' })).toHaveAttribute(
      'href',
      'https://github.com/K23K-dev/scheduling-algo',
    )
    expect(screen.getByRole('combobox', { name: 'Algorithm' })).toHaveValue(
      'fcfs-course',
    )
    expect(screen.queryByRole('spinbutton', { name: 'Time quantum' })).not.toBeInTheDocument()
    expectActiveRule(fcfs)
    expectProcessTable(generator.generateProblem(42, fcfs))
    expectSeed(42)
  })

  test('shows all five planned algorithms and disables those not yet available', () => {
    render(<App />)

    const options = within(
      screen.getByRole('combobox', { name: 'Algorithm' }),
    ).getAllByRole('option')
    expect(options).toHaveLength(5)
    for (const option of options) {
      const value = (option as HTMLOptionElement).value
      if (value === 'fcfs-course' || value === 'round-robin') {
        expect(option).toBeEnabled()
      } else {
        expect(['sjf', 'srtf', 'priority']).toContain(value)
        expect(option).toBeDisabled()
      }
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
    expect(screen.queryByRole('button', { name: /reveal|show solution/i })).not.toBeInTheDocument()
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
    expectSeed(42)
  })

  test('applies round robin to the existing workload when it still fits', () => {
    render(<App />)
    const original = generator.generateProblem(42, fcfs)
    vi.mocked(generator.createProblemSeed).mockReturnValue(99)

    selectRoundRobin()
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }))

    expectActiveRule(rr)
    expectProcessTable(original)
    expectSeed(42)
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
    expectSeed(99)
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
    expectSeed(99)
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
    expectSeed(42)
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
      expectSeed(42)
      fireEvent.click(screen.getByRole('button', { name: 'New problem' }))
      expectActiveRule(fcfs)
      expectProcessTable(original)
    },
  )
})
