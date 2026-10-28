import type { ProcessInput } from '../scheduling/types'
import styles from '../App.module.css'

export function ProcessTable({
  processes,
  showPriority = false,
}: {
  readonly processes: readonly ProcessInput[]
  readonly showPriority?: boolean
}) {
  return (
    <section className={styles.panel} aria-label="Processes">
      <div className={styles.processTableScroll} role="region" aria-label="Scrollable process inputs" tabIndex={0}>
        <table className={styles.processTable} aria-label="Processes">
          <thead>
            <tr>
              <th scope="col">Process</th>
              <th scope="col">Arrival</th>
              <th scope="col">CPU 1</th>
              <th scope="col">I/O</th>
              <th scope="col">CPU 2</th>
              {showPriority ? <th scope="col">Priority</th> : null}
            </tr>
          </thead>
          <tbody>
            {processes.map((process) => (
              <tr key={process.id}>
                <th scope="row"><span className={styles.processBadge} data-process={process.id}>{process.id}</span></th>
                <td className={styles.arrivalValue}>{process.arrival}</td>
                <td>{process.cpu1}</td>
                <td>{process.io}</td>
                <td>{process.cpu2}</td>
                {showPriority ? <td>{process.priority}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
