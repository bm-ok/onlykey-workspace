//---------------------------------------------------------------------------
//THE ONE DOOR ONTO THE WORKSPACE'S NOTES.
//
//ONE VERB, AND NOTHING ELSE REACHABLE THROUGH IT. That is the whole design, and
//it is why this exists at all rather than the file being dropped into
//`.okc/provision/` where ../vms/provision would have served it for free.
//
//THAT ROUTE SERVES A FOLDER; THIS SERVES A FILE. `/provision/*` resolves
//whatever name it is given against `[keptDir, .okc/provision, appDir]`, which is
//correct for a folder of scripts written to be handed out — and would be a hole
//the moment the root of `.okc` were added to it, because that folder also holds
//`machines.json`, `github-drafts.json`, `meter.json` and every contract. There
//is no name to pass here. There is nothing to ask for but the one document.
//
//---- WHO MAY READ IT ------------------------------------------------------
//
//EVERY MACHINE, including a supervisor. Unlike a handback or a session, this
//carries nothing belonging to one piece of work and nothing belonging to one
//machine — it is what this workspace is, and a supervisor asked to reason about
//the work has as much use for it as the worker doing it.
//
//IT MUST NEVER CARRY A SECRET, which is a rule about what people and machines
//WRITE into it rather than one this door can enforce. Said in the starter, said
//in ./server.js, and said again here because this is where it would leave.
//---------------------------------------------------------------------------

module.exports = function guestapi(deps) {
    var d = deps || {};

    var read = d.read;      //() -> { text, mine, at }
    var say = d.say;        //(who, name, 'guest') -> a logger

    async function notes(at) {
        var name = at.vm.name;

        try {
            var got = await read();

            at.res.writeHead(200, {
                'content-type': 'text/markdown; charset=utf-8',
                //WHOSE COPY IT IS, ON THE ANSWER. A guest cannot tell the
                //starter from a written-up workspace by looking at the bytes,
                //and the boot script says which one it wrote so the line in the
                //log is worth reading.
                'x-okc-notes': got.mine ? 'workspace' : 'starter'
            });
            at.res.end(got.text);
        } catch (e) {
            //A WORKSPACE THAT CANNOT BE READ IS NOT A MACHINE'S PROBLEM TO
            //SOLVE, and it must not stop a boot. 503 and a sentence: the boot
            //script treats any failure as "carry on without it", which is right
            //— a machine with no notes can still do its work, and a machine
            //that refused to finish booting over a missing document could not.
            say('workstrap', name, 'guest').warn(name + ' asked for the workspace notes and could not '
                + 'be given them: ' + e.message);
            at.res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
            at.res.end('the workspace notes could not be read: ' + e.message + '\n');
        }
    }

    return {
        name: 'workstrap',
        about: "The workspace's own notes — what every machine is given as CLAUDE.md",

        //---- WHO MAY ASK ------------------------------------------------
        //
        //EVERY MACHINE THIS HOST KNOWS, AND NOTHING ELSE. Unlike a handback or
        //a session, this carries nothing belonging to one piece of work and
        //nothing belonging to one machine — it is what the workspace IS, and a
        //supervisor reasoning about the work has as much use for it as the
        //worker doing it. So the rule is only that the caller be a machine at
        //all, which ../vms/https has already proved by the time this is asked.
        //
        //STATED RATHER THAN OMITTED, and it has to be: the register refuses a
        //door that does not say, on the grounds that a plugin which stays quiet
        //is one opening its verbs to every machine on the host without anybody
        //deciding that. This plugin was written with the sentence above in a
        //comment and no function under it, and the app would not start.
        may: function (vm) { return !!(vm && vm.name); },

        routes: [
            { method: 'GET', path: '/workstrap', about: "the workspace's notes", run: notes }
        ]
    };
};
