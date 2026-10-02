# TypeSafe / Jev Project Reference

Distilled implementation reference for this project, based on the official TypeSafe documentation reviewed on 2026-10-02. This is a practical summary, not a verbatim copy or a replacement for the linked API reference. Recheck the official docs for changes before relying on version-specific limits or behavior.

Coverage: core concepts, HTTP API, JavaScript SDK, models, confidence, and documented Jev limitations were reviewed in detail. The cookbook index is cataloged with links and representative recipes were reviewed; this file does not reproduce every cookbook or the Python SDK reference. The emphasis is the JavaScript web-app integration surface.

## In one minute

TypeSafe's Jev is a **System One decision model**, not a chat, speech-recognition, text-generation, or code-generation model. Send textual state plus one or more typed questions; receive bounded answers, probability distributions, and token usage. Keep workflow, calculations, side effects, and final policy decisions in application code.

For a voice-controlled app, use a separate speech-to-text layer to transcribe audio. Jev can then classify the transcript, detect specific intents or constraints, and assign confidence-aware routing. Do not send audio directly: Jev accepts text only.

## Project integration rules

- Use TypeSafe from a trusted server/backend route. Never put `TYPESAFE_API_KEY` in browser JavaScript, client-side bundles, or a `VITE_*`/`NEXT_PUBLIC_*` variable. The JS SDK explicitly disables browser use by default because browser API keys are exposed to users; `dangerouslyAllowBrowser` is not appropriate for production secrets.
- Keep API credentials in server environment configuration. Do not log request bodies containing user speech/transcripts unless the product's privacy policy explicitly allows it.
- Keep TypeSafe question definitions and decision thresholds in a small, reviewable server module. Treat changes to instructions, criteria, model version, and thresholds as behavior changes.
- Let deterministic code handle exact parsing, permissions, arithmetic, state changes, and tool execution. Jev may say what a transcript likely means; application logic validates what actions are permitted.
- Use a separate transcription service for audio and pass only the minimum useful transcript/context to Jev. If transcription is uncertain, carry that uncertainty into the app's routing rather than treating the transcript as ground truth.

## HTTP API

Evaluation endpoint:

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer $TYPESAFE_API_KEY
Content-Type: application/json
```

Request top-level fields:

- `state` (required): string, JSON object, or array of text values; this is the material evaluated.
- `model` (required in raw HTTP): model ID or alias, normally `jev-latest`.
- `questions` (required): non-empty object keyed by application-chosen answer IDs. The IDs are for matching answers only; they are not sent to the model.

```json
{
  "state": { "transcript": "Move the lights in the kitchen to 30 percent." },
  "model": "jev-latest",
  "questions": {
    "intent": {
      "type": "choice",
      "instructions": "What action is the speaker requesting?",
      "criteria": {
        "set_brightness": "Set a light's brightness to a requested level",
        "turn_on": "Turn a light on without specifying a brightness",
        "other": "No supported smart-home action"
      }
    },
    "mentions_room": {
      "type": "noul",
      "instructions": "Does the transcript name a room?"
    },
    "urgency": {
      "type": "score",
      "instructions": "How urgent is the request?",
      "criteria": ["Routine request", "Time-sensitive", "Immediate emergency"]
    }
  }
}
```

One response entry appears in `answers` for every input question ID. The response also contains the resolved versioned `model` and `usage.input_tokens` / `usage.output_tokens`. Log the response model if reproducibility matters.

### Question and answer shapes

| Type | Use when | Question fields | Answer fields |
| --- | --- | --- | --- |
| `choice` | Exactly one member of a known unordered set is needed | `type`, `instructions`, `criteria` map | `type`, `choice`, `probabilities` map, `confidence` |
| `score` | A position on an ordered, described scale is needed | `type`, `instructions`, `criteria` array | `type`, `score`, `legend`, `probabilities` map, `confidence` |
| `noul` | One clearly worded yes/no proposition is needed | `type`, `instructions`, optional `criteria.true` / `criteria.false` | `type`, `noul` in [0, 1] |

`Choice` permits up to 255 options. Use an `other`/`none` option if the input may not fit the taxonomy. A `Score` needs 2-10 ordered levels; level indices start at 0. Its `score` is an expected position and can be fractional, not an exact measurement. A `Noul` value is probability of **yes**, not a degree scale; it has no separate `confidence` field. For Noul thresholding, a value near 0.5 indicates ambiguity.

Choice and Score probabilities cover all supplied outcomes and sum to 1. Choice `choice` is the highest-probability label. Score probabilities use string-number level keys in raw JSON and `legend` maps those indices back to the supplied criteria. SDKs may expose numeric keys/types.

## TypeScript / JavaScript SDK

Official package: `@typesafe-ai/sdk`; documented minimum Node.js version: 20.

```sh
npm install @typesafe-ai/sdk
```

```ts
import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient(); // reads TYPESAFE_API_KEY

