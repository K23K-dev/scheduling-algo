import { useEffect, useRef } from 'react'
import styles from '../App.module.css'

export function ReplaceProblemDialog({
  onCancel,
  onConfirm,
}: {
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement
    if (typeof dialog.showModal === 'function') dialog.showModal()
    // Keep the dialog readable in environments without the native dialog API.
    else dialog.setAttribute('open', '')
    return () => {
      if (dialog.open) dialog.close?.()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={styles.replacementDialog}
      role="alertdialog"
      aria-labelledby="replacement-title"
      aria-describedby="replacement-description"
      onCancel={(event) => { event.preventDefault(); onCancel() }}
    >
      <h2 id="replacement-title">Start a new problem?</h2>
      <p id="replacement-description">
        This workload would exceed 40 blocks with the selected settings.
        Starting a new problem will clear your current attempt and its undo history.
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.secondaryButton} onClick={onCancel}>Keep current problem</button>
        <button type="button" className={styles.primaryButton} onClick={onConfirm}>Start new problem</button>
      </div>
    </dialog>
  )
}
