"use client";

type Props = {
  reason: string;
  actionLabel: string;
  onRetry: () => void;
  onSkip: () => void;
  onStop: () => void;
};

export function RecoveryCard({
  reason,
  actionLabel,
  onRetry,
  onSkip,
  onStop,
}: Props) {
  return (
    <div className="overlay-card" role="dialog" aria-labelledby="recovery-title">
      <p className="eyebrow">Could not finish this step</p>
      <h3 id="recovery-title">The agent got stuck</h3>
      <p>{reason}</p>
      <p className="mono-note">{actionLabel}</p>
      <div className="overlay-card__actions">
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          Retry
        </button>
        <button type="button" className="btn" onClick={onSkip}>
          Skip
        </button>
        <button type="button" className="btn btn-danger" onClick={onStop}>
          Stop
        </button>
      </div>
    </div>
  );
}