const result = await client.systemOne({
  state: { transcript: "Turn off the bedroom lights." },
  questions: {
    intent: choice("What action is requested?", {
      turn_off: "Turn one or more lights off",
      turn_on: "Turn one or more lights on",
      other: "Another or unsupported request",
    }),
    safety_check: noul("Does the request ask to unlock an exterior door?"),
    complexity: score("How complex is the requested action?", [
      "One direct device action",
      "Several related actions",
      "Ambiguous or unsupported multi-step request",
    ]),
  },
});

const intent = result.answers.intent.choice;
const confidence = result.answers.intent.confidence;
const transcriptFlag = result.answers.safety_check.noul;
console.log({ intent, confidence, transcriptFlag, model: result.model, usage: result.usage });
```

The SDK infers answer types from question IDs and criteria. `systemOne(request, options?)` takes `state`, non-empty `questions`, and optional `model`. A configured `defaultModel` is inherited when the request omits the model. Questions and Score criteria receive local validation; the server can still reject invalid input.

Client config supported by the current JS reference:

- `apiKey`: explicit key; otherwise `TYPESAFE_API_KEY`.
- `baseURL`: otherwise `TYPESAFE_BASE_URL`, then `https://api.typesafe.ai`.
- `defaultModel`: otherwise `TYPESAFE_DEFAULT_MODEL`, then `jev-latest`.
- `timeout`: milliseconds per attempt; default 10,000. This is not a total retry budget.
- `retry`: partial retry-policy overrides.
- `defaultHeaders`, `fetch`, `logger`, `logLevel`: transport/logging customization. Default log level is `warn`; `info` logs request summaries; `debug` can log headers and bodies. Credential headers are redacted, but bodies are not.
- `dangerouslyAllowBrowser`: defaults false; enabling it exposes the API key and should not be used for production secrets.

Per-call `RequestOptions` allow `timeout`, partial `retry`, `headers`, and `signal` (`AbortSignal`). Per-call headers override client defaults. The SDK retry defaults documented are: 2 retries after the initial attempt; retry connection/timeouts and HTTP 408, 429, and 500-599; exponential delay starting at 500ms, max 5000ms, 25% jitter; honor `Retry-After` and `retry-after-ms` up to 60,000ms. Retry policy is configurable; do not retry non-retryable validation/auth errors blindly.

