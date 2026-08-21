//what ../../test/vms/channel-framing.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/channel/framing.js',
    test: 'test/vms/channel-framing.test.js',
    breaks: [
        //A CHUNK IS NOT A MESSAGE. This works perfectly until the guest is busy.
        ['a chunk is read as a message',
            "        var out = [];\n        var cut;\n        while ((cut = buffer.indexOf('\\n')) !== -1) {",
            "        var out = [];\n        var cut;\n        if (buffer.indexOf('\\n') === -1) { var whole = buffer; buffer = ''; try { out.push(JSON.parse(whole)); } catch (e) {} return { messages: out }; }\n        while ((cut = buffer.indexOf('\\n')) !== -1) {"],

        ['only the first message in a chunk is taken',
            "        while ((cut = buffer.indexOf('\\n')) !== -1) {",
            "        if ((cut = buffer.indexOf('\\n')) !== -1) {"],

        ['a half-line is thrown away instead of kept for the next chunk',
            'buffer = buffer.slice(cut + 1);',
            "buffer = '';"],

        ['the leftover is never consumed, so every chunk repeats what came before',
            'buffer = buffer.slice(cut + 1);',
            'buffer = buffer.slice(cut);'],

        //A message written without its newline is one the far end waits for
        //forever, and it looks like a hang.
        ['what is written has no newline on the end',
            "function line(msg) { return JSON.stringify(msg) + '\\n'; }",
            'function line(msg) { return JSON.stringify(msg); }'],

        //What ends a session.
        ['anything that is not JSON is quietly skipped',
            "            catch (e) { return { messages: out, fault: 'sent something that was not JSON' }; }",
            '            catch (e) { continue; }'],

        ['a fault throws away the good messages that arrived before it',
            "            catch (e) { return { messages: out, fault: 'sent something that was not JSON' }; }",
            "            catch (e) { return { messages: [], fault: 'sent something that was not JSON' }; }"],

        //`null`, `7` and `"hi"` all parse.
        ['valid JSON that is not a message is accepted',
            "            if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {\n                return { messages: out, fault: 'sent something that was not a message' };\n            }",
            ''],

        ['an array is accepted as a message',
            "if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {",
            "if (!msg || typeof msg !== 'object') {"],

        //A runaway guest must not be able to exhaust memory here.
        ['a line that never ends is held forever',
            "        if (buffer.length > max) return { messages: out, fault: 'sent a line that never ended' };",
            ''],

        //THE ONE EXPLANATION THAT IS NOT TRUE: measuring the whole buffer before
        //splitting counts complete lines towards a limit that is about one line.
        ['the limit is measured before the complete lines are taken out',
            "        buffer += chunk;\n\n        var out = [];",
            "        buffer += chunk;\n        if (buffer.length > max) return { messages: [], fault: 'sent a line that never ended' };\n\n        var out = [];"],

        //One buffer shared between sockets splices two machines into one stream.
        //One buffer shared between sockets splices two machines' output into one
        //stream of nonsense.
        ['every socket shares one buffer',
            "    //ONE OF THESE PER SOCKET. The buffer is the half-line that has not finished\n    //arriving, and it is the only state there is.\n    var buffer = '';",
            '    //hoisted'],

        ['a blank line is a message',
            "            if (!line.trim()) continue;",
            '']
    ]
};
