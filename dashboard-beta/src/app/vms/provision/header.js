//---------------------------------------------------------------------------
//THE BLOCK OF VALUES EVERY SCRIPT IS GIVEN, AND THE TWO HELPERS EVERY SCRIPT
//USES.
//
//PREPENDED RATHER THAN SUBSTITUTED INTO THE SCRIPT. That is the whole design:
//each file stays valid shell on its own, so it can be read, edited and run by
//hand on the machine to debug it. A script full of ${placeholders} is a script
//nobody can run where the problem is.
//
//AND EVERY VALUE IS QUOTED. A spec is configuration somebody types, and it ends
//up inside a shell file that runs AS ROOT at first boot — so a value carrying a
//quote must not be able to end the string it is in. This is the one function in
//the file that has to be right.
//---------------------------------------------------------------------------

//SINGLE QUOTES, AND THE ONE ESCAPE THAT WORKS INSIDE THEM.
//
//Shell gives no way to escape a `'` within `'...'`, so the only correct move is
//to CLOSE the string, emit an escaped quote, and open a new one: `'\''`.
//Everything else — backticks, $(), $VAR, newlines, semicolons — is already inert
//inside single quotes, which is why this is the whole of the defence.
function q(s) {
    return "'" + String(s == null ? '' : s).split("'").join("'\\''") + "'";
}

