//what ../../test/vms/provision-header.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/provision/header.js',
    test: 'test/vms/provision-header.test.js',
    breaks: [
        //THE ONE FUNCTION IN THE FILE THAT HAS TO BE RIGHT. A spec is
        //configuration somebody types, and it ends up in a shell file that runs
        //AS ROOT at first boot.
        ['a value is not quoted at all',
            'function q(s) {\n    return "\'" + String(s == null ? \'\' : s).split("\'").join("\'\\\\\'\'") + "\'";\n}',
            "function q(s) {\n    return String(s == null ? '' : s);\n}"],

        ['a value is quoted but a quote inside it is not escaped',
            'return "\'" + String(s == null ? \'\' : s).split("\'").join("\'\\\\\'\'") + "\'";',
            'return "\'" + String(s == null ? \'\' : s) + "\'";'],

        ['a quote is escaped the way it would be in double quotes',
            'split("\'").join("\'\\\\\'\'")',
            'split("\'").join("\\\\\'")'],

        ['double quotes are used, where everything is live again',
            'return "\'" + String(s == null ? \'\' : s).split("\'").join("\'\\\\\'\'") + "\'";',
            'return \'"\' + String(s == null ? \'\' : s) + \'"\';'],

        ['nothing at all becomes an empty word rather than an empty string',
            "    return \"'\" + String(s == null ? '' : s).split(\"'\").join(\"'\\\\''\") + \"'\";",
            "    if (s == null) return '';\n    return \"'\" + String(s).split(\"'\").join(\"'\\\\''\") + \"'\";"],

        //A machine can only ever connect as itself.
        ['the token is left out',
            "    put('OKC_TOKEN=' + q(spec.token || ''));",
            "    put('OKC_TOKEN=' + q(''));"],

        //Missing means yes for a desktop; missing means no for a supervisor.
        ['a machine built without a desktop is told it has one',
            "    put('OKC_DESKTOP=' + q(spec.desktop === false ? 'no' : 'yes'));",
            "    put('OKC_DESKTOP=' + q('yes'));"],

        ['an ordinary runner is told it is a supervisor',
            "    put('OKC_SUPERVISOR=' + q(spec.supervisor === true ? 'yes' : 'no'));",
            "    put('OKC_SUPERVISOR=' + q(spec.supervisor ? 'yes' : 'no'));"],

        ['every machine is provisioned as a supervisor',
            "put('OKC_SUPERVISOR=' + q(spec.supervisor === true ? 'yes' : 'no'));",
            "put('OKC_SUPERVISOR=' + q('yes'));"],

        //A guest cannot use 127.0.0.1 to reach the host.
        ['a guest is told to dial the loopback',
            "    var hostAddress = w.hostAddress;",
            "    var hostAddress = w.hostAddress || '127.0.0.1';\n    hostAddress = '127.0.0.1';"],

        //A child stage inherits nothing that is not exported.
        ['the values are set but never exported',
            "    put('export OKC_VM OKC_HOST OKC_PORT OKC_BASE OKC_USER OKC_SSH_KEY OKC_REPROVISION_ON_BOOT OKC_DESKTOP OKC_SUPERVISOR');\n    put('export OKC_TOKEN OKC_CHANNEL_PORT OKC_CA OKC_CA_URL OKC_CA_FINGERPRINT');",
            ''],

        ['the secret half is not exported',
            "    put('export OKC_TOKEN OKC_CHANNEL_PORT OKC_CA OKC_CA_URL OKC_CA_FINGERPRINT');",
            ''],

        //What proves the dashboard is the dashboard.
        ['the authority is accepted without checking its fingerprint',
            "    put('  if [ \"$got\" != \"$want\" ]; then');",
            "    put('  if false; then');"],

        ['the fingerprint is not carried, so nothing could check it',
            "    put('OKC_CA_FINGERPRINT=' + q(w.caFingerprint || ''));",
            ''],

        ['a call is told to skip verification instead',
            '    put(\'  curl -fsS --cacert "$OKC_CA" -u "$OKC_VM:$OKC_TOKEN" --max-time 5 "$OKC_BASE/provision/report?vm=$OKC_VM&stage=$1" >/dev/null 2>&1 || true\');',
            '    put(\'  curl -fsS -k -u "$OKC_VM:$OKC_TOKEN" --max-time 5 "$OKC_BASE/provision/report?vm=$OKC_VM&stage=$1" >/dev/null 2>&1 || true\');'],

        //Every line appeared twice, for a whole run, and nothing was wrong.
        ['every stage opens its own tee, so every line is logged twice',
            '    put(\'if [ "${OKC_TEEING:-no}" != yes ]; then\');',
            '    put(\'if true; then\');'],

        ['the flag is not exported, so a child stage tees again anyway',
            "    put('  export OKC_TEEING OKC_LOG');",
            ''],

        //It defines things and does no work.
        ['the header does work rather than only defining things',
            "    put('#!/bin/bash');",
            "    put('#!/bin/bash');\n    put('apt update');"]
    ]
};
