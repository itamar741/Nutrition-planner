import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ArnoldCapabilitiesPanel,
  type ArnoldCapabilityId,
  type CapabilityAvailability,
} from "@/components/coach-workspace/ArnoldCapabilitiesPanel";

function availability(
  available: ArnoldCapabilityId[] = [],
): Record<ArnoldCapabilityId, CapabilityAvailability> {
  return {
    draft: {
      available: available.includes("draft"),
      note: "Complete onboarding first.",
    },
    foods: {
      available: available.includes("foods"),
      note: "Complete onboarding and choose your foods first.",
    },
    calculations: {
      available: available.includes("calculations"),
      note: "Complete onboarding first.",
    },
    weight: {
      available: available.includes("weight"),
      note: "Available after you approve a plan.",
    },
    trend: {
      available: available.includes("trend"),
      note: "Available in the Existing profile.",
    },
    goal: {
      available: available.includes("goal"),
      note: "Complete onboarding first.",
    },
  };
}

describe("ArnoldCapabilitiesPanel", () => {
  it("renders the fixed capability set for New and marks unavailable actions", () => {
    render(
      <ArnoldCapabilitiesPanel
        availability={availability(["goal"])}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("What Arnold can help with")).toBeVisible();
    expect(
      screen.getByText("Create or revise a meal-plan Draft"),
    ).toBeVisible();
    expect(
      screen.getByText("Available after you approve a plan."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Try: Generate my Draft Meal Plan" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Try: I want to change my nutrition goal",
      }),
    ).toBeEnabled();
  });

  it("renders enabled Existing capabilities and only fills a message when clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ArnoldCapabilitiesPanel
        availability={availability([
          "draft",
          "foods",
          "calculations",
          "weight",
          "trend",
          "goal",
        ])}
        onSelect={onSelect}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Try: Find Eggs and add it to my foods",
      }),
    );

    expect(onSelect).toHaveBeenCalledWith("Find Eggs and add it to my foods");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
