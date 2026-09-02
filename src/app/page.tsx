import Link from "next/link";
import { AccessGate } from "@/components/AccessGate";
import { hasServerAccess } from "@/security/demo-access";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const profiles = [
  {
    id: "new",
    number: "01 · START FRESH",
    title: "New Demo Profile",
    description:
      "Build a nutrition profile through adaptive conversation, one clear decision at a time.",
  },
  {
    id: "existing",
    number: "02 · SEE PROGRESS",
    title: "Existing Demo Profile",
    description:
      "Enter a prepared profile with an active plan and weight history for the adjustment demo.",
  },
] as const;

export default async function Home() {
  const hasAccess = await hasServerAccess();
  return (
    <main className={styles.main}>
      <div className={styles.shell}>
        <p className={styles.eyebrow}>
          Course demonstration · two fixed profiles
        </p>
        <section className={styles.hero} aria-labelledby="page-title">
          <h1 id="page-title">
            Food decisions,
            <br />
            made <span>clear.</span>
          </h1>
          <p>
            A conversational nutrition coach for adults who exercise and want a
            practical starting point—without learning nutrition planning first.
          </p>
        </section>

        {hasAccess ? (
          <>
            <section
              className={styles.profileGrid}
              aria-label="Choose a demo profile"
            >
              {profiles.map((profile) => (
                <Link
                  className={styles.profileCard}
                  href={`/coach/${profile.id}`}
                  key={profile.id}
                >
                  <span className={styles.number}>{profile.number}</span>
                  <h2>{profile.title}</h2>
                  <p>{profile.description}</p>
                  <span className={styles.arrow} aria-hidden="true">
                    →
                  </span>
                </Link>
              ))}
            </section>
            <p className={styles.note}>
              No sign-up. No additional profiles. Demo data only.
            </p>
          </>
        ) : (
          <AccessGate />
        )}
      </div>
    </main>
  );
}
