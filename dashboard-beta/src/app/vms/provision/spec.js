//---------------------------------------------------------------------------
//WHAT A MACHINE IS BUILT AS, DECIDED ONCE.
//
//EVERY DEFAULT HERE WAS ARRIVED AT BY RUNNING THE THING rather than guessed,
//and several of these fields are DECIDED HERE OR NEVER — because they change
//what gets installed at first boot, and flipping one afterwards would say
//"desktop" about a machine with no X on it at all.
//
//Which makes this the one place where a machine's identity is settled: the
//flag, the tag and the secret cannot disagree, because there is only one moment
//at which any of them is set.
//---------------------------------------------------------------------------

//A NAME IS AN ADDRESS. VirtualBox knows the machine by it, every action takes
//it, and it ends up in a hostname and a folder path — so it is letters, numbers,
//dots and dashes, and the refusal says what is allowed rather than what is not.
var NAME = /^[\w.-]+$/;

function yes(v) { return v === true || v === 'true'; }

module.exports = function spec(deps) {
    var d = deps || {};

    //ITS OWN SECRET, PER MACHINE, so a machine can only ever dial in as itself.
    //Handed in from ../channel rather than made here, so the thing that checks
    //tokens and the thing that issues them are the same thing.
    var newToken = d.newToken || function () { return ''; };

    //THE TAGS THIS APP GIVES A MEANING TO, from ../ours. Named there because a
    //role is a fact about a machine record; used here because this is the moment
    //somebody says what the machine is for.
    var SUPERVISOR = d.SUPERVISOR || 'supervisor';
    var POOL = d.POOL || 'default';

    function fill(input) {
        var it = input || {};
        var name = String(it.name || '').trim();

        if (!NAME.test(name)) {
            throw new Error('Give it a name using letters, numbers, dots or dashes — no spaces.');
        }

        //DECIDED HERE OR NEVER, and read only afterwards.
        //
        //A desktop is not decoration: a task with no job leaves its machine
        //running at a desktop for whoever wrote it. But a runner that only ever
        //holds a terminal pays for a display manager, a session and a compositor
        //it never shows anybody — a gigabyte of memory and most of the boot. Two
        //machines coming up at once is what wedges this host, and most of what
        //they compete over is a desktop nobody is looking at.
        //
        //OFF UNLESS ASKED FOR, because every machine is installed from the
        //SERVER image and a desktop is something ADDED. That way round because
        //stripping is never as complete as never installing.
        var desktop = yes(it.desktop);

        //AND THE ONE KIND THAT IS NOT A RUNNER. A supervisor runs Claude Code to
        //decide what work to give and asks this dashboard for it. It takes no
        //task, clones no repository, and gets none of the project's provisioning.
        //
        //Same rule as `desktop` and for the same reason: it changes what is
        //installed at first boot. It also carries a tag that cannot be taken off
        //by hand, because the tag is what keeps it out of the pool — and a tag
        //somebody can remove is not a guarantee.
        var supervisor = yes(it.supervisor);

        //---- AND A SUPERVISOR NEVER GETS A DESKTOP -------------------------
        //
        //IT HAS NO X DISPLAY AT ALL. A supervisor is installed slim — node and
        //Claude Code — and gets none of the project's provisioning, so asking
        //for a desktop on one is asking for something that cannot be built.
        //
        //THESE WERE READ INDEPENDENTLY and both were kept, so `vmCreate` would
        //happily record a supervisor that wanted a desktop and then build one
        //without: the record said one thing and the machine was another, and
        //every reader afterwards believed the record. The window refuses the
        //combination now, and a rule the window enforces alone is a rule the
        //command line does not have.
        //
        //TAKEN QUIETLY RATHER THAN REFUSED, because it is not a mistake worth
        //stopping for — nothing is lost, the machine is the one that was asked
        //for in every other respect, and `desktop: false` is what a supervisor
        //means. What must not happen is the record claiming otherwise.
        if (supervisor) desktop = false;

        return {
            name: name,

            //A NAMED LTS ostype, because "Ubuntu_64" makes VirtualBox pick worse
            //defaults for its unattended installer. 8GB and 4 cpus because a
            //build in a 2-cpu guest is miserable, and 60GB because a toolchain
            //plus sources outgrows 30.
            ostype: it.ostype || 'Ubuntu24_LTS_64',
            cpus: Number(it.cpus) || 4,
            memoryMB: Number(it.memoryMB) || 8192,
            vramMB: Number(it.vramMB) || 128,
            diskMB: Number(it.diskMB) || 61440,
            iso: it.iso || '',

            desktop: desktop,
            supervisor: supervisor,
            tags: tagsFor(it, supervisor),

            //BRIDGED, because a guest has to be able to reach this app to fetch
            //its setup, and on NAT it cannot see the host at all without more
            //plumbing.
            network: it.network === 'nat' ? 'nat' : 'bridged',
            bridgeAdapter: it.bridgeAdapter || '',
            sshPort: Number(it.sshPort) || 2222,

            user: it.user || 'okc',
            password: it.password || 'okc',
            fullName: it.fullName || 'okc',
            hostname: it.hostname || (name.replace(/[^a-z0-9-]/gi, '-') + '.local'),
            locale: it.locale || 'en_US',
            timeZone: it.timeZone || 'UTC',

            //---- NO `installAdditions`, AND NOTHING LOST WITH IT -----------
            //
            //IT SAID WHETHER TO INSTALL THE GUEST ADDITIONS DURING THE INSTALL,
            //defaulting on for a desktop and forced on by shared folders. What
            //it actually did was make VirtualBox splice a `packages:` list into
            //the autoinstall so it could build the kernel modules mid-install --
            //and a live-server install has no package index but the CD's, so
            //that failed with `E: Unable to locate package build-essential` and
            //took the whole install with it. See ./installing.js.
            //
            //BOTH REASONS IT EXISTED ARE MET ANOTHER WAY NOW, and better:
            //
            //  the mount helper   ./scripts/toolchain.sh installs
            //  and the clock      virtualbox-guest-utils on EVERY machine, so a
            //                     share does not need a desktop to be mountable
            //
            //  clipboard, resize  ./scripts/desktop.sh installs
            //  drag-and-drop      virtualbox-guest-x11, where there is a screen
            //
            //Ubuntu already ships the kernel half -- vboxguest and vboxsf -- so
            //none of it is compiled and none of it needs a compiler.
            //
            //A FLAG NOTHING READS IS WORSE THAN NO FLAG: it reads as a switch
            //somebody can still turn.

            baseSnapshot: it.baseSnapshot || 'base',
            sshKey: it.sshKey || '',
            token: it.token || newToken(),

            //DECLARED, NEVER ASSUMED. An empty list means the concept does not
            //apply to this machine, which is a different thing from not having
            //been asked.
            usb: Array.isArray(it.usb) ? it.usb : [],
            shares: Array.isArray(it.shares) ? it.shares : [],
            setup: Array.isArray(it.setup) ? it.setup : []
        };
    }

    //WHAT IT IS FOR, and unlike the two above this can be changed whenever you
    //like. It is asked for HERE because the moment somebody is making a machine
    //is the moment they know what it is for, and a field asked six weeks later
    //is one nobody goes back to fill in.
    //
    //A LIST OR ONE COMMA-SEPARATED STRING, because the window sends a typed line
    //and a script sends an array, and neither should have to know what the other
    //does.
    function tagsFor(it, supervisor) {
        var asked = (Array.isArray(it.tags) ? it.tags : String(it.tags == null ? '' : it.tags).split(','))
            .map(function (t) { return String(t).trim().toLowerCase(); })
            .filter(Boolean);

        //A SUPERVISOR CARRIES ITS TAG WHATEVER ELSE WAS TYPED, because the tag
        //is what the queue reads. Written in here rather than checked in three
        //places later: the tag and the flag cannot disagree if there is only one
        //moment where either is set.
        if (supervisor) asked.push(SUPERVISOR);

        var out = [];
        asked.forEach(function (t) { if (out.indexOf(t) < 0) out.push(t); });

        //EVERY MACHINE IS IN A POOL. One given no kind is in the ordinary one,
        //and it SAYS SO — a reader inferring it is how "which pool is this in"
        //came to have two sorts of answer, a tag or a shrug.
        //
        //A SUPERVISOR IS NOT, and it needs no clause of its own to stay out: it
        //already carries its tag by the time this is reached, so it can never be
        //the empty case. Putting it in the pool work is drawn from would be a
        //name for something that can never happen.
        if (!out.length) return [POOL];
        return out;
    }

    return { fill: fill, NAME: NAME };
};

module.exports.NAME = NAME;
