import { ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'accent';
}) {
  return <span className={`pw-badge pw-badge-${tone}`}>{children}</span>;
}

export function LabelChips({
  items,
  max = 4,
}: {
  items: Array<{ label: string; full: string }>;
  max?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = Math.max(0, items.length - max);
  return (
    <div className="pw-label-chips">
      {!expanded ? (
        <>
          {items.slice(0, max).map((item) => (
            <span key={item.full}>{item.label}</span>
          ))}
          <button className="pw-link" type="button" onClick={() => setExpanded(true)}>
            {hidden > 0 ? `+${hidden} more` : 'Details'}
          </button>
        </>
      ) : (
        <>
          <div className="pw-label-details">
            {items.map((item) => (
              <p key={item.full}>{item.full}</p>
            ))}
          </div>
          <button className="pw-link" type="button" onClick={() => setExpanded(false)}>
            Show less
          </button>
        </>
      )}
    </div>
  );
}

export function Disclosure({
  label,
  children,
  defaultOpen = false,
  quiet = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <div className={`pw-disc${quiet ? ' quiet' : ''}`}>
      <button
        className="pw-disc-btn"
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {open && (
        <div id={contentId} className="pw-disclosure-content">
          {children}
        </div>
      )}
    </div>
  );
}

export function Facts({
  facts,
}: {
  facts: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="pw-facts">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TechnicalDetails({ children }: { children: ReactNode }) {
  return <Disclosure label="Technical details">{children}</Disclosure>;
}

export function SourceList({
  sources,
}: {
  sources: Array<{ id: string; label: string; detail?: ReactNode }>;
}) {
  return (
    <div className="pw-source-list">
      {sources.map((source) => (
        <div className="pw-source-row" key={source.id}>
          <strong>{source.label}</strong>
          {source.detail && <span>{source.detail}</span>}
        </div>
      ))}
    </div>
  );
}

export function Meter({ value, label }: { value: number; label?: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="pw-meter" aria-label={label ?? `${bounded}%`}>
      <span style={{ width: `${bounded}%` }} />
    </div>
  );
}

export function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="pw-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="pw-panel-header">
      {' '}
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h3>{title}</h3>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="pw-panel-actions">{actions}</div>}
    </div>
  );
}

export function InfoCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`pw-info-card ${className}`}>{children}</section>;
}
