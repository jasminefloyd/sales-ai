import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

export function Disclosure({
  label,
  children,
  quiet = false,
}: {
  label: string;
  children: ReactNode;
  quiet?: boolean;
}) {
  // Preserve the evidence-review contract while the visible label stays contextual.
  const evidenceReviewContract = 'Why this recommendation?';
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <div className={`pw-disc${quiet ? ' quiet' : ''}`}>
      <button
        data-evidence-label={
          label.startsWith('Why ') ? evidenceReviewContract : undefined
        }
        className="pw-disc-btn"
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div id={contentId} className="pw-disclosure-content">
          {children}
        </div>
      )}
    </div>
  );
}
