import { useEffect, useState } from 'react';
import { useAtlas } from '../state/store';
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

/** `priya@acme.example` → `PR`, `Analytics Eng` → `AE`. */
function initials(name: string): string {
  const words = name.split('@')[0].split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function TopBar() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const user = useAtlas((s) => s.version?.user);

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
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
          {/* Three sources converge on a model, which writes one table. */}
          <path d="M4.8 7C11.3 7 9.8 16 15.8 16M4.8 25C11.3 25 9.8 16 15.8 16M4.8 16H20.8" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="4.3" cy="7" r="2.9" fill="var(--ink-3)" />
          <circle cx="4.3" cy="16" r="2.9" fill="var(--ink-3)" />
          <circle cx="4.3" cy="25" r="2.9" fill="var(--ink-3)" />
          <circle cx="15.3" cy="16" r="4.6" fill="var(--accent)" />
          <rect x="21.8" y="12" width="7.6" height="8" rx="2" fill="none" stroke="var(--accent)" strokeWidth="2.2" />
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
      {user && (
        <div className="who" title="Edits made here are recorded under this name. Set ATLAS_USER on the server to change it.">
          <i>{initials(user)}</i>
          <span>{user}</span>
        </div>
      )}
    </header>
  );
}
