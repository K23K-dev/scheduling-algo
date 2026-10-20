import styles from './App.module.css'

export default function App() {
  return (
    <main className={styles.workspace}>
      <header className={styles.header}>
        <span className={styles.course}>CS2200 / UNIT 3</span>
        <span className={styles.status}>In development</span>
      </header>

      <section className={styles.introduction} aria-labelledby="app-title">
        <p className={styles.eyebrow}>CPU scheduling practice</p>
        <h1 id="app-title">Scheduling Algo</h1>
        <p className={styles.description}>
          Understand what runs next, and why. Practice scheduling decisions
          through CPU and I/O timelines.
        </p>
        <p className={styles.notice}>The practice workspace is coming next.</p>
      </section>

      <footer className={styles.footer}>
        <span>One decision at a time.</span>
        <a href="https://github.com/K23K-dev/scheduling-algo">
          View the project <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </main>
  )
}
