//---------------------------------------------------------------------------
//WHAT A MACHINE MAY ASK THIS PLUGIN FOR, WHILE IT IS BEING BUILT.
//
//Registered with ../https, which owns the certificate, the port, and turning
//`vm:token` into a machine record. Everything below is handed the machine that
//PROVED it is itself — see the note on `vm` below, which is the whole of the
//security here.
//
//---- the three things a guest does -----------------------------------------
//
//  GET /provision/<file>     fetch its own setup
//  GET /provision/report     say which stage it reached
//  GET /provision/say        put a line in the live log
//
//PLAIN GETS WITH NO BODY, because they are called by `curl` inside an installer
//that has nothing else on it yet.
//
//---- and who may -----------------------------------------------------------
//
//ANY MACHINE THIS APP MADE, including one that is only half-built — which is the
//point. A machine fetching first-boot.sh has no operating system yet, no agent,
//no role and nothing on it but the installer; a rule that asked what KIND of
//machine it is would refuse every machine at the only moment this matters.
//
//What it must be is ITSELF, and ../https has already established that before
//anything here runs.
//---------------------------------------------------------------------------

module.exports = function guestapi(deps) {
    var d = deps || {};
    var scripts = d.scripts;
    var settle = d.settle;
    var say = d.say;

    //ASKED BEFORE EVERY SCRIPT IS SERVED. Handed in rather than reached for, so
    //this file goes on knowing nothing about workspaces.
    var freshen = d.freshen || function () {};
    var where = d.where;     //the ports and fingerprint a rendered script is told

    //---- the file a machine is fetching ------------------------------------
    //
    //RENDERED FOR THE MACHINE THAT ASKED, NEVER FOR THE ONE NAMED IN THE QUERY.
    //
    //THIS IS THE ONE THAT MATTERED. A script carries the machine's TOKEN, so
    //serving it to whoever asked meant any machine could read any other
    //machine's secret and then BE that machine — dial in as it, push to its
    //branch. Encryption settled who could read it in transit and did nothing
    //at all about who could ask for it.
    //
    //`vm` here is the record ../https authenticated. The `?vm=` in the URL is
    //used for nothing but the log line, and that asymmetry is deliberate: a
    //guest naming a destination is a guest naming somebody else's.
    async function file(at) {
        //WHERE THE PROJECT'S SCRIPTS ARE, ASKED NOW RATHER THAN REMEMBERED --
        //the same rule as `where` below, and for a sharper reason. A machine
        //asks for these twenty-five minutes after it was made, and this half of
        //the app is rebuilt on every save in between: anything worked out when
        //the machine was created is gone by the time it asks.
        //
        //It cost an install. A save mid-install left a fresh copy of this plugin
        //with no idea where the project's folder was, and the guest spent ten
        //minutes being told "There is no provisioning script called extra.sh"
        //about a file that was on disk the whole time.
        await freshen();

        var vm = at.vm;
        var name = at.url.pathname.split('/').pop();
        var stage = scripts.stageOfFile(name);

        var to = say('vm', vm.name, 'guest');

        //THE THREE THAT ARE SERVED AS THEY ARE. A .py, .js or .md is a payload a
        //machine runs or reads; only a .sh gets the header of values, because
        //only a .sh is a script this app composes.
        if (/\.(py|js|md)$/.test(name)) {
            if (!stage) throw notServed(name);
            to.good(vm.name + ' asked for ' + name);
            at.res.writeHead(200, { 'content-type': typeOf(name) });
            at.res.end(scripts.raw(vm, stage));
            return;
        }

        if (!/\.sh$/.test(name)) throw notServed(name);

        //ANY SCRIPT IN THE PROVISIONING FOLDER, BY FILENAME, so a project's
        //swapped-in copy is served exactly as a default is — see ./scripts.js,
        //which resolves the name inside those directories and nowhere else.
        to.good(vm.name + ' asked for ' + name
            + ' (' + scripts.sourceOf(scripts.fileFor(vm, stage || name)) + "'s copy)");

        at.res.writeHead(200, { 'content-type': 'text/x-shellscript' });
        at.res.end(scripts.render(stage || name, vm, await where()));
    }

    function typeOf(name) {
        if (/\.py$/.test(name)) return 'text/x-python';
        if (/\.js$/.test(name)) return 'application/javascript';
        return 'text/markdown';
    }

    function notServed(name) {
        return new Error('"' + name + '" is not a provisioning file this app serves.');
    }

    //---- where it has got to -----------------------------------------------
    //
    //THE ONLY VIEW OF A MACHINE between "the installer started" and "it dialled
    //in". `settle.report` decides what to do with it — see ./settling.js, and
    //note that the guest's word is kept as its own fact rather than as the stage
    //this app derives.
    function report(at) {
        settle.report(at.vm.name, at.url.searchParams.get('stage') || 'running');
        return plain(at, 'ok\n');
    }

    //---- a line from inside a machine --------------------------------------
    //
    //INTO THE SAME LIVE LOG AS EVERYTHING ELSE, which is what makes a long
    //install watchable instead of silent.
    //
    //AUTHENTICATED, AND IT MATTERS MORE HERE THAN IT LOOKS: this writes into the
    //operator's log WEARING A MACHINE'S NAME. Without proof, anything on the
    //network could put convincing sentences in front of them, signed as a
    //machine it is not.
    function line(at) {
        say('vm', at.vm.name, 'guest').out(at.url.searchParams.get('text') || '');
        return plain(at, 'ok\n');
    }

    //`curl` INSIDE AN INSTALLER, so the answer is a word rather than JSON. There
    //is nothing on that machine yet to parse anything.
    function plain(at, text) {
        at.res.writeHead(200, { 'content-type': 'text/plain' });
        at.res.end(text);
    }

    return {
        name: 'provision',
        about: 'What a machine fetches and reports while it is being built',

        //ANY MACHINE THIS APP MADE — see the header. ../https has already proved
        //it is itself, and at this point in its life it is nothing else yet.
        may: function (vm) { return !!(vm && vm.name); },

        routes: [
            { method: 'GET', path: '/provision/report', about: 'the stage a guest has reached', run: report },
            { method: 'GET', path: '/provision/say', about: 'a line for the live log', run: line },
            { method: 'GET', path: '/provision/*', about: 'a provisioning file, rendered for the asker', run: file }
        ]
    };
};
