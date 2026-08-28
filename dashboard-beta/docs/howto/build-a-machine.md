# Build a machine

A machine is a VirtualBox VM this app made, installed unattended from an
Ubuntu Server ISO, provisioned with the app's scripts, and snapshotted as a
clean base. Workers, judges and the supervisor all run on machines like it.

## Before

- VirtualBox installed; `status` names `VBoxManage.exe`.
- An Ubuntu **live-server** ISO downloaded; `vmIsos` lists what VirtualBox
  knows about. The desktop ISO does not work headless.

## Steps

1. **Runners → Virtual machines → New machine.** Name it, pick the ISO,
   memory and disk, and its **tags**: `worker`, `judge`, or both; tick
   *supervisor* for a supervisor. Tags are what the queue picks a machine
   by.
2. **Install.** Unattended, about twenty-five minutes. Nothing else comes
   up while it does. Watch it with **Console** (Terminal tab) or
   `vmLog --name X --which serial`. The installer prints the addresses it
   can be reached on.
3. When it says *booted* and *connected*, the agent on it has dialled in to
   this host on port 7383. If it never does, read `events` for *nothing is
   listening for machines* — that is the host, not the machine.
4. **Base snapshot** is taken for you at the end of the install. Every run
   afterwards starts from it and is rolled back to it.

## Command line

    node tools/okc.js vmCreate --vm '{"name":"w2","iso":"C:/.../ubuntu-24.04-live-server-amd64.iso","tags":["worker"],"memoryMB":4096,"diskMB":30720}'
    node tools/okc.js vmInstall --name w2
    node tools/okc.js vmAwait --name w2 --for dialled
    node tools/okc.js vmList

## Afterwards

- `vmTags --name w2 --tags worker,judge` changes what it is for.
- `vmForTasks --name w2 --enabled false` keeps it back from the queue.
- `vmBorrow` takes one out for a person; `vmReturn` puts it back clean.
- A machine is put back to **off, on its base snapshot, holding nothing**
  after every task. `vmHolds` says if one is holding commits not pushed.

Never restart the app while a machine is installing: the install fetches
its scripts from this host at the very end.
