"use client";

type Props = {
  reason: string;
  actionPreview?: string;
  onApprove: () => void;
  onReject: () => void;
};

export function ApprovalCard({ reason, actionPreview, onApprove, onReject }: Props) {
  return (
    <div className="overlay-card" role="dialog" aria-labelledby="approval-title">
      <p className="eyebrow">Human approval required</p>
      <h3 id="approval-title">Steer before continuing</h3>
      <p>{reason}</p>
      {actionPreview ? <p className="mono-note">{actionPreview}</p> : null}
      <div className="overlay-card__actions">
        <button type="button" className="btn btn-primary" onClick={onApprove}>
          Approve
        </button>
        <button type="button" className="btn" onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}
