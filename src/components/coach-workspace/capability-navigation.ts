import type { RefObject } from "react";

export function scrollCapabilityComposerIntoView(
  composer: RefObject<HTMLTextAreaElement | null>,
) {
  window.requestAnimationFrame(() => {
    const target = composer.current;
    if (!target) return;
    target.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    window.requestAnimationFrame(() => {
      const bounds = target.getBoundingClientRect();
      if (bounds.top >= 0 && bounds.bottom <= window.innerHeight) return;
      const centeredTop =
        window.scrollY +
        bounds.top -
        window.innerHeight / 2 +
        bounds.height / 2;
      window.scrollTo({ top: Math.max(0, centeredTop), behavior: "smooth" });
    });
  });
}
