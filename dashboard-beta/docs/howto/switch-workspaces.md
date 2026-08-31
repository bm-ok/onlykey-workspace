# Switch to a different workspace

A workspace is a folder of git repositories, and every other tab is a
statement about the one that is open. Switching is the largest thing this
app does in one press, so it asks first, and what changes is worth knowing
before you press it.

## Remembering one is not moving into it

**Workspace** (beside the title) → **Choose a folder…** opens this
computer's own folder dialog. In a browser tab there is no dialog to open,
so a list of the disk is used instead — and it says how many git
repositories each folder holds, which the dialog cannot.

Then two buttons, and they are different:

- **Remember it** puts the folder on the list and changes nothing else. Set
  up three folders in a sitting while working in a fourth.
- **Remember and open it** is the one that switches, and it asks first.

Neither writes anything into the folder. What this app learns about a
workspace is kept beside its own state, out of reach of a `git clean`.

## What follows the folder

**Everything that arms this app.** A workspace opened for the first time can
do none of it:

| | |
|---|---|
| Watching GitHub | off |
| Supervisor may wake itself | off |
| Queue starts by itself | off |
| Whose word counts | nobody — nothing arriving from GitHub can be a request |
| The tag | none set |
| Sent without being read | nothing — every reply, close and review is drafted |
| The drills | off, and the sandbox owner list is empty |

Also per folder: the repositories and everything learnt about them, tasks,
judgements, lines, PR cuts, drafts and what was sent, the caches, **the
machines**, **the whole library** — jobs, prompts, contracts and the
provisioning scripts — and **everything the supervisor keeps**: its
conversation, its todo list, its notebook and any skill it has proposed. A todo reading "#12 needs a
judge" names a task that exists in one workspace and is somebody else's
number in the next.

**Nothing is thrown away.** What is set for one folder stays with it —
switch back and it is as you left it. The Workspace tab shows the live
answer for the folder open now, under *What this workspace is armed to do*.

## What stays with this computer

The keys and sign-ins, the guards, the certificate authority and this app's
own ssh key, and which workspace is open. Those are facts about this
installation rather than about the work, so they are there whichever folder
is open.

**The machines and the library used to be on that list and are not any
more.** A machine belongs to the work it was built for: with one register
per host, switching folders showed the machines the other one made, because
nothing had ever asked which folder a machine belonged to. And a library
laid out as files in the workspace **is** a bundle — which is what makes a
second workspace something you can start from the first.

The supervisor's own state was the same mistake found earlier: a second
workspace opened with the first one's todo list waiting in it, and its
conversation still on screen. The machine is one per host; what it was
asked to do is about a folder.

### What that costs, said plainly

Deleting a workspace folder deletes its state — **including the machine
register and the artifacts a task delivered**. For tasks, cuts and notes
that is the point. For those two it is a real cost, taken deliberately for
one property: a workspace has one name and it is the folder.

A machine missing from the register is one this app will not touch, while
it goes on running in VirtualBox. If that ever happens the way back is
VirtualBox itself — the machines are still there under their own names, and
a new register is written by making the workspace again.

## What happens on screen

The window drops what was selected — the repository, the cut, the task, all
of them named in a folder that is no longer open — and reads everything
again. Repositories, Worker, Queue, Judge and Supervisor switch off when no
workspace is open at all, with the reason on them.

## An empty folder is a workspace

A folder with no git repositories in it opens perfectly well and every pane
says so rather than drawing blank. It is worth doing deliberately: it is the
cheapest way to see what this app looks like before anything is set up.

## Command line

    node tools/okc.js workspaces                    every one, and which is open
    node tools/okc.js workspaceAdd --dir C:\work    remember it, do not open it
    node tools/okc.js workspaceUse --dir C:\work    open it
    node tools/okc.js workspaceClose                put it down

`folderList` and `folderPick` are refused down the pipe: one enumerates the
disk, the other puts a window in front of whoever is sitting there.

## Setting a new one up

1. Open it. Check **Repositories → Repos** lists what you expect.
2. **Settings → Trust**: name whose word counts and choose the tag. Until
   both are set, nothing arriving from GitHub can be a request.
3. **Settings → General**: turn on watching, and the queue, if this folder
   should have them.
4. Look at **Workspace → What this workspace is armed to do** and check it
   says what you meant.

See [what a workspace is](../repositories/workspace-and-forks.md) and
[opening one](open-a-workspace.md).
