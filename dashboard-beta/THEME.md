# The theme kit

An inventory of every visual element the old dashboard has, and where each one
should live in this app. Written before porting the rest of the panes, because
the order matters: panes built against a thin kit grow their own primitives, and
then the kit can never be swapped.

The old window's stylesheet is ~130 top-level selectors. About 75 of them are
genuinely shared vocabulary. The other 55 are one pane's private business and
have been sitting in the shared stylesheet the whole time — which is the real
finding here, and the thing worth fixing while it is cheap.

`theme` is a slot. Nothing outside `src/app/theme/` should know what is behind
it, and no pane should reach a class name directly.

---

## What went wrong first, and why it is listed before anything else

**The layout was never in the JavaScript.** `ui/index.html` is 1,454 lines and
it is the skeleton: 19 `.cols` rows, 49 `.col`, 19 `narrow`, 15 `wide`, 46
`.stack`, 23 `.titlerow`, 15 `.plus`. The JS only ever filled containers that
already existed — `$('branches').innerHTML = ...`.

So porting the JS gets the content and silently loses the shape. Every pane
ported so far is one column because of this, not because anything decided it
should be.

**The shape it lost is the same on nearly every tab:**

    col narrow            col                     col wide
    ------------------    --------------------    ----------------------
    titlerow + [+]        Actions -- acting on    What it carries
    finder                the left's selection
    chips (counts)        --------------------    (detail)
    stack of .card.pick   Tasks on it

Master, then what can be done to it, then what it holds. One set of buttons
serves every item in the list, which is the entire reason for the split.

---

## 1. Layout — MISSING ENTIRELY

| class | what it is |
|---|---|
| `.cols` | flex row, `align-items: flex-start`, 16px gap |
| `.cols3` | same, wrapping, for three short lists side by side |
| `.col` | `flex: 1 1 0; min-width: 260px` |
| `.col.narrow` | `flex: 0 1 260px` — the master list |
| `.col.wide` | `flex: 1.6 1 0` — the detail |
| `.stack` | column, 8px gap |
| `.titlerow` | heading row that can hold a button |
| `.grow` | the spacer that pushes it right |
| `.row` | wrapping 6px row, inside a panel or card |

Proposed: `<Cols>`, `<Cols3>`, `<Col narrow|wide>`, `<Stack>`, `<TitleRow>`,
`<Row>`.

Two rules in here are load-bearing and must survive the port:

* `.col > div + div:not(.pane) { margin-top: 8px }` — spacing at the join
  between two containers in a column. It was a property of the container and
  never of the column, so whether there was a gap depended on which classes
  happened to meet.
* `.col > .hidden + div { margin-top: 0 }` — and the sibling rule counts hidden
  elements, so the first *visible* container was pushed down by a gap under
  something that is not on the screen.

In React the second one mostly stops applying — a pane that renders `null`
leaves no element — but the first still matters and `<Stack>` should own it.

## 2. Containers — beta has these, and they need variants

| class | state |
|---|---|
| `.panel` | have |
| `.card` | have |
| `.card.pick` / `.card.pick:hover` | MISSING — selectable, cursor changes |
| `.card.on` | have (accent border) |
| `.card.warn` | MISSING — left bar; the surprising case |
| `.card-title` / `.card-sub` / `.card-sub.bad` | title yes, sub yes, `.bad` no |
| `.card .cog` | MISSING — hidden until hover or selected |
| `.empty` / `.note` | have |

`.card.pick` is the whole master column and it is not ported.

## 3. Marks

| class | state |
|---|---|
| `.badge` + `ok bad warn run muted` | have |
| `.badges` | MISSING — the wrapping row |
| `.chip` + `on ok warn bad`, `.chips` | MISSING — the counts above a list |
| `.mono` `.muted` `.hidden` | have `.mono` |
| `.dot` `.dot.live` | have, inside Topbar |
| `.linky` `.linky-chip` | MISSING — opens in the real browser |
| `.verb` | MISSING |

## 4. Controls

| class | state |
|---|---|
| `.btn` + `ok danger wide small` | have `.btn`, kinds pass through |
| `.plus` | MISSING — the `+` in a titlerow |
| `.cog` | MISSING |
| `.finder` | MISSING — the find-a-thing input above a list |
| `.form input/select/textarea/label` | MISSING |
| `.plus.sync-ok/off/bad` | pane-private (see below) |

## 5. Navigation — mostly have

`.topbar` `.brand` `.tabs` `.tab` `.tab.active` `.tab-badge` `.subtabs`
`.subtab` `.pane` `.pane.active` — all ported.

