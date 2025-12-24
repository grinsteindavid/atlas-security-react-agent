# Evidence Context Refactor Plan

## Problem

The Cortex (LLM reasoning node) lacks sufficient context to make well-informed decisions:

| Gap | Impact |
|-----|--------|
| No findings summary | Re-investigates same issues |
| No session/cookie state | Can't reason about auth |
| No error history | Retries failed requests |
| No hypothesis tracking | Can't evaluate past reasoning |

---

## Phase 1: Findings Summary

### Problem
Reporter extracts findings, but LLM never sees them during the run.

### Solution
Extract findings incrementally and include summary in Cortex context.

### Changes
- [x] Export `extractFindings` for use during run (not just at report time)
- [x] Add `currentFindings` summary to Cortex user message
- [x] Deduplicate so LLM sees unique issues only

### Files
- `src/cortex.js` — add findings to context
- `src/reporter.js` — already exports `extractFindings`

---

## Phase 2: Session/Cookie State

### Problem
Cookie jar exists but LLM has no visibility into auth state.

### Solution
Expose cookie summary and auth indicators to Cortex.

### Changes
- [x] Create `getSessionSummary()` helper in httpClient.js
- [x] Extract key cookies (session tokens, auth flags)
- [x] Add `sessionState` to Cortex context

### Files
- `src/httpClient.js` — add session summary export
- `src/cortex.js` — include in context

---

## Phase 3: Error History

### Problem
`metrics.errors[]` exists but not sent to LLM.

### Solution
Include recent errors so LLM can avoid retrying failed paths.

### Changes
- [x] Add `recentErrors` (last 5) to Cortex context
- [x] Include path, tool, and error message

### Files
- `src/cortex.js` — add to user message

---

## Phase 4: Hypothesis Tracking

### Problem
LLM generates hypotheses but can't see if past ones were confirmed/refuted.

### Solution
Track hypothesis outcomes in state and feed back to LLM.

### Changes
- [x] Add `hypothesisLog` to state with outcome tracking
- [x] After each hop, mark hypothesis as: pending/supported/refuted
- [x] Include recent hypothesis outcomes in Cortex context

### Files
- `src/state.js` — add hypothesisLog
- `src/graph.js` — update hypothesis outcomes
- `src/cortex.js` — include in context

---

## Implementation Order

1. **Findings summary** (highest impact, easiest)
2. **Error history** (quick win)
3. **Session state** (medium complexity)
4. **Hypothesis tracking** (most complex)

---

## Expected Outcomes

| Metric | Before | After |
|--------|--------|-------|
| Duplicate investigations | Common | Rare |
| Auth-aware decisions | No | Yes |
| Failed path retries | Frequent | Avoided |
| Hypothesis continuity | None | Tracked |

---

## New Context Structure

```javascript
{
  // Existing
  observations: [...],
  remainingBudget,
  remainingHops,
  visitedPaths,
  candidates,
  candidateScores,
  lastDecisions,
  pathStatsSummary,
  captcha,
  
  // NEW
  currentFindings: [
    { type, subtype, severity, path, owasp }
  ],
  sessionState: {
    hasCookies: true,
    cookieCount: 3,
    authIndicators: ["token", "session"]
  },
  recentErrors: [
    { path, tool, error }
  ],
  hypothesisOutcomes: [
    { hypothesis, owasp, outcome: "supported|refuted|pending" }
  ]
}
```
