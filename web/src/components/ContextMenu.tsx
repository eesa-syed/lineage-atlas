import { useEffect, useRef } from 'react';
import { useAtlas } from '../state/store';
import { primaryTag } from '../types';

export function ContextMenu() {
  const menu = useAtlas((s) => s.menu);
  const codes = useAtlas((s) => s.codes);
  const openMenu = useAtlas((s) => s.openMenu);
  const openFlowTab = useAtlas((s) => s.openFlowTab);
  const openSchemaTab = useAtlas((s) => s.openSchemaTab);
  const startConnect = useAtlas((s) => s.startConnect);
  const duplicate = useAtlas((s) => s.duplicate);
  const deleteCode = useAtlas((s) => s.deleteCode);
  const select = useAtlas((s) => s.select);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) openMenu(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu, openMenu]);

  if (!menu) return null;
  const code = codes.find((n) => n.id === menu.codeId);
  if (!code) return null;

  const run = (action: () => void) => () => {
    openMenu(null);
    action();
  };

  return (
    <div
      className="menu"
      ref={ref}
      role="menu"
      style={{ left: Math.min(menu.x, window.innerWidth - 232), top: Math.min(menu.y, window.innerHeight - 280) }}
    >
      <div className="mh">
        <span className="rail-label">{primaryTag(code)}</span>{' '}
        <span className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>
          {code.name}
        </span>
      </div>

      <button className="mi" role="menuitem" onClick={run(() => openFlowTab(code.id))}>
        ◱ Open code logic flow<span className="k">↵</span>
      </button>
      {code.assetId && (
        <button className="mi" role="menuitem" onClick={run(() => openSchemaTab(code.assetId!))}>
          ▦ Open asset schema
        </button>
      )}

      <div className="div" />

      <button className="mi" role="menuitem" onClick={run(() => startConnect(code.id))}>
        ⇢ Connect forward…<span className="k">C</span>
      </button>
      <button className="mi" role="menuitem" onClick={run(() => void duplicate(code.id, false))}>
        ⧉ Duplicate code<span className="k">D</span>
      </button>
      <button className="mi" role="menuitem" onClick={run(() => void duplicate(code.id, true))}>
        ⧉ Duplicate with inputs<span className="k">⇧D</span>
      </button>

      <div className="div" />

      <button className="mi" role="menuitem" onClick={run(() => select(code.id, true))}>
        ◎ Focus lineage
      </button>
      <button className="mi danger" role="menuitem" onClick={run(() => void deleteCode(code.id))}>
        × Delete code
      </button>
    </div>
  );
}
