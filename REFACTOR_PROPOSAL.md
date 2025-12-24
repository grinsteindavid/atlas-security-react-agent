# ATLAS Refactor Proposal

Based on analysis of trace `trace-2025-12-24T01-49-54-931Z.json` and codebase review.

## Current Score: 6.5/10

## Identified Issues

### Critical (P0)

#### P0-1: Static Assets Polluting Candidates Queue
**Location**: `src/tools.js:52-75`

**Problem**: `addCandidatesFromContent()` extracts paths from HTML/JS content but doesn't filter static assets. The agent then wastes requests POSTing to `.css`, `.js`, `.ico` files.

**Evidence from trace**:
- POST to `/styles.css` → returned HTML (SPA fallback)
- POST to `/runtime.js` → returned HTML
- POST to `/polyfills.js` → returned HTML
- POST to `/vendor.js` → returned HTML
- POST to `/favicon_js.ico` → returned HTML

**Fix**: Add static extension filter before adding to candidates.

---

#### P0-2: Path Selection Ignores LLM Decisions
**Location**: `src/graph.js:65-78`

**Problem**: `choosePath()` overrides LLM's requested path when it's "blocked" (same as last action or hit limit reached), falling back to random candidate from queue.

**Evidence from trace**:
- LLM requested `/api/Challenges` POST 5 times (hops 6,7,9,12,14,17)
- Agent diverted to static files instead
- LLM decisions effectively ignored after first few hops

**Fix**: When LLM path is blocked, either:
1. Skip iteration and re-query LLM
2. Filter candidates to API/auth paths only
3. Return null and handle gracefully in dispatcher

---

### Major (P1)

#### P1-1: No Error Recovery
**Location**: `src/tools.js:138-143` (and all tool functions)

**Problem**: Tool errors are recorded then re-thrown, crashing the entire run.

**Fix**: Catch errors in `dispatchTool()`, log them, continue loop.

---

#### P1-2: Zero Tool Diversity
**Location**: `src/graph.js:172-221`

**Problem**: No enforcement of tool variety. Trace shows:
- 14 POSTs, 6 GETs
- 0 `inspect_headers` calls
- 0 `provoke_error` calls
- 0 `measure_timing` calls

**Fix**: Force tool diversity (e.g., require `inspect_headers` every N hops).

---

#### P1-3: No Findings Extraction
**Location**: `src/reporter.js`

**Problem**: Reporter outputs raw observations but doesn't extract/dedupe security findings.

**Missed findings in trace**:
- CORS wildcard (`access-control-allow-origin: *`)
- Stack trace disclosure (500 errors with full Express stack)
- Missing HSTS header
- Auth error structure disclosure

**Fix**: Add `extractFindings()` function to aggregate and dedupe.

---

### Moderate (P2)

#### P2-1: Module-level State
**Location**: `src/tools.js:5`

**Problem**: `let requestCount = 0;` is module-level, not reset between runs.

**Fix**: Use `state.metrics.requests` (already exists) instead.

---

#### P2-2: Config Mismatch
**Location**: `src/config.js`

**Problem**: `MAX_HOPS=8` but `MAX_REQ_PER_RUN=80` creates inefficient budget usage.

**Fix**: Align defaults (e.g., `MAX_HOPS=40` for ~2 requests/hop average).

---

### Minor (P3)

#### P3-1: No Actual LangGraph Usage
**Location**: `src/graph.js`

**Problem**: README claims LangGraph architecture but code uses manual `while` loop.

**Fix**: Refactor to use `StateGraph` API for cleaner node/edge definitions.

---

## Implementation Plan

| Phase | Task | Files | Effort |
|-------|------|-------|--------|
| 1 | P0-1: Filter static assets | `tools.js` | 30 min |
| 1 | P0-2: Fix path selection | `graph.js` | 30 min |
| 2 | P1-1: Graceful error handling | `graph.js` | 20 min |
| 2 | P1-3: Findings aggregation | `reporter.js` | 40 min |
| 3 | P1-2: Tool diversity | `graph.js`, `state.js` | 30 min |
| 3 | P2-1: Remove module state | `tools.js` | 10 min |
| 3 | P2-2: Align config | `config.js` | 5 min |
| 4 | P3-1: LangGraph refactor | `graph.js` | 2 hours |

## Expected Outcomes

After refactor:
- No requests wasted on static files
- LLM tool/path decisions respected
- All 6 tools used in balanced manner
- Automatic finding extraction (CORS, HSTS, stack traces)
- Graceful error recovery
- Clean traces with actionable security insights

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Static file requests | 5/20 (25%) | 0% |
| Tool diversity | 2/6 tools | 5/6 tools |
| Findings extracted | 0 | Auto-detected |
| Error resilience | Crash on error | Continue |
