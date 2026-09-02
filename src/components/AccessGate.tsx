"use client";

import { FormEvent, useState } from "react";
import styles from "@/app/page.module.css";

export function AccessGate() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/demo/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        const result = (await response.json()) as { message?: string };
        throw new Error(result.message ?? "Access was not granted.");
      }
      window.location.reload();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Access was not granted.",
      );
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.accessCard} aria-labelledby="access-title">
      <span>Protected course demo</span>
      <h2 id="access-title">Enter the shared access code.</h2>
      <p>The code is used only to keep this temporary demonstration private.</p>
      <form onSubmit={submit}>
        <label htmlFor="demo-access-code">Demo access code</label>
        <input
          autoComplete="current-password"
          id="demo-access-code"
          onChange={(event) => setCode(event.target.value)}
          type="password"
          value={code}
        />
        <button disabled={!code.trim() || submitting} type="submit">
          {submitting ? "Checking…" : "Open demo"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
