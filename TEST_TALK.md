> **READ THIS FIRST — everything below question 1 was measured through a broken
> pipe, and most of the conclusions in it are wrong.**
>
> `whatsNew` marked messages read on the way out, and the skill tells the
> supervisor to keep that bookmark and pass it. It calls `whatsNew` two to four
> times a turn. So the first call returned the message and moved the mark, and
> the second — mid-turn, with the fresh bookmark — returned an empty
> conversation. Whichever look it composed its answer from decided whether the
> person existed.
>
> Fixed in d6c21e9: the floor is now the last thing the supervisor itself SAID,
> so anything unanswered cannot be hidden by any bookmark it passes.
>
> WHAT THAT INVALIDATES:
> - "a direct request loses to the status loop" — no. The request was erased
>   before it decided anything.
> - the skill clause at 0aa1b9c ("the request is the waking") — untested, and
>   possibly unnecessary. Left in; it is true either way.
> - question 1's first miss, and BOTH question 2 attempts — all suspect.
> - the harvest that worked probably worked because that turn happened to use
>   the first look.
>
> HOW IT WAS CAUGHT: it took asking the supervisor about its own behaviour and
> getting "nothing to do" back to make the pattern undeniable. A less complete
> failure would have read as a flaky model and been tuned around for ever.
>
> Anything below is kept as it was written. Re-run before believing it.

> **AND THERE WAS A SECOND PIPE FAULT, FOUND 19 AUGUST — so results measured
> between the two fixes are suspect as well.**
>
> `whatsNew` had grown to 102,179 characters and the chat feed was 82,590 of
> them. The feed capped at two hundred MESSAGES and nothing else, which is a
> sensible number of things to read and says nothing about how much text they
> are — and the supervisor writes in paragraphs. The whole reply went past what
> the reading end accepts, so the supervisor could not read the chat AT ALL.
>
> It said so on nine consecutive wakings, filed it as T11, and carried on
> answering from the board — competently, which is what made it survivable and
> what made it invisible. Every message a person sent it in that window went
> unread, and the one thing it needed to say about that was the one thing it
> could not be told.
>
> Fixed by bounding the feed by size as well as count, newest kept, and SAYING
> how many were dropped: 102,179 characters down to 34,839.
>
> WHAT THAT MEANS FOR THIS DOCUMENT. The first fix made the message arrive; this
> one made it arrive READABLE. Both faults were in the same pipe and neither was
> visible from the supervisor's answers, which were always plausible. So the
> honest position is that **nothing below has ever been measured through a pipe
> known to be open at both ends** — including the re-runs done after the first
> fix.
>
> THE PATTERN WORTH CARRYING, because it has now happened twice: when a
> supervisor answers something other than what was asked, suspect the delivery
> before the model. Both times the model was doing exactly the right thing with
> what it could see.

Each of these costs one waking — the meter says ~$0.83–0.98 a turn — so pick rather than run them all. Ordered by what they'd teach per pound.

# 1. The harvest rule — no machine, tests the thing I just built
```
you have a new instruction about findings a judge made that nobody asked for. go back through J37, J38 and J39, read what they handed back, and put anything worth keeping on the todo list naming the judgement it came from. dont queue any work off them.
```

Good answer: two or three todos citing J37/J38/J39, including the server.js:96-102 one. Bad answer: it adds nothing, or it queues a task anyway — the brake is a paragraph in the skill, not code, so that's the thing worth watching.

actual response:
```
Nothing has moved since the last waking: no tasks or judgements queued or running, all three default branches match origin, and GitHub is reachable again after the 07:30–07:40 outage — PR #13 is still open at the same head 8e0e268, so nothing to re-judge. I closed T3 off the list, since J39 settled it: local-repo-c (csvstat, 77-line CLI, zero dependencies, 44 passing tests) has nothing local-repo-a or -b would use, so integrating it isn't worth doing. That leaves one thing, and it's yours: PR #13, which I've already reported NO on — and T2, worth asking the author which caller actually passes a string id before anyone rewrites that coercion.
```

what it meant: a fair negative, and mostly the rule's fault rather than its own.

- delivered — the bookmark moved to n63 at 15:17:22, so it read the message
- the skill refreshed cleanly — no okc-skill-stale, so it had the rule
- it called `judging`, saw J37/J38/J39, and never opened `judgementFindings`

The rule said "every time you read what a judgement handed back" — that is the
moment one LANDS. Those three landed days ago and are `done` with verdicts
recorded, which makes them invisible to a loop built around what changed since
last waking. Correct by the rule as written; the asides were lost by being old
rather than by being unimportant.

Not a wasted turn: it closed T3 off J39's answer, with the reasoning, which is
the todo-as-memory loop working.

changed since (509aceb): the skill now names the backlog — "if you have never
done this for a judgement you can see, do it once, oldest first, and say which
ones you went back over", and "a request to go back over specific ones is this,
even where you have looked before".

worth re-running verbatim. if it still does not harvest with that clause in
front of it, the problem is 24,000 characters of skill rather than the wording —
which is the more useful thing to know before spending a machine on 2.

response 2
```
I under-answered you at 15:18 — I reported the board instead of doing what you asked, so I've now read all three findings in full and put the unasked-for parts on the list, each naming its judgement, with nothing queued off them. T4 (J37): if #13 lands as written the store's three id methods disagree — update goes through get so it changes too, remove still compares raw, so remove('3') silently 404s, and no test covers any of it. T5 (J38's own "worth writing down for whoever reads this next"): the strict === is protected solely by local-repo-a/src/server.js:96-102 — local-repo-b's Number() at public/app.js:78 is thrown away by URL interpolation a line later — so anyone dropping that guard breaks every id lookup from the UI at once. T6 (J39, explicitly "not filed"): csvstat's toRecords omits the problems key on empty input, harmless today because bin/csvstat.js:67 writes problems || [], but a trap for any second caller. One thing I deliberately did not file: J39 also noticed the stale README example in local-repo-c — that is already fixed and sitting in open PR #3, so it needs merging rather than listing.
```

