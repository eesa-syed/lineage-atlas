import { useMemo, useState } from 'react';
import { useAtlas } from '../state/store';

/** How many chips the collapsed filter shows before folding the rest away. */
const COLLAPSED = 8;

/**
 * The tag chips both rail tabs filter with. A pipeline can carry any number
 * of tags, and a plain wrapping chip list grew without bound — a dbt import
 * pushed the date filter and the list itself off the bottom of the rail.
 *
 * So the collapsed view shows the tags that are switched on plus the most
 * used ones, and folds the rest behind "+N more". Expanded, the chips get a
 * find box and a capped, scrolling box of their own, so the rail below never
 * moves further than that cap.
 */
export function TagFilter() {
  const tagCounts = useAtlas((s) => s.tagCounts);
  const tagFilter = useAtlas((s) => s.tagFilter);
  const toggleTagFilter = useAtlas((s) => s.toggleTagFilter);
  const clearTagFilters = useAtlas((s) => s.clearTagFilters);

  const [expanded, setExpanded] = useState(false);
  const [find, setFind] = useState('');

  // Most used first: the tags people reach for are the ones on many codes.
  const byCount = useMemo(
    () => [...tagCounts].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    [tagCounts],
  );

  const foldable = byCount.length > COLLAPSED;

  const shown = useMemo(() => {
    if (expanded || !foldable) {
      const q = find.trim().toLowerCase();
      return q ? byCount.filter((t) => t.tag.toLowerCase().includes(q)) : byCount;
    }
    // Tags that are on always stay visible, even when they are rarely used —
    // otherwise an active filter could hide behind "+N more".
    const on = byCount.filter((t) => tagFilter.has(t.tag));
    const rest = byCount.filter((t) => !tagFilter.has(t.tag));
    return [...on, ...rest.slice(0, Math.max(0, COLLAPSED - on.length))];
  }, [expanded, foldable, find, byCount, tagFilter]);

  const hidden = byCount.length - shown.length;

  const collapse = () => {
    setExpanded(false);
    setFind('');
  };

  return (
    <div className="fsub">
      <div className="fsub-head">
        <span className="rail-label">Tags</span>
        <button className="linkbtn" onClick={clearTagFilters} disabled={tagFilter.size === 0}>
          reset
        </button>
      </div>

      {tagCounts.length === 0 ? (
        <div className="hint">No tags in this pipeline yet.</div>
      ) : (
        <>
          {expanded && foldable && (
            <input
              className="pipe-input tag-find"
              type="search"
              autoFocus
              value={find}
              placeholder={`Find among ${byCount.length} tags…`}
              aria-label="Find a tag"
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') collapse();
                // Enter toggles the only match, so typing a tag name is enough.
                if (e.key === 'Enter' && shown.length === 1) toggleTagFilter(shown[0].tag);
              }}
            />
          )}

          <div className={`chips${expanded ? ' chips-capped' : ''}`}>
            {shown.map(({ tag, count }) => (
              <button
                key={tag}
                className="chip"
                aria-pressed={tagFilter.has(tag)}
                onClick={() => toggleTagFilter(tag)}
              >
                {tag}
                <span className="n">{count}</span>
              </button>
            ))}
            {expanded && shown.length === 0 && <span className="hint">No tag matches.</span>}
            {!expanded && foldable && hidden > 0 && (
              <button className="chip chip-more" onClick={() => setExpanded(true)}>
                +{hidden} more
              </button>
            )}
          </div>

          {expanded && foldable && (
            <button className="linkbtn tag-less" onClick={collapse}>
              show less
            </button>
          )}
        </>
      )}
    </div>
  );
}
