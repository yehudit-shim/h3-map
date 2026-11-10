import ErrorBoundary from './app/ErrorBoundary.jsx'
import Workspace from './app/Workspace.jsx'

// Single-screen workspace for now: no router is needed until there is more than one page
// (project/settings views arrive with the PostgreSQL phase).
export default function App() {
  return (
    <ErrorBoundary name="the application">
      <Workspace />
    </ErrorBoundary>
  )
}
