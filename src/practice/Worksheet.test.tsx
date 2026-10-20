import { useReducer } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AttemptCell, ProcessInput, Resource } from '../scheduling/types'
import { attemptReducer, createAttemptHistory } from './attempt'
import { Worksheet } from './Worksheet'

const processes: readonly ProcessInput[] = [
  { id: 'P1', arrival: 0, cpu1: 3, io: 2, cpu2: 2 },
  { id: 'P2', arrival: 1, cpu1: 2, io: 3, cpu2: 1 },
  { id: 'P3', arrival: 2, cpu1: 1, io: 1, cpu2: 3 },
]

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string
  readonly isPrimary: boolean

  constructor(type: string, options: PointerEventInit = {}) {
    super(type, options)
    this.pointerId = options.pointerId ?? 1
    this.pointerType = options.pointerType ?? 'mouse'
    this.isPrimary = options.isPrimary ?? true
  }
}

let pointerTarget: Element | null = null
const elementFromPointDescriptor = Object.getOwnPropertyDescriptor(
  document,
  'elementFromPoint',
)

function Harness() {
  const [history, dispatch] = useReducer(attemptReducer, undefined, createAttemptHistory)

  return (
    <>
      <Worksheet processes={processes} history={history} onEdit={dispatch} />
      <output aria-label="Saved attempt">{JSON.stringify(history.present)}</output>
      <button type="button">Outside worksheet</button>
    </>
  )
}

function cell(resource: Resource, time: number, value: AttemptCell = null) {
  const resourceLabel = resource === 'cpu' ? 'CPU' : 'I/O'
  const valueLabel = value === null ? 'unanswered' : value === 'idle' ? 'Idle' : value
  return screen.getByRole('button', {
    name: `${resourceLabel}, time ${time} to ${time + 1}: ${valueLabel}`,
  })
}

function choose(value: string) {
  fireEvent.click(screen.getByRole('button', { name: value }))
}

function worksheetRegion() {
  return screen.getByRole('region', { name: 'Scrollable CPU and I/O worksheet' })
}

function beginDrag(resource: Resource, time: number, pointerType = 'mouse') {
  const start = cell(resource, time)
  fireEvent.pointerDown(start, { pointerId: 1, pointerType, button: 0, buttons: 1 })
}

function moveDrag(target: Element | null, pointerType = 'mouse') {
  pointerTarget = target
  fireEvent.pointerMove(worksheetRegion(), {
    pointerId: 1,
    pointerType,
    buttons: 1,
    clientX: 100,
    clientY: 100,
  })
}

function endDrag(pointerType = 'mouse') {
  fireEvent.pointerUp(worksheetRegion(), {
    pointerId: 1,
    pointerType,
    button: 0,
    buttons: 0,
  })
}

beforeEach(() => {
  pointerTarget = null
  vi.stubGlobal('PointerEvent', TestPointerEvent)
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => pointerTarget),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (elementFromPointDescriptor) {
    Object.defineProperty(document, 'elementFromPoint', elementFromPointDescriptor)
  } else {
    Reflect.deleteProperty(document, 'elementFromPoint')
  }
})

