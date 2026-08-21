"use client";

const EXAMPLES = [
  "Research 5 AI accounting startups in the US. Find website, product, target customer, pricing, funding, and engineering openings. Verify from their sites and compare.",
  "Compare 4 AI customer-support startups: product, pricing model, notable customers, and open engineering roles.",
  "Find 3 US AI document-automation companies and summarize product focus, funding stage, and careers pages.",
];

type Props = {
  disabled?: boolean;
  onStart: (goal: string) => void;
};

export function AgentInput({ disabled, onStart }: Props) {
  return (
    <section className="goal-panel">
      <div className="goal-panel__copy">
        <p className="eyebrow">Observable browser research</p>
        <h1 className="brand">ResearchPilot</h1>
        <p className="lede">
          Give it a research goal. Watch it plan, browse, recover, and compile a
          source-backed comparison you can steer at every step.
        </p>
      </div>

      <form
        className="goal-form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);
          const goal = String(data.get("goal") || "").trim();
          if (goal) onStart(goal);
        }}
      >
        <label htmlFor="goal" className="sr-only">
          Research goal
        </label>
        <textarea
          id="goal"
          name="goal"
          rows={4}
          disabled={disabled}
          placeholder="Describe the research you want done in the browser…"
          defaultValue={EXAMPLES[0]}
        />
        <div className="goal-form__actions">
          <button type="submit" className="btn btn-primary" disabled={disabled}>
            Start research
          </button>
          <div className="example-row">
            {EXAMPLES.map((example, index) => (
              <button
                key={example}
                type="button"
                className="chip"
                disabled={disabled}
                onClick={(e) => {
                  const form = (e.currentTarget as HTMLButtonElement).form;
                  const area = form?.querySelector("textarea");
                  if (area) area.value = example;
                }}
              >
                Example {index + 1}
              </button>
            ))}
          </div>
        </div>
      </form>
    </section>
  );
}
