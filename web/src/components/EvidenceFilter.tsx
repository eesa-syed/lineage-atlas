import { useMemo } from 'react';
import { provenanceSources } from '../lib/lineage';
import { useAtlas } from '../state/store';
import { PROVENANCE_LABEL, PROVENANCE_SOURCES } from '../types';

/**
 * One chip per evidence source that appears in this pipeline — "confirmed in
 * code", "inferred", … — so a reviewer can pull up exactly the claims nobody has
 * checked yet. Counts are codes: a code counts once per source it carries,
 * whether the provenance sits on the code or on one of its inputs and outputs.
 *
 * Hidden entirely in a pipeline that records no provenance, which is most of them.
 */
export function EvidenceFilter() {
  const codes = useAtlas((s) => s.codes);
  const provenanceFilter = useAtlas((s) => s.provenanceFilter);
  const toggle = useAtlas((s) => s.toggleProvenanceFilter);
  const clear = useAtlas((s) => s.clearProvenanceFilters);

  const counts = useMemo(() => {
    const n = new Map<string, number>();
    for (const code of codes) for (const source of provenanceSources(code)) n.set(source, (n.get(source) ?? 0) + 1);
    return n;
  }, [codes]);

  const present = PROVENANCE_SOURCES.filter((s) => counts.has(s) || provenanceFilter.has(s));
  if (!present.length) return null;

  return (
    <div className="fsub">
      <div className="fsub-head">
        <span className="rail-label">Evidence</span>
        <button className="linkbtn" onClick={clear} disabled={provenanceFilter.size === 0}>
          reset
        </button>
      </div>
      <div className="chips">
        {present.map((source) => (
          <button key={source} className="chip" aria-pressed={provenanceFilter.has(source)} onClick={() => toggle(source)}>
            {PROVENANCE_LABEL[source]}
            <span className="n">{counts.get(source) ?? 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
