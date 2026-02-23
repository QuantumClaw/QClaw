# Dashboard Usability Scrutiny

Focused review of the QClaw dashboard from a **usability** perspective: clarity, feedback, consistency, accessibility, and cognitive load. British English.

---

## 1. First-time and auth

| Issue | Severity | Detail |
|-------|----------|--------|
| **Token screen has no context** | Medium | User sees "Enter your auth token" with no explanation of where to get it. The hint "Run `qclaw dashboard` for the URL" is easy to miss and assumes CLI access. |
| **No "show/hide" for token** | Low | Token input is plain text; no toggle to mask when typing (though token is often pasted). |
| **PIN error doesn't say how many attempts left** | Medium | After wrong PIN, message is "Wrong PIN"; API can return `attemptsLeft` but it's not always shown. Lockout (15 min) is not explained up front. |
| **No "forgot PIN" or recovery** | High | If user forgets PIN, only option is to clear it via config/CLI; no in-UI path. |

**Recommendations:** Add one line under the token input: "Get your URL and token by running `qclaw dashboard` in a terminal." Show attempts left on PIN error. Add a note "Forgot PIN? Remove via Config or run `qclaw config set dashboard.pin ''`."

---

## 2. Navigation

| Issue | Severity | Detail |
|-------|----------|--------|
| **Icon-only sidebar** | Medium | All nav is icons; labels only on hover (tooltips). New users must hover every icon to learn Chat, Overview, Channels, etc. |
| **No active-page indicator in title** | Low | Topbar shows "Chat" etc., but sidebar icon state is the only other cue; fine once learned. |
| **Connection status is easy to miss** | Medium | Small dot + "Connected" at bottom of sidebar; if WS drops, "Offline" is easy to overlook when focused on chat. |
| **No keyboard shortcut to switch tabs** | Low | Power users can't use e.g. 1–9 or Cmd+1 to jump to a page. |

**Recommendations:** Optional "expanded" sidebar mode with labels (toggle or on first visit). Consider a slim connection banner when status goes offline. Add optional number shortcuts (e.g. 1=Chat, 2=Overview) for keyboard users.

---

## 3. Chat

| Issue | Severity | Detail |
|-------|----------|--------|
| **Empty state is vague** | Medium | "Select a thread or start chatting" doesn't say that typing and sending will start a new conversation; "New Chat" is below the fold in the thread list. |
| **Agent selector has no label** | High | Dropdown at top of thread list has no "Agent" label; first-time users may not know what it does. |
| **Send button has no disabled state** | Medium | When WS is offline or no message, Send still looks clickable; click does nothing (guard in code). No tooltip explaining why. |
| **No loading state when switching threads** | High | Clicking a thread clears messages then fetches; user sees empty pane briefly with no spinner or skeleton. |
| **"Agent is typing..." is easy to miss** | Low | Small italic text above input; could be more visible (e.g. inside a bubble or with a subtle animation). |
| **Thread list: no visual distinction for "Dashboard" vs Telegram** | Medium | Icon helps (💻 vs 📱) but "Dashboard" as a thread name is ambiguous (this browser session? all dashboard users?). |

**Recommendations:** Add an "Agent" label above the dropdown. Disable Send when offline or empty and show a tooltip ("Connect to send" / "Type a message"). Show a loading spinner or skeleton in the message area when `selectThread` is loading. Empty state: "Type a message below to start, or pick a conversation from the list." 

---

## 4. Forms and inputs

| Issue | Severity | Detail |
|-------|----------|--------|
| **Config: keys are technical** | High | Keys like `models.primary.provider` and `dashboard.port` have no human-readable labels or help; non-technical users struggle. |
| **Config Save feedback is subtle** | Medium | Save button flashes green; easy to miss. No "Saved" toast or inline message. |
| **Config: Enter to save is undiscoverable** | Medium | Instruction says "press Enter to save" but many users will click Save; fine. No focus management after save (focus stays in field). |
| **Memory search: button only** | Medium | "Search" must be clicked; no search-on-Enter in the input. |
| **No inline validation** | Medium | Config values (e.g. port "abc") are sent to API; error comes back generic. No client-side hint (e.g. "Port must be a number"). |

**Recommendations:** Add short labels or tooltips for common config keys (e.g. "Primary AI provider", "Dashboard port"). After Save, show a brief "Saved" text or toast. Add Enter key handler to memory search input.

---

## 5. Feedback and errors

| Issue | Severity | Detail |
|-------|----------|--------|
| **API errors are generic** | High | Many catch blocks set "Error: " + e.message or "Error loading X"; no distinction between network failure, 401, 403, 500. |
| **No global error banner** | Medium | Errors are per-section (e.g. Overview card shows "Error"); if the whole API is down, each tab shows its own error. |
| **Copy link: feedback is button text only** | Low | Button changes to "Copied!" for 2s; good. Could add a tiny toast so it's visible even if the button scrolls out of view. |
| **Refresh has no loading state** | Medium | Clicking Refresh refetches and repaints; no spinner or disabled state, so user may click again. |
| **Logs "Live on" state** | Low | Button says "Live on" when active; "Live (5s)" when off is clear. Could add a small "Pause" icon when live. |

