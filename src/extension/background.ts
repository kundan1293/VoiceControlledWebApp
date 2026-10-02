import type {
  ExtensionRequest,
  ExtensionResponse,
  LinkItem,
  PageContext,
} from "../shared";

function originPattern(urlText: string): string | null {
  try {
    const url = new URL(urlText);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No controllable page is active.");
  return tab;
}

async function collectLinks(tabId: number): Promise<LinkItem[]> {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: "collect-links" });
    return result?.links ?? [];
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["assets/content.js"] });
    const result = await chrome.tabs.sendMessage(tabId, { type: "collect-links" });
    return result?.links ?? [];
  }
}

async function getContext(): Promise<PageContext> {
  const tab = await activeTab();
  const url = tab.url!;
  const scope = originPattern(url);
  const connected = scope
    ? await chrome.permissions.contains({ origins: [scope] })
    : false;
  let links: LinkItem[] = [];
  if (connected && tab.id) links = await collectLinks(tab.id);

  return {
    tabId: tab.id!,
    title: tab.title || new URL(url).hostname,
    url,
    originPattern: scope,
    connected,
    links,
  };
}

function requireSafeWebUrl(urlText: string): string {
  const url = new URL(urlText);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS addresses can be opened.");
  }
  return url.href;
}

async function executeAction(message: Extract<ExtensionRequest, { type: "run-action" }>) {
  const tab = await activeTab();
  if (!tab.id) throw new Error("The active tab is unavailable.");
  if (tab.url !== message.pageUrl) {
    throw new Error("The active page changed after this proposal. Please speak the command again.");
  }

  if (message.action === "navigate") {
    if (!message.url) throw new Error("No web address was identified in the command.");
    await chrome.tabs.update(tab.id, { url: requireSafeWebUrl(message.url) });
    return { status: "Opening address" };
  }
  if (message.action === "search") {
    if (!message.query?.trim()) throw new Error("No search terms were identified.");
    await chrome.tabs.update(tab.id, {
      url: `https://www.google.com/search?q=${encodeURIComponent(message.query.trim())}`,
    });
    return { status: "Searching the web" };
  }
  if (message.action === "back") {
    await chrome.tabs.goBack(tab.id);
    return { status: "Going back" };
  }
  if (message.action === "forward") {
    await chrome.tabs.goForward(tab.id);
    return { status: "Going forward" };
  }

  const scope = originPattern(tab.url || "");
  if (!scope || !(await chrome.permissions.contains({ origins: [scope] }))) {
    throw new Error("Connect this site before controlling its page.");
  }
  await collectLinks(tab.id);

  if (message.action === "click_link") {
    if (!message.link) throw new Error("No matching visible link was selected.");
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "click-link",
      href: message.link.href,
      label: message.link.label,
    });
    if (!result?.ok) throw new Error(result?.error || "The link could not be clicked.");
    return { status: "Link clicked" };
  }

  if (message.action === "scroll_down" || message.action === "scroll_up") {
    const direction = message.action === "scroll_down" ? "down" : "up";
    await chrome.tabs.sendMessage(tab.id, { type: "scroll", direction });
    return { status: direction === "down" ? "Scrolled down" : "Scrolled up" };
  }

  throw new Error("This command is not supported.");
}

async function handle(request: ExtensionRequest): Promise<ExtensionResponse<unknown>> {
  try {
    if (request.type === "get-context" || request.type === "refresh-links") {
      return { ok: true, data: await getContext() };
    }
    if (request.type === "run-action") {
      return { ok: true, data: await executeAction(request) };
    }
    return { ok: false, error: "Unknown extension request." };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Browser action failed.",
    };
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionRequest, _sender, sendResponse: (response: ExtensionResponse<unknown>) => void) => {
    void handle(message).then(sendResponse);
    return true;
  },
);
