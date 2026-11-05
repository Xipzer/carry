// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const apply = (value: string) => {
    const next = value === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#101318' : '#f5f6f9');
    setTheme(next);
  };
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === 'carry.theme') apply(event.newValue ?? 'dark'); };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync);
  }, []);
  return <button className="icon-button theme-toggle" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => {
    const next = theme === 'dark' ? 'light' : 'dark'; apply(next);
    try { localStorage.setItem('carry.theme', next); } catch { /* Theme can still change without persistent storage. */ }
  }}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>;
}
