import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  purpose,
  action,
}: {
  eyebrow: string;
  title: string;
  purpose: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="muted">{purpose}</p>
      </div>
      {action}
    </header>
  );
}

export function StatusChip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'muted';
}) {
  return (
    <span className={`status-pill ${tone === 'success' ? 'success-pill' : ''}`}>
      {children}
    </span>
  );
}

export function EvidenceMeter({ level }: { level: 'low' | 'medium' | 'high' }) {
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
  return (
    <span className="evidence-meter" aria-label={`${level} evidence`}>
      <i className={filled >= 1 ? 'filled' : ''} />
      <i className={filled >= 2 ? 'filled' : ''} />
      <i className={filled >= 3 ? 'filled' : ''} />
      <strong>{level[0].toUpperCase() + level.slice(1)}</strong>
    </span>
  );
}

export function AIAssessment({ children }: { children: ReactNode }) {
  return (
    <aside className="ai-assessment">
      <span className="field-label">AI fit assessment</span>
      <small>Advisory · ranks, never gates</small>
      <p>{children}</p>
    </aside>
  );
}

export function DeterministicChecks({
  checks,
}: {
  checks: Array<{ label: string; passed: boolean }>;
}) {
  return (
    <div className="deterministic-checks">
      {checks.map((check) => (
        <span
          className={check.passed ? 'check-passed' : 'check-failed'}
          key={check.label}
        >
          {check.passed ? '✓' : '!'} {check.label}
        </span>
      ))}
    </div>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <p>{title}</p>
      {action}
    </div>
  );
}