describe('editable worksheet', () => {
  test('starts unanswered with P1 selected and no available history', () => {
    render(<Harness />)

    expect(
      within(worksheetRegion()).getAllByRole('button', { name: /: unanswered$/ }),
    ).toHaveLength(80)
    expect(screen.getByRole('button', { name: 'P1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    for (const value of ['P2', 'P3', 'Idle', 'Erase']) {
      expect(screen.getByRole('button', { name: value })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    }
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })

  test('assigns the selected process to either resource without checking correctness', () => {
    render(<Harness />)

    fireEvent.click(cell('cpu', 0))
    choose('P3')
    fireEvent.click(cell('io', 0))
    fireEvent.click(cell('cpu', 39))

    expect(cell('cpu', 0, 'P1')).toBeVisible()
    expect(cell('io', 0, 'P3')).toBeVisible()
    expect(cell('cpu', 39, 'P3')).toBeVisible()
    expect(screen.getByRole('button', { name: 'P3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByText(/incorrect|correct answer|check answer/i)).not.toBeInTheDocument()
  })

  test('keeps Idle distinct from erasing an answer', () => {
    render(<Harness />)

    choose('Idle')
    fireEvent.click(cell('io', 5))
    expect(cell('io', 5, 'idle')).toBeVisible()

    choose('Erase')
    fireEvent.click(cell('io', 5, 'idle'))
    expect(cell('io', 5)).toBeVisible()
    choose('Undo')
    expect(cell('io', 5, 'idle')).toBeVisible()
  })

  test('fills only unanswered cells in both rows and undoes the fill together', () => {
    render(<Harness />)

    fireEvent.click(cell('cpu', 0))
    choose('P2')
    fireEvent.click(cell('io', 3))
    choose('Fill remaining empty cells with Idle')

    expect(cell('cpu', 0, 'P1')).toBeVisible()
    expect(cell('io', 3, 'P2')).toBeVisible()
    expect(
      within(worksheetRegion()).getAllByRole('button', { name: /: Idle$/ }),
    ).toHaveLength(78)

    choose('Undo')
    expect(cell('cpu', 0, 'P1')).toBeVisible()
    expect(cell('io', 3, 'P2')).toBeVisible()
    expect(
      within(worksheetRegion()).getAllByRole('button', { name: /: unanswered$/ }),
    ).toHaveLength(78)
  })

  test('clears both resources as one undoable edit and supports redo', () => {
    render(<Harness />)

    fireEvent.click(cell('cpu', 0))
    choose('P2')
    fireEvent.click(cell('io', 4))
    choose('Clear attempt')
    expect(
      within(worksheetRegion()).getAllByRole('button', { name: /: unanswered$/ }),
    ).toHaveLength(80)

    choose('Undo')
    expect(cell('cpu', 0, 'P1')).toBeVisible()
    expect(cell('io', 4, 'P2')).toBeVisible()
    choose('Redo')
    expect(cell('cpu', 0)).toBeVisible()
    expect(cell('io', 4)).toBeVisible()
  })

  test('replaces redo history after making a new edit', () => {
    render(<Harness />)

    fireEvent.click(cell('cpu', 0))
    fireEvent.click(cell('cpu', 1))
    choose('Undo')
    choose('P2')
    fireEvent.click(cell('io', 2))

    expect(cell('cpu', 0, 'P1')).toBeVisible()
    expect(cell('cpu', 1)).toBeVisible()
    expect(cell('io', 2, 'P2')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })
})

describe('worksheet drag editing', () => {
  test.each(['mouse', 'pen'])(
    'previews a contiguous %s drag and saves the whole range as one edit',
    (pointerType) => {
      render(<Harness />)
      const end = cell('cpu', 4)
      const saved = screen.getByLabelText('Saved attempt').textContent

      beginDrag('cpu', 1, pointerType)
      moveDrag(end, pointerType)
      expect(screen.getByLabelText('Saved attempt').textContent).toBe(saved)
      for (let index = 1; index <= 4; index++) {
        expect(cell('cpu', index, 'P1')).toBeVisible()
      }
      endDrag(pointerType)
      fireEvent.click(cell('cpu', 4, 'P1'), { detail: 1 })

      for (let index = 1; index <= 4; index++) {
        expect(cell('cpu', index, 'P1')).toBeVisible()
      }
      expect(cell('cpu', 0)).toBeVisible()
      expect(cell('cpu', 5)).toBeVisible()
      expect(cell('io', 2)).toBeVisible()

      choose('Undo')
      for (let index = 1; index <= 4; index++) {
        expect(cell('cpu', index)).toBeVisible()
      }
      expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
      choose('Redo')
      expect(cell('cpu', 4, 'P1')).toBeVisible()
    },
  )

  test('shrinks the selected range when a drag reverses direction', () => {
    render(<Harness />)
    const farEnd = cell('cpu', 7)
    const nearerEnd = cell('cpu', 4)

    beginDrag('cpu', 2)
    moveDrag(farEnd)
    moveDrag(nearerEnd)
    endDrag()

    for (let index = 2; index <= 4; index++) {
      expect(cell('cpu', index, 'P1')).toBeVisible()
    }
    for (let index = 5; index <= 7; index++) {
      expect(cell('cpu', index)).toBeVisible()
    }
  })

  test('paints backward and does not extend onto the other resource row', () => {
    render(<Harness />)
    const end = cell('io', 2)
    const otherRow = cell('cpu', 0)
    choose('P2')

    beginDrag('io', 5)
    moveDrag(end)
    moveDrag(otherRow)
    endDrag()

    for (let index = 2; index <= 5; index++) {
      expect(cell('io', index, 'P2')).toBeVisible()
    }
    expect(
      within(worksheetRegion()).getAllByRole('button', { name: /^CPU,.*: unanswered$/ }),
    ).toHaveLength(40)
  })

  test.each(['pointer cancellation', 'Escape', 'lost pointer capture', 'window blur'])(
    'discards a drag preview on %s',
    (cancellation) => {
      render(<Harness />)
      const end = cell('cpu', 4)

      beginDrag('cpu', 1)
      moveDrag(end)
      if (cancellation === 'Escape') {
        fireEvent.keyDown(worksheetRegion(), { key: 'Escape' })
      } else if (cancellation === 'lost pointer capture') {
        fireEvent.lostPointerCapture(worksheetRegion(), { pointerId: 1, pointerType: 'mouse' })
      } else if (cancellation === 'window blur') {
        fireEvent.blur(window)
      } else {
        fireEvent.pointerCancel(worksheetRegion(), { pointerId: 1, pointerType: 'mouse' })
      }
      endDrag()
      fireEvent.click(cell('cpu', 1), { detail: 1 })

      expect(
        within(worksheetRegion()).getAllByRole('button', { name: /: unanswered$/ }),
      ).toHaveLength(80)
      expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    },
  )

  test.each([
    { tool: 'Idle', value: 'idle' as const },
    { tool: 'Erase', value: null },
  ])('drags $tool over an existing range and can restore its previous assignments', ({ tool, value }) => {
    render(<Harness />)
    fireEvent.click(cell('cpu', 1))
    choose('P2')
    fireEvent.click(cell('cpu', 2))
    choose(tool)
    const start = cell('cpu', 1, 'P1')
    const end = cell('cpu', 2, 'P2')

    fireEvent.pointerDown(start, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 })
    moveDrag(end)
    endDrag()

    expect(cell('cpu', 1, value)).toBeVisible()
    expect(cell('cpu', 2, value)).toBeVisible()
    choose('Undo')
    expect(cell('cpu', 1, 'P1')).toBeVisible()
    expect(cell('cpu', 2, 'P2')).toBeVisible()
  })

  test('leaves touch movement unpainted while ordinary touch clicks still assign', () => {
    render(<Harness />)
    const end = cell('cpu', 4)

    beginDrag('cpu', 1, 'touch')
    moveDrag(end, 'touch')
    endDrag('touch')
    expect(
      within(worksheetRegion()).getAllByRole('button', { name: /: unanswered$/ }),
    ).toHaveLength(80)

    fireEvent.click(cell('io', 2))
    expect(cell('io', 2, 'P1')).toBeVisible()
  })
})

describe('worksheet keyboard editing', () => {
  test('moves focus with arrows without painting and stops at row boundaries', () => {
    render(<Harness />)
    const first = cell('cpu', 0)
    first.focus()

    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(cell('cpu', 1)).toHaveFocus()
    fireEvent.keyDown(cell('cpu', 1), { key: 'ArrowDown' })
    expect(cell('io', 1)).toHaveFocus()
    fireEvent.keyDown(cell('io', 1), { key: 'ArrowUp' })
    expect(cell('cpu', 1)).toHaveFocus()

    const last = cell('cpu', 39)
    last.focus()
    fireEvent.keyDown(last, { key: 'ArrowRight' })
    expect(last).toHaveFocus()
    expect(
      within(worksheetRegion()).getAllByRole('button', { name: /: unanswered$/ }),
    ).toHaveLength(80)
    expect(
      within(worksheetRegion())
        .getAllByRole('button')
        .filter((button) => button.tabIndex === 0),
    ).toHaveLength(1)
  })

  test('erases the focused answer with Delete and restores it with keyboard undo', () => {
    render(<Harness />)
    fireEvent.click(cell('cpu', 2))
    const assigned = cell('cpu', 2, 'P1')
    assigned.focus()

    fireEvent.keyDown(assigned, { key: 'Delete' })
    expect(cell('cpu', 2)).toHaveFocus()
    fireEvent.keyDown(cell('cpu', 2), { key: 'z', ctrlKey: true })
    expect(cell('cpu', 2, 'P1')).toHaveFocus()
    fireEvent.keyDown(cell('cpu', 2, 'P1'), { key: 'y', ctrlKey: true })
    expect(cell('cpu', 2)).toHaveFocus()
  })

  test('supports Command undo and Shift-Command redo without handling outside shortcuts', () => {
    render(<Harness />)
    fireEvent.click(cell('io', 3))
    const assigned = cell('io', 3, 'P1')
    assigned.focus()

    fireEvent.keyDown(assigned, { key: 'z', metaKey: true })
    expect(cell('io', 3)).toBeVisible()
    fireEvent.keyDown(cell('io', 3), { key: 'Z', metaKey: true, shiftKey: true })
    expect(cell('io', 3, 'P1')).toBeVisible()

    const outside = screen.getByRole('button', { name: 'Outside worksheet' })
    outside.focus()
    fireEvent.keyDown(outside, { key: 'z', ctrlKey: true })
    expect(cell('io', 3, 'P1')).toBeVisible()
  })
})
