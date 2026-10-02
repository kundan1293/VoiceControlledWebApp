export interface LinkItem {
  id: string;
  label: string;
  href: string;
}

export interface PageContext {
  tabId: number;
  title: string;
  url: string;
  originPattern: string | null;
  connected: boolean;
  links: LinkItem[];
}

export type BrowserAction =
  | "navigate"
  | "search"
  | "click_link"
  | "back"
  | "forward"
  | "scroll_down"
  | "scroll_up"
  | "other";

export interface CommandProposal {
  transcript: string;
  action: BrowserAction;
  confidence: number;
  targetLink?: LinkItem;
  targetConfidence?: number;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export type ExtensionRequest =
  | { type: "get-context" }
  | { type: "refresh-links" }
  | {
      type: "run-action";
      action: BrowserAction;
      pageUrl: string;
      url?: string;
      query?: string;
      link?: Pick<LinkItem, "label" | "href">;
    };

export type ExtensionResponse<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface EvaluationRequest {
  transcript: string;
  page: Pick<PageContext, "title" | "url" | "links">;
}

export interface EvaluationResponse {
  proposal: CommandProposal;
}
