const { test } = require('node:test');
const assert = require('node:assert');

const machines = require('../../src/app/runners/machines/server');

//A MACHINE'S SPEC CARRIES ITS BOOTSTRAP TOKEN AND ITS LOGIN, because a rebuild
//needs them. A listing does not, and it carried both out -- into --json
//answers, captures and logs -- until this was written.

test('a listing never carries a machine\'s token or password', () => {
    const vm = { name: 'w1', state: 'running', spec: { name: 'w1', cpus: 2, token: 'sekrit', password: 'okc', user: 'okc' } };
    const out = machines.withoutSecrets([vm]);
    assert.equal(out[0].spec.token, undefined);
    assert.equal(out[0].spec.password, undefined);
    assert.equal(out[0].spec.cpus, 2, 'the rest of the spec was lost with the secrets');
    //AND THE RECORD IT CAME FROM IS UNTOUCHED: the store still needs them.
    assert.equal(vm.spec.token, 'sekrit');
});

test('the shape with vms inside is stripped the same way, and a bare record too', () => {
    const said = { available: true, vms: [{ name: 'a', spec: { token: 't' } }] };
    assert.equal(machines.withoutSecrets(said).vms[0].spec.token, undefined);
    assert.equal(machines.withoutSecrets(said).available, true);
    assert.equal(machines.withoutSecrets({ name: 'b', spec: { password: 'p' } }).spec.password, undefined);
    assert.equal(machines.withoutSecrets(null), null);
});
