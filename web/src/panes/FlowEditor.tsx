import { useState } from 'react';
import type { CodeFlow, FlowInput } from '../types';

type StepDraft = FlowInput['steps'][number];

/** Edits a code's logic steps: what it does, in order, in prose. */
export function FlowEditor({
  flow,
  saving,
  onSave,
  onCancel,
}: {
  flow: CodeFlow;
  saving: boolean;
  onSave: (input: FlowInput) => void;
  onCancel: () => void;
}) {
  const [steps, setSteps] = useState<StepDraft[]>(
    flow.steps.map((s) => ({ op: s.op, title: s.title, body: s.body })),
  );

  const patch = (i: number, next: Partial<StepDraft>) =>
    setSteps(steps.map((step, index) => (index === i ? { ...step, ...next } : step)));

  const move = (i: number, by: number) => {
    const target = i + by;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[i], next[target]] = [next[target], next[i]];
    setSteps(next);
  };

  return (
    <div className="card">
      <div className="code-top">
        <span className="rail-label">Steps · {steps.length}</span>
        <span className="spacer" />
        <button
          className="linkbtn"
          onClick={() => setSteps([...steps, { op: 'read', title: '', body: '' }])}
        >
          + add step
        </button>
      </div>

      {steps.length === 0 && (
        <div className="empty" style={{ padding: '22px 18px' }}>
          No steps yet. Add one to start explaining what this code does.
        </div>
      )}

      {steps.map((step, i) => (
        <div className="step-edit" key={i}>
          <div className="step-edit-head">
            <span className="num">{String(i + 1).padStart(2, '0')}</span>
            <input
              className="pipe-input"
              value={step.title}
              placeholder="Read staged orders"
              aria-label={`Step ${i + 1} title`}
              onChange={(e) => patch(i, { title: e.target.value })}
            />
            <input
              className="pipe-input op-input"
              value={step.op}
              placeholder="join"
              aria-label={`Step ${i + 1} operation`}
              onChange={(e) => patch(i, { op: e.target.value })}
            />
          </div>

          <textarea
            className="pipe-input"
            rows={2}
            value={step.body}
            placeholder="What this step does, and why it is done this way."
            aria-label={`Step ${i + 1} description`}
            onChange={(e) => patch(i, { body: e.target.value })}
          />

          <div className="step-edit-foot">
            <span className="spacer" />
            <button className="linkbtn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
              ↑
            </button>
            <button className="linkbtn" disabled={i === steps.length - 1} onClick={() => move(i, 1)} title="Move down">
              ↓
            </button>
            <button className="linkbtn danger" onClick={() => setSteps(steps.filter((_, index) => index !== i))}>
              remove
            </button>
          </div>
        </div>
      ))}

      <div className="btn-grid" style={{ marginTop: 7 }}>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn pri" disabled={saving} onClick={() => onSave({ steps })}>
          {saving ? 'Saving…' : 'Save logic flow'}
        </button>
      </div>
    </div>
  );
}
