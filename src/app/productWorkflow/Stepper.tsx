import {
  AlertTriangle,
  Check,
  Clock,
  FileText,
  Megaphone,
  Package,
  PenLine,
  Target,
} from 'lucide-react';
import type { WorkflowStep, WorkflowStepId } from './types';

const icons = {
  source: FileText,
  profile: Package,
  audiences: Target,
  outreach: Megaphone,
  copy: PenLine,
} as const;

export function Stepper({
  steps,
  activeStep,
  onSelect,
}: {
  steps: WorkflowStep[];
  activeStep?: WorkflowStepId;
  onSelect: (id: WorkflowStepId) => void;
}) {
  return (
    <div className="pw-stepper-viewport">
      <nav className="pw-stepper" aria-label="Product workflow progress">
        {steps.map((step, index) => {
          const Icon = icons[step.id];
          return (
            <div className="pw-step-wrap" key={step.id}>
              <button
                className="pw-step"
                type="button"
                aria-current={activeStep === step.id ? 'step' : undefined}
                onClick={() => onSelect(step.id)}
              >
                <span className="pw-step-rail">
                  <span className="pw-node" data-status={step.status}>
                    <Icon size={20} aria-hidden="true" />
                    {step.status !== 'locked' && (
                      <span className={`pw-status-mark ${step.status}`}>
                        {step.status === 'approved' ? (
                          <Check size={11} />
                        ) : step.status === 'working' ? (
                          <Clock size={11} />
                        ) : step.status === 'attention' ? (
                          <AlertTriangle size={11} />
                        ) : (
                          step.reviewCount || ''
                        )}
                      </span>
                    )}
                  </span>
                  {index < steps.length - 1 && (
                    <span
                      className={`pw-connector ${step.status === 'approved' && steps[index + 1]?.status === 'approved' ? 'done' : ''}`}
                    />
                  )}
                </span>
                <span className="pw-step-label">
                  {step.label === 'ICPs & audiences' ? 'Audiences' : step.label}
                </span>
                <span className="pw-step-sum">
                  {step.summary}
                </span>
                <span className="sr-only">: {step.status}</span>
              </button>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
