import { StrictMode, useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { generateProblem } from '../scheduling/generator'
import { explainInterval } from '../scheduling/grader'
import { simulate } from '../scheduling/simulator'
import type { Problem, SchedulingSettings } from '../scheduling/types'
import { SolutionPlayback } from './SolutionPlayback'

const problem: Problem = {
  seed: 42,
  rulesVersion: 1,
  generatorVersion: 1,
  settings: { algorithm: 'fcfs-course' },
  processes: [
    { id: 'P1', arrival: 0, cpu1: 2, io: 3, cpu2: 1 },
    { id: 'P2', arrival: 0, cpu1: 1, io: 2, cpu2: 1 },
    { id: 'P3', arrival: 8, cpu1: 1, io: 1, cpu2: 1 },
  ],
}

function setup(input = problem) {
  const solution = simulate(input)
  const onClose = vi.fn()
  const rendered = render(
    <SolutionPlayback problem={input} solution={solution} onClose={onClose} />,
  )
  return { ...rendered, solution, onClose }
}

function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}

function seek(time: number) {
  fireEvent.change(screen.getByRole('slider', { name: 'Playback time' }), {
    target: { value: time },
  })
}

function expectTime(time: number) {
  expect(screen.getByRole('slider', { name: 'Playback time' })).toHaveValue(String(time))
}

