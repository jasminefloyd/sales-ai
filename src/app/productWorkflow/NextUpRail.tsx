import { Check, FileText, Megaphone, Package, PenLine, Target } from 'lucide-react';
import type { NextUpView, WorkflowStep } from './types';
import { Disclosure } from './Disclosure';

export function NextUpRail({
  steps,
  nextUp,
  onSelect,
}: {
  steps: WorkflowStep[];
  nextUp: NextUpView;
  onSelect: (id: WorkflowStep['id']) => void;
}) {
  const approved = steps.filter((step) => step.status === 'approved').length;
  const icons = {
    source: FileText,
    profile: Package,
    audiences: Target,
    outreach: Megaphone,
    copy: PenLine,
  } as const;
  const NextIcon = nextUp.tone === 'done' ? Check : icons[nextUp.targetStep];
  return (
    <aside className="pw-rail" aria-label="Next step">
      <div className={`pw-next pw-next-${nextUp.tone}`}>
        <span className="pw-next-icon">
          <NextIcon size={20} aria-hidden="true" />
        </span>
        <h3>{nextUp.title}</h3>
        <p>{nextUp.body}</p>
        <button
          className={`pw-btn ${nextUp.tone === 'done' ? '' : 'pw-btn-primary '}pw-btn-block`}
          type="button"
          onClick={() => onSelect(nextUp.targetStep)}
        >
          {nextUp.actionLabel}
        </button>
      </div>
      <div className="pw-progress">
        <strong>{approved} of 5 steps approved</strong>
        <div className="pw-progress-bar">
          <span style={{ width: `${(approved / 5) * 100}%` }} />
        </div>
      </div>
      <div className="pw-progress">
        <Disclosure label="How this was built" quiet>
          <div className="pw-lineage">
            {steps.map((step) => (
              <span key={step.id}>
                {(() => {
                  const Icon = icons[step.id];
                  return <Icon size={13} />;
                })()}{' '}
                {step.label === 'ICPs & audiences' ? 'Audiences' : step.label}
              </span>
            ))}
          </div>
        </Disclosure>
      </div>
    </aside>
  );
}
