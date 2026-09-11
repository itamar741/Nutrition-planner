import styles from "./CoachWorkspace.module.css";

export type CapabilityAvailability = {
  available: boolean;
  note?: string;
};

export type ArnoldCapabilityId =
  "draft" | "foods" | "calculations" | "weight" | "trend" | "goal";

const capabilities: Array<{
  id: ArnoldCapabilityId;
  title: string;
  description: string;
  example: string;
}> = [
  {
    id: "draft",
    title: "Create or revise a meal-plan Draft",
    description: "Build a validated plan from your approved foods.",
    example: "Generate my Draft Meal Plan",
  },
  {
    id: "foods",
    title: "Manage approved foods",
    description: "Add, find, inspect, or remove foods for future Drafts.",
    example: "Find Greek yogurt and add it to my foods",
  },
  {
    id: "calculations",
    title: "Explain your calculations",
    description: "Ask about calories, macros, TDEE/EER, or plan checks.",
    example: "How is my TDEE calculated?",
  },
  {
    id: "weight",
    title: "Record and correct weight",
    description: "Track a weight measurement or correct an earlier day.",
    example: "I weigh 75.4 kg today",
  },
  {
    id: "trend",
    title: "Review weight trends",
    description: "Review evidence and propose an adjustment when supported.",
    example: "Review my weight trend",
  },
  {
    id: "goal",
    title: "Choose a different goal",
    description: "Restart onboarding to choose a new nutrition goal.",
    example: "I want to change my nutrition goal",
  },
];

export function ArnoldCapabilitiesPanel({
  availability,
  onSelect,
}: {
  availability: Record<ArnoldCapabilityId, CapabilityAvailability>;
  onSelect: (example: string) => void;
}) {
  return (
    <section
      aria-label="What Arnold can help with"
      className={styles.capabilitiesPanel}
    >
      <header>
        <p className={styles.kicker}>What Arnold can help with</p>
        <h2>Plan, learn, and track your nutrition.</h2>
      </header>
      <ul className={styles.capabilityList}>
        {capabilities.map((capability) => {
          const state = availability[capability.id];
          return (
            <li key={capability.id}>
              <div>
                <strong>{capability.title}</strong>
                <p>{capability.description}</p>
                {!state.available && state.note ? (
                  <small>{state.note}</small>
                ) : null}
              </div>
              <button
                aria-label={`Try: ${capability.example}`}
                disabled={!state.available}
                onClick={() => onSelect(capability.example)}
                type="button"
              >
                Try it
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
