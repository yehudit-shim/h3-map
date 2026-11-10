import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '../ui/Button.jsx'

/** Catches render errors so one broken subtree cannot blank the whole workspace. */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(`[${this.props.name ?? 'app'}] render error`, error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) return this.props.fallback(this.state.error, this.reset)
    return (
      <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-3 bg-bg p-8 text-center">
        <AlertTriangle className="text-danger" size={32} aria-hidden="true" />
        <div className="text-[15px] font-semibold">Something went wrong{this.props.name ? ` in ${this.props.name}` : ''}</div>
        <pre className="max-w-xl overflow-auto rounded-md border border-line bg-panel p-3 text-left text-[12px] text-muted">{String(this.state.error?.message ?? this.state.error)}</pre>
        <Button variant="solid" onClick={this.reset}>Try again</Button>
      </div>
    )
  }
}
