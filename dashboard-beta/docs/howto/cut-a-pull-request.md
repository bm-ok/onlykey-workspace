# Cut a pull request

A cut is one act that opens one pull request per repository the change
touches, tracked here as one landing. It needs a **line** to cut from and a
**line** to cut into, and a judgement of the code.

## Steps

1. **Make the branch a line.** Repositories → Branches Cut → the branch →
   **As a line** (`branchAsLine --branch fix/x --name fix/x --why ...`). A
   line is a named point: one branch per repository.
2. **Have it judged.** A cut of unjudged code is refused: *Nothing has
   judged "fix/x"*. Queue → judgement on the branch, or wait for the one the
   supervisor queues when a task lands.
3. **Write what it says.** Repositories → New PR Cut → pick source and
   target lines → title and description. The template blocks are added
   under whatever you write: why the branch was cut, what it was cut from,
   the commits, the `Closes owner/repo#N` line from the issue it carries,
   and links between the pull requests when there are several. **Preview**
   shows the composed body (`prTemplatePreview`); `prTemplate` turns blocks
   on and off.
4. **Cut it.** Pushes each branch to its repository's GitHub remote and
   opens the pull requests, into the repository chosen by *Send work to*.

## Afterwards

- **PR cuts** shows each pull request, its state read from GitHub, its
  reviews (approvals and changes requested, counted per reviewer).
- A later task on the same branch, judged and accepted, is pushed onto the
  open pull request by the host (`prCutRefresh`). Cutting the same pair
  again does the same and opens nothing.
- **Merging is yours**: on GitHub, or **Land it** here (`prCutLand`), which
  is a purple press.
- `Closes` closes the issue only when the merge is into the issue's own
  repository's default branch. Across repositories it links; close the
  issue with the drafted `issueClose`.

## Command line

    node tools/okc.js prDraftSave --source fix/x --target test-bc1 --title "..." --body "..."
    node tools/okc.js prTemplatePreview --source fix/x --target test-bc1
    node tools/okc.js prCutMake --source fix/x --target test-bc1 --title "..." --body "..."
    node tools/okc.js prCuts
    node tools/okc.js prCutState --source fix/x --target test-bc1
