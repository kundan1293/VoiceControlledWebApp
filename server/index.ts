import "dotenv/config";
import express from "express";
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { z } from "zod";

const app = express();
const port = Number(process.env.PORT || 8787);
app.use(express.json({ limit: "64kb" }));

const linkSchema = z.object({
  id: z.string().max(32),
  label: z.string().max(180),
  href: z.string().url().max(2048),
});
const evaluateSchema = z.object({
  transcript: z.string().trim().min(1).max(12000),
  page: z.object({
    title: z.string().max(300),
    url: z.string().url().max(2048),
    links: z.array(linkSchema).max(100),
  }),
});

app.get("/api/health", (_request, response) => {
  response.json({ configured: Boolean(process.env.TYPESAFE_API_KEY) });
});

app.post("/api/evaluate", async (request, response) => {
  const parsed = evaluateSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid command or page context." });
    return;
  }
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    response.status(503).json({ error: "Set TYPESAFE_API_KEY in the local server environment." });
    return;
  }

  const { transcript, page } = parsed.data;
  const actions = {
    navigate: "Open a web address or website explicitly named in the spoken command.",
    search: "Search the web for a subject when no web address is given.",
    ...(page.links.length ? { click_link: "Click a visible link on the current page." } : {}),
    back: "Go to the previous page in browser history.",
    forward: "Go to the next page in browser history.",
    scroll_down: "Scroll the current page down.",
    scroll_up: "Scroll the current page up.",
    other: "The request is not one of the supported browser actions or is unclear.",
  };
  const linkOptions = Object.fromEntries(
    page.links.map((link) => [link.id, `${link.label} (${link.href})`]),
  );
  if (!Object.keys(linkOptions).length) linkOptions.no_links = "No visible links are available.";

  try {
    const client = new TypeSafeClient({ apiKey });
    const result = await client.systemOne({
      model: process.env.TYPESAFE_MODEL || "jev-latest",
      state: {
        spoken_command: transcript,
        current_page: { title: page.title, url: page.url },
        visible_links: page.links.map(({ id, label, href }) => ({ id, label, href })),
      },
      questions: {
        action: choice(
          "Which single supported browser action is the speaker asking for? Follow the literal request; do not infer an action that was not requested.",
          actions,
        ),
        target_link: choice(
          "If the speaker asks to click a link, which visible link do they mean? Match the spoken description to the link label and address. If no link matches or the speaker did not ask to click a link, choose no_links when available.",
          linkOptions,
        ),
      },
    });

    const action = result.answers.action;
    const target = result.answers.target_link;
    const selectedLink = page.links.find((link) => link.id === target.choice);
    response.json({
      proposal: {
        transcript,
        action: action.choice,
        confidence: action.confidence,
        ...(selectedLink
          ? { targetLink: selectedLink, targetConfidence: target.confidence }
          : {}),
        model: result.model,
        usage: result.usage,
      },
    });
  } catch (error) {
    console.error("Jev evaluation failed:", error instanceof Error ? error.message : "unknown error");
    response.status(502).json({ error: "Jev could not evaluate that command. Try again." });
  }
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Jev command service listening on http://127.0.0.1:${port}`);
});
