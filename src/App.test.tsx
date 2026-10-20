import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from './App'

test('renders the starter screen with an accessible title and project link', () => {
  render(<App />)

  const workspace = within(screen.getByRole('main'))

  expect(
    workspace.getByRole('heading', { level: 1, name: 'Scheduling Algo' }),
  ).toBeVisible()
  expect(workspace.getByRole('link', { name: 'View the project' })).toHaveAttribute(
    'href',
    'https://github.com/K23K-dev/scheduling-algo',
  )
})
