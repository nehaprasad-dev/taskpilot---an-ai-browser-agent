"use client";

type Props = {
  summary: string;
  collected: string[];
  missing: string[];
  onContinue: () => void;
  onStop: () => void;
};

export function CheckpointCard({
  summary,
  collected,
  missing,
  onContinue,
  onStop,
}: Props) {
  return (
    <div className="overlay-card" role="dialog" aria-labelledby="checkpoint-title">
      <p className="eyebrow">Checkpoint</p>
      <h3 id="checkpoint-title">Review progress</h3>
      <p>{summary}</p>
      <div className="checkpoint-grid">
        <div>
          <h4>Collected</h4>
          <ul>
            {collected.length ? (
              collected.map((item) => <li key={item}>✓ {item}</li>)
            ) : (
              <li className="muted">Nothing solid yet</li>
            )}
          </ul>
        </div>
        <div>
          <h4>Still missing</h4>
          <ul>
            {missing.length ? (
              missing.map((item) => <li key={item}>○ {item}</li>)
            ) : (
              <li className="muted">Coverage looks good</li>
            )}
          </ul>
        </div>
      </div>
      <div className="overlay-card__actions">
        <button type="button" className="btn btn-primary" onClick={onContinue}>
          Continue
        </button>
        <button type="button" className="btn btn-danger" onClick={onStop}>
          Stop
        </button>
      </div>
    </div>
  );
}
