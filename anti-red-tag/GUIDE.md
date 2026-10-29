# Anti Red-Tag

One selected tab reports visible and focused while you work elsewhere. The extension changes standard document focus/visibility APIs and intercepts page-level blur, focusout, and visibility-change events. It does not arrange windows or manage a second tab.

## Install

1. If you used the previous extension, disable it in `opera://extensions`. Reload any page it had protected to clear its old overrides.
2. Enable Developer mode and choose **Load unpacked**.
3. Select the `anti-red-tag` folder containing `manifest.json`.
4. Open a website tab, click the Anti Red-Tag toolbar icon, and press the power button. Allow access to that website when prompted.

For Chrome, use `chrome://extensions` instead. This is a new extension folder: loading only the previous folder will not install this version.

## Controls

Every action uses the same outline icon family, with accessible labels, keyboard focus, and hover descriptions.

| Icon | Action |
| --- | --- |
| Power | Start or stop protection |
| Red stop octagon | Emergency stop all Anti Red-Tag protection; also available with Alt+Shift+K |
| Tab / chevron | Search and choose the single tab |
| Circular arrows | Use the current browser tab |
| Target | Go to the selected tab |
| Pop-out arrow | Open or reuse a small control window |
| Sun | Switch to light mode |
| Moon | Switch to dark mode |
| Question mark | Help and protection coverage |
| Key | Allow required website access, or remove grants from Help |
| Close | Dismiss a dialog |

The selected tab is detected by browser tab ID, not a hardcoded website. Navigating does not change its identity. If it closes, choose another tab; an unrelated tab is never selected silently. Private tabs, the extension’s own pages, and Opera’s reserved Corner are excluded.

When protection is already on, choosing another tab transfers it. The picker requests the new website’s permission first; refusing that request leaves the previous tab protected. Concurrent controllers cannot silently act on a different selection.

**Protected** means the script confirmed the standard focus/visibility overrides in the main page. Permitted HTTP/HTTPS child documents are included as they load. Child sites without a host grant, browser-managed pages, and special frames such as `about:blank` or `srcdoc` are not covered. Help shows the count of accessible documents that received protection.

The `Alt+Shift+P` command toggles protection. **Alt+Shift+K is an off-only emergency stop.** Commands do not request website permission automatically: grant access through the panel when needed. Shortcut conflicts depend on browser and operating-system settings.

## Emergency stop

Press the red stop octagon in the header or use **Alt+Shift+K**. It remains available while ordinary controls are loading or waiting on another action. It first disables automatic protection, stores an off latch, and then clears accessible live frames, including previously protected tabs with lost session records and the older project’s restorable page markers. Late injections are canceled or immediately undone and cannot re-enable protection.

Normal Off now also disables automatic reapplication **before** attempting cleanup. It inspects live documents instead of trusting saved frame records. Once overrides are removed, standard visibility and focus notifications let the website read its restored native state. These notifications are synthetic; sites that ignore untrusted events may require an actual focus change or a page reload.

After a stop request, **Protection off** confirms completed accessible-document cleanup. **Stopping…** means work is still being canceled. **Reload needed** means automatic protection is already disabled, but browser access or another error prevented full cleanup. The toolbar displays a warning badge for incomplete cleanup. Protection cannot be restarted until cleanup finishes.

The recovery reload icon performs a **hard reset** of affected tabs (or the selected tab after successful emergency cleanup). This clears any old function references or internal focus status cached by a website. **Reloading may lose unsaved edits.** The panel warns before this action; it never reloads pages automatically. A real document replacement is checked before cleanup is confirmed.

If settings storage fails, emergency cleanup still runs. If the off state cannot be saved, the extension attempts to remove its website grants as a separate safeguard. If the browser refuses both persistence and grant removal, the panel tells you to disable the extension before restarting the browser. The switch cannot disable a separate extension or another installed copy of this project; disable old copies if they are also running.

## Limits and recovery

This is best-effort page behavior masking, not an undetectable mechanism. It cannot block every possible out-of-focus inference, references to original APIs retained before injection, browser throttling, sleeping tabs, network/server-side checks, GX resource limits, or operating-system suspension. Events already observed before injection cannot be undone. Ordinary form-field blur events and native event registration remain intact.

Navigation reapplies protection while it is enabled and access allows. Moving to another site may show **Access needed**. Cached pages remove overrides on exit. A small extension-isolated lifecycle listener reconciles the exact document on return, removing late overrides if protection was stopped or moved to another tab. If cleanup is blocked, use the emergency stop and its explicit reload recovery.

Worker suspension preserves the selected ID and protection state for the browser session. A full browser restart resets protection and detects tabs again. Appearance is retained locally. If initial loading fails, use the retry icon.

## Privacy

There are no remote scripts, analytics, external services, or runtime dependencies. Saved settings contain appearance and session IDs/state, not browsing history or page content. Stored error messages redact page URLs. Permission grants are maintained by the browser.

The manifest requests `tabs`, `storage`, `scripting`, and `webNavigation`. HTTP/HTTPS website access is optional and requested for the selected website. There is no global content script or default all-sites grant. Protection code runs in each permitted document’s main JavaScript world and is visible to that page.

## Preview and tests

Open `controller.html` as a local browser file for a simulated preview. Its banner identifies simulated actions; it does not protect real tabs.

From the workspace parent:

```text
npm install
npx playwright install chromium
npm run test:all
```

To run browser tests in Opera GX, set `GX_BROWSER_PATH` to its executable before running the same command. Tests use disposable profiles and local pages. Production permissions are checked separately from a temporary extension copy granted localhost access for injection tests. See `VALIDATION.md` for verified behavior and remaining manual checks.
