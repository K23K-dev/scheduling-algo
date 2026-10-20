import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from 'react'
import { TIME_BOUNDARIES } from '../scheduling/timeline'
import type { GradeResult } from '../scheduling/grader'
import type { HintLevel, HintResult } from '../scheduling/hints'
import {
  TIMELINE_LENGTH,
  type AttemptCell,
  type ProcessInput,
  type Resource,
} from '../scheduling/types'
import type { AttemptAction, AttemptHistory } from './attempt'
import { AnswerFeedback } from './AnswerFeedback'
import { HintPanel } from './HintPanel'
import styles from '../App.module.css'
import editor from './Worksheet.module.css'

interface CellPosition {
  readonly resource: Resource
  readonly index: number
}

interface Drag {
  readonly pointerId: number
  readonly resource: Resource
  readonly start: number
  readonly end: number
  readonly value: AttemptCell
}

interface WorksheetProps {
  readonly processes: readonly ProcessInput[]
  readonly history: AttemptHistory
  readonly onEdit: Dispatch<AttemptAction>
  readonly onCheck: () => void
  readonly feedback: GradeResult | null
  readonly checkError: string | null
  readonly pendingSettings?: boolean
  readonly hint: HintResult | null
  readonly helpError: string | null
  readonly assisted: boolean
  readonly solutionVisible: boolean
  readonly onHint: (level: HintLevel) => void
  readonly onReveal: () => void
  readonly onRetry: () => void
  readonly revealButtonRef?: Ref<HTMLButtonElement>
}

const intervals = TIME_BOUNDARIES.slice(0, TIMELINE_LENGTH)
const resources = [{ id: 'cpu', label: 'CPU' }, { id: 'io', label: 'I/O' }] as const

function cellLabel(value: AttemptCell): string {
  return value === null ? 'unanswered' : value === 'idle' ? 'Idle' : value
}