function stateRow(id: string) {
  const table = screen.getByRole('table', { name: 'Playback process states' })
  return within(table).getByRole('rowheader', { name: id }).closest('tr')!
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('solution playback', () => {
  test('opens paused at boundary zero with a separate complete, read-only reference', () => {
    vi.useFakeTimers()
    const { solution } = setup()

    expect(screen.getByRole('heading', { name: '04 Solution playback' })).toBeVisible()
    expect(screen.getByText(/All processes finish at time/)).toHaveTextContent(
      `All processes finish at time ${solution.completionTime}.`,
    )
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Previous step' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back to start' })).toBeDisabled()
    expect(vi.getTimerCount()).toBe(0)
    expectTime(0)

    const reference = screen.getByRole('table', { name: 'Reference solution' })
    expect(within(reference).queryAllByRole('button')).toHaveLength(0)
    expect(within(reference).getAllByRole('cell')).toHaveLength(80)
    for (const [resource, label] of [['cpu', 'CPU'], ['io', 'I/O']] as const) {
      for (let time = 0; time < 40; time++) {
        const expected = solution.timeline[resource][time]
        const cell = within(reference).getByRole('cell', {
          name: `${label}, time ${time} to ${time + 1}: ${expected === 'idle' ? 'Idle' : expected}`,
        })
        expect(cell).toHaveTextContent(expected === 'idle' ? 'Idle' : expected)
        expect(cell).toHaveAttribute('data-value', expected)
      }
    }
    expect(reference.querySelectorAll('td[data-current="true"]')).toHaveLength(2)
    expect(reference.querySelector('[aria-current="step"]')).toHaveTextContent('0')
    act(() => { vi.advanceTimersByTime(5_000) })
    expectTime(0)
  })

  test('steps, scrubs, and jumps across the complete 0–40 boundary range', () => {
    setup()
    click('Next step')
    expectTime(1)
    expect(screen.getByRole('heading', { name: 'Time 1–2' })).toBeVisible()
    click('Previous step')
    expectTime(0)
    seek(17)
    expectTime(17)
    expect(screen.getByRole('slider')).toHaveAttribute(
      'aria-valuetext', 'Time 17, interval 17 to 18',
    )
    click('Go to end')
    expectTime(40)
    expect(screen.getByRole('button', { name: 'Next step' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Go to end' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    click('Back to start')
    expectTime(0)
  })

  test('shows remaining current and future work for running, ready, and not-arrived processes', () => {
    setup()
    expect(stateRow('P1')).toHaveTextContent('Running CPU burst 1')
    expect(stateRow('P1')).toHaveTextContent('CPU 1: 2 · I/O: 3 · CPU 2: 1')
    expect(stateRow('P2')).toHaveTextContent('Ready for CPU burst 1')
    expect(stateRow('P2')).toHaveTextContent('Ready since time 0')
    expect(stateRow('P3')).toHaveTextContent('Not arrived')
    expect(stateRow('P3')).toHaveTextContent('Arrives at time 8')
    expect(stateRow('P3')).toHaveTextContent('CPU 1: 1 · I/O: 1 · CPU 2: 1')
    expect(within(screen.getByRole('list', { name: 'Ready queue order' })).getAllByRole('listitem'))
      .toHaveLength(1)
    expect(screen.getByRole('list', { name: 'Ready queue order' })).toHaveTextContent('P2')
  })

  test('shows active I/O, queued requests, and completed processes at their real boundaries', () => {
    setup()
    seek(3)
    expect(stateRow('P1')).toHaveTextContent('Performing I/O')
    expect(stateRow('P1')).toHaveTextContent('Started at time 2')
    expect(stateRow('P1')).toHaveTextContent('I/O: 2 · CPU 2: 1')
    expect(stateRow('P2')).toHaveTextContent('Waiting for I/O')
    expect(stateRow('P2')).toHaveTextContent('Requested at time 3')
    expect(screen.getByRole('list', { name: 'I/O queue order' }))
      .toHaveTextContent('P2Requested at 3')
    expect(screen.getByRole('article', { name: 'CPU decision' })).toHaveTextContent('Idle')

    seek(5)
    expect(stateRow('P1')).toHaveTextContent('Running CPU burst 2')
    expect(stateRow('P1')).toHaveTextContent('CPU 2: 1')
    expect(stateRow('P1')).not.toHaveTextContent('I/O:')
    seek(6)
    expect(stateRow('P1')).toHaveTextContent('Completed at time 6')
    expect(stateRow('P1')).toHaveTextContent('None')
  })

  test('keeps ready queue entry order even when the CPU policy selects by burst length', () => {
    setup({
      ...problem,
      settings: { algorithm: 'sjf' },
      processes: [
        { id: 'P1', arrival: 0, cpu1: 5, io: 1, cpu2: 1 },
        { id: 'P2', arrival: 0, cpu1: 1, io: 1, cpu2: 1 },
        { id: 'P3', arrival: 0, cpu1: 2, io: 1, cpu2: 1 },
      ],
    })
    const queued = within(screen.getByRole('list', { name: 'Ready queue order' }))
      .getAllByRole('listitem')
    expect(queued[0]).toHaveTextContent('P1')
    expect(queued[1]).toHaveTextContent('P3')
    expect(screen.getByRole('heading', { name: 'Ready queue after dispatch' })).toBeVisible()
    expect(screen.getByText(/the ready queue is not sorted by burst length or priority/))
      .toBeVisible()
    expect(screen.getByRole('article', { name: 'CPU decision' })).toHaveTextContent('SJF selects P2')
  })

  const policies: SchedulingSettings[] = [
    { algorithm: 'fcfs-course' },
    { algorithm: 'round-robin', quantum: 2 },
    { algorithm: 'sjf' },
    { algorithm: 'srtf' },
    { algorithm: 'priority', mode: 'preemptive' },
    { algorithm: 'priority', mode: 'non-preemptive' },
  ]

  test.each(policies)('uses shared decision explanations for $algorithm $mode', (settings) => {
    const input = generateProblem(42, settings)
    const { solution } = setup(input)
    for (const time of [0, 3, 7]) {
      seek(time)
      const explanation = explainInterval(input, solution, time)
      expect(screen.getByRole('article', { name: 'CPU decision' }))
        .toHaveTextContent(explanation.cpu)
      expect(screen.getByRole('article', { name: 'I/O decision' }))
        .toHaveTextContent(explanation.io)
    }
    if (settings.algorithm === 'priority') {
      expect(within(screen.getByRole('table', { name: 'Playback process states' }))
        .getByRole('columnheader', { name: 'Priority' })).toBeVisible()
      for (const process of input.processes) {
        expect(within(stateRow(process.id)).getByRole('cell', { name: String(process.priority) }))
          .toBeVisible()
      }
    }
  })

  test('shows remaining round-robin quantum before the chosen interval executes', () => {
    setup({ ...problem, settings: { algorithm: 'round-robin', quantum: 2 } })
    expect(stateRow('P1')).toHaveTextContent('Quantum remaining: 2')
    seek(1)
    expect(stateRow('P1')).toHaveTextContent('Quantum remaining: 1')
  })

  test('shows terminal bookkeeping and completion at exactly 40 without inventing another interval', () => {
    setup({
      ...problem,
      processes: [{ id: 'P1', arrival: 0, cpu1: 18, io: 4, cpu2: 18 }],
    })
    seek(40)
    expect(screen.getByRole('heading', { name: 'Time 40 — terminal boundary' })).toBeVisible()
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Time 40, terminal boundary')
    expect(screen.getByText(/no new interval starts and neither resource is dispatched/)).toBeVisible()
    expect(screen.getByText('P1 completed CPU burst 2.')).toBeVisible()
    expect(screen.getByText('P1 completed all its work.')).toBeVisible()
    expect(stateRow('P1')).toHaveTextContent('Completed at time 40')
    expect(stateRow('P1')).toHaveTextContent('None')
    expect(screen.getByRole('heading', { name: 'Ready queue at boundary 40' })).toBeVisible()
    expect(screen.queryByRole('article', { name: 'CPU decision' })).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'I/O decision' })).not.toBeInTheDocument()
    expect(screen.queryByText(/40–41|40 to 41/)).not.toBeInTheDocument()
    const reference = screen.getByRole('table', { name: 'Reference solution' })
    expect(reference.querySelectorAll('td[data-current="true"]')).toHaveLength(0)
    expect(reference.querySelector('[aria-current="step"]')).toHaveTextContent('40')
  })

  test('shows the terminal empty-event state when all work finished earlier', () => {
    setup()
    seek(40)
    expect(screen.getByText('No additional events at this boundary.')).toBeVisible()
    for (const { id } of problem.processes) {
      expect(stateRow(id)).toHaveTextContent('Completed at time')
      expect(stateRow(id)).toHaveTextContent('None')
    }
  })
})

