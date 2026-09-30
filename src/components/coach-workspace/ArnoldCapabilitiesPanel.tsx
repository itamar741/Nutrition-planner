import styles from "./CoachWorkspace.module.css";
import {
  arnoldCapabilities,
  type ArnoldCapabilityId,
} from "@/domain/agent/capabilities";

export type { ArnoldCapabilityId } from "@/domain/agent/capabilities";

export type CapabilityAvailability = {
  available: boolean;
  note?: string;
};

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
        {arnoldCapabilities.map((capability) => {
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
