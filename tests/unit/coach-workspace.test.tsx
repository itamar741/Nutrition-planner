import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoachWorkspace } from "@/components/coach-workspace/CoachWorkspace";
import { createNewDemoState, emptyProfile } from "@/data/demo-fixtures";
import { foodCatalog } from "@/data/food-catalog";
import { demoReducer, type DemoState } from "@/store/demo-reducer";

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

function installCloudFetch(
  onboarding: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
) {
  let state: DemoState = createNewDemoState();
  let version = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/demo/state/new" && !init?.method) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            profile: { profileId: "new", version, state },
            catalog: foodCatalog,
          }),
        };
      }
      if (url === "/api/demo/state/new" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as {
          action: Parameters<typeof demoReducer>[1];
        };
        state = demoReducer(state, body.action);
        version += 1;
        return {
          ok: true,
          json: async () => ({
            ok: true,
            profile: { profileId: "new", version, state },
          }),
        };
      }
      if (url === "/api/coach/message") {
        const legacy = await onboarding();
        const body = (await legacy.json()) as {
          profile?: DemoState["profile"];
          activeTurn?: DemoState["activeTurn"];
          targets?: DemoState["targets"];
          acknowledgement?: string;
        };
        if (body.profile && body.activeTurn) {
          state = {
            ...state,
            profile: body.profile,
            activeTurn: body.activeTurn,
            targets: body.targets ?? null,
            messages: [
              ...state.messages,
              {
                id: "user-agent",
                role: "user",
                text: "I am a 30 year old man, 180 cm and 80 kg.",
              },
              {
                id: "assistant-agent",
                role: "assistant",
                text: body.acknowledgement ?? "Saved.",
              },
            ],
          };
          version += 1;
        }
        return {
          ok: legacy.ok,
          headers: { get: () => "application/json" },
          json: async () => ({
            ok: true,
            profile: { profileId: "new", version, state },
          }),
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
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
    installCloudFetch(async () => {
      const body = await payload.json();
      body.commandId = "command-12345";
      return { ok: true, json: async () => body };
    });
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
    let resolveFetch:
      | ((value: { ok: boolean; json: () => Promise<unknown> }) => void)
      | undefined;
    installCloudFetch(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    render(<CoachWorkspace profileId="new" />);

    const input = screen.getByLabelText("Message to nutrition coach");
    await user.type(input, "I am 30.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(document.querySelector('[data-role="user"]')).toHaveTextContent(
      "I am 30.",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Thinking");
    expect(input).toBeDisabled();

    await act(async () => {
      resolveFetch?.({ ok: true, json: async () => ({}) });
    });
  });
});
