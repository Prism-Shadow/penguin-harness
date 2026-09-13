# The dock gains a UI workbench panel: the preview, element picking, the payload a pick becomes, and the conversation it goes to

- **Date:** 2026-09-13
- **Type:** feature
- **Scope:** `web`, `desktop`

[中文版](2026-09-13-ui-workbench-panel.zh.md)

The chat dock can now hold a **UI workbench** panel, listed and named like every other panel: it
appears in the launcher fan, the dock's add menu and the "open panel" picker, docks to either edge,
and its tab survives a reload with the rest of the layout. Point it at a running dev server, and the
panel embeds that page, names what it found on the other end, says in Chromium's own terms what went
wrong when a load fails, and lets you pick an element out of the page — hover highlights it, a click
locks it while that click is stopped from reaching the page, and `暂离` hands the page back when the
element you want is behind a menu that has to be opened first. What the pick becomes is on screen
too: the frozen **element payload** — where it was found, what it is, how it looks, and the `refId`
that keeps it the same element next round — assembled as you pick it and shown back to you field by
field and as JSON. **加入对话** sends that payload to the conversation, as a chip in the composer and
as the message body itself: a line naming the element, then the payload as fenced JSON, then what you
typed.

## Details

- The workbench is where a running dev server gets embedded and an element in the page gets sent to
  the conversation together with the file and line it was written on, so the Agent can edit it
  without searching for it first. It reads the user's page; it never authors one.
- It is **dev-only by design**: the element's origin is located through the source maps a development
  build carries — inline, or a `.map` the module names beside itself — and a production build has
  neither those nor the positions. The panel says so instead of degrading silently.
- The panel is registered the same way as the others — `PanelKind` + `PANEL_KINDS` in
  `features/dock/dock-state.ts`, its name and mark in `features/dock/panel-meta.tsx`, its body in
  `features/chat/chat-page.tsx`'s `renderPanel`, the body itself in `features/workbench/`, and one
  row in `DockPicker` (`features/dock/dock-panel.tsx`). That last one is worth knowing about: the
  picker's choices are a hand-written row list, not a walk over `PANEL_KINDS`, so a new kind that
  skips it is registered everywhere except the one surface a user meets first. The dock end-to-end
  spec now opens the panel from the picker, which is what failed while it was missing.
  `ELEMENT_PICKER_ICON` is the new mark: a page with a pointer resting on it.
- No `key` on the panel body, unlike the session-scoped panels: the workbench owns no server state,
  so switching conversations must not throw away where the preview was pointed.
- `test/dock-state.test.ts` covers the new kind the same way the scheduled-tasks panel is covered —
  listed in `PANEL_KINDS`, opens into a dock, becomes its active tab.

## The preview

- **Address row, remembered per browser profile** (`penguin.workbench.previewUrl`, declared in
  `lib/install-scope.ts`). A bare `localhost:5173` or a bare `5173` becomes a URL; `file:` and other
  schemes are refused, because a preview that reads the local disk is not a preview.
- **The dev servers found instead of a typed port**: 5173, 5174, 3000 and 8080 are probed in
  parallel and offered as pills, each saying whether it is Vite, an ordinary page, or a server that
  answers but will not be read from another origin. Nothing listening is not offered.
- **The load says what the page can give**: a Vite page whose entry module carries a source map —
  inline, or a `.map` it names beside itself — reads "precise tier available", one with neither reads
  "degraded only", and a page that refuses to
  be read says so. Failure lines name the case — nothing on the port, a timeout, a name that will not
  resolve, a page that refuses to be embedded, an error page, a crashed preview — instead of calling
  everything a connection error.
- **`webviewTag: true` on the desktop shell only** (`packages/desktop/src/main.ts`): the panel is the
  one place in the app that embeds someone else's site. It is a presentation capability the server
  cannot deliver — the page is the user's, cross-origin, and never passes through our HTTP API — and
  it adds no Node and no preload to either side: the panel reaches the guest through its DOM events
  and `executeJavaScript` alone. In a browser tab there is no guest element at all, so the panel says
  the preview needs the desktop app rather than showing an address row that could not load anything,
  and the dock end-to-end spec asserts exactly that.
