import { useEffect, useState } from 'react';
import { PipelineMenu } from './PipelineMenu';

type Theme = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'atlas-theme';

function readStoredTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function TopBar() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // A browser that refuses storage still gets the theme for this session.
    }
  }, [theme]);

  const cycle = () => setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system');

  return (
    <header className="topbar">
      <div className="mark">
        <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden="true">
          <path d="M3 4.5h4M3 9.5h4M3 14.5h4" stroke="var(--ink-3)" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M7 4.5C11 4.5 8 9.5 12 9.5M7 14.5C11 14.5 8 9.5 12 9.5" stroke="var(--accent)" strokeWidth="1.4" fill="none" />
          <circle cx="14.5" cy="9.5" r="2.6" fill="var(--accent)" />
        </svg>
        <b>Lineage Atlas</b>
      </div>

      <nav className="crumb">
        <span>workspace</span>
        <span className="sep">/</span>
        <PipelineMenu />
      </nav>

      <div className="spacer" />

      <span className="hint" style={{ margin: 0 }}>
        Press <span className="kbd">/</span> to search · <span className="kbd">C</span> connect · <span className="kbd">D</span> duplicate
      </span>
      <button className="theme-toggle" onClick={cycle} title="Switch theme">
        {theme === 'system' ? '◐ system' : theme === 'light' ? '☀ light' : '☾ dark'}
      </button>
      <div className="who">
        <i>SE</i>
        <span>syedeesa</span>
      </div>
    </header>
  );
}