The SDK also supports model listing. `GET https://api.typesafe.ai/v1/models` (or the SDK's `client.models.list()`) returns `models` with `name`, `description`, and `release_date`.

## Model and operational facts

As documented for Jev 1.13:

- `jev-latest` resolves to the most recent stable release; on the review date it resolved to `jev-1.13.0`.
- `jev-preview` is allowed to move ahead of stable, but the docs said it pointed to the same release at review time.
- Alias targets can change. Pin a versioned model ID if a threshold is calibrated to a specific release. Record `response.model` regardless.
- Price listed: $0.042 per million input tokens; output tokens free. These values and limits can change; confirm current pricing before launch.
- Listed rate limit: 100,000 tokens/second and 40 requests/second, subject to dynamic adjustment. SDK retries back off and honor retry headers.
- Context: 64k tokens total across state plus all questions, with a 32k budget for state plus the longest question.
- Text only; English is the primary/best-supported language. Other languages are supported with lower or variable accuracy; test the actual workload.
- TypeSafe says customer data is not used to train Jev. Legal docs describe retention/data handling; zero data retention is available for enterprise customers. Review the DPA and privacy policy for requirements applicable to this app. Do not infer that all plans have zero retention.
- Jev is not customer-fine-tuned or LoRA-adapted. Adapt behavior through state, instructions, and criteria.

## Design questions that work

1. **Keep one question to one judgment.** Ask a crisp, literal question. Split multi-factor judgments into independent questions and compose them in code.
2. **Choose the primitive that matches the answer.** Closed set = Choice; ordered spectrum = Score; proposition = Noul.
3. **Make rubrics concrete.** Describe observable situations, not bare numbers or vague adjectives. Score levels are judged individually; the model does not see neighboring levels. Keep dimensions distinct and order low to high.
4. **Use structure when it clarifies.** `state`, `instructions`, and criteria can be JSON objects/arrays. Put a question in a named field and its supporting data in separate fields; reference state paths explicitly in backticks, e.g. ``Does `ticket.messages[0].text` request a refund?``
5. **Send the useful context only.** Put related evidence into one structured state, but filter irrelevant records in code. Large, irrelevant state distracts and can reduce accuracy.
6. **Batch independent questions.** All questions in a request use the same state, run independently/in parallel, and may mix types. Include speculative questions if their answers might be needed; ignore irrelevant answers in code. This can avoid repeat transmission of the same state. One question cannot depend on another answer in the same request. Make a second request only when the first result is required to construct/fetch the next state or question set.
7. **Treat confidence as a signal, not a guarantee.** Route high/medium/low confidence to automatic action, confirmation/review, or fallback according to action risk. Calibrate thresholds against labeled examples from this application's real traffic.
8. **Preserve probabilities.** Confidence compresses information. Use full probabilities when ranking, inspecting close alternatives, routing on a runner-up, or combining signals.
9. **Keep semantics consistent.** Do not assume equivalent-looking separate questions are mathematically consistent. A Choice over alternatives is relative; independent Nouls are absolute and may all be low. Negated questions are not guaranteed to sum to one.
10. **Validate before actions.** Jev chooses/assesses; code must enforce allowed devices, user permissions, confirmation for risky actions, and all exact business rules.

Structured option/level/yes-no criteria may be strings, objects, arrays, or null. Use objects for boundary definitions such as `what`, `not_for`, and `examples`; field names are ordinary model-visible labels, not special API keywords. Start simple and add examples only when test data shows a real ambiguity.

### Confidence formulas (documented)

For a Noul with yes probability $p$, a comparable confidence measure is $|2p - 1|$; the API itself returns only `noul`.

For Choice with $n$ options and maximum probability $p_{max}$:

$$\text{confidence} = \frac{p_{max} - 1/n}{1 - 1/n}$$

For Score with $n$ levels, probabilities $p_i$, and most likely level $m$:

$$\text{confidence} = \max\left(0, 1 - \frac{\sum_i p_i |i-m|}{\frac{1}{n}\sum_i |i-(n-1)/2|}\right)$$

Confidence is derived from the distribution; it is not an independent correctness guarantee. The score is the expected level index, $\sum_i i p_i$. Different distributions can yield the same score.

## Known weak spots and mitigations

The Jev 1.13 limitations page (last reviewed 2026-09-17) calls out these failure modes. Assume they can change between releases and verify against current docs and a project-specific test set.

- Exact math, counting, numeric precision, and date/time ordering/differences: compute in code. Use Jev only to judge semantic categories or extract bounded components; validate and assemble exact values in code.
- Literal wording, negation, and indirect/multi-hop questions: write the exact condition, name the relevant state fields, align instructions with criteria, and split reasoning into atomic questions.
- Large state with irrelevant detail: filter/retrieve first and send only relevant fields.
- Adversarial/injected content: state is not inherently treated as hostile. Test prompt-injection examples; do not let model output itself authorize a consequential action.
- Structural invariants across questions are not guaranteed; do not assume complements or identical semantics produce arithmetic-consistent probabilities.
- Text generation: Jev is not a generator. Use a generative model or deterministic code for free-form output.

For voice specifically, test transcription errors, numbers/units, negations ("don't turn off"), homophones, ambiguous targets, multiple commands, and out-of-domain speech. Exact device name resolution and action execution belong to application code; request clarification or human confirmation when intent/target confidence is inadequate.

## Errors and production handling

HTTP errors documented:

- `401`: missing/invalid API key; fix credentials rather than retrying.
- `422`: invalid request/question schema; fix the named field.
- `429`: rate limit; back off, honoring retry headers.
- `529`: service overloaded; retry after delay.
- SDK also reports API/connection/timeout/abort failures with typed errors. Catch errors at the backend boundary, map them to controlled app responses, and avoid leaking credentials or internal error bodies to the browser.

The JS SDK retries selected transient failures by default. For direct HTTP calls, implement bounded exponential backoff and respect `Retry-After`/`retry-after-ms`. Keep retries bounded and make side effects idempotent; model evaluation itself is a POST but does not execute the chosen app action.

## Recommended project workflow

- Keep speech-to-text, TypeSafe evaluation, policy/routing, and device/action execution as separate layers.
- Define question templates in one server-side module. Avoid constructing unconstrained question text from untrusted input where fixed questions/options suffice.
- Include only relevant transcript, device inventory, and relevant application context in `state`; never rely on Jev's hidden world knowledge for current device state or policies.
- Start with a Choice for command intent, Nouls for independent safety/constraint checks, and Score only where a genuinely ordered rubric is useful. Keep extraction bounded; use Choice over candidate device/action values rather than asking Jev to generate arbitrary identifiers.
- Return the model's structured assessment to server-side decision code; validate chosen device IDs/actions against the authoritative inventory and authorization rules.
- Set conservative confidence/probability thresholds, ask users to confirm risky/ambiguous actions, and have a fallback for no-match/other cases.
- Build a small labeled evaluation set from real expected transcripts. Measure wrong-action and missed-action rates per intent and per action risk; tune criteria and thresholds on held-out examples. Re-test when changing model alias/version, speech recognizer, question text, state shape, or criteria.
- Track model version, token usage, latency, errors, and decisions without storing raw transcripts longer than the privacy policy permits.

## Documentation map

Core references:

- [Introduction](https://docs.typesafe.ai/introduction) and [Quick start](https://docs.typesafe.ai/introduction/quickstart)
- [System One](https://docs.typesafe.ai/concepts/system-one), [State](https://docs.typesafe.ai/concepts/state), [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
- [Primitives](https://docs.typesafe.ai/primitives), [Choice](https://docs.typesafe.ai/primitives/choice), [Score](https://docs.typesafe.ai/primitives/score), [Noul](https://docs.typesafe.ai/primitives/noul), [Advanced structure](https://docs.typesafe.ai/primitives/advanced)
- [Confidence](https://docs.typesafe.ai/confidence), [Patterns](https://docs.typesafe.ai/patterns): [fan-out](https://docs.typesafe.ai/patterns/fan-out), [confidence routing](https://docs.typesafe.ai/patterns/confidence-routing), [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring), [intent routing](https://docs.typesafe.ai/patterns/intent-routing)
- [HTTP API](https://docs.typesafe.ai/api), [Models](https://docs.typesafe.ai/models), [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript), [JavaScript API reference](https://docs.typesafe.ai/sdk/javascript/api)
- [AI primer](https://docs.typesafe.ai/introduction/machine-learning-primer), [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13), [Legal/data handling](https://docs.typesafe.ai/legal), [Agent skill](https://docs.typesafe.ai/agent-skill)

Cookbook catalog (worked examples):

- [Self-consistency: Nouls](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook), [Self-consistency: Choices](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook), [Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions)
- [Re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe), [Line-by-line search](https://docs.typesafe.ai/cookbooks/semantic_find), [Structure recovery](https://docs.typesafe.ai/cookbooks/autoformat)
- [Function calling](https://docs.typesafe.ai/cookbooks/function_calling), [Skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion), [Entity alignment](https://docs.typesafe.ai/cookbooks/entity_alignment), [Classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages), [Double-checking citations](https://docs.typesafe.ai/cookbooks/citation_check), [LLM guardrails](https://docs.typesafe.ai/cookbooks/llm_guardrails)
- [SDE cascade](https://docs.typesafe.ai/cookbooks/sde_cascade), [Date extraction](https://docs.typesafe.ai/cookbooks/date_extraction_cookbook), [Pre-parsed value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook)
- [Hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification), [Autoresearch feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery), [Classification using confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence)
- [Smart home demo](https://docs.typesafe.ai/demos/smart-home)

Use the cookbook closest to a task for examples; do not copy its old model alias, prices, thresholds, or benchmark figures without checking their date and validating against this project.

## Official source of truth

- Documentation index: https://docs.typesafe.ai/llms.txt
- Human-readable docs: https://docs.typesafe.ai/
- API reference: https://docs.typesafe.ai/api
- JavaScript SDK API reference: https://docs.typesafe.ai/sdk/javascript/api
- Console / API keys: https://console.typesafe.ai/keys

When this reference disagrees with current official docs, prefer the official docs and update this file.
