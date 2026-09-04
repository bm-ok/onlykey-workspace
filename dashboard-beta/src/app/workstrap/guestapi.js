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
//A WORKER, A JUDGE, OR A DIY SEAT — the three that open the code. Not a
//supervisor: it cannot see the code, which is the design rather than an
//oversight, so a document about finalising, building and testing the project is
//the one thing it has no use for and should not be reasoning from. See `may`
//below.
//
//IT MUST NEVER CARRY A SECRET, which is a rule about what people and machines
//WRITE into it rather than one this door can enforce. Said in the starter, said
//in ./server.js, and said again here because this is where it would leave.
//---------------------------------------------------------------------------

var roles = require('../vms/ours/roles');

module.exports = function guestapi(deps) {
    var d = deps || {};

    var read = d.read;      //() -> { text, mine, at }
    var say = d.say;        //(who, name, 'guest') -> a logger
    var gave = d.gave;      //(machine, text) -> remember what this machine was handed

    async function notes(at) {
        var name = at.vm.name;

        try {
            var got = await read();

            //---- WHAT THIS MACHINE WAS GIVEN, WRITTEN DOWN AS IT GOES ------
            //
            //SO A STALE COPY IS NEVER MISTAKEN FOR AN EDIT. When the notes are
            //read back at shutdown there are three values, not two: what this
            //machine was GIVEN, what the host has NOW, and what is on the
            //machine. Comparing the last two is the obvious thing and it is
            //wrong — a seat that booted this morning and touched nothing would
            //look like it had reverted every change approved since.
            //
            //RECORDED HERE BECAUSE THIS IS THE ONLY PLACE THAT KNOWS. The door
            //hands over an exact string to an exact machine; anywhere else has
            //to guess which version that was, and guessing is the whole problem.
            //
            //NOT WORTH FAILING THE FETCH OVER. A machine that got its notes but
            //whose base was not recorded is one this app cannot later tell an
            //edit from a stale copy on — and `changed` treats a missing base as
            //"cannot tell", which drafts nothing and says so.
            try { if (gave) gave(name, got.text); }
            catch (e) {
                say('workstrap', name, 'guest').warn('could not record what ' + name
                    + ' was given, so a later change on it cannot be told from a stale copy: ' + e.message);
            }

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

        //---- WHO MAY ASK: WHATEVER OPENS THE CODE, AND NOTHING ELSE ------
        //
        //A WORKER, A JUDGE, OR A PERSON IN A DIY SEAT. Those are the three that
        //check the repositories out and have to get them running, and this
        //document exists for exactly that moment.
        //
        //NOT A SUPERVISOR, AND THAT IS THE SAME FENCE ../runners/handback
        //KEEPS. A supervisor cannot see the code — it is the design, and its own
        //skill leads with it — so it has no workspace to finalise, no tests to
        //run and nothing to build. Handing it the build and test instructions
        //would be handing the one role kept away from the code a document that
        //is entirely about the code, and it would start reasoning from it.
        //
        //ASKED THROUGH ../vms/ours/roles RATHER THAN BY READING TAGS. `canBe`
        //is where "what is this machine for" is answered for the queue, the
        //panes and the drills, and a fourth reader inventing its own tag check
        //is how the four begin to disagree. It also settles a machine tagged
        //both worker and judge, and an untagged one — which gets no credential
        //either, for the same reason: an unlabelled box is not a role.
        //
        //STATED RATHER THAN OMITTED, AND IT HAS TO BE. The register refuses a
        //door that does not say, on the grounds that a plugin staying quiet is
        //one opening its verbs to every machine without anybody deciding that.
        //This was first written with a sentence in a comment and no function
        //under it, and the app would not start — which is the guard working.
        may: function (vm) {
            return roles.canBe(vm, 'worker')
                || roles.canBe(vm, 'judge')
                || roles.canBe(vm, 'diy');
        },

        routes: [
            { method: 'GET', path: '/workstrap', about: "the workspace's notes", run: notes }
        ]
    };
};
