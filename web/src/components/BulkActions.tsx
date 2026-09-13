import { useState } from 'react';
import { useAtlas } from '../state/store';

/**
 * What can be done to several codes at once: tag them all, or connect them all
 * forward into one target. Shared by the rail's bulk bar and the canvas
 * toolbar, so both act on the one selection in the same way; `variant` picks the
 * button style each place already uses.
 */
export function BulkActions({ ids, variant = 'rail' }: { ids: string[]; variant?: 'rail' | 'toolbar' }) {
  const button = variant === 'toolbar' ? 'tbtn' : 'btn';
  const bulkAddTag = useAtlas((s) => s.bulkAddTag);
  const startBulkConnect = useAtlas((s) => s.startBulkConnect);
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <>
      {draft === null ? (
        <button className={button} onClick={() => setDraft('')}>
          + tag all
        </button>
      ) : (
        <input
          className="chip-input"
          autoFocus
          value={draft}
          placeholder="tag name ↵"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // Esc abandons the tag, not the selection it was about to be applied to.
              e.stopPropagation();
              setDraft(null);
            }
            if (e.key === 'Enter' && draft.trim()) {
              void bulkAddTag(ids, draft);
              setDraft(null);
            }
          }}
        />
      )}
      <button className={button} onClick={() => startBulkConnect(ids)}>
        ⇢ connect to…
      </button>
    </>
  );
}
