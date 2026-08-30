import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoachWorkspace } from "@/components/coach-workspace/CoachWorkspace";
import { emptyProfile } from "@/data/demo-fixtures";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function successResponse() {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      commandId: expect.any(String),
      profile: {
        ...emptyProfile,
        age: 30,
        equationSex: "male",
        heightCm: 180,
        currentWeightKg: 80,
      },
      activeTurn: {
        type: "closed_question",
        id: "choose-goal",
        field: "goal",
        prompt: "Which nutrition goal should this fixed plan support?",
        options: [
          {
            id: "goal-fat-loss",
            label: "Fat Loss",
            patch: { goal: "fat_loss" },
          },
          {
            id: "goal-maintenance",
            label: "Maintenance",
            patch: { goal: "maintenance" },
          },
        ],
      },
      targets: null,
      acknowledgement: "I captured those four details.",
    }),
  };
}

describe("CoachWorkspace", () => {
  it("UI-01 starts with text enabled and no quick replies", () => {
    render(<CoachWorkspace profileId="new" />);

    expect(screen.getByLabelText("Message to nutrition coach")).toBeEnabled();
    expect(screen.queryByLabelText("Quick replies")).not.toBeInTheDocument();
  });

  it("UI-02 switches to quick replies and disables free text", async () => {
    const user = userEvent.setup();
    const payload = successResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        const body = await payload.json();
        body.commandId = "command-12345";
        return { ok: true, json: async () => body };
      }),
    );
    render(<CoachWorkspace profileId="new" />);

    await user.type(
      screen.getByLabelText("Message to nutrition coach"),
      "I am a 30 year old man, 180 cm and 80 kg.",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByLabelText("Quick replies")).toBeInTheDocument();
    expect(screen.getByLabelText("Message to nutrition coach")).toBeDisabled();
    expect(screen.getByText("Body basics").closest("li")).toHaveTextContent(
      "Body basics",
    );
  });

  it("UI-05 locks input while processing and keeps the submitted message visible", async () => {
    const user = userEvent.setup();
    let resolveFetch: ((value: unknown) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    render(<CoachWorkspace profileId="new" />);

    const input = screen.getByLabelText("Message to nutrition coach");
    await user.type(input, "I am 30.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(document.querySelector('[data-role="user"]')).toHaveTextContent(
      "I am 30.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reviewing your details",
    );
    expect(input).toBeDisabled();

    await act(async () => {
      resolveFetch?.({ ok: true, json: async () => ({}) });
    });
  });
});
