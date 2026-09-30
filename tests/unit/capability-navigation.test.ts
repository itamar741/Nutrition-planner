import { describe, expect, it, vi } from "vitest";
import { scrollCapabilityComposerIntoView } from "@/components/coach-workspace/capability-navigation";

describe("capability composer navigation", () => {
  it("smoothly reveals the composer without focusing it", () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    scrollCapabilityComposerIntoView({
      current: {
        scrollIntoView,
        focus,
        getBoundingClientRect: () =>
          ({ top: 100, bottom: 150, height: 50 }) as DOMRect,
      } as unknown as HTMLTextAreaElement,
    });

    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    expect(focus).not.toHaveBeenCalled();
  });
});