- Two behaviours were measured rather than assumed, both after the first real-shell run got them
  wrong: a `src` written in the same turn as the guest's insertion is silently discarded (it must be
  written before the element enters the document), and a failed main-frame load still commits
  Chromium's error page and raises `dom-ready` 3ms later, so a failure has to stand until a new
  navigation starts. The second one is a tested reducer (`reduceGuest`) with six cases; without it a
  port with nothing on it was reported as connected.

## Picking an element

- **The picker is injected into the page's own world** (`features/workbench/element-picker.ts`), as a
  self-contained script handed to `webview.executeJavaScript` — the main world, which is the only place
  the page's own framework data lives, and which the page's CSP cannot keep us out of. It reports over
  `console-message`, the one channel measured to work without a host preload; every message is one
  JSON object behind a fixed prefix, and a line that does not parse is dropped, so the page's own
  logging can never be mistaken for ours.
- **Hover draws a highlight box and nothing else**: `position: fixed`, `pointer-events: none`, moved
  once per animation frame and reported only when the element under the cursor changes. Measured in
  the real shell: 24 mouse moves in a single turn repaint it twice. The page's layout is never touched.
- **A click selects and is stopped from reaching the page** — swallowed in the capture phase, which is
  what keeps the next click from following a link or submitting a form. Verified against a page whose
  button counts its own clicks and whose link would navigate: neither happened.
- **Esc is two-step, and belongs to whichever side has focus.** With something selected it clears the
  selection, with nothing selected it leaves pick mode; in the page the picker handles it, in the panel
  the panel does. It deliberately does not `preventDefault`: the picker's job is to take clicks, not to
  take away the page's own Esc.
- **`暂离` hands the page back** — listeners removed, highlight hidden, selection kept, so coming back
  re-locks the same element. This is how an element behind a menu that must be opened first gets
  picked. Nothing is floated over the page to switch modes: the control is in the panel, and the page
  only ever carries the highlight box.
- The picker's state is a tested reducer (`reducePick`, seven cases) over three facts rather than one
  mode: the switch (`wanted`, kept across page loads — a reload must not turn picking back on behind a
  user who switched it off), `暂离` (`paused`), and whether a picker is in the page at all (`live`).
  Collapsing those into one mode is exactly how a switch gets silently reopened by the next navigation.
- The element's facts travel with the page they were read on: the URL and viewport come from inside
  the page **at the moment of the pick**, never from the address box afterwards, so a route change
  cannot leave a payload naming a page the element was not on.

## What a picked element becomes

- **The frozen v1 payload** (`features/workbench/element-payload.ts`, §6 of the PRD) is assembled in
  the panel from three things: the element's DOM facts, the page it was found on, and the Session's
  **workspace** — which is the project being previewed, and the only thing that makes a relative
  source path unambiguous. `page.projectRoot` is that workspace, not the preview address.
- **It is shown back in full** — `refId`, selector, tag, role, name, text, test box, ancestors,
  classes, project, page, source — with the whole JSON one click away. The promise of this feature is
  that nothing reaches the Agent that the user could not read first, and a payload you cannot see is
  not that. (Measured while building it: leaving the JSON expanded by default squeezed the preview
  pane to 91px from 526px, so the JSON starts collapsed and the facts are capped to a scrollable
  block. The payload's `viewport`/`rect` are the ones from the moment of the pick; the panel growing
  afterwards must not rewrite them.)
- **`refId` is issued, not scraped** — `hash(canonical source site, semantic key)`, exactly as the
  requirement freezes it: FNV-1a over `projectRoot::file:line:column` plus a key that prefers
  `data-testid`, then role + accessible name, then tag + a digest of the text. The hash is pinned
  against FNV-1a's published vectors so the scheme cannot drift. Two picks of one element agree;
  two elements do not.
