# Iteration 09 - Cursor SDK Runtime Adapter

> Planning note
> This iteration captures the first integration slice for Cursor's TypeScript SDK as a Hermit runtime.

This iteration adds a **Cursor SDK runtime spike and adapter foundation**.

The goal is to treat Cursor SDK as a programmable agent runtime, not as a terminal CLI that we scrape.

That means:
- use `@cursor/sdk` directly from TypeScript
- support local workspace execution first
- validate cloud mode and PR automation as a later phase
- keep Hermit's team/task/message contracts as the product-facing orchestration layer

---

## Core Goal

Add Cursor as a first-class runtime option behind Hermit's runtime adapter boundary.

Initial scope:
- prove the SDK can run a single local coding agent in the current workspace
- capture output/status/errors in a stable shape
- map the result into the existing team runtime abstractions
- expose enough UI/runtime metadata to make Cursor selectable in a later implementation slice

---

## Non-Goals

- Do not replace Claude Agent Teams as the default runtime.
- Do not ship cloud PR automation in the first slice.
- Do not assume Cursor SDK supports every Claude stream-json behavior one-to-one.
- Do not couple renderer components directly to `@cursor/sdk`.
- Do not add a second team/task protocol. Cursor remains an execution runtime under Hermit's board.

---

## Phase 0 - SDK Proof Script

Add a proof script:

```text
scripts/prove-cursor-sdk-runtime.mts
```

It should:
- import `Agent` from `@cursor/sdk`
- create a local agent in the current repo
- send a small prompt
- collect final output, error state, duration, and any run/session id exposed by the SDK
- avoid writing production files unless the prompt explicitly uses a temporary fixture

Success criteria:
- script can run from repo root
- failures produce actionable diagnostics: SDK missing, auth missing, unsupported runtime, network/cloud issue
- output format is easy to reuse in tests or debug logs

---

## Phase 1 - Runtime Capability Discovery

Add Cursor discovery alongside existing provider/runtime checks.

Detect:
- SDK package availability
- auth/login state if exposed
- local runtime availability
- model catalog or model ids if exposed
- cloud mode availability if exposed

Represent this as a provider readiness payload rather than UI-only state.

Open questions:
- Does the SDK expose explicit auth status?
- Does it expose supported models, including Composer model ids?
- Can local and cloud modes be distinguished cleanly before launch?

---

## Phase 2 - Minimal Runtime Adapter

Add a `cursor` runtime adapter implementing the same conceptual lifecycle used by other team runtimes:

- `prepare`
- `launch`
- `sendMessage`
- `stop` / cancel if supported
- `readRuntimeState`

Initial behavior:
- local mode only
- one lead-style agent only
- no teammate fan-out yet
- no cloud PR automation yet

The adapter should translate Cursor SDK events into Hermit runtime state:
- `starting`
- `running`
- `waiting`
- `completed`
- `failed`
- `cancelled`

---

## Phase 3 - Team Integration Slice

Once a single agent is proven:

- allow team lead runtime = Cursor local
- keep teammates disabled or explicitly marked unsupported until teammate semantics are designed
- persist launch identity with provider `cursor`
- show Cursor runtime details in launch diagnostics
- keep task board orchestration in Hermit

Important: the first team slice may be **solo/lead-only Cursor**. Full multi-member Cursor teams should be a follow-up iteration unless the SDK gives a clear multi-agent primitive.

---

## Phase 4 - Cloud Mode And PR Automation

After local mode works:

- add Cursor cloud mode option
- validate sandbox lifecycle
- surface run URL / PR URL if SDK exposes it
- support `autoCreatePR` as an explicit launch/task option
- map cloud task completion back to Hermit task comments and review flow

This phase is valuable because it aligns with Hermit's "task -> reviewable change" direction.

---

## Data And Contract Changes

Expected additions:

- `TeamProviderId` or runtime provider union includes `cursor`
- `TeamProviderBackendId` supports Cursor local/cloud if needed
- launch identity can persist Cursor model/runtime mode
- runtime diagnostics include SDK-level status and cloud/local mode

Keep public contracts small:

```ts
type CursorRuntimeMode = 'local' | 'cloud';

interface CursorRuntimeLaunchOptions {
  mode: CursorRuntimeMode;
  modelId?: string;
  autoCreatePR?: boolean;
}
```

Exact types should follow the real SDK surface after Phase 0.

---

## Risks

- SDK may require a different auth/session model than CLI runtimes.
- SDK may not expose stable streaming events or cancellation yet.
- Cloud mode may be network- and account-dependent, making tests flaky.
- Composer model ids may differ from public examples.
- Local workspace writes must stay inside expected project boundaries.

Mitigations:
- start with a proof script
- keep cloud behind explicit opt-in
- keep Cursor adapter isolated from renderer and existing Claude runtime code
- add tests around adapter state transitions using a fake SDK wrapper

---

## Definition Of Done

Iteration is done when:

- proof script can run and report clear success/failure
- Cursor SDK is wrapped behind a small main-process adapter boundary
- provider readiness can report Cursor availability
- a lead-only local Cursor run can be launched from main-process code
- output/errors are visible in existing runtime diagnostics
- no renderer component imports `@cursor/sdk` directly
- docs include the known SDK limitations and follow-up cloud/multi-agent work

