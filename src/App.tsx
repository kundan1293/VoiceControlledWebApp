import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AudioLines,
  Check,
  ChevronRight,
  CircleHelp,
  Globe2,
  Link2,
  LoaderCircle,
  Mic,
  MousePointer2,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  BrowserAction,
  CommandProposal,
  EvaluationRequest,
  EvaluationResponse,
  ExtensionRequest,
  ExtensionResponse,
  PageContext,
} from "./shared";

const API_BASE = import.meta.env.DEV ? "/api" : "http://127.0.0.1:8787/api";

interface SpeechResultEntry {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResultEntry>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
  available?: (options: {
    langs: string[];
    processLocally: boolean;
  }) => Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
}

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

function hasExtensionApi(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

async function sendExtension<T>(message: ExtensionRequest): Promise<T> {
  if (!hasExtensionApi()) throw new Error("Load the extension in Chrome or Edge to control a browser tab.");
  const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse<T>;
  if (!response?.ok) throw new Error(response?.error || "The browser extension did not respond.");
  return response.data;
}

function extractWebAddress(text: string): string | undefined {
  const match = text.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s]*)?/i);
  if (!match) return undefined;
  const candidate = match[0].replace(/[.,!?;:]+$/, "");
  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function searchTerms(text: string): string {
  return text
    .replace(/^\s*(please\s+)?(open|go to|navigate to|visit|search for|look up|find)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

const actionLabels: Record<BrowserAction, string> = {
  navigate: "Open website",
  search: "Search the web",
  click_link: "Click a page link",
  back: "Go back",
  forward: "Go forward",
  scroll_down: "Scroll down",
  scroll_up: "Scroll up",
  other: "Not understood",
};

const actionIcons: Record<BrowserAction, typeof Globe2> = {
  navigate: Globe2,
  search: Search,
  click_link: Link2,
  back: ArrowLeft,
  forward: ArrowRight,
  scroll_down: ArrowDown,
  scroll_up: ArrowUp,
  other: CircleHelp,
};

export default function App() {
  const [context, setContext] = useState<PageContext | null>(null);
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [speechPreparing, setSpeechPreparing] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [running, setRunning] = useState(false);
  const [proposal, setProposal] = useState<CommandProposal | null>(null);
  const [autoRun, setAutoRun] = useState(false);
  const [speechLanguage, setSpeechLanguage] = useState("en-US");
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");

  async function refreshContext() {
    if (!hasExtensionApi()) return;
    try {
      const page = await sendExtension<PageContext>({ type: "refresh-links" });
      setContext(page);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read the active tab.");
    }
  }

  useEffect(() => {
    void fetch(`${API_BASE}/health`)
      .then((response) => response.json() as Promise<{ configured: boolean }>)
      .then((health) => setApiConfigured(health.configured))
      .catch(() => setApiConfigured(false));

    if (hasExtensionApi()) {
      void sendExtension<PageContext>({ type: "get-context" })
        .then(setContext)
        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Browser connection failed."));
      void chrome.storage.local.get({ autoRunSafe: false }).then((settings) => {
        setAutoRun(Boolean(settings.autoRunSafe));
      });
    }

    return () => recognitionRef.current?.stop();
  }, []);

  async function connectCurrentSite() {
    if (!context?.originPattern || !hasExtensionApi()) return;
    setError("");
    try {
      const granted = await chrome.permissions.request({ origins: [context.originPattern] });
      if (!granted) {
        setError("Site access was not granted. The extension has not read or changed this page.");
        return;
      }
      await refreshContext();
      setMessage("Connected to this site");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not request site access.");
    }
  }

  async function evaluateCommand(commandText = transcript.trim()) {
    if (!commandText) return;
    if (!context) {
      setError("Open the extension popup on the page you want to control.");
      return;
    }
    if (!context.connected) {
      setError("Connect this site before asking Jev to inspect its links.");
      return;
    }

    setEvaluating(true);
    setError("");
    setMessage("");
    setProposal(null);
    try {
      const body: EvaluationRequest = {
        transcript: commandText,
        page: { title: context.title, url: context.url, links: context.links },
      };
      const response = await fetch(`${API_BASE}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as EvaluationResponse | { error?: string };
      if (!response.ok || !("proposal" in payload)) {
        throw new Error("error" in payload ? payload.error || "Jev evaluation failed." : "Jev evaluation failed.");
      }
      setProposal(payload.proposal);
      if (
        autoRun &&
        payload.proposal.action !== "click_link" &&
        payload.proposal.action !== "other" &&
        payload.proposal.confidence >= 0.86
      ) {
        await runProposal(payload.proposal, true);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Jev evaluation failed.");
    } finally {
      setEvaluating(false);
    }
  }

  async function runProposal(current: CommandProposal, automatic = false) {
    if (!context) return;
    if (current.action === "other") {
      setError("I couldn't map that phrase to a supported browser action. Try a direct command like ‘open example.com’ or ‘click the pricing link’.");
      return;
    }
    if (current.confidence < 0.55 || (current.action === "click_link" && (current.targetConfidence ?? 0) < 0.6)) {
      setError("Jev is uncertain about this command. Rephrase it or choose a link from the page before running it.");
      return;
    }

    let action = current.action;
    const request: Extract<ExtensionRequest, { type: "run-action" }> = {
      type: "run-action",
      action,
      pageUrl: context.url,
    };
    if (action === "navigate") {
      const address = extractWebAddress(current.transcript);
      if (address) request.url = address;
      else {
        action = "search";
        request.action = action;
        request.query = searchTerms(current.transcript);
      }
    } else if (action === "search") {
      request.query = searchTerms(current.transcript);
    } else if (action === "click_link") {
      if (!current.targetLink) {
        setError("Jev did not identify a visible link. Try naming the link text exactly.");
        return;
      }
      request.link = { href: current.targetLink.href, label: current.targetLink.label };
    }

    setRunning(true);
    setError("");
    setMessage("");
    try {
      await sendExtension(request);
      setMessage(automatic ? "Command executed" : `${actionLabels[action]} complete`);
      setProposal(null);
      if (action === "scroll_down" || action === "scroll_up") await refreshContext();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The browser action failed.");
    } finally {
      setRunning(false);
    }
  }

  async function startListening() {
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Speech recognition is not available in this browser. Type a command below instead.");
      return;
    }

    setSpeechPreparing(true);
    setTranscript("");
    finalTranscriptRef.current = "";
    setProposal(null);
    setError("");
    try {
      let processLocally = false;
      if (Recognition.available) {
        const availability = await Recognition.available({
          langs: [speechLanguage],
          processLocally: true,
        });
        if (availability === "available") {
          processLocally = true;
        } else if (availability === "downloadable") {
          if (!Recognition.install) {
            throw new Error("This browser can use offline speech after a language pack is installed, but it does not support pack installation here.");
          }
          setMessage(`Downloading the ${speechLanguage} offline speech pack. Tap to speak again when it finishes.`);
          const installed = await Recognition.install({
            langs: [speechLanguage],
            processLocally: true,
          });
          if (!installed) throw new Error(`The ${speechLanguage} offline speech pack could not be installed. Check your connection or use Chrome/Edge.`);
          setMessage(`Offline speech is ready for ${speechLanguage}. Tap to speak again.`);
          return;
        } else if (availability === "downloading") {
          setMessage(`The ${speechLanguage} offline speech pack is downloading. Tap to speak again when it finishes.`);
          return;
        }
      }

      const recognition = new Recognition();
      recognition.lang = speechLanguage;
      recognition.continuous = false;
      recognition.interimResults = true;
      if ("processLocally" in recognition) recognition.processLocally = processLocally;
      recognition.onresult = (event) => {
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result.isFinal) {
            finalTranscriptRef.current += `${result[0].transcript} `;
          } else {
            interim += result[0].transcript;
          }
        }
        setTranscript(`${finalTranscriptRef.current}${interim}`.trim());
      };
      recognition.onerror = (event) => {
        const detail = event.error === "not-allowed"
          ? "Microphone access was denied. Allow it in browser site settings."
          : event.error === "network"
            ? processLocally
              ? "On-device speech could not start. Try another installed language pack or type a command."
              : "The browser speech service could not connect. In the VS Code preview, open the extension popup in Chrome or Edge; otherwise check your connection or proxy. You can type a command below."
            : event.error === "audio-capture"
              ? "The browser could not access a microphone. Check your input device and microphone permissions."
              : event.error === "language-not-supported"
                ? `This browser does not support ${speechLanguage} speech recognition. Try another language.`
                : `Speech recognition error: ${event.error}`;
        setListening(false);
        setMessage("");
        setError(detail);
      };
      recognition.onend = () => {
        setListening(false);
        setMessage("");
        const completed = finalTranscriptRef.current.trim();
        if (completed) {
          setTranscript(completed);
          void evaluateCommand(completed);
        }
      };
      recognitionRef.current = recognition;
      setListening(true);
      setMessage(processLocally ? "Listening on this device" : "Listening through browser speech service");
      recognition.start();
    } catch (caught) {
      setListening(false);
      setMessage("");
      setError(caught instanceof Error ? caught.message : "Could not start speech recognition. Type a command instead.");
    } finally {
      setSpeechPreparing(false);
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  async function toggleAutoRun(checked: boolean) {
    setAutoRun(checked);
    if (hasExtensionApi()) await chrome.storage.local.set({ autoRunSafe: checked });
  }

  const ActionIcon = proposal ? actionIcons[proposal.action] : Sparkles;
  const host = context ? (() => {
    try {
      return new URL(context.url).hostname;
    } catch {
      return "Browser tab";
    }
  })() : "No active tab";
  const canEvaluate = Boolean(context?.connected && !evaluating && !running);

  return (
    <div className="app-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Jev Browser Control home">
          <span className="brand-mark"><AudioLines size={19} strokeWidth={2.4} /></span>
          <span><strong>JEV</strong><small>BROWSER CONTROL</small></span>
        </a>
        <div className={`system-state ${hasExtensionApi() ? "is-live" : "is-preview"}`}>
          <span className="state-dot" />
          {hasExtensionApi() ? "Extension linked" : "Preview mode"}
        </div>
      </header>

      <main className="workspace">
        <section className="command-column">
          <div className="eyebrow"><span>VOICE INTERFACE</span><span className="eyebrow-line" /></div>
          <h1>Say what you<br /><em>want done.</em></h1>
          <p className="intro-copy">Speak naturally. Jev maps your words to a browser action, then you stay in control.</p>

          <section className={`page-strip ${context?.connected ? "page-connected" : ""}`}>
            <div className="page-icon"><Globe2 size={18} /></div>
            <div className="page-details">
              <div className="page-overline">ACTIVE PAGE</div>
              <div className="page-title" title={context?.title || host}>{context?.title || host}</div>
              <div className="page-host">{host}{context?.connected ? ` · ${context.links.length} visible links` : " · access not granted"}</div>
            </div>
            {context?.connected ? (
              <button className="icon-button quiet" title="Refresh page links" onClick={() => void refreshContext()} aria-label="Refresh page links"><RefreshCw size={16} /></button>
            ) : context?.originPattern ? (
              <button className="connect-button" onClick={() => void connectCurrentSite()}><ShieldCheck size={15} /> Connect site</button>
            ) : (
              <span className="unsupported-badge">Unavailable</span>
            )}
          </section>

          {!hasExtensionApi() && (
            <div className="preview-note"><CircleHelp size={16} /><span>Load the unpacked extension in Chrome or Edge to connect a page and run browser actions.</span></div>
          )}

          <section className="voice-panel" aria-label="Voice command input">
            <div className="panel-topline"><span>COMMAND</span><label className="language-select"><Volume2 size={14} /><select value={speechLanguage} onChange={(event) => setSpeechLanguage(event.target.value)} aria-label="Speech recognition language"><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="en-IN">English (India)</option><option value="hi-IN">Hindi</option></select></label></div>
            <button className={`listen-button ${listening ? "listening" : ""}`} onClick={listening ? stopListening : () => void startListening()} aria-label={listening ? "Stop listening" : "Start listening"} disabled={speechPreparing}>
              <span className="listen-icon">{listening ? <Square size={18} fill="currentColor" /> : <Mic size={21} />}</span>
              <span className="listen-label">{speechPreparing ? "Preparing speech" : listening ? "Listening now" : "Tap to speak"}</span>
              <span className="listen-hint">{speechPreparing ? "Checking offline speech support" : listening ? "Tap to finish" : "Microphone stays off until you start"}</span>
              {listening && <span className="sound-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>}
            </button>
            <label className="transcript-label" htmlFor="command-text">TRANSCRIPT <span>{transcript.length ? "EDIT BEFORE RUNNING" : "OR TYPE A COMMAND"}</span></label>
            <textarea id="command-text" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Try ‘open example.com’ or ‘click the pricing link’" rows={3} maxLength={12000} />
            <div className="input-footer">
              <span className="privacy-note"><ShieldCheck size={13} /> Sent to Jev for intent only</span>
              <button className="analyze-button" onClick={() => void evaluateCommand()} disabled={!transcript.trim() || !canEvaluate}>
                {evaluating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={15} />}
                {evaluating ? "Understanding" : "Understand"}
                {!evaluating && <ChevronRight size={15} />}
              </button>
            </div>
          </section>

          {error && <div className="notice notice-error" role="alert"><X size={16} /><span>{error}</span></div>}
          {message && !error && <div className="notice notice-success" role="status"><Check size={16} /><span>{message}</span></div>}

          {proposal && (
            <section className="proposal-panel" aria-live="polite">
              <div className="proposal-heading"><div><div className="panel-kicker">JEV PROPOSAL</div><h2><ActionIcon size={19} /> {actionLabels[proposal.action]}</h2></div><button className="icon-button quiet" aria-label="Dismiss proposal" onClick={() => setProposal(null)}><X size={17} /></button></div>
              {proposal.targetLink && <div className="selected-link"><Link2 size={15} /><span>{proposal.targetLink.label}</span><small>{Math.round((proposal.targetConfidence ?? 0) * 100)}% match · {new URL(proposal.targetLink.href).hostname}</small></div>}
              <div className="confidence-row"><span>Decision confidence</span><strong>{Math.round(proposal.confidence * 100)}%</strong></div>
              <div className="confidence-track"><span style={{ width: `${Math.max(0, Math.min(100, proposal.confidence * 100))}%` }} /></div>
              <div className="proposal-meta"><span><span className="meta-dot" /> {proposal.model}</span><span>{proposal.usage.input_tokens.toLocaleString()} input tokens</span></div>
              <div className="proposal-actions">
                <button className="run-button" onClick={() => void runProposal(proposal)} disabled={running || proposal.action === "other" || proposal.confidence < 0.55 || (proposal.action === "click_link" && (!proposal.targetLink || (proposal.targetConfidence ?? 0) < 0.6))}>
                  {running ? <LoaderCircle size={16} className="spin" /> : <Play size={15} fill="currentColor" />}
                  {running ? "Running" : proposal.action === "click_link" && (proposal.targetConfidence ?? 0) < 0.6 ? "Clarify link target" : proposal.action === "click_link" ? "Review & click link" : "Run action"}
                </button>
                <button className="dismiss-button" onClick={() => setProposal(null)}>Dismiss</button>
              </div>
              {proposal.action === "click_link" && <p className="confirm-note">Link clicks always need your confirmation. Forms and buttons are never activated.</p>}
            </section>
          )}
        </section>

        <aside className="side-column">
          <section className="control-card">
            <div className="card-heading"><span className="card-index">01</span><span>CONTROL MODE</span></div>
            <div className="mode-title">Human-confirmed</div>
            <p>Nothing runs until you approve it. Link clicks always stay behind confirmation.</p>
            <label className="toggle-row">
              <span className="toggle-copy"><strong>Auto-run simple actions</strong><small>Navigate, search, scroll, back and forward at 86%+ confidence</small></span>
              <input type="checkbox" checked={autoRun} onChange={(event) => void toggleAutoRun(event.target.checked)} disabled={!hasExtensionApi()} />
              <span className="toggle-switch" aria-hidden="true" />
            </label>
          </section>

          <section className="control-card action-card">
            <div className="card-heading"><span className="card-index">02</span><span>AVAILABLE ACTIONS</span></div>
            <ul className="action-list">
              <li><Globe2 size={16} /><span>Open a website</span><code>navigate</code></li>
              <li><Search size={16} /><span>Search the web</span><code>search</code></li>
              <li><MousePointer2 size={16} /><span>Click a visible link</span><code>review first</code></li>
              <li><ArrowLeft size={16} /><span>Back / forward</span><code>history</code></li>
              <li><ArrowDownToLine size={16} /><span>Scroll up / down</span><code>page</code></li>
            </ul>
            <div className="safety-rule"><ShieldCheck size={15} /><span>No form submissions, purchases, or arbitrary scripts.</span></div>
          </section>

          <section className="connection-card">
            <div className="connection-top"><span className="connection-pulse" /><span>JEV DECISION ENGINE</span></div>
            <div className="connection-detail"><span>API status</span><strong className={apiConfigured ? "value-good" : "value-muted"}>{apiConfigured === null ? "Checking" : apiConfigured ? "Ready" : "Key required"}</strong></div>
            <div className="connection-detail"><span>Mic status</span><strong>{listening ? "Listening" : "Off by default"}</strong></div>
            <div className="connection-foot"><Sparkles size={13} /> Typed decisions. Code stays in control.</div>
          </section>
        </aside>
      </main>
      <footer className="bottomline"><span>JEV / VOICE BROWSER</span><span>Local control · explicit permission · visible actions</span></footer>
    </div>
  );
}