- **What the payload honestly cannot say yet, it says.** Resolving the source file needs the running
  page's inline source map, which is the next milestone, so `source` is `{confidence: "none"}` — the
  honest one of the four frozen levels — rather than an invented location. The `refId` degrades with
  it: its canonical site falls back to the page URL, which is why a text-named element's id moves when
  its text does, while a `data-testid`-named one keeps its id across the same edit. Measured in the
  real shell, both ways.
- The payload also carries a one-line note that its `cssSelector` describes the page as it is right
  now: the selector is a shortcut, the `refId` is the durable handle, and an Agent that treats the
  former as a fact writes to the right line today and the wrong one tomorrow.
- The DOM facts are gathered where the DOM is, and none of them is invented: a role the page does not
  declare (and that cannot be implied) is `null`, an accessible name is an approximation in the same
  order the real algorithm looks, `text` is cut to 200 characters, ancestors stop at three, and
  computed style is a curated set of the properties a design change actually turns on rather than the
  ~340 a browser holds.
- Switching conversations keeps the panel mounted but changes whose project the payload names, so a
  pick made after the switch cannot carry the previous project's root.
- One trap for the next person: `install-scope.ts` sweeps every `penguin.*` literal in the web source
  and fails the build's tests on any it has not classified, and the payload's discriminator
  (`penguin.ui-element-ref`) looks like one — it is a message field, never stored, so it is now called
  out as a deliberate exclusion rather than filed as a preference.

## Where the element is written

- **The payload's `source` is a location in the user's own project** — `src/Badge.jsx:2:10` — and it is
  the element's, not its component's: measured against the truth table taken on the same fixture in
  M1, both rows (`span.badge` → `src/Badge.jsx:2:10`, `h2.card-title` → `src/App.jsx:7:7`) land on the
  line the JSX is written on, with that line's own text as the snippet. The panel shows it in the
  payload card and the message the Agent receives carries the same value.
- **The page is asked, not guessed at.** The injected picker asks the page's own framework where the
  element came from, and each route is one that was measured rather than assumed: React 19's
  `_debugStack`, React 18's component text, Svelte 5's `__svelte_meta.loc`, Vue 3's `type.__file`.
  The whole sniffer is one self-contained function, serialized into the page — nothing from the
  bundle's scope goes with it, and a test evaluates the serialized text on its own to prove it.
- **React 19's stack is handed over whole, in order, and the host picks the frame.** The first frame is
  React's own `jsxDEV`, and the pre-bundled dependency it lives in is served from `/@fs/…/deps/…` —
  there is no `node_modules` in that URL, so no filter on the URL could tell it from the user's code;
  Vite will even bundle React's production `jsx` into a **hash-named shared chunk**
  (`deps/chunk-4S5VGXK3.js`) whose URL does not contain the word `react` at all, and only its map says
  what it is. What can tell them apart is the module's text and its map, which only the host has: each
  frame is mapped in turn, React's own runtime frames are stepped over, and **the first frame left is
  the element's creator** — which is also why the first attempt at this reported
  `react-jsx-dev-runtime.development.js` as the element's file. A creator **inside a dependency is
  reported as well**, flagged with `moduleIsThirdParty`: the position is right, it is just no use to
  edit — the payload's job is to send the Agent to "pass a prop or wrap it", not to the user's line
  that calls the library. When the stack holds nothing but React's own runtime, the payload says
  `none` + `moduleIsThirdParty`.
- **React 18 has no usable line numbers, so the element is found inside its component's compiled text**:
  the `jsxDEV(...)` calls are scanned with balanced brackets (a nested element is inside its parent's
  call, so the search has to continue *within* it) and string literals are skipped (a `)` in a prop ends
  a call that has not ended). Same tag, same class token, two siblings from a `map()`: more than one
  candidate is reported as `ambiguous` with the candidate count, never as `exact` — measured, picking
  the static sibling lands on the `map()` one, which is the reason for the rule in the first place.
  Only the element's **own** fiber's `_debugStack` is a location for it: an ancestor's names where the
  ancestor was created, and standing it in for an element a stack-less runtime made would report the
  user's line that renders the library as `exact`.
