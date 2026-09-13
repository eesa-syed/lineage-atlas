import { useMemo, useState } from 'react';
import { useAtlas } from '../state/store';
import { normaliseTag, tagColor } from '../types';

/** Creates a code at `at`, the canvas coordinate the caller chose. */
export function NewCodeForm({ at, onClose }: { at: { x: number; y: number }; onClose: () => void }) {
  const createCode = useAtlas((s) => s.createCode);
  const tagCounts = useAtlas((s) => s.tagCounts);

  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  // Most-used tags first — the ones worth a single click.
  const suggestions = useMemo(
    () => [...tagCounts].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 12),
    [tagCounts],
  );

  const toggle = (tag: string) =>
    setChosen((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));

  const commitDraft = () => {
    const tag = normaliseTag(draft);
    if (tag && !chosen.includes(tag)) setChosen([...chosen, tag]);
    setDraft('');
  };

  const submit = () => {
    if (!name.trim()) return;
    void createCode({ name: name.trim(), tags: chosen, x: at.x, y: at.y });
    onClose();
  };

  return (
    <div className="newnode">
      <div className="rail-label" style={{ marginBottom: 7 }}>
        New code
      </div>

      <input
        className="pipe-input"
        autoFocus
        value={name}
        placeholder="stg_refunds"
        aria-label="Code name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onClose();
        }}
      />

      <div className="rail-label" style={{ margin: '10px 0 5px' }}>
        Tags {chosen.length > 0 && <span style={{ color: 'var(--accent)' }}>· {chosen[0]} is the main tag</span>}
      </div>

      {chosen.length > 0 && (
        <div className="chips" style={{ marginBottom: 6 }}>
          {chosen.map((tag, i) => (
            <span className="chip picked" key={tag} style={{ ['--tc' as string]: tagColor(tag) }}>
              {i === 0 && <span className="dotmark" />}
              {tag}
              <button className="rm" aria-label={`Remove ${tag}`} onClick={() => toggle(tag)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        className="pipe-input"
        value={draft}
        placeholder="new tag ↵"
        aria-label="Create a tag"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitDraft();
          }
          if (e.key === 'Escape') onClose();
        }}
      />

      {suggestions.length > 0 && (
        <div className="chips" style={{ marginTop: 6, maxHeight: 92, overflowY: 'auto' }}>
          {suggestions.map(({ tag, count }) => (
            <button
              key={tag}
              className="chip"
              aria-pressed={chosen.includes(tag)}
              style={{ ['--tc' as string]: tagColor(tag) }}
              onClick={() => toggle(tag)}
            >
              {tag}
              <span className="n">{count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="btn-grid" style={{ marginTop: 9 }}>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn pri" onClick={submit} disabled={!name.trim()}>
          Create
        </button>
      </div>
    </div>
  );
}
