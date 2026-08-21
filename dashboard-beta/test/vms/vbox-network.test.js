const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const makeNetwork = require('../../src/app/vms/vbox/network');
const { blocks, HOST_ONLY } = require('../../src/app/vms/vbox/network');

//---------------------------------------------------------------------------
//where a machine can be reached, and where it can reach this host.
//
//TWO NETWORKS, AND THE DIFFERENCE DECIDES WHAT CAN BE ASKED. A machine's
//BRIDGED adapter is what makes it reachable, and its address came from the
//router — so nothing here can ask what it got. Its HOST-ONLY adapter is on the
//one network VirtualBox itself serves DHCP on, which makes it the only one it
//can be asked about. That is the whole reason the second adapter exists.
//
//THE CLAIM WORTH THE MOST: what address a machine has is asked of the DHCP
//SERVER, not of the guest. That works with the machine mid-install, wedged, or
//with no guest additions — which is exactly when nothing else can answer, and
//exactly when somebody wants to know.
//---------------------------------------------------------------------------

let net, asked, answers, files, ifaces;

beforeEach(() => {
    asked = [];
    answers = {};
    files = {};
    ifaces = {};

    const run = async (args) => {
        asked.push(args.join(' '));
        const out = answers[args.join(' ')];
        if (out === undefined) throw new Error('VBoxManage: no such thing: ' + args.join(' '));
        return typeof out === 'function' ? out() : out;
    };

    net = makeNetwork(run, {
        available: () => true,
        there: (p) => !!files[p],
        interfaces: () => ifaces
    });
});

//---------------------------------------------------------------------------
//WHAT IS ON THIS HOST.
//---------------------------------------------------------------------------

test('interfaces come back as blocks, and the same parser reads both kinds', () => {
    const out = blocks([
        'Name:            Realtek Gaming 2.5GbE',
        'GUID:            {aaaa}',
        'DHCP:            Enabled',
        'IPAddress:       192.168.51.63',
        'Status:          Up',
        '',
        'Name:            VirtualBox Host-Only Ethernet Adapter',
        'IPAddress:       192.168.56.1',
        'Status:          Down'
    ].join('\n'));

    assert.deepEqual(out, [
        { name: 'Realtek Gaming 2.5GbE', ip: '192.168.51.63', status: 'Up' },
        { name: 'VirtualBox Host-Only Ethernet Adapter', ip: '192.168.56.1', status: 'Down' }
    ]);
});

test('a field before any name belongs to nothing and is dropped', () => {
    assert.deepEqual(blocks('IPAddress: 10.0.0.1\nName: one\nStatus: Up'),
        [{ name: 'one', status: 'Up' }]);
});

test('nothing at all is nothing, not a half-built interface', () => {
    assert.deepEqual(blocks(''), []);
    assert.deepEqual(blocks('\n\n'), []);
});

//---------------------------------------------------------------------------
//AN ISO SOMEBODY CAN PICK.
//---------------------------------------------------------------------------

test('only the ones that are actually still there are offered', async () => {
    answers['list dvds'] = [
        'UUID:        aaa',
        'Location:    C:/isos/debian.iso',
        '',
        'UUID:        bbb',
        'Location:    C:/isos/moved-away.iso'
    ].join('\n');
    files['C:/isos/debian.iso'] = true;

    //VirtualBox REMEMBERS MEDIA THAT HAS BEEN MOVED OR DELETED, and offering one
    //of those is offering an install that fails twenty minutes in.
    assert.deepEqual(await net.isos(), [{ location: 'C:/isos/debian.iso', name: 'debian.iso' }]);
});

test('and only things that are isos', async () => {
    answers['list dvds'] = 'Location:    C:/isos/notes.txt';
    files['C:/isos/notes.txt'] = true;
    assert.deepEqual(await net.isos(), []);
});

test('no VirtualBox at all is an empty list rather than a failure', async () => {
    const none = makeNetwork(async () => { throw new Error('should not be asked'); },
        { available: () => false });

    assert.deepEqual(await none.isos(), []);
    assert.deepEqual(await none.bridges(), []);
    assert.deepEqual(await none.hostOnlyIfs(), []);
});

//---------------------------------------------------------------------------
//MAKING THE HOST-ONLY NETWORK.
//---------------------------------------------------------------------------

test('a new adapter gets an address and a DHCP server, or the point is lost', async () => {
    answers['hostonlyif create'] = "Interface 'adapter-2' was successfully created";
    answers['hostonlyif ipconfig adapter-2 --ip ' + HOST_ONLY.host + ' --netmask ' + HOST_ONLY.mask] = 'ok';
    answers['dhcpserver add --interface adapter-2 --server-ip ' + HOST_ONLY.server
        + ' --netmask ' + HOST_ONLY.mask + ' --lower-ip ' + HOST_ONLY.from
        + ' --upper-ip ' + HOST_ONLY.to + ' --enable'] = 'ok';

    const name = await net.makeHostOnlyIf();

    assert.equal(name, 'adapter-2');
    //A MACHINE ATTACHED TO ONE WITH NO DHCP GETS NOTHING.
    assert.ok(asked.some((a) => /^hostonlyif ipconfig/.test(a)), asked.join(' | '));
    assert.ok(asked.some((a) => /^dhcpserver add/.test(a)), asked.join(' | '));
});