- **The map is read where it is — both forms of it — and the honest level is stated.** The module's text
  is fetched with an ordinary CORS request to the dev server the page came from, **fresh on every pick**
  (see "Asking the page once more before sending"); the map
  may be an inline `data:` URL or a `.map` the module **names** at its end, because Vite 7 serves both
  forms on one page (inline for its small chunks, side-car for large dependencies such as
  `deps/react-markdown.js`) and reading only the inline one downgrades an element inside a dependency
  from located to unknown. Decoding is a zero-dependency VLQ consumer that answers only for the line
  asked about — a position with no mapping on its line is `none`, because taking a neighbouring mapping
  is exactly how a "precise" location becomes a plausible, wrong one. `sources` entries are resolved
  against the module they were found in (Vite writes `Badge.jsx` inside the map for `/src/Badge.jsx`;
  read as a path, that loses `src/`) and then made relative to the Session's workspace. A production
  build has no map at all, and the panel says why rather than inventing a line (see the next section).
- **`refId` is now issued from the source site**, which was the plan all along: the previous fallback —
  the page URL — is gone, so an element that was named only by its text no longer changes its id when
  the text does, and components keep theirs across an edit. The consequence worth knowing: element
  chips staged in a conversation from before this change renumber once, and the send-time
  re-resolution surfaces that explicitly (see "Asking the page once more before sending") rather than
  hiding it.
- **All four rails are now measured end to end, not only in unit tests.** A real desktop shell picks 17
  elements across the four minimal projects M1 used — React 19, React 18, Svelte 5 and Vue 3 — and every
  payload matches the truth table read out of those projects' own source: 6/6, 4/4 and 3/3 `exact`, and
  Vue 3 `file-only` on every one of its four, with no line invented. One convention came out of doing
  it: **a payload's column counts from one**, while Svelte 5 reports its own column from zero, so the
  host moves it onto the payload's base instead of passing it through (`src/Badge.svelte` came out
  `5:0` against a truth table of `5:1`).

## When it cannot be located, it says why

- **The "source" row now states the tier itself**, all four of them in words: `精确 src/App.jsx:7:7`
  (precise) | `只到文件 src/App.vue（这个框架只说得出文件，不编行号）` (file only, with the reason) |
  `有歧义 src/Rows.jsx:5:9（同一处写法有 2 个候选，可能是兄弟节点）` (ambiguous, with the candidate
  count) | `无源码位置：…` (no source location, and why). The machine-readable `confidence` has not gone
  anywhere: it is still in the payload JSON, and therefore still in the message the Agent receives. The
  person reads the row; the Agent reads the field.
- **Four ways of having no location are four different things, and the panel tells them apart**: no
  source map can be read on this page (usually a production build) / the element is created by a
  framework or library runtime, not by your project / this page's framework reports no position (an
  unsupported framework or build) / evidence was there and did not map back to source. The order is
  fixed: a **page-wide fact comes first** — when nothing on the page can resolve, that is the page's
  business rather than this pick's — and only then the element's own particulars. Saying which one it
  is, instead of "nothing", is what makes each of the four suggest a different next move.
- **A degraded tier does not block anything.** Run end to end on a **real production build** (a page
  built by `vite build` and served the way production is, by `vite preview`): the status line names "no
  readable source map", the payload is `confidence: "none"` with **no file invented**, and the row says
  why. Picking, adding to the conversation and sending all still work, and the DOM half of the payload
  — selector, classes, the computed `24px` font size, the text — is complete, which is exactly what the
  Agent searches the source with. The acceptance asserts that the message really went out, not merely
  that the button was not greyed out.
