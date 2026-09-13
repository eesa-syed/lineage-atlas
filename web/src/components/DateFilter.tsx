import { useAtlas } from '../state/store';
import { ANY_DATE, dayOffset, isDateFiltered, type DateField, type DateRange } from '../types';

/**
 * The windows worth one click. Everything else is what the two date boxes are
 * for; these are the three questions people actually arrive with — what has
 * moved lately, and what has been left alone.
 */
const PRESETS: { key: string; label: string; title: string; from: () => string; to: () => string }[] = [
  { key: '7d', label: 'last 7d', title: 'Changed in the last 7 days', from: () => dayOffset(-7), to: () => '' },
  { key: '30d', label: 'last 30d', title: 'Changed in the last 30 days', from: () => dayOffset(-30), to: () => '' },
  { key: 'stale', label: '90d+ ago', title: 'Nothing since 90 days ago — the stale end of the catalogue', from: () => '', to: () => dayOffset(-90) },
];

const FIELDS: { value: DateField; label: string }[] = [
  { value: 'updatedAt', label: 'Updated' },
  { value: 'createdAt', label: 'Created' },
];

/** A short name for the active window, for the collapsed filter summary. */
export function describeDates(range: DateRange): string {
  const field = FIELDS.find((f) => f.value === range.field)?.label.toLowerCase() ?? 'updated';
  const preset = PRESETS.find((p) => range.from === p.from() && range.to === p.to());
  if (preset) return `${field} ${preset.label}`;
  if (range.from && range.to) return `${field} ${range.from} → ${range.to}`;
  return range.from ? `${field} ≥ ${range.from}` : `${field} ≤ ${range.to}`;
}

/**
 * Filters codes or assets by one of their two stewardship dates. One control,
 * one piece of state, rendered by both rail tabs — the same arrangement the
 * search box and the tag chips already have, so a window set while reading
 * codes still applies when you switch to assets.
 *
 * The presets write into the very same two boxes rather than being a mode of
 * their own: whatever a chip does is visible as dates, and editable from there.
 * Rendered inside the combined filter panel, so it has no section of its own.
 */
export function DateFilter({ idPrefix }: { idPrefix: string }) {
  const range = useAtlas((s) => s.dateFilter);
  const setDateFilter = useAtlas((s) => s.setDateFilter);
  const clearDateFilter = useAtlas((s) => s.clearDateFilter);

  const active = isDateFiltered(range);
  const isOn = (preset: (typeof PRESETS)[number]) => range.from === preset.from() && range.to === preset.to();

  return (
    <div className="fsub">
      <div className="fsub-head">
        <span className="rail-label">Date</span>
        <button className="linkbtn" onClick={clearDateFilter} disabled={!active && range.field === ANY_DATE.field}>
          reset
        </button>
      </div>

      <div className="datebar">
        <select
          className="group-select"
          aria-label="Which date to filter on"
          value={range.field}
          onChange={(e) => setDateFilter({ field: e.target.value as DateField })}
        >
          {FIELDS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <label className="rail-label" htmlFor={`${idPrefix}-date-from`}>
          from
        </label>
        <input
          id={`${idPrefix}-date-from`}
          type="date"
          className="pipe-input date-input"
          value={range.from}
          max={range.to || undefined}
          onChange={(e) => setDateFilter({ from: e.target.value })}
        />

        <label className="rail-label" htmlFor={`${idPrefix}-date-to`}>
          to
        </label>
        <input
          id={`${idPrefix}-date-to`}
          type="date"
          className="pipe-input date-input"
          value={range.to}
          min={range.from || undefined}
          onChange={(e) => setDateFilter({ to: e.target.value })}
        />
      </div>

      <div className="chips">
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            className="chip"
            title={preset.title}
            aria-pressed={isOn(preset)}
            // A second click on the chip that is already on clears the window,
            // so a preset undoes itself the way a tag chip does.
            onClick={() =>
              isOn(preset)
                ? clearDateFilter()
                : setDateFilter({ from: preset.from(), to: preset.to() })
            }
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