describe('playback timers', () => {
  test('plays one interval each second, pauses, and resumes from the same boundary', () => {
    vi.useFakeTimers()
    setup()
    click('Play')
    expect(vi.getTimerCount()).toBe(1)
    act(() => { vi.advanceTimersByTime(999) })
    expectTime(0)
    act(() => { vi.advanceTimersByTime(1) })
    expectTime(1)
    click('Pause')
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(5_000) })
    expectTime(1)
    click('Play')
    act(() => { vi.advanceTimersByTime(1_000) })
    expectTime(2)
  })

  test('automatically stops at 40 and never advances beyond the worksheet', () => {
    vi.useFakeTimers()
    setup()
    seek(39)
    click('Play')
    act(() => { vi.advanceTimersByTime(1_000) })
    expectTime(40)
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(10_000) })
    expectTime(40)
  })

  test.each([
    ['Previous step', 2],
    ['Next step', 4],
    ['Back to start', 0],
    ['Go to end', 40],
    ['slider', 12],
  ])('pauses when navigating with %s', (control, expected) => {
    vi.useFakeTimers()
    setup()
    seek(3)
    click('Play')
    if (control === 'slider') seek(Number(expected))
    else click(String(control))
    expectTime(Number(expected))
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(2_000) })
    expectTime(Number(expected))
  })

  test('pauses on window blur and stays paused after focus returns', () => {
    vi.useFakeTimers()
    setup()
    click('Play')
    fireEvent.blur(window)
    fireEvent.focus(window)
    expect(vi.getTimerCount()).toBe(0)
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
    act(() => { vi.advanceTimersByTime(2_000) })
    expectTime(0)
  })

  test('pauses when the page becomes hidden and does not restart on return', () => {
    vi.useFakeTimers()
    setup()
    const hidden = vi.spyOn(document, 'hidden', 'get')
    click('Play')
    hidden.mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
    expect(vi.getTimerCount()).toBe(0)
    hidden.mockReturnValue(false)
    fireEvent(document, new Event('visibilitychange'))
    act(() => { vi.advanceTimersByTime(2_000) })
    expectTime(0)
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
  })

  test('hiding the solution calls the parent and clears playback immediately', () => {
    vi.useFakeTimers()
    const { onClose } = setup()
    click('Play')
    click('Hide solution')
    expect(onClose).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  test('cleans up on unmount and starts paused when reopened', () => {
    vi.useFakeTimers()
    const solution = simulate(problem)
    function Harness() {
      const [visible, setVisible] = useState(true)
      return visible
        ? <SolutionPlayback problem={problem} solution={solution} onClose={() => setVisible(false)} />
        : <button type="button" onClick={() => setVisible(true)}>Reopen</button>
    }
    const { unmount } = render(<StrictMode><Harness /></StrictMode>)
    click('Play')
    expect(vi.getTimerCount()).toBe(1)
    act(() => { vi.advanceTimersByTime(2_000) })
    expectTime(2)
    click('Hide solution')
    expect(vi.getTimerCount()).toBe(0)
    click('Reopen')
    expectTime(0)
    expect(vi.getTimerCount()).toBe(0)
    click('Play')
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
