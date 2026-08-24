"use client";

const EXAMPLES = [
  "Research 5 AI accounting startups in the US. Find website, product, target customer, pricing, funding, and engineering openings. Verify from their sites and compare.",
  "Compare 4 AI customer-support startups: product, pricing model, notable customers, and open engineering roles.",
  "Find 3 US AI document-automation companies and summarize product focus, funding stage, and careers pages.",
];

const CAPABILITIES = [
  {
    title: "Plans, then acts",
    body: "An LLM decides each browser step from what it just saw — navigate, read, click, extract.",
  },
  {
    title: "Shows its work",
    body: "Every decision, action, and page screenshot streams live while the run happens.",
  },
  {
    title: "You stay in control",
    body: "Pause, stop, or require approval before the next action at any moment.",
  },
  {
    title: "Recovers out loud",
    body: "Dead pages and failed clicks are retried and reported. Nothing fails silently.",
  },
];

type Props = {
  disabled?: boolean;
  onStart: (goal: string) => void;
};

export function AgentInput({ disabled, onStart }: Props) {
  return (
    <main className="landing">
      <div className="landing__main">
        <p className="landing__kicker">Plain English in. Verified research out.</p>
        <h1 className="landing__title">
          Watch an agent
          <br />
          <span>do the research</span>
        </h1>
        <p className="landing__lede">
          Give ResearchPilot a goal. It plans the work, drives a real browser,
          reads the pages, and returns a comparison table where every cell links
          back to the page it came from.
        </p>

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
          <label htmlFor="goal" className="goal-form__label">
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
              <span className="example-row__label">Try</span>
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
      </div>

      <aside className="landing__side">
        <div className="preview" aria-hidden>
          <div className="preview__bar">
            <span />
            <span />
            <span />
            <em>agent viewport</em>
          </div>
          <div className="preview__body">
            <div className="preview__scan" />
            <div className="preview__row">
              <span className="preview__tick">✓</span>
              <span className="preview__bone preview__bone--lg" />
            </div>
            <div className="preview__row">
              <span className="preview__tick">✓</span>
              <span className="preview__bone preview__bone--md" />
            </div>
            <div className="preview__row preview__row--active">
              <span className="preview__tick preview__tick--live">→</span>
              <span className="preview__bone preview__bone--lg" />
            </div>
            <div className="preview__cells">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>

        <ul className="capabilities">
          {CAPABILITIES.map((item) => (
            <li key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}