**Recommendations:** For 401, show "Session expired. Re-enter token." and optionally clear token / show token screen. For network errors, show "Can't reach server. Check connection." Differentiate in UI. Add a short loading state (spinner or disabled) on Refresh buttons during fetch.

---

## 6. Consistency and language

| Issue | Severity | Detail |
|-------|----------|--------|
| **"Copy link" vs "Copy URL"** | Low | Some users expect "Copy URL"; "Copy link" is fine but could add title "Copy dashboard URL". (Already has title.) |
| **Terminology mix** | Medium | "Audit Log" in nav vs "Logs" in page title; "Cost & Usage" vs "Usage" in nav. "Quick Stats" vs "System Overview" – both are stats. |
| **Button styles** | Low | "Refresh" and "Copy link" use btn-sm; "Approve" in pairing uses different style. Acceptable. |
| **Currency** | Low | £ is hardcoded; fine for UK audience; consider config or locale later. |

**Recommendations:** Align nav label and page title (e.g. "Logs" everywhere, or "Audit" everywhere). Use one term for "stats" (e.g. "Overview" for the page, "Summary" for the second block).

---

## 7. Readability and density

| Issue | Severity | Detail |
|-------|----------|--------|
| **Card values are dense** | Low | Small cards with label + big value + sub; on small screens several cards per row can feel cramped. |
| **Log viewer font** | Low | .72rem monospace is small; consider .8rem or user-adjustable. |
| **Table text** | Low | Tables are readable; row hover helps. |
| **Contrast** | Low | Dim text (--text-dim) on dark background is within range; ensure WCAG AA for critical text. |

**Recommendations:** Slightly increase base font for log viewer. Optionally allow a "compact" vs "comfortable" density for cards (future).

---

## 8. Mobile and viewport

| Issue | Severity | Detail |
|-------|----------|--------|
| **Thread list hidden at 480px** | High | Below 480px `.thread-list{display:none}`; user cannot switch conversations on small screens. |
| **Touch targets** | Medium | Sidebar icons and btn-sm buttons may be under 44px; tap can be fiddly. |
| **user-scalable=no** | High | Viewport has `maximum-scale=1.0, user-scalable=no`; prevents zoom and hurts accessibility (e.g. low vision). |
| **Topbar wraps** | Low | Copy link + badges can wrap on narrow screens; usually still usable. |

**Recommendations:** Remove `user-scalable=no`; allow zoom. On mobile, consider a bottom sheet or modal for thread list instead of hiding it. Increase tap targets for nav and primary buttons (min 44px height).

---

## 9. Accessibility

| Issue | Severity | Detail |
|-------|----------|--------|
| **No ARIA labels** | High | Sidebar items, icon buttons (upload, send), and Copy link have no aria-label. Screen readers get only "button" or emoji. |
| **No skip link** | Medium | No "Skip to main content" for keyboard users. |
| **Focus not managed** | Medium | After opening a page or sending a message, focus is not moved; modal/token screen doesn't trap focus. |
| **Live region for errors** | Low | Errors are not announced to screen readers (no aria-live). |
| **Colour as only indicator** | Medium | Status is green/red dot + text; colour-blind users may rely on "Online"/"Offline" text, which is present. |

**Recommendations:** Add aria-label to all icon-only buttons and nav items (e.g. "Chat", "Copy dashboard URL"). Add aria-live for connection status and for error messages. Ensure focus moves to main content or first control when switching pages.

---

## 10. Cognitive load

| Issue | Severity | Detail |
|-------|----------|--------|
| **Overview: too many concepts at once** | Medium | Status, Degradation, Agents, Memory, Tunnel, AGEX, Messages, Cost, Tokens – new users may not know what "Degradation" or "AGEX" means. |
| **Config: flat list of keys** | High | Nested keys are rendered as a long list with section headers; hard to scan. No grouping by "Dashboard", "Models", "Channels". |
| **Channels vs Paired Users** | Low | "Connected Channels" (cards) then "Paired Users" (table) – relationship between them could be clearer (e.g. "Users paired to these channels"). |

**Recommendations:** Add one-line tooltips or help text for "Degradation" and "AGEX" on Overview. Group Config by top-level key (Dashboard, Models, Channels, Memory) with collapsible sections. Add a short subheading: "Users who have paired with the channels above."

---

## Priority summary

| Priority | Action |
|----------|--------|
| **High** | Add "Agent" label for chat agent dropdown. Show loading state when switching threads. Remove `user-scalable=no` from viewport. Add aria-labels to icon buttons and nav. Provide token-screen hint ("Run `qclaw dashboard` for URL"). |
| **Medium** | Disable Send when offline/empty with tooltip. Show attempts left on PIN error. Add brief "Saved" feedback for Config. Add Enter key for memory search. Differentiate error types (auth vs network). Optional expanded sidebar or first-time nav labels. |
| **Low** | Search on Enter in memory. Slightly larger log font. Consider thread list on mobile (sheet/modal). Number shortcuts for pages. |

Implementing the high-priority items will noticeably improve usability and accessibility without large rewrites.
