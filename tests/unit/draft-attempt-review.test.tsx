import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentInteractionPanel } from "@/components/coach-workspace/AgentInteractionPanel";
import type {
  AgentInteraction,
  DraftAttemptReview,
} from "@/domain/agent/types";

function attempt(
  attemptNumber: number,
  riceGrams: number,
  energyKcal: number,
): DraftAttemptReview {
  return {
    attempt: attemptNumber,
    summary: `Rice Draft ${attemptNumber}`,
    meals: ["Breakfast", "Lunch", "Dinner"].map((name, index) => ({
      id: ["breakfast", "lunch", "dinner"][index] as
        "breakfast" | "lunch" | "dinner",
      name,
      items: [
        {
          catalogFoodId: "white-rice-cooked",
          displayName: "White rice",
          grams: riceGrams,
        },
      ],
    })),
    totals: {
      energyKcal,
      proteinG: 45,
      carbohydrateG: 410,
      fatG: 8,
      fiberG: 6,
    },
    checks: [
      {
        key: "energy",
        label: "Energy",
        actual: `${energyKcal} kcal`,
        expected: "2200–2400 kcal (±5%)",
        passed: false,
      },
      {
        key: "fiber",
        label: "Fiber",
        actual: "6.0 g",
        expected: "At least 32.0 g",
        passed: false,
      },
    ],
    issues: ["Energy must be within ±5% of 2300 kcal."],
  };
}

describe("Draft attempt review", () => {
  it("shows exact portions, totals, failures, and changes between attempts", () => {
    const interaction: AgentInteraction = {
      id: "draft-failure-review",
      type: "draft_failure_review",
      attempts: [attempt(1, 500, 2600), attempt(2, 400, 2080)],
      prompt: "Should I keep this structure or use different approved foods?",
    };

    render(
      <AgentInteractionPanel
        catalog={[]}
        disabled={false}
        interaction={interaction}
        onAction={vi.fn()}
        onQuickReply={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Rejected Draft attempts" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Attempt 1 · 2600 kcal")).toBeInTheDocument();
    expect(screen.getByText("Attempt 2 · 2080 kcal")).toBeInTheDocument();
    expect(screen.getAllByText("White rice · 400 g")).toHaveLength(3);
    expect(
      screen.getByText("Breakfast: White rice 500 g → 400 g."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Failed: Energy")).toHaveLength(2);
    expect(
      screen.getByText(
        "Should I keep this structure or use different approved foods?",
      ),
    ).toBeInTheDocument();
  });

  it("does not render empty validation messages", () => {
    const withEmptyMessages = attempt(1, 500, 2600);
    withEmptyMessages.issues = ["", "   ", "Energy must be within range."];
    render(
      <AgentInteractionPanel
        catalog={[]}
        disabled={false}
        interaction={{
          id: "empty-message-review",
          type: "draft_failure_review",
          attempts: [withEmptyMessages],
          prompt: "Choose a direction.",
        }}
        onAction={vi.fn()}
        onQuickReply={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Energy must be within range."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Energy must be within range.").closest("ul")?.children,
    ).toHaveLength(1);
  });
});
