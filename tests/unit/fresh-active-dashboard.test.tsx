import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FreshActiveDashboard } from "@/components/coach-workspace/FreshActiveDashboard";
import { foodCatalog } from "@/data/food-catalog";
import { demoReducer } from "@/store/demo-reducer";
import { makeReadyState, makeValidDraft } from "../fixtures/turn-2";

function activeState() {
  const draft = makeValidDraft("fresh-dashboard");
  return demoReducer(
    { ...makeReadyState(), draft },
    {
      type: "activate_draft",
      commandId: "activate-dashboard",
      proposalId: draft.id,
      activatedAt: "2026-09-10T08:00:00.000Z",
    },
  );
}

function renderDashboard(state = activeState(), overrides = {}) {
  const props = {
    state,
    catalog: [...foodCatalog],
    activities: [],
    cloudError: "",
    agentBusy: false,
    agentStatusText: "Thinking…",
    pendingAgentText: "",
    streamingText: "",
    messageInput: "",
    onMessageInput: vi.fn(),
    onSendMessage: vi.fn(),
    onAgentAction: vi.fn(),
    onReset: vi.fn(),
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onRecordWeight: vi.fn(),
    onEditWeight: vi.fn(),
    onDeleteWeight: vi.fn(),
    ...overrides,
  };
  render(<FreshActiveDashboard {...props} />);
  return props;
}

describe("FreshActiveDashboard", () => {
  it("shows the same active-plan, transparency, weight, chat, and food areas", () => {
    renderDashboard();

    expect(screen.getByText("Personal profile · active plan")).toBeVisible();
    expect(screen.getByText("Fixed goal")).toBeVisible();
    expect(
      screen.getByLabelText("How your nutrition plan works"),
    ).toBeVisible();
    expect(screen.getByLabelText("Weight tracking")).toBeVisible();
    expect(screen.getByText("Active Plan", { exact: true })).toBeVisible();
    expect(screen.getByText("Coach conversation")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /\d+ approved foods/ }),
    ).toBeVisible();
  });

  it("keeps one approval control beside the chat when a revised Draft is pending", async () => {
    const user = userEvent.setup();
    const state = activeState();
    const draft = {
      ...makeValidDraft("fresh-revision"),
      basePlanVersion: state.activePlan?.version ?? 1,
    };
    const onApprove = vi.fn();
    renderDashboard({ ...state, draft }, { onApprove });

    const approve = screen.getByRole("button", { name: "Approve & activate" });
    expect(approve).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Approve & activate" }),
    ).toHaveLength(1);
    await user.click(approve);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