- **While the answer is still being worked out, the row says it is locating**, not that there is
  nothing: resolution is asynchronous, and claiming "no source location" in that window would be
  claiming something nobody has measured. And in that window it never shows *the previous element's*
  location: a resolution is stored **keyed by the selection it answers** (page URL plus selector), so
  the moment a new element is picked, the answer that belongs to the old one stops being used — the
  frames in between read as "locating" rather than as a new element wearing the old file and line.
  Measured, not assumed: alternating picks between two elements with every card DOM change *and*
  every animation frame recorded (9 of 19 and 8 of 18 misattributed before, 0 of 19 and 0 of 9
  after), rather than only comparing the settled values (`实测脚本/m54-卡片归属/`).
- **"Can it work on my project at all" is answered inside the panel.** While nothing is loaded, the
  panel carries a collapsed **"What it supports (L1)"** block: exact file/line/column on React 19,
  React 18 and Svelte 5 (measured on Vite); file only on Vue 3; degraded — selectable but with no
  source location — on builds nobody has measured yet (webpack / Next.js) and on every production
  build; out of reach inside a shadow root or an iframe; and third-party nodes located in the
  dependency's own file, where editing changes nothing. The rows say **what was measured**, not what
  the frameworks claim, and both dictionaries carry the same rows — a unit test pins both, so an
  unmeasured framework cannot be placed in a tier by accident. Once a page is up the block gives way
  to the status line, which reports *that page's* own tier, and the preview keeps its full height
  (`实测脚本/m55-支持范围/`, 8/8).
- **The tier line's own wording got more accurate too**: from "precise tier available" to "the page
  carries a source map: pick an element to see whether it reaches a line". A page having a map is not
  the same as this element reaching a line — Vue 3 is the live example: its page carries a map, the
  precise tier's precondition holds, and the framework still only names the file, so the payload
  reports `file-only` and the row says "file only". Having both sentences is more honest than letting
  only one of them speak.

## Where it cannot reach, it says which kind

There are places this first cut deliberately does not go (PRD §2.3): inside shadow DOM, inside the
document an iframe carries, inside a third-party component library's own files, and elements that are
not visible right now. Drawing that line is not the problem — **saying nothing about it is**: when
someone clicks something, the panel either answers or explains why it cannot, and it never quietly
hands over a neighbour. Each of the four now has its own sentence, said at the moment you hit it:

- **Click inside shadow DOM and the panel tells you it is handing over the outer host.** The page's own
  DOM tree stops at the shadow host (measured: with the pointer over shadow content,
  `document.elementFromPoint` returns the host), so what gets picked is the host `shadow-widget` —
  together with its real source location, because the host *is* a real element written in
  `src/App.jsx`. The panel's line reads "Inside Shadow DOM: L1 does not pierce the shadow root, so this
  is the outer host shadow-widget — style the host, or pass a prop into the component." **The one case
  it cannot speak to is a closed shadow root**: from the outside it is indistinguishable from an
  ordinary host, so that goes in the product notes rather than being claimed as working.
- **Nothing inside an iframe can be picked at all, so the panel says so up front.** The picker is never
  installed into a frame's document, so an element in there is not "unsupported after picking" — it is
  unpickable. So **as soon as you start picking**, the panel says "This page embeds N iframe(s): L1 does
  not enter frames, so nothing inside them can be picked." (re-counted on every navigation, withdrawn
  when picking stops). And when you do click the iframe element itself — its **border** belongs to the
  parent document, which is the only part that can be clicked — the panel says "This is the iframe
  element itself and inside it is another document: L1 does not enter frames — open that page on its own
  and preview it there."
- **An element you cannot see is described by its own facts.** An `opacity: 0` element **can still be
  clicked**, so "it is actually invisible" is something only the panel can tell you: "The element you
  picked is opacity:0 — it takes up space but is fully transparent." Four cases get one line each
  (`display:none`, `visibility:hidden`, `opacity:0`, a `0×0` box), and the way out is spelled out too:
  "Use Stand down to get the page into a state where it shows (open the dropdown, open the modal), then
  Pick again and select it — L1 will not open it for you." The Stand down line itself now names
  dropdowns, modals and hover layers as things you can open.
