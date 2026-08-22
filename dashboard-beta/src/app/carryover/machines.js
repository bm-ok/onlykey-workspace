//---------------------------------------------------------------------------
//BRINGING THE MACHINES ACROSS.
//
//../vms/ours is a REGISTER: membership comes from the file and never from
//VirtualBox, because that is what lets this app refuse to touch a machine it did
//not make. So an app that starts with an empty register has no machines, whether
//or not four of them are running on this host — and the moment `vmList` stops
//relaying, the Runners tab goes blank while kit-1 keeps working.
//
//THIS IS THE ONE-WAY DOOR OF THE WHOLE PORT. Everything else moved behind a
//relay that kept the old app answering; this is where this app stops shadowing
//and starts owning. It is a deliberate act, run once, by a person.
//
//---- what it carries, and what it will not --------------------------------
//
//THE STORED FACTS ONLY. A record over there also carries `live`, `running`,
//`state`, `stage`, `connected`, `kind`, `agent` — none of which are stored
//anywhere: ../vms/ours/store.js works all of them out on every read, from
//VirtualBox and the channel. Carrying them would write down an answer that the
//next read overwrites, and until it did, this app would be reporting the other
//app's view of a machine as its own.
//
//AND NOT AN INSTALL IN PROGRESS. A machine with `installing` set is one the
//OTHER app is driving right now — twenty-five minutes of unattended installer
//that this app did not start, cannot watch and cannot finish. Carrying the flag
//would make this app report an install it is not running; carrying the machine
//without the flag would make it report a machine that is ready and is not.
//
//SO SUCH A MACHINE IS REFUSED, and named, and can be brought across when its
//install ends. That is the same rule ./server.js applies to an approval: the
//thing that must not cross is a CLAIM this app has not earned.
//
//---- and it carries the token, which is the careful part ------------------
//
//A machine's spec holds the token the channel checks when that machine dials in.
//Without it this app cannot authenticate its own machines, so there is no
//version of this that leaves it behind.
//
//WHAT THAT MEANS IS A SECOND COPY, at this app's own data folder rather than the
//other one's, in plain JSON exactly as the other app keeps it. It is the same
//secret already sitting in that machine's own config and in its git remotes —
//this adds a copy, not an exposure of a new kind. Worth knowing before running
//it rather than after.
//
//`sshKey` is the PUBLIC half and `password` is the installer's, which is `okc`
//on every machine here; neither is what makes this worth a paragraph.
//---------------------------------------------------------------------------

//WHAT IS WRITTEN DOWN, listed rather than inferred. Anything not here is either
//derived on read or deliberately dropped above — and a list is something the
//next person can check against ../vms/ours/records.js.
var KEEP = ['created', 'baseSnapshot', 'snapshots', 'reported', 'branch', 'borrowed'];

module.exports = function machines(deps) {
    var d = deps || {};
    var ours = d.ours;
    var there = d.there;   //ask the app being ported from

    async function carry(dry) {
        var out = { brought: [], already: [], couldNot: [], dry: !!dry };

        var said = await there('vmList', {});
        if (!said || !Array.isArray(said.vms)) {
            out.unreachable = true;
            out.note = 'The app being ported from did not answer, so there is nothing to bring across. '
                + 'It has to be running for this.';
            return out;
        }

        for (var i = 0; i < said.vms.length; i++) {
            var vm = said.vms[i];
            var name = vm && vm.name;
            if (!name) continue;

            //ALREADY HERE IS LEFT EXACTLY AS IT IS. A second run brings across
            //what is still missing and touches nothing else, so it is safe to
            //run twice — and safe to run after this app has started using one.
            if (ours.has(name)) {
                out.already.push({ name: name });
                continue;
            }

            if (vm.installing) {
                out.couldNot.push({
                    name: name,
                    why: 'it is being installed by the other app right now. Bring it across when that finishes — '
                        + 'this app cannot watch or finish an install it did not start.'
                });
                continue;
            }

            if (!vm.spec || !vm.spec.name) {
                out.couldNot.push({ name: name, why: 'it has no spec over there, so there is nothing to write down' });
                continue;
            }

            var carried = { name: name, tags: (vm.tags || []).slice(), snapshots: vm.snapshots || {} };
            if (dry) { out.brought.push(Object.assign({ would: true }, carried)); continue; }

            //THE SPEC AS IT IS, plus the two things ../vms/ours/records.js lifts
            //out of it — tags and serial live at the top of a record and are
            //read from the spec when one is made.
            var made = ours.add(Object.assign({}, vm.spec, {
                name: name,
                tags: carried.tags,
                serial: vm.serial || null
            }));

            var rest = {};
            KEEP.forEach(function (k) { if (vm[k] != null) rest[k] = vm[k]; });
            if (Object.keys(rest).length) ours.update(name, rest);

            out.brought.push(Object.assign({ id: made && made.name }, carried));
        }

        out.note = (dry ? 'Nothing was written. ' : '')
            + out.brought.length + ' ' + (dry ? 'would come across' : 'came across') + ', '
            + out.already.length + ' already here'
            + (out.couldNot.length ? ', ' + out.couldNot.length + ' could not' : '')
            + '.'
            + (out.brought.length && !dry
                ? ' Their tokens are now written here as well as in the other app — see the header of '
                  + 'src/app/carryover/machines.js.'
                : '');

        return out;
    }

    return { carry: carry, KEEP: KEEP };
};

module.exports.KEEP = KEEP;
