import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../App'
import * as generator from '../scheduling/generator'
import * as hints from '../scheduling/hints'

function activate(name: string) {
  const button = screen.getByRole('button', { name })
  button.focus()
  fireEvent.click(button)
}

beforeEach(() => {
  vi.spyOn(generator, 'createProblemSeed').mockReturnValue(42)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('keyboard focus through the practice flow', () => {
  test('keeps each requested hint reachable, including when its reveal button disappears', () => {
    render(<App />)
    for (const [index, action] of ['Hint', 'More detail', 'Show this assignment'].entries()) {
      activate(action)
      expect(screen.getByRole('heading', {
        name: `Hint ${index + 1} of 3 · time 0–1`,
      })).toHaveFocus()
    }
    expect(screen.getByText('Assisted attempt')).toBeVisible()
    expect(screen.getByRole('button', { name: 'CPU, time 0 to 1: unanswered' })).toBeVisible()
  })

  test('jumps from a hint to either resource without editing or discarding the hint', () => {
    render(<App />)
    activate('Hint')
    for (const resource of ['CPU', 'I/O']) {
      activate(`Focus ${resource} at time 0`)
      expect(screen.getByRole('button', {
        name: `${resource}, time 0 to 1: unanswered`,
      })).toHaveFocus()
      expect(screen.getByRole('heading', { name: 'Hint 1 of 3 · time 0–1' })).toBeVisible()
    }
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('focuses a hint error if preparing the next stage removes the progression button', () => {
    render(<App />)
    activate('Hint')
    vi.spyOn(hints, 'getHint').mockImplementationOnce(() => { throw new Error('Unavailable') })
    activate('More detail')
    expect(screen.getByRole('alert')).toHaveFocus()
    activate('Hint')
    expect(screen.getByRole('heading', { name: 'Hint 1 of 3 · time 0–1' })).toHaveFocus()
  })

  test('canceling a drag restores the hint without taking focus away from the worksheet', () => {
    render(<App />)
    activate('Hint')
    const cell = screen.getByRole('button', { name: 'CPU, time 0 to 1: unanswered' })
    fireEvent(cell, new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(cell).toHaveFocus()
    expect(screen.queryByRole('heading', { name: 'Hint 1 of 3 · time 0–1' })).not.toBeInTheDocument()
    fireEvent.keyDown(cell, { key: 'Escape' })
    expect(screen.getByRole('heading', { name: 'Hint 1 of 3 · time 0–1' })).toBeVisible()
    expect(cell).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('undo from a hint keeps focus in the worksheet after clearing that hint', () => {
    render(<App />)
    activate('CPU, time 0 to 1: unanswered')
    activate('Hint')
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Hint 1 of 3 · time 0–1' }), {
      key: 'z', ctrlKey: true,
    })
    expect(screen.queryByRole('heading', { name: /^Hint 1/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CPU, time 0 to 1: unanswered' })).toHaveFocus()
  })

  test('opens playback at its heading and returns focus to Reveal when hidden', () => {
    render(<App />)
    activate('Reveal solution')
    expect(screen.getByRole('heading', { name: '04 Solution playback' })).toHaveFocus()
    activate('Hide solution')
    expect(screen.getByRole('button', { name: 'Reveal solution' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reveal solution' })).toHaveFocus()
  })

  test('keeps settings focus when a settings change removes playback', () => {
    render(<App />)
    activate('Reveal solution')
    fireEvent.change(screen.getByRole('combobox', { name: 'Algorithm' }), {
      target: { value: 'sjf' },
    })
    activate('Apply settings')
    expect(screen.queryByRole('heading', { name: '04 Solution playback' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply settings' })).toHaveFocus()
  })

  test('keeps navigation available when an endpoint button disables itself', () => {
    render(<App />)
    activate('Reveal solution')
    for (const [action, time] of [['Go to end', '40'], ['Back to start', '0']] as const) {
      activate(action)
      expect(screen.getByRole('button', { name: action })).toBeDisabled()
      expect(screen.getByRole('slider', { name: 'Playback time' })).toHaveFocus()
      expect(screen.getByRole('slider', { name: 'Playback time' })).toHaveValue(time)
    }
  })

  test('moves from the focused Play control to the slider when playback finishes', () => {
    vi.useFakeTimers()
    render(<App />)
    activate('Reveal solution')
    fireEvent.change(screen.getByRole('slider', { name: 'Playback time' }), {
      target: { value: '39' },
    })
    activate('Play')
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    expect(screen.getByRole('slider', { name: 'Playback time' })).toHaveFocus()
    expect(screen.getByRole('slider', { name: 'Playback time' })).toHaveValue('40')
  })

  test.each(['another control', 'the page background'])(
    'does not steal focus from %s when playback finishes',
    (destination) => {
      vi.useFakeTimers()
      render(<App />)
      activate('Reveal solution')
      fireEvent.change(screen.getByRole('slider', { name: 'Playback time' }), {
        target: { value: '39' },
      })
      activate('Play')
      if (destination === 'another control') screen.getByRole('button', { name: 'Hint' }).focus()
      else (document.activeElement as HTMLElement).blur()
      const focus = document.activeElement
      act(() => { vi.advanceTimersByTime(1_000) })
      expect(screen.getByRole('slider', { name: 'Playback time' })).toHaveValue('40')
      expect(document.activeElement).toBe(focus)
    },
  )

  test.each(['Keep current problem', 'Start new problem'])(
    'returns from the overflow dialog after choosing %s',
    (action) => {
      vi.mocked(generator.createProblemSeed).mockReturnValueOnce(607).mockReturnValue(99)
      render(<App />)
      activate('CPU, time 0 to 1: unanswered')
      fireEvent.change(screen.getByRole('combobox', { name: 'Algorithm' }), {
        target: { value: 'round-robin' },
      })
      activate('Apply settings')
      expect(screen.getByRole('alertdialog')).toBeVisible()
      activate(action)
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Apply settings' })).toHaveFocus()
    },
  )
})
