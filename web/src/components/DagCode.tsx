import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { STATUS_COLOR, assetLinkTag, codeColor, primaryTag, tagColor, type AssetLink, type Code } from '../types';

export interface DagNodeData extends Record<string, unknown> {
  code: Code;
  dim: boolean;
  inLineage: boolean;
  isConnectSource: boolean;
  detailed: boolean;
}

export type DagFlowNode = Node<DagNodeData, 'dag'>;

const SHOWN = 3;

/** Inputs and outputs listed on the card, the way pipeline docs are usually read. */
function Ports({ label, assets }: { label: string; assets: AssetLink[] }) {
  if (assets.length === 0) return null;
  const shown = assets.slice(0, SHOWN);
  const rest = assets.length - shown.length;
  return (
    <div className="ports">
      <span className="ports-label">{label}</span>
      {shown.map((asset) => {
        const tag = assetLinkTag(asset);
        return (
          <span className="port-row" key={asset.id} title={`${asset.path}${asset.detail ? ` — ${asset.detail}` : ''}`}>
            {tag && (
              <span className="pg" style={{ color: tagColor(tag) }}>
                {tag}
              </span>
            )}
            <span className={`pp${asset.assetId ? ' linked' : ''}`}>{asset.path}</span>
          </span>
        );
      })}
      {rest > 0 && <span className="port-more">+{rest} more</span>}
    </div>
  );
}

function DagCodeCard({ data, selected }: NodeProps<DagFlowNode>) {
  const { code, dim, inLineage, isConnectSource, detailed } = data;
  const className = [
    'dagnode',
    detailed ? 'detailed' : '',
    selected ? 'selected' : '',
    dim ? 'dim' : '',
    inLineage && !selected ? 'lineage' : '',
    isConnectSource ? 'connect-source' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const extraTags = code.tags.slice(1);

  return (
    <div className={className} style={{ ['--tc' as string]: codeColor(code) }}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="nh">
        <span className="ty" title={`main tag: ${primaryTag(code)}`}>
          {primaryTag(code)}
        </span>
        <span className="st" style={{ background: STATUS_COLOR[code.status] }} title={code.status} />
      </div>

      {/* Names wrap instead of truncating — a model name is the one thing on the
          card you can never afford to lose the end of. */}
      <div className={`nn${code.name.length > 26 ? ' long' : ''}`} title={code.name}>
        {code.name}
      </div>

      <div className="nd">{code.description}</div>

      {detailed && (
        <>
          <Ports label="in" assets={code.inputs} />
          <Ports label="out" assets={code.outputs} />
        </>
      )}

      <div className="nf">
        {!detailed && (
          <span className="io">
            ↓{code.inputs.length} ↑{code.outputs.length}
          </span>
        )}
        {extraTags.slice(0, 2).map((tag) => (
          <span className="tg" key={tag}>
            {tag}
          </span>
        ))}
        {extraTags.length > 2 && <span className="tg">+{extraTags.length - 2}</span>}
      </div>
    </div>
  );
}

export default memo(DagCodeCard);
