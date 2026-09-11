import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WeightTrendChart } from "@/components/coach-workspace/WeightTrendChart";
import type { WeightTrend } from "@/domain/weight/trend";

const measurements = [
  {
    id: "weight-1",
    date: "2026-08-02",
    weightKg: 80.25,
    commandId: "command-1",
  },
  {
    id: "weight-2",
    date: "2026-09-10",
    weightKg: 79.8,
    commandId: "command-2",
  },
];

const trend: WeightTrend = {
  measurementCount: 2,
  spanDays: 39,
  meanWeightKg: 80.025,
  slopeKgPerDay: 0,
  weeklyKg: 0,
  weeklyPercent: 0,
  evidence: "insufficient",
  evidenceReason: "not_enough_measurements",
};

function renderChart(onEdit = vi.fn(), onDelete = vi.fn()) {
  render(
    <WeightTrendChart
      measurements={measurements}
      onDelete={onDelete}
      onEdit={onEdit}
      trend={trend}
    />,
  );
  return { onDelete, onEdit };
}

describe("WeightTrendChart", () => {
  it("shows the exact date and weight on hover and hides them on leave", async () => {
    const user = userEvent.setup();
    renderChart();
    const point = screen.getByRole("button", {
      name: "Edit 2 August 2026, 80.25 kilograms",
    });

    await user.hover(point);
    expect(screen.getByRole("tooltip")).toHaveTextContent("2 August 2026");
    expect(screen.getByRole("tooltip")).toHaveTextContent("80.25 kg");

    await user.unhover(point);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("edits from the point popover and closes without saving on Escape", async () => {
    const user = userEvent.setup();
    const { onEdit } = renderChart();
    const point = screen.getByRole("button", {
      name: "Edit 10 September 2026, 79.8 kilograms",
    });

    await user.click(point);
    const editor = screen.getByRole("dialog", {
      name: "Edit weight for 10 September 2026",
    });
    expect(editor).toHaveTextContent("10 September 2026");
    const input = screen.getByRole("spinbutton", {
      name: "Replacement weight in kilograms",
    });
    await user.clear(input);
    await user.type(input, "79.65");
    await user.click(screen.getByRole("button", { name: "Save replacement" }));
    expect(onEdit).toHaveBeenCalledWith("2026-09-10", 79.65);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(point);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("opens the same editor with the keyboard", async () => {
    const user = userEvent.setup();
    renderChart();
    const point = screen.getByRole("button", {
      name: "Edit 2 August 2026, 80.25 kilograms",
    });

    point.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("dialog", { name: "Edit weight for 2 August 2026" }),
    ).toBeVisible();
  });

  it("deletes immediately from the point editor", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderChart();
    await user.click(
      screen.getByRole("button", {
        name: "Edit 2 August 2026, 80.25 kilograms",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("2026-08-02");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