//WHAT A GUEST IS TOLD ABOUT ITSELF AND ABOUT THIS HOST.
//
//`where` is the network half — this host's address, the ports, and the
//fingerprint of the authority. It is passed in rather than looked up, because
//the address a guest must dial is a question about NETWORKS and is answered in
//../vbox/network.js.
module.exports = function header(vm, where) {
    var w = where || {};
    var spec = (vm && vm.spec) || {};
    var hostAddress = w.hostAddress;
    var base = 'https://' + hostAddress + ':' + w.port;

    var out = [];
    var put = function (line) { out.push(line); };

    put('#!/bin/bash');
    put('# ------------------------------------------------------------------------------');
    put('# Written by the dashboard for "' + String(vm.name) + '". Everything below this');
    put('# block is the script file itself, unchanged -- so it can be read, edited and run');
    put('# by hand.');
    put('# ------------------------------------------------------------------------------');
    put('OKC_VM=' + q(vm.name));
    put('OKC_HOST=' + q(hostAddress));
    put('OKC_PORT=' + q(w.port));
    put('OKC_BASE=' + q(base));
    put('OKC_USER=' + q(spec.user || 'okc'));
    put('OKC_SSH_KEY=' + q(spec.sshKey || ''));
    put('OKC_REPROVISION_ON_BOOT=' + q(spec.reprovisionOnBoot ? 'yes' : 'no'));

    put('# WHETHER THIS MACHINE IS MEANT TO HAVE A SCREEN, decided when it was made and');
    put('# never afterwards. A machine with no desktop boots in a fraction of the time and');
    put('# idles on a fraction of the memory -- no display manager, no session, no');
    put('# compositor -- which is what a runner that only ever holds a terminal wants.');
    put('#');
    put('# The scripts ASK this rather than guessing from what is installed: "there is no');
    put('# gdm here" is also true of a desktop machine whose install went wrong, and those');
    put('# two need opposite responses.');
    put('OKC_DESKTOP=' + q(spec.desktop === false ? 'no' : 'yes'));

    put('# WHETHER THIS MACHINE IS A SUPERVISOR rather than a runner, decided when it was');
    put('# made and never afterwards.');
    put('#');
    put('# A supervisor runs Claude Code to decide what work to give and asks the dashboard');
    put('# for it. It takes no tasks, so it needs none of what a task needs: no');
    put('# repositories, no project toolchain, no kernel headers for something it will');
    put('# never build. The project\'s own provisioning is skipped entirely, because "this');
    put('# project" is not what a supervisor is about.');
    put('OKC_SUPERVISOR=' + q(spec.supervisor === true ? 'yes' : 'no'));

    put('# This machine\'s own secret, and the port it dials in on. It can only ever connect');
    put('# as itself, because the dashboard checks this against the machine it claims to be.');
    put('#');
    put('# It reaches this script over TLS, which is the point: this line used to cross the');
    put('# network in the clear on every machine ever built, as the first thing that');
    put('# happened, because the installer fetched this file with plain curl.');
    put('OKC_TOKEN=' + q(spec.token || ''));
    put('OKC_CHANNEL_PORT=' + q(w.channelPort));

    put('# What proves the dashboard is the dashboard.');
    put('#');
    put('# OKC_CA is where the authority\'s certificate lives on this machine. Everything');
    put('# that talks to the host passes it, so nothing here ever needs to be told to skip');
    put('# verification -- which would have been the easy way to make a self-signed');
    put('# certificate work and would have thrown away the entire reason for having one.');
    put('#');
    put('# The fingerprint is carried so any script can re-fetch the authority and check it.');
    put('# The certificate is public and its address is unencrypted; THAT is what makes');
    put('# fetching it from there safe.');
    put('OKC_CA=/etc/okc/ca.pem');
    put('OKC_CA_URL=' + q('http://' + hostAddress + ':' + w.caPort + '/ca.pem'));
    put('OKC_CA_FINGERPRINT=' + q(w.caFingerprint || ''));
    put('');
    put('export OKC_VM OKC_HOST OKC_PORT OKC_BASE OKC_USER OKC_SSH_KEY OKC_REPROVISION_ON_BOOT OKC_DESKTOP OKC_SUPERVISOR');
    put('export OKC_TOKEN OKC_CHANNEL_PORT OKC_CA OKC_CA_URL OKC_CA_FINGERPRINT');
    put('');

    //FETCHES THE AUTHORITY IF IT IS NOT HERE, and REFUSES it unless it is the one
    //the fingerprint names. Safe to call from anywhere, including before there is
    //any certificate on the machine at all.
    put('okc_ca () {');
    put('  [ -s "$OKC_CA" ] && return 0');
    put('  [ -n "$OKC_CA_FINGERPRINT" ] || return 1');
    put('  mkdir -p "$(dirname "$OKC_CA")" 2>/dev/null || return 1');
    put('  tmp=$(mktemp) || return 1');
    put('  curl -fsS --max-time 20 "$OKC_CA_URL" -o "$tmp" || { rm -f "$tmp"; return 1; }');
    put('  got=$(openssl x509 -in "$tmp" -noout -fingerprint -sha256 2>/dev/null | tr -d \':\' | cut -d= -f2 | tr \'A-Z\' \'a-z\')');
    put('  want=$(printf \'%s\' "$OKC_CA_FINGERPRINT" | tr -d \':\' | tr \'A-Z\' \'a-z\')');
    put('  if [ "$got" != "$want" ]; then');
    put('    echo "okc: REFUSED the certificate authority -- it is not the one this machine was told to expect."');
    put('    rm -f "$tmp"');
    put('    return 1');
    put('  fi');
    put('  mv "$tmp" "$OKC_CA" && chmod 0644 "$OKC_CA"');
    put('}');
    put('okc_ca || true');
    put('');

    //EVERYTHING A SCRIPT PRINTS goes to one log on the machine and to the
    //dashboard, so the live log and the machine's own record say the same thing.
    //
    //ONCE, HOWEVER MANY SCRIPTS DEEP THIS IS. This header goes on EVERY stage,
    //and a stage is run BY another script that is already teeing into the same
    //file — so the child wrote each line to the log itself and also to the
    //parent's stdout, which the parent teed into the log. Every line appeared
    //twice, for a whole run, and nothing was wrong. That is the kind of noise
    //that makes a log stop being read.
    //
    //The flag is EXPORTED, so a stage started from a stage inherits it and writes
    //through its parent instead of opening its own tee.
    put('OKC_LOG=/var/log/okc-provision.log');
    put('touch "$OKC_LOG" 2>/dev/null || OKC_LOG=/tmp/okc-provision.log');
    put('if [ "${OKC_TEEING:-no}" != yes ]; then');
    put('  OKC_TEEING=yes');
    put('  export OKC_TEEING OKC_LOG');
    put('  exec > >(tee -a "$OKC_LOG") 2>&1');
    put('fi');
    put('');

    //NEVER FATAL, AND NEVER NOISY ABOUT IT: a machine must not fail to build
    //because the dashboard was restarted while it was talking.
    put('report () {');
    put('  curl -fsS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" --max-time 5 "$OKC_BASE/provision/report?vm=$OKC_VM&stage=$1" >/dev/null 2>&1 || true');
    put('}');
    put('');

    //ECHOED ALWAYS. Sent over HTTP only when nothing else is carrying our
    //output: during an install nobody is listening to stdout, but when the agent
    //runs a script it already streams stdout — and doing both put every line in
    //the log twice.
    put('say () {');
    put('  echo "okc: $*"');
    put('  if [ "${OKC_QUIET_SAY:-no}" != "yes" ]; then');
    put('    curl -fsS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" --max-time 5 --get --data-urlencode "text=$*" \\');
    put('      "$OKC_BASE/provision/say?vm=$OKC_VM" >/dev/null 2>&1 || true');
    put('  fi');
    put('}');

    return out.join('\n') + '\n';
};

module.exports.q = q;