test('an adapter that was made but could not be configured is still returned', async () => {
    answers['hostonlyif create'] = "Interface 'adapter-3' was successfully created";
    //Both follow-ups fail — on Windows this is the operation that can ask for
    //elevation.
    const name = await net.makeHostOnlyIf();

    //IT EXISTS EITHER WAY, and an adapter with no DHCP is a fault somebody can
    //see and fix rather than a create that half happened and reported nothing.
    assert.equal(name, 'adapter-3');
});

test('an adapter VirtualBox will not name is a failure, not a guess', async () => {
    answers['hostonlyif create'] = 'VBoxManage: error: Failed to create the host-only adapter';

    await assert.rejects(() => net.makeHostOnlyIf(),
        /did not say which host-only adapter it made/);
});

//---------------------------------------------------------------------------
//WHAT ADDRESS A MACHINE HAS.
//---------------------------------------------------------------------------

test('it is asked of the DHCP server, by the machine’s host-only MAC', async () => {
    answers['list dhcpservers'] = 'NetworkName:    HostInterfaceNetworking-Adapter';
    answers['dhcpserver findlease --network HostInterfaceNetworking-Adapter --mac-address 0800271A2B3C'] =
        'IP Address:  192.168.56.104\nMAC Address: 08:00:27:1a:2b:3c';

    //ASKING THE GUEST REQUIRES THE GUEST TO BE ABLE TO ANSWER, and the moments
    //somebody most wants to know are the moments it cannot.
    assert.equal(await net.leaseFor('one', '0800271A2B3C'), '192.168.56.104');
});

test('a machine with no lease yet is null, which is ordinary while one boots', async () => {
    answers['list dhcpservers'] = 'NetworkName:    HostInterfaceNetworking-Adapter';
    //findlease is not answered at all — VBoxManage treats it as an error.
    assert.equal(await net.leaseFor('one', '0800271A2B3C'), null);
});

test('a host with no host-only DHCP server has nothing to ask', async () => {
    answers['list dhcpservers'] = '';
    assert.equal(await net.leaseFor('one', '0800271A2B3C'), null);
    //AND IT DID NOT GO ON TO ASK a server that is not there.
    assert.ok(!asked.some((a) => /findlease/.test(a)), asked.join(' | '));
});

//---------------------------------------------------------------------------
//THE ADDRESS A GUEST MUST USE TO REACH THIS HOST.
//---------------------------------------------------------------------------

test('the bridged one that is up, because that is the network the guest is on', async () => {
    answers['list bridgedifs'] = [
        'Name:       Realtek',
        'IPAddress:  192.168.51.63',
        'Status:     Up'
    ].join('\n');

    //A GUEST CANNOT USE 127.0.0.1 TO REACH THE HOST.
    assert.equal(await net.hostAddress(), '192.168.51.63');
});

test('an interface that is down is not an address', async () => {
    answers['list bridgedifs'] = [
        'Name:       Unplugged', 'IPAddress:  10.0.0.5', 'Status:     Down',
        'Name:       Realtek', 'IPAddress:  192.168.51.63', 'Status:     Up'
    ].join('\n');

    assert.equal(await net.hostAddress(), '192.168.51.63');
});

test('and one with no real address is not either', async () => {
    answers['list bridgedifs'] = [
        'Name:       Unplugged', 'IPAddress:  169.254.13.201', 'Status:     Up'
    ].join('\n');
    ifaces = { 'Ethernet': [{ family: 'IPv4', internal: false, address: '192.168.51.63' }] };

    //169.254 IS WHAT AN INTERFACE HAS WHEN IT HAS NO ADDRESS. Telling a guest to
    //dial one is telling it to dial nowhere.
    assert.equal(await net.hostAddress(), '192.168.51.63');
});

test('a host with no bridged adapter listed falls back to its own interfaces', async () => {
    answers['list bridgedifs'] = '';
    ifaces = {
        'Loopback': [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
        'Ethernet': [{ family: 'IPv4', internal: false, address: '192.168.51.63' }]
    };

    assert.equal(await net.hostAddress(), '192.168.51.63');
});

test('a loopback is never the answer, because a guest cannot reach it', async () => {
    answers['list bridgedifs'] = '';
    ifaces = { 'Loopback': [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] };

    await assert.rejects(() => net.hostAddress(), /no way to reach it/);
});

test('nowhere to be reached throws rather than guessing', async () => {
    answers['list bridgedifs'] = '';
    ifaces = {};

    //A GUEST HANDED AN ADDRESS THAT MEANS NOTHING fails twenty minutes later,
    //fetching its scripts, with an error about a network rather than about this.
    await assert.rejects(() => net.hostAddress(),
        /Could not work out this machine's address on the network/);
});