- **A node inside a library keeps its location and gains a line about whose file it is.** When a library
  built the element itself and the location lands in the library's file (react-markdown's heading, say),
  the row still says "precise `<the dependency's own file>:381:18`" and appends "inside a library (a
  dependency's own file — edit it and nothing changes: pass a prop or wrap it)". "Where is it" and
  "whose is it" are two answers, and both are worth having.
- **The same sentence reaches the Agent.** The payload schema is frozen (§6 v1) and this round **added
  no field to it**: the paragraph in the panel is for the **person**, and the message's first line gains
  one clause for the **Agent** — "Picked UI element: shadow-widget (on …) — this is the Shadow DOM host;
  the part you clicked lives in its shadow root (L1 does not pierce it)". Both are computed from the same
  fact, so they cannot disagree.

## Putting a pick into the conversation

- **`加入对话` stages the element as a quotation the composer already understands** — a
  `ComposerReference` of a new `kind: "element"`, the same structure a selected file or directory
  becomes, so the chips, the send path and everything downstream of them are one code path and not two.
- **A chip is named the way a person would name the thing, not by a path it does not have.** A file
  has a path, so the chip is its last segment; a picked element has no workspace path yet — that is the
  next milestone — so the reference carries a `label` instead, the element's own description
  (`span.badge "hello"`), and the chip prefers a label when there is one. The chip's tooltip appends the
  element's `refId`, which is the one thing that says *which* element it is.
- **Staging the same element twice updates its chip rather than adding a second one.** Deduplication is
  by `refId`, and it replaces in place instead of ignoring the second staging: if you changed the
  element and picked it again, the chip carries the newer payload, not the one you staged a minute ago.
  (`stageReference` is a tested pure function that never mutates what it is given; a reference with no
  `refId` — a file or a directory — keeps the old append behaviour.)
- **The payload never enters the textarea.** It is put on the message at send time, and the composer
  keeps only what you typed: with two elements staged the draft is still empty (measured), so a
  quotation can be removed before sending without hunting for JSON in your own sentence.
- **The message body is: a line naming the element, the payload as fenced JSON, then your sentence.**
  Measured in the real shell: 3769 characters for two elements — about 1.9 KB each — with the typed
  sentence last, both JSON blocks parseable, and each `refId` matching the one on the panel. The
  staged quotations go in front of what was typed, because they are what the message is about; the
  `[use_skills]` wrapper, when skills are selected, stays outermost so a message can carry both.
- **A chip shows a summary, not a collapsible payload preview**; the payload card on the panel is where
  the whole thing is readable. What it carries is the snapshot from the moment it was staged — but that
  snapshot is not the last word: the page is asked once more before the message goes out (next section).

## Asking the page once more before sending

- **What the message carries is what the page says now.** A chip's payload is the snapshot taken when
  the element was picked, and a user's dev server hot-reloads on every save; before composing a message
  the composer takes the chip's `cssSelector` (and its own `data-testid`, when it had one) back to the
  page, re-reads the element, and builds a fresh payload into the message. Measured in the real shell:
  after inserting a blank line above the `<h2>`, the message carried the **new line the element had
  moved to** (`src/App.jsx:8:7`) while the chip's snapshot plainly said the old `7:7`; after adding an
  inline colour to that element, the message carried the new `color` (`rgb(11, 22, 33)`) where the
  snapshot had `rgb(0, 0, 0)`.
- **Two things are the same element when they are "the same thing at the same path"**: a node the path
  still matches, with the same tag and — when it has one — the same `data-testid`. The semantic key is
  deliberately **not** compared: it contains the accessible name, which changes the moment a user
  rewrites the text, and the element whose text was rewritten is obviously still that element. The
  known cost: after a large structural edit, another node with the same tag can take its place; an
  element carrying a `data-testid` is unaffected.
