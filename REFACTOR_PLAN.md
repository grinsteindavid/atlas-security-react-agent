# ATLAS Agent Refactor Plan

## Overview
Refactor to address two key issues:
1. **Performance**: Sequential execution causes slow runs (~40-80s for 40 hops)
2. **Prompt Alignment**: System prompt doesn't match project's educational/hypothesis-first intent

---

## Phase 1: Cortex Prompt Refactor

### Problem
Current prompt is action-checklist focused, not hypothesis-first reasoning.

### Changes
- [x] Reframe as "learning attacker thinking" agent
- [x] Add explicit ReAct cycle guidance (Hypothesize → Plan → Act → Evaluate)
- [x] Add confidence calibration guidelines
- [x] Emphasize `thought`/`hypothesis` as primary learning artifacts
- [x] Remove prescriptive step-by-step strategy

### Files
- `src/cortex.js` - system prompt rewrite
- `src/constants.js` - add confidence calibration constants

---

## Phase 2: Batch Tool Execution

### Problem
One LLM call per tool = ~1-2s latency × 40 hops = slow.

### Changes
- [x] Modify schema to accept `next_actions[]` (array of tools) instead of single `next_tool`
- [x] Update `CortexResponseSchema` in cortex.js
- [x] Update `probeNode` to dispatch multiple tools
- [x] Execute independent HTTP requests in parallel via `Promise.all`

### Schema Change
```javascript
// Before
next_tool: z.enum(ALLOWED_TOOLS).optional(),
next_args: z.object({...}).optional(),

// After
next_actions: z.array(z.object({
  tool: z.enum(ALLOWED_TOOLS),
  args: z.object({
    path: z.string(),
    label: z.string().optional(),
    body: z.record(z.unknown()).optional(),
    control: z.record(z.unknown()).optional(),
    test: z.record(z.unknown()).optional(),
  }),
  rationale: z.string(), // Why this tool for this path?
})).min(1).max(5).optional(),
```

### Files
- `src/cortex.js` - schema + prompt update
- `src/graph.js` - `probeNode` parallel dispatch

---

## Phase 3: Parallel HTTP Execution

### Problem
Even with batched tools, sequential HTTP = wasted time.

### Changes
- [x] Create `dispatchToolsBatch()` function
- [x] Use `Promise.all()` for parallel execution
- [x] Aggregate observations from all results
- [x] Update metrics tracking for batch execution

### Files
- `src/graph.js` - new batch dispatch function

---

## Phase 4: State & Metrics Updates

### Changes
- [x] Track batch execution metrics
- [x] Add `batchSize` to decisions log
- [x] Update reporter to show batch stats

### Files
- `src/state.js` - optional batch tracking fields
- `src/reporter.js` - batch summary in trace

---

## Expected Outcomes

| Metric | Before | After |
|--------|--------|-------|
| LLM calls per run | ~40 | ~8-15 |
| Time per run | 60-90s | 20-40s |
| Reasoning quality | Action-list | Hypothesis-driven |
| Trace usefulness | Low | High (clear reasoning) |

---

## Implementation Order
1. Cortex prompt (no breaking changes)
2. Schema update (backward compatible with single action)
3. Batch dispatch in graph.js
4. Parallel HTTP
5. Update tests

---

## Rollback Plan
- Keep `next_tool`/`next_args` as fallback if `next_actions` empty
- Feature flag via env `ENABLE_BATCH_TOOLS=true`
