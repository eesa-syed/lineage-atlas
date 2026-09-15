import { useState } from 'react';
import { useAtlas } from '../state/store';
import { ANY_DATE, PROVENANCE_LABEL, isDateFiltered } from '../types';
import { DateFilter, describeDates } from './DateFilter';
import { EvidenceFilter } from './EvidenceFilter';
import { TagFilter } from './TagFilter';

const OPEN_KEY = 'atlas-filters-open';

function storedOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Tags, evidence and dates as one section. Most of the time nobody is filtering, and
 * the two open control blocks took the top half of the rail to say so — so
 * closed, this is a single line, plus one removable chip per filter that is
 * actually on. Open, it shows the full tag and date controls.
 *
 * Both rail tabs render one, so the open state lives in storage rather than
 * in either instance: switching tabs keeps the panel as you left it.
 */
export function FilterPanel({ idPrefix }: { idPrefix: string }) {
  const tagFilter = useAtlas((s) => s.tagFilter);
  const dateFilter = useAtlas((s) => s.dateFilter);
  const toggleTagFilter = useAtlas((s) => s.toggleTagFilter);
  const clearTagFilters = useAtlas((s) => s.clearTagFilters);
  const clearDateFilter = useAtlas((s) => s.clearDateFilter);
  const provenanceFilter = useAtlas((s) => s.provenanceFilter);
  const toggleProvenanceFilter = useAtlas((s) => s.toggleProvenanceFilter);
  const clearProvenanceFilters = useAtlas((s) => s.clearProvenanceFilters);

  const [open, setOpen] = useState(storedOpen);

  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? '0' : '1');
    } catch {
      // Without storage the panel just forgets on reload.
    }
  };

  const dated = isDateFiltered(dateFilter);
  const activeCount = tagFilter.size + provenanceFilter.size + (dated ? 1 : 0);
  const clearAll = () => {
    clearTagFilters();
    clearDateFilter();
    clearProvenanceFilters();
  };

  return (
    <div className="sec filters">
      <div className="filters-head">
        <button className="filters-toggle" aria-expanded={open} onClick={toggle}>
          <span className="caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className="rail-label">Filters</span>
          {activeCount > 0 && <span className="rail-label sec-count">· {activeCount} on</span>}
        </button>
        <button
          className="linkbtn"
          onClick={clearAll}
          disabled={activeCount === 0 && dateFilter.field === ANY_DATE.field}
        >
          clear all
        </button>
      </div>

      {!open && activeCount > 0 && (
        <div className="chips filters-summary">
          {[...tagFilter].map((tag) => (
            <button key={tag} className="chip" aria-pressed="true" title="Remove this tag filter" onClick={() => toggleTagFilter(tag)}>
              {tag}
              <span className="rm">×</span>
            </button>
          ))}
          {[...provenanceFilter].map((source) => (
            <button key={source} className="chip" aria-pressed="true" title="Remove this evidence filter" onClick={() => toggleProvenanceFilter(source)}>
              {PROVENANCE_LABEL[source]}
              <span className="rm">×</span>
            </button>
          ))}
          {dated && (
            <button className="chip" aria-pressed="true" title="Remove the date filter" onClick={clearDateFilter}>
              {describeDates(dateFilter)}
              <span className="rm">×</span>
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="filters-body">
          <TagFilter />
          <EvidenceFilter />
          <DateFilter idPrefix={idPrefix} />
        </div>
      )}
    </div>
  );
}
