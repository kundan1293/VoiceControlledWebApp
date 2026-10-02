import type { LinkItem } from "../shared";

type ContentMessage =
  | { type: "collect-links" }
  | { type: "click-link"; href: string; label: string }
  | { type: "scroll"; direction: "up" | "down" };

function collectLinks(): LinkItem[] {
  const links: LinkItem[] = [];
  const anchors = document.querySelectorAll<HTMLAnchorElement>("a[href]");

  for (const anchor of anchors) {
    if (links.length >= 100) break;
    const style = getComputedStyle(anchor);
    if (
      !anchor.getClientRects().length ||
      style.display === "none" ||
      style.visibility === "hidden"
    ) {
      continue;
    }

    let url: URL;
    try {
      url = new URL(anchor.href);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;

    const label = (anchor.getAttribute("aria-label") || anchor.title || anchor.innerText)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    if (!label) continue;
    links.push({ id: `link-${links.length}`, label, href: url.href });
  }
  return links;
}

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  if (message.type === "collect-links") {
    sendResponse({ links: collectLinks() });
    return;
  }

  if (message.type === "click-link") {
    const match = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].find(
      (anchor) =>
        anchor.href === message.href &&
        (anchor.getAttribute("aria-label") || anchor.title || anchor.innerText)
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180) === message.label,
    );
    if (!match || !match.getClientRects().length) {
      sendResponse({ ok: false, error: "That link is no longer visible on this page." });
      return;
    }
    match.click();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "scroll") {
    window.scrollBy({ top: message.direction === "down" ? window.innerHeight * 0.75 : -window.innerHeight * 0.75, behavior: "smooth" });
    sendResponse({ ok: true });
  }
});
