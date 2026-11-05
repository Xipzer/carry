// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './brand-icons.css';
import './quote.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    return this.state.error ? <main className="crash-screen"><img src="/carry.svg" width="44" alt="Carry" /><h1>Page could not load</h1><p>If you confirmed a source transaction, do not send USDC again. Reload and open Activity, or recover the transfer using its source hash.</p><button className="primary-button" onClick={() => location.reload()}>Reload</button></main> : this.props.children;
  }
}
document.title = 'Carry | USDC transfers';
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
