# Anti Red-Tag 2.0.1 verification

Verified on 29 October 2026 in isolated profiles. The previous two-tab version is archived and is not used by this version or these tests.

| Checks | Result |
| --- | --- |
| Brand, single-tab scope, manifest references, resources, syntax, CSP structure | Passed |
| Logic and injected browser/storage failures | 34 passed |
| Chromium interactive UI, icon consistency, keyboard controls, stale-response and retry tests | 9 passed |
| Chromium real browser scenarios | 20 passed |
| Opera GX 138.0.6044.45 real browser scenarios | 20 passed |
| Development dependency audit | 0 known vulnerabilities reported |

The browser suites load the production manifest to verify its opt-in permission boundary, then use a temporary copy granted only localhost access for injection tests. The shipped manifest has no default host grants or global content scripts.

## Off and emergency-stop regressions

The reported failure was reproduced before the fix. A cleanup exception left `enabled` true, allowing future navigation events to apply protection again. A second reproduced path skipped cleanup when its saved document list was missing. A real-browser check also showed that simply restoring native properties did not notify website listeners that had missed the suppressed visibility/blur events.

Version 2.0.1 disables intent first, persists a stop latch, checks live frames, and sends state-resync notifications only after cleanup. The separate header kill switch bypasses the ordinary action queue and remains accessible during startup errors, a stalled injection, or an open picker. Queued work is invalidated, new injections are bound to a document ID when available, and late results are removed. A late initial UI response cannot overwrite the stopped display.

Unit regressions cover: off after denied cleanup; lost frame bookkeeping; current and untracked prior tabs; preemption of a held injection; off-latch survival across worker reload; access-loss recovery through explicit reload; the off-only keyboard handler; unreadable settings; and failed storage writes. Storage-write failure falls back to removing host grants when possible. It is not reported as a saved off state if the browser refuses both mechanisms.

Real-browser regressions drive the actual power button and emergency icon, verify native main/child document properties are restored, check visibility/blur resync notifications, add an orphaned marker in an unselected tab, hold a MAIN-world injection through a controlled worker API wrapper, and verify emergency stop remains clickable and cancels the late result. They also retain an old focus-function reference and verify the explicit hard-reset reload discards it.

The access-revocation recovery scenario is simulated by making permission checks refuse access in the temporary fixture; that fixture’s required localhost grant cannot be removed through the ordinary permissions API. The page reload and document-ID replacement are real browser operations. Native permission-dialog and OS shortcut behavior are not inferred from these controlled checks.

Browser tests cover one-tab injection, unchanged browser window positions, permitted child-frame coverage, skipped unpermitted cross-origin frames, dynamically added frames, protection transfer, complete cleanup of previously protected main/child documents, repeated toggles, reloads, cross-origin navigation, closed selections, stale controllers, choices closing in the picker, worker suspension, control-window reuse, and full browser restart. Native form blur and `EventTarget.prototype.addEventListener` remain unchanged.

The back/forward cache scenario performs five protection/navigation/stop/back cycles per run. Cached restoration was confirmed with `pageshow.persisted`. A timing bug found during repeat runs was fixed with an isolated lifecycle listener that asks the extension to reconcile an exact resumed document. Unit tests separately reproduce an untracked late override and a previously selected tab returning from cache; neither is allowed to retain protection after it should stop.

UI checks verify sun/moon action consistency, accessible labels on icon controls, a shared SVG stroke style, removal of native button appearance, widths from 300 pixels upward, searchable selection, visible errors, keyboard power activation, stale-response rejection, and startup retry. Dark/light and preview screenshots are in the parent `test-results` folder.

Failure-injection tests cover refused access, blocked cleanup, temporary API failures, failed settings saves, transient startup reads, malformed stored data, private/unsupported tabs, stale selections, untrusted senders, and redaction of URLs in stored errors. The protection API never moves tabs or resizes windows.

## Limits

Tests are headless. Native toolbar-popup opening, interactive permission prompts, operating-system shortcut conflicts, sleeping/throttled tabs, and a particular website’s own detection mechanisms still need manual checks. Synthetic event checks verify installed interception, not every possible browser event ordering.

Protection confirms standard document API overrides, not that every possible out-of-focus inference is blocked. Injection may follow the first website scripts. Only HTTP/HTTPS documents with access are covered; ungranted cross-origin frames and special documents remain outside that coverage. A full browser restart intentionally starts unprotected.

Run `npm run test:all` from the workspace parent. Set `GX_BROWSER_PATH` to the Opera GX executable to repeat browser verification there; the dedicated UI runner uses Chromium.
