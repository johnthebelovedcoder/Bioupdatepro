'use client';

export interface TraceNode {
  kind: string;
  title: string;
  reference?: string;
  date?: string;
  quantity?: string;
  details?: Record<string, string>;
  children: TraceNode[];
}

const LABEL: Record<string, string> = {
  INVOICE: 'Invoice',
  DELIVERY: 'Delivery',
  LINE: 'Stock',
  RECEIPT: 'Goods received',
  PRODUCTION: 'Production',
  HARVEST: 'Harvest',
  POPULATION: 'Population',
  HATCH: 'Hatch',
  BREEDING: 'Breeding',
  EGG_BATCH: 'Egg batch',
  FEED: 'Feed',
  TREATMENT: 'Treatment',
  TRANSFER: 'Transfer',
  COUNT: 'Stock count',
  RETURN: 'Return',
  OTHER: 'Source',
  GAP: 'Gap',
};

function Node({ node, depth }: { node: TraceNode; depth: number }) {
  const body = (
    <div className="stack" style={{ gap: 2 }}>
      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span className={`badge ${node.kind === 'GAP' ? 'badge-danger' : node.kind === 'RECEIPT' || node.kind === 'POPULATION' ? 'badge-success' : ''}`}>
          {LABEL[node.kind] ?? node.kind}
        </span>
        <span>{node.title}</span>
        {node.date ? <span className="faint">{node.date}</span> : null}
      </div>
      {node.details && Object.keys(node.details).length > 0 ? (
        <div className="faint" style={{ fontSize: 13 }}>
          {Object.entries(node.details)
            .map(([k, v]) => `${k}: ${v}`)
            .join(' · ')}
        </div>
      ) : null}
    </div>
  );
  if (node.children.length === 0) {
    return <li style={{ margin: '6px 0' }}>{body}</li>;
  }
  return (
    <li style={{ margin: '6px 0' }}>
      <details open={depth < 6}>
        <summary style={{ cursor: 'pointer', listStyle: 'revert' }}>{body}</summary>
        <ul style={{ listStyle: 'none', margin: 0, paddingLeft: 22, borderLeft: '1px solid var(--border, #d0d5dd)' }}>
          {node.children.map((child, i) => (
            <Node key={i} node={child} depth={depth + 1} />
          ))}
        </ul>
      </details>
    </li>
  );
}

/** The trace as a tree, every step open to a readable depth. */
export function TraceTree({ tree }: { tree: TraceNode }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      <Node node={tree} depth={0} />
    </ul>
  );
}

/** The same chain as a CSV file: one row per step, with its depth (AC-011 "one query/export"). */
export function DownloadTrace({ tree, reference }: { tree: TraceNode; reference: string }) {
  const download = () => {
    const rows: string[][] = [['Depth', 'Step', 'Description', 'Reference', 'Date', 'Quantity', 'Details']];
    const walk = (node: TraceNode, depth: number) => {
      rows.push([
        String(depth),
        LABEL[node.kind] ?? node.kind,
        node.title,
        node.reference ?? '',
        node.date ?? '',
        node.quantity ?? '',
        Object.entries(node.details ?? {})
          .map(([k, v]) => `${k}: ${v}`)
          .join('; '),
      ]);
      node.children.forEach((child) => walk(child, depth + 1));
    };
    walk(tree, 0);
    const cell = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    const csv = rows.map((r) => r.map(cell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `trace-${reference.replace(/[^A-Za-z0-9-]+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button type="button" className="btn" onClick={download}>
      Download CSV
    </button>
  );
}