- **When the page no longer has it, the send is held instead of made.** The element is gone (`missing`),
  something else is at that path (`replaced`), or the preview has moved to another origin
  (`page-changed`) — none of the three sends a payload the page has already contradicted: a toast names
  the element and the reason, the panel says the same sentence again, the chip in the composer turns
  red and reads "gone", and **the sentence you typed stays exactly where it was** (held means not sent,
  not thrown away). All three branches have their own "the transcript did not grow" assertion on the
  real machine, and after switching back to the original page the same chip sends fine.
- **What could not be checked says so.** With no preview open, no picker in the page, or a page we
  cannot reach, the chip keeps its own snapshot and goes out; the panel claims no verification. The one
  thing never done here is claiming a freshness that was not measured.
- **An element that moved is issued a new `refId`** — the source site is part of the hash, so this is
  the signing rule working as designed; the chip is replaced in place with the new one, and the panel
  and the message never disagree about which element it is.
- **Pointing the preview away and back does not condemn the chip for good**: another origin marks it
  gone, and switching back means the next send simply goes out, resolved against the page as it is now.
  Invalidating is the result of one check, not a one-way door.
- **The panel's card reads the module text as of now.** This one is a leftover bug from the previous
  milestone, found by running the real thing: the module text used to be cached by URL, and a dev server
  serves a module's *current* text at the same URL — so after a save, picking the element again left the
  card on the pre-save line, showing the user a false piece of evidence while the message was right.
  Every pick now reads fresh, so the card and the message say the same thing (the same assertion went
  from "the card is still on the old line" to "the card followed the new one").

## Leaving the user's project alone

- **The user's project is read, never written.** Measured on a project that is a real git repository:
  the whole flow — open the panel, load the preview, pick an element, add it to the conversation, send —
  leaves `git status --porcelain` empty and byte-identical, and all seven files keep their sha256. No
  new file, no deleted file, no rewritten file. The Vite dev server the acceptance runs points its cache
  at a temp directory for the same reason: a tool that helps you read someone's page has no business
  dropping files in it.
- **The workbench's own state lives on our side**: the preview address it remembers is in the host
  profile's local storage (`penguin.workbench.previewUrl`), which is the same place every other panel's
  state lives, and there is no counterpart file in the project.
- **Nothing is sent out.** With Electron's own request monitor on every session for the whole run, the
  93 requests seen go to six loopback hosts and nowhere else: our app's server, the workbench's own port
  probes (5173/5174/3000/8080), and the user's dev server. The assertion is a
  loopback allow-list rather than "there were no requests", because the probes are ours and legitimate —
  and it is paired with a check that the list is non-empty and contains the dev server, so a monitor
  that saw nothing cannot pass by staying silent.
- **The page cannot reach the host.** In the guest's own main world, `require`, `process`,
  `window.ipcRenderer`, `window.electron` and `module` are all `undefined`, and the only resources the
  page loaded came from loopback. The one channel the picker uses to talk back is the page's console,
  which is also what makes it cheap and preload-free.
- **The injected script carries no way to reach anything.** The text handed to the guest is checked for
  network primitives (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, dynamic
  `import`, and any `http(s)`/`ws(s)`/protocol-relative URL) and for host or storage access (`require`,
  `process`, `ipcRenderer`, `postMessage`, `localStorage`, `sessionStorage`, `document.cookie`, `eval`)
  — as a unit test over the serialized source, which is exactly what the guest evaluates, so a primitive
  added inside the installer cannot slip past it. The test also asserts the source is the real thing and
  not an empty string, which would pass every "does not contain" check on its own.
- **A page logging on our channel cannot drive the panel.** The console is a shared channel, so the
  parse only accepts our prefix plus one of our kinds: a plain page log, our prefix with broken JSON, and
  our prefix with an unknown kind all leave the panel exactly where it was. What this does not fix is
  worth knowing: the channel is not authenticated, so a page can *fabricate* a picker message. The blast
  radius is that it can change what the panel shows, and nothing reaches the conversation unless the user
  asks for it — the payload is shown to the user before it can be sent.