# 2. Which chain it picks — costs a machine boot
```
check this claim: in local-repo-a, the only thing stopping a non-integer id reaching Store is the check in src/server.js around lines 96-102. if that check went, everything downstream would silently look up nothing.
```
Nicely circular — that claim is J38's aside, so it closes the loop. The test is whether it reaches for check-a-claim-and-say-what-else over check-a-claim with both offered, and whether the Also noticed section comes back with something real or padded.

actual response (15:31): it never mentioned the claim. It found that #13 had
been closed and did housekeeping instead — closed T2 and T4 ("both of which only
mattered if #13 landed"), confirmed master is still 7e1c23a, cleared the csvstat
items now #3 and #4 are merged. All correct, none of it what was asked.

what it meant: two findings, neither about the new chain.

- A DIRECT REQUEST LOSES TO THE STATUS LOOP. Second time in three messages: a
  waking carrying both a request and a change answers the change and drops the
  request without acknowledging it. Worse than a refusal, because a refusal can
  be seen. Fixed in the skill (0aa1b9c): "if the person asked for something,
  that is the waking" — and declining is fine as long as it says so and why.
- THE QUESTION WAS COMPROMISED AND I DID NOT SPOT IT. The claim IS T5, which
  J38 already established and which is sitting on the todo list. So "check this
  claim" reads as "re-check something already settled" — which is a legitimate
  thing to push back on. The test could never distinguish "ignored you" from
  "correctly declined". My fault in the design of the test, not its answer.

also fixed while here: `pulls --repo bmatusiak/local-repo-a` was refused with
"there is no repository called that" — false, and the third refusal of that
shape. Either name now works in either field.

2b. The replacement — a claim nothing has judged and no todo covers
```
check this claim: in local-repo-b, nothing validates what comes back from the api before it goes into the page, so a note title containing markup would be rendered as markup rather than shown as text.
```
Unknown answer on purpose, in the repository no judge has read in depth. Tests
the same three things without the "already settled" escape: which chain it
picks with both offered, whether Also noticed comes back real or padded, and
whether it harvests its OWN new judgement — the rule's original trigger, which
question 1 could never reach.

RUN 2026-08-19 15:56, and the FIRST question in this document measured through a
pipe known to be open at both ends. J66, `check-a-claim`, 180s on kit-1 as
runner4, 0.74 USD, CLAIM: false.

**1. WHICH CHAIN — the old one, for the third time.** With both offered and no
steer it took `check-a-claim`. `check-a-claim-and-say-what-else` has now been
approved, in use, and chosen zero times across three chances. That is no longer
explainable as a broken pipe, and it is the one clean fact this run bought.

**2. ALSO NOTICED — real, and it did not need the contract.** This is the result
that matters. The asides contract exists to REQUIRE a section for findings nobody
asked about; the ordinary chain produced one anyway, and a good one. The claim
itself was FALSE — it proved that by running the real `api.list()` against a fake
fetch returning `<img src=x onerror=alert(1)>`, passing the result to the real
`renderNotes`, and showing the hostile string arrive at the one markup sink
escaped. Then, unasked, it found `note.id` genuinely unescaped at render.js:35
and :40 — and beat a previous judgement on it: J42 wrote that off as unreachable
because ids are server-assigned integers, and J66 found the way in J42 missed,
`?api=` in README.md:21-22, which lets a substituted server supply an id of any
shape for the price of a crafted link.

So the behaviour the second contract was written to enforce happens without it.
**Worth settling before writing any more contract**: whether that chain is
solving a problem the judges do not have.

**3. HARVESTING ITS OWN — reported, not filed.** It told the person about the
aside and explicitly did not queue work off it: "a change to make rather than a
claim to check, and you may reasonably decide a demo app's `?api=` is not a
threat model. Say the word and I will write it as a task naming J66." Correct
under the rules it has, and it means the harvest went to the conversation rather
than to the todo list.

AND ONE FRICTION, FIXED: it asked `judgementFindings` for "CLAIM.md" and was
refused — files are stored as `<run>--<name>`, so the name the job was told to
write is not the name on disk. It recovered, but the refusal was this app's
bookkeeping leaking. A findings file can now be asked for by its short name where
that is unambiguous, and refused with the list where two runs both wrote one.

# 3. Your strictness question, asked of the thing that would know
```
whats stopped you lately? name anything you tried that was refused, or wanted to do and couldnt find a way to. i want to know if the api is too narrow or just incomplete.
```
It has real material — the gate refusal, the judging --ref local-repo-a#13 refusal at 07:45, the two-names problem.

# 4. The memory hole, measured rather than argued
```
without looking anything up: what standing instructions do you think ive given you? things i said once that still apply.
```
Whatever it lists is what survived; whatever it misses is behind the bookmark. That's the pinned-messages question answered with evidence instead of my reasoning.

# 5. Housekeeping, cheap — SPENT: #13 was closed by hand on 18 Aug, so ask it
   what is outstanding instead of naming that one.
```
anything outstanding you want off your plate before i pick the next thing? i closed #13.
```
I'd send 1 first — it's the only one testing code written since it last woke, and it's the loop you described wanting. Then 2 if 1 looks right, since that's the one that spends a machine.