export function Worksheet({
  processes, history, onEdit, onCheck, feedback, checkError, pendingSettings = false,
  hint, helpError, assisted, solutionVisible, onHint, onReveal, onRetry, revealButtonRef,
}: WorksheetProps) {
  const [tool, setTool] = useState<AttemptCell>(processes[0].id)
  const [focused, setFocused] = useState<CellPosition>({ resource: 'cpu', index: 0 })
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const regionRef = useRef<HTMLDivElement>(null)
  const answered = [...history.present.cpu, ...history.present.io].filter((cell) => cell !== null).length
  const visibleFeedback = drag === null ? feedback : null

  const cancelDrag = useCallback(() => {
    const current = dragRef.current
    dragRef.current = null
    setDrag(null)
    const region = regionRef.current
    if (current && region?.hasPointerCapture?.(current.pointerId)) {
      region.releasePointerCapture(current.pointerId)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('blur', cancelDrag)
    return () => window.removeEventListener('blur', cancelDrag)
  }, [cancelDrag])

  function startDrag(event: PointerEvent<HTMLButtonElement>, position: CellPosition) {
    // Touch uses native taps and swipes, so scrolling never starts an edit.
    if (dragRef.current) return
    suppressClick.current = false
    if (event.pointerType === 'touch' || event.button !== 0 || event.isPrimary === false) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    suppressClick.current = true
    const next: Drag = {
      pointerId: event.pointerId,
      resource: position.resource,
      start: position.index,
      end: position.index,
      value: tool,
    }
    dragRef.current = next
    setDrag(next)
    regionRef.current?.setPointerCapture?.(event.pointerId)
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = dragRef.current
    if (!current || current.pointerId !== event.pointerId) return
    // Pointer capture delivers moves outside the original cell; hit-test the
    // actual position and keep the gesture confined to its starting resource.
    const cell = document.elementFromPoint?.(event.clientX, event.clientY)
      ?.closest<HTMLButtonElement>('button[data-resource][data-index]')
    if (!cell || !regionRef.current?.contains(cell) || cell.dataset.resource !== current.resource) return
    const end = Number(cell.dataset.index)
    if (end === current.end) return
    const next = { ...current, end }
    dragRef.current = next
    setDrag(next)
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    moveDrag(event)
    const current = dragRef.current
    if (!current) return
    cancelDrag()
    onEdit({
      type: 'paint',
      resource: current.resource,
      start: current.start,
      end: current.end,
      value: current.value,
    })
  }

  function revealCell(button: HTMLButtonElement) {
    const region = regionRef.current
    if (!region) return
    button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    // Native focus scrolling does not account for the sticky resource column.
    // Measure its actual width so zoom and larger text do not hide the target.
    const regionBounds = region.getBoundingClientRect()
    const labelBounds = region.querySelector('tbody th')?.getBoundingClientRect()
    const cellBounds = button.getBoundingClientRect()
    const visibleLeft = Math.max(regionBounds.left, labelBounds?.right ?? regionBounds.left) + 8
    const visibleRight = regionBounds.right - 8
    if (cellBounds.left < visibleLeft) {
      region.scrollLeft = Math.max(0, region.scrollLeft - (visibleLeft - cellBounds.left))
    } else if (cellBounds.right > visibleRight) {
      region.scrollLeft += cellBounds.right - visibleRight
    }
  }

  function focusCell(position: CellPosition) {
    const button = regionRef.current?.querySelector<HTMLButtonElement>(
      `button[data-resource="${position.resource}"][data-index="${position.index}"]`,
    )
    button?.focus({ preventScroll: true })
  }

  function handleKeys(event: KeyboardEvent<HTMLElement>) {
    const target = event.target
    if (event.nativeEvent.isComposing || (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'))
    )) return
    if (event.key === 'Escape') {
      cancelDrag()
      return
    }
    const key = event.key.toLowerCase()
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'z' || key === 'y')) {
      event.preventDefault()
      cancelDrag()
      // History clears help panels; keep focus on a cell if its current
      // heading or button is about to disappear with that feedback.
      if (target instanceof HTMLElement && !regionRef.current?.contains(target)) focusCell(focused)
      onEdit({ type: key === 'y' || event.shiftKey ? 'redo' : 'undo' })
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (!event.shiftKey) {
      const process = /^[1-3]$/.test(key) ? processes[Number(key) - 1] : undefined
      if (process || key === 'i' || key === 'e') {
        event.preventDefault()
        cancelDrag()
        setTool(process ? process.id : key === 'i' ? 'idle' : null)
        return
      }
    }
    if (!(target instanceof HTMLButtonElement) || !target.dataset.resource) return
    const position = {
      resource: target.dataset.resource as Resource,
      index: Number(target.dataset.index),
    }
    let next: CellPosition | null = null
    switch (event.key) {
      case 'ArrowLeft':
        next = { ...position, index: Math.max(0, position.index - 1) }
        break
      case 'ArrowRight':
        next = { ...position, index: Math.min(TIMELINE_LENGTH - 1, position.index + 1) }
        break
      case 'ArrowUp':
        next = { ...position, resource: 'cpu' }
        break
      case 'ArrowDown':
        next = { ...position, resource: 'io' }
        break
      case 'Home':
        next = { ...position, index: 0 }
        break
      case 'End':
        next = { ...position, index: TIMELINE_LENGTH - 1 }
        break
      case 'Backspace':
      case 'Delete':
        event.preventDefault()
        cancelDrag()
        onEdit({ type: 'paint', resource: position.resource, start: position.index, end: position.index, value: null })
        return
    }
    if (next) {
      event.preventDefault()
      cancelDrag()
      focusCell(next)
    }
  }

  return (
    <section
      className={`${styles.panel} ${styles.worksheet}`}
      aria-labelledby="worksheet-title"
      onKeyDown={handleKeys}
    >
      <div className={styles.panelHeading}>
        <h2 id="worksheet-title" tabIndex={-1}><span className={styles.step}>03</span> Your timeline</h2>
        <div className={editor.attemptStatus}>
          {assisted ? <span className={editor.assisted} aria-live="polite">Assisted attempt</span> : null}
          <span className={styles.previewTag} aria-live="polite">{answered} / 80 filled</span>
        </div>
      </div>
      <p className={styles.worksheetDescription} id="editing-help">
        Choose a process, Idle, or Erase. Click a block or drag across one row to assign a range.
      </p>
      <div className={editor.toolbar}>
        <div className={editor.palette} role="group" aria-label="Assignment tool" aria-describedby="keyboard-help">
          {processes.map(({ id }, index) => (
            <button
              key={id}
              type="button"
              className={`${styles.processBadge} ${editor.tool}`}
              data-process={id}
              aria-pressed={tool === id}
              aria-keyshortcuts={String(index + 1)}
              title={`Select ${id} (${index + 1})`}
              onClick={() => { cancelDrag(); setTool(id) }}
            >{id}</button>
          ))}
          <button
            type="button"
            className={`${editor.tool} ${editor.idleTool}`}
            aria-pressed={tool === 'idle'}
            aria-keyshortcuts="I"
            title="Select Idle (I)"
            onClick={() => { cancelDrag(); setTool('idle') }}
          >Idle</button>
          <button
            type="button"
            className={editor.tool}
            aria-pressed={tool === null}
            aria-keyshortcuts="E"
            title="Select Erase (E)"
            onClick={() => { cancelDrag(); setTool(null) }}
          >Erase</button>
        </div>
        <div className={editor.historyActions}>
          <button type="button" disabled={history.past.length === 0} title="Undo (Ctrl/Cmd+Z)" onClick={() => onEdit({ type: 'undo' })}>Undo</button>
          <button type="button" disabled={history.future.length === 0} title="Redo (Ctrl/Cmd+Shift+Z)" onClick={() => onEdit({ type: 'redo' })}>Redo</button>
          <button type="button" disabled={answered === 0} onClick={() => onEdit({ type: 'clear' })}>Clear attempt</button>
        </div>
      </div>
      <p className={editor.toolStatus} aria-live="polite" aria-atomic="true">
        Selected tool: {tool === null ? 'Erase' : cellLabel(tool)}.
      </p>
      <div className={editor.legend}>
        <span><i className={styles.emptySwatch} aria-hidden="true">·</i> Unanswered</span>
        <span>First block: [0, 1)</span>
      </div>
      <div
        ref={regionRef}
        className={styles.timelineScroll}
        tabIndex={-1}
        role="region"
        aria-label="Scrollable CPU and I/O worksheet"
        aria-describedby="keyboard-help"
        onFocus={(event) => {
          if (event.target === event.currentTarget) focusCell(focused)
        }}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={(event) => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag() }}
        onLostPointerCapture={(event) => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag() }}
      >
        <table className={styles.timeline} aria-label="CPU and I/O worksheet" aria-describedby="editing-help keyboard-help">
          <colgroup><col className={styles.resourceColumn} /><col span={TIMELINE_LENGTH} /></colgroup>
          <thead>
            <tr>
              <th scope="col" className={styles.axisLabel}>Time</th>
              {intervals.map((time) => (
                <th key={time} scope="col" className={styles.timeBoundary} aria-label={`Time ${time} to ${time + 1}`}>
                  <span>{time}</span>
                  {time === TIMELINE_LENGTH - 1 ? <span className={styles.finalBoundary}>{TIMELINE_LENGTH}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resources.map(({ id: resource, label }) => (
              <tr key={resource}>
                <th scope="row" className={styles.resourceLabel}>{label}</th>
                {intervals.map((time) => {
                  const preview = drag !== null && drag.resource === resource &&
                    time >= Math.min(drag.start, drag.end) && time <= Math.max(drag.start, drag.end)
                  const value = preview ? drag.value : history.present[resource][time]
                  const flagged = visibleFeedback?.status === 'needs-correction' &&
                    visibleFeedback.time === time &&
                    visibleFeedback.issues.some((issue) => issue.resource === resource)
                  return (
                    <td
                      key={time}
                      className={`${styles.timelineCell} ${editor.cell} ${time % 5 === 0 ? styles.majorBoundary : ''}`}
                    >
                      <button
                        type="button"
                        className={editor.cellButton}
                        aria-label={`${label}, time ${time} to ${time + 1}: ${cellLabel(value)}`}
                        aria-invalid={flagged || undefined}
                        aria-describedby={flagged ? `feedback-${resource}` : undefined}
                        data-resource={resource}
                        data-index={time}
                        data-value={value ?? 'empty'}
                        data-preview={preview || undefined}
                        data-feedback={flagged || undefined}
                        tabIndex={focused.resource === resource && focused.index === time ? 0 : -1}
                        onFocus={(event) => {
                          setFocused({ resource, index: time })
                          revealCell(event.currentTarget)
                        }}
                        onPointerDown={(event) => startDrag(event, { resource, index: time })}
                        onClick={(event) => {
                          // A physical drag already committed on pointerup. Native
                          // keyboard activation and touch taps still produce clicks.
                          if (event.detail !== 0 && suppressClick.current) {
                            suppressClick.current = false
                            return
                          }
                          suppressClick.current = false
                          onEdit({ type: 'paint', resource, start: time, end: time, value: tool })
                        }}
                      >
                        <span aria-hidden="true">{value === null ? '·' : cellLabel(value)}</span>
                        {flagged ? <span className={editor.reviewMarker} aria-hidden="true">!</span> : null}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={editor.bottomActions}>
        <button type="button" disabled={answered === 80} onClick={() => onEdit({ type: 'fill-idle' })}>
          Fill remaining empty cells with Idle
        </button>
        <button type="button" className={editor.checkButton} onClick={() => { cancelDrag(); onCheck() }}>
          Check answer
        </button>
      </div>
      <div className={editor.learningActions}>
        <button type="button" onClick={() => { cancelDrag(); onHint(1) }}>Hint</button>
        <button ref={revealButtonRef} type="button" disabled={solutionVisible} onClick={() => { cancelDrag(); onReveal() }}>
          Reveal solution
        </button>
        <button type="button" onClick={() => { cancelDrag(); onRetry() }}>Retry same problem</button>
      </div>
      <p className={editor.checkHelp}>
        {pendingSettings
          ? 'Checking, hints, and playback use the current problem’s applied settings. Your setting changes are still pending.'
          : 'Hints start with a rule. Revealing an assignment or solution marks this attempt as assisted.'}
      </p>
      <AnswerFeedback
        result={visibleFeedback}
        error={checkError}
        onEditCell={(resource, time) => { cancelDrag(); focusCell({ resource, index: time }) }}
      />
      <div hidden={drag !== null}>
        <HintPanel
          hint={hint}
          error={helpError}
          onHint={onHint}
          onEditCell={(resource, time) => { cancelDrag(); focusCell({ resource, index: time }) }}
        />
      </div>
      <div className={styles.worksheetFooter} id="keyboard-help">
        <p>1/2/3 choose a process · I selects Idle · E selects Erase</p>
        <p>Arrows move · Home/End jump along a row · Enter/Space assign · Delete/Backspace erase</p>
        <p>Ctrl/Cmd+Z undoes · Ctrl/Cmd+Shift+Z redoes. Shortcuts work while focus is in this worksheet.</p>
        <p>On touch screens, tap to assign and swipe to scroll.</p>
      </div>
    </section>
  )
}