`.view` / `.view.active` is MISSING and is not the same as a pane: it is
switching *within* a pane, which is how master/detail shows one detail at a
time.

`.brand-tab` and `.topright` are not ported.

## 6. The dialog — MISSING ENTIRELY, and it is the human gate

`.dlg-overlay` `.dlg` `.dlg-title` `.dlg-heading` `.dlg-body` `.dlg-cost`
`.dlg-err` `.dlg-tabs` `.dlg-tab` `.dlg-actions` `.dlg ul` `.dlg li`
`.dlg li.wide` `.dlg input/select/textarea/label`

This is not decoration. Every irreversible act in this app goes through
`ask()` — send it, merge it, allow it to be judged, approve a prompt, approve a
contract. The dialog is where the cost is stated and where the press is taken,
and the operator's rule is that a person makes those presses.

Rules it already encodes, learned the hard way:

* **bounded, and scrolls in the middle.** Title and buttons are pinned. A
  dialog that grows puts its confirm button below the bottom of a fixed
  overlay — which has happened.
* **`.dlg-cost`** states what the thing will spend before it is agreed to.
* **`.dlg-err`** shows a refusal *in place* rather than closing and going quiet.
* **`.dlg li.wide`** is why `ask()` accepts nodes and not only strings.

Nothing else should be built until this exists, because every remaining pane
needs it and five panes each inventing their own confirm is exactly the outcome
this port was meant to avoid.

## 7. Notices and banners — MISSING

| class | what it says |
|---|---|
| `.notice` + `ok bad`, `.notice-x` | something just happened; dismissable |
| `.stale-banner` | what is on screen is out of date |
| `.testing-banner` | testing mode is on — a standing state |
| `.running-banner` | a drill is running right now — a moment |

The last two are deliberately different colours. Amber is a state, purple is a
moment, and one colour for both is how somebody stops reading either.

## 8. Waiting — MISSING

`.skel` `.skel-line` `.skel-card`

Every ported pane currently says `asking…`, which is worse than the old window
and was my shortcut. A skeleton says "this is a list and it is coming"; the word
"asking" says nothing and looks like a failure state.

## 9. Text and code — MISSING

| class | what it is |
|---|---|
| `.code` | read-only Ace. Code that is read gets an editor, not a `<pre>` |
| `.md` | rendered markdown |
| `.console` + `tall` `short` | log output |
| `.line` + `good warn bad out`, `.t` `.g` `.m` | one log line: time, tag, message |
| `.spec` | `<details>`/`<summary>` with a key/value table |
| `.act` | one action's name, about, and what it takes |

`.code` needs the vendored Ace, which is not in this app yet. `.console` and
`.line` are needed by Live, Tasks and Judge and should come first.

---

## 10. NOT the theme — pane-private, and currently shared by accident

These are ~55 selectors that describe one pane's own furniture. They should move
into that plugin's own `.scss`, so deleting the plugin deletes its styles and
the shared kit stays swappable.

| family | selectors | belongs to |
|---|---|---|
| `.change-*` | 14 | a Changes pane (diff view) |
| `.term-*`, `.term-x` | 5 | terminal |
| `.msg*`, `.chat-*`, `.writer`, `.authline` | 12 | chat / supervisor |
| `.carries*` | 4 | branches |
| `.branch-facts`, `.branch-tasks`, `.card.branch` | 3 | branches |
| `.group-part`, `.group-why` | 3 | lines |
| `.sync-head`, `.sync-controls`, `.plus.sync-*` | 8 | github |
| `.card.snap*` | 4 | machines |
| `.graph-holder` | 2 | graph |
| `.head-state` | 1 | repos |

Nothing outside its own pane uses any of them. They are in the shared sheet
because there was one sheet.

---

## The order to build in

1. **Layout** — `Cols/Col/Stack/TitleRow/Grow`. Nothing else can be shaped
   correctly until this exists, and every pane already ported needs revisiting
   through it.
2. **Dialog** — `<Dialog>` and an `ask()` equivalent. The gate.
3. **Master list** — `.card.pick`, `.finder`, `.chips`, `<Skeleton>`. These
   always appear together and they are the left column.
4. **Console / log line** — needed by Live, Tasks, Judge.
5. **Banners and notices.**
6. **Split the pane-private selectors out** of `dashboard.scss` into the plugins
   that own them.
7. Then port branches, prcuts, changes, chat, guests, terminal, workspace.

Step 6 is the one that will get skipped if it is not written down, and it is the
one that decides whether `theme` is actually swappable or just a folder.
