//what ../../test/vms/provision-building.test.js has to be able to catch.
module.exports = {
    file: 'src/app/vms/provision/building.js',
    test: 'test/vms/provision-building.test.js',
    breaks: [
        //Which image.
        ['a path that is there is looked up by name anyway',
            '        if (wanted && there(wanted)) return wanted;',
            ''],

        ['any image at all is used when one was named',
            "        var hit = known.filter(function (i) { return i.name.toLowerCase().indexOf(needle) >= 0; })[0];",
            '        var hit = known[0];'],

        ['a name that matches nothing quietly picks the first',
            "        throw new Error('No installer image matching \"' + wanted + '\". VirtualBox knows about: '",
            "        return (known[0] || {}).location; throw new Error('No installer image matching \"' + wanted + '\". VirtualBox knows about: '"],

        ['with several images one is chosen without asking',
            '            if (known.length === 1) return known[0].location;',
            '            if (known.length) return known[0].location;'],

        //Which adapter. Somebody who said which meant it.
        ['a named adapter that is not there falls back to another',
            "            if (!hit) throw new Error('There is no network adapter called \"' + preferred + '\".');",
            '            if (!hit) return list[0] && list[0].name;'],

        ['an adapter that is down is bridged onto',
            "            return b.status === 'Up' && b.ip && b.ip.indexOf('169.254') !== 0;",
            '            return !!b.ip;'],

        ['an interface with no address is bridged onto',
            "b.ip.indexOf('169.254') !== 0;",
            'true;'],

        ['nothing up at all is not refused',
            '        if (!up.length) {\n            throw new Error(\'No network adapter is up to bridge onto. Use NAT instead, or say which adapter.\');\n        }',
            ''],

        //One network, every machine on it.
        ['a second host-only network is made when one already exists',
            '        var have = await vbox.hostOnlyIfs();\n        if (have.length) return have[0].name;',
            '        await vbox.hostOnlyIfs();'],

        ['a host with none never gets one made',
            '        return await vbox.makeHostOnlyIf();',
            '        return null;'],

        //The build, and the order VirtualBox forces.
        ['the disk is made before the machine that will hold it',
            "        await vbox.run(['createvm', '--name', spec.name, '--ostype', spec.ostype, '--register'],\n            { tags: [spec.name] });",
            ''],

        ['the controller takes a disk before it has been made',
            "        await vbox.run(['createmedium', 'disk', '--filename', disk,\n            '--size', String(spec.diskMB), '--format', 'VDI'],\n        { timeout: 300000, tags: [spec.name] });",
            ''],

        ['there is one port, so the installer and the disk cannot both be there',
            "'--controller', 'IntelAhci', '--portcount', '2', '--bootable', 'on'",
            "'--controller', 'IntelAhci', '--portcount', '1', '--bootable', 'on'"],

        ['the installer is attached where the disk goes',
            "await vbox.run(['storageattach', spec.name, '--storagectl', 'SATA', '--port', '1', '--device', '0',\n                '--type', 'dvddrive', '--medium', iso], { tags: [spec.name] });",
            "await vbox.run(['storageattach', spec.name, '--storagectl', 'SATA', '--port', '0', '--device', '0',\n                '--type', 'dvddrive', '--medium', iso], { tags: [spec.name] });"],

        //The second foot, which is the only way to ask where a machine is.
        ['a machine gets no second adapter',
            "            net = net.concat(['--nic2', 'hostonly', '--hostonlyadapter2', hostOnly, '--nictype2', 'virtio']);",
            ''],

        ['a host with no host-only network refuses to build at all',
            '        var hostOnly = null;\n        try { hostOnly = await hostOnlyAdapter(); }\n        catch (e) {',
            '        var hostOnly = await hostOnlyAdapter();\n        if (false) try {} catch (e) {'],

        ['the bridged adapter is not named, so it lands on whatever',
            "            ? ['--nic1', 'bridged', '--bridgeadapter1', bridge, '--nictype1', 'virtio']",
            "            ? ['--nic1', 'bridged', '--nictype1', 'virtio']"],

        //An instrument only the drills had.
        ['the console is not captured as the machine is built',
            '            await vbox.setSerial(spec.name, serial);',
            ''],

        ['the folder for it is not made',
            '            makeDir(serialDir);',
            ''],

        ['a console that cannot be captured stops the whole build',
            "            to.warn('could not capture its console: ' + e.message);\n            serial = null;",
            '            throw e;'],

        ['a console that failed is reported as captured',
            '            serial = null;',
            ''],

        //NAT with no forwarded port has no way in at all.
        ['NAT gets no forwarded port',
            "            await vbox.run(['modifyvm', spec.name, '--natpf1',\n                'ssh,tcp,127.0.0.1,' + spec.sshPort + ',,22'], { tags: [spec.name] });",
            ''],

        //Declared as data, attached at create time.
        ['a usb filter with no ids is added, matching everything',
            '            if (!f.vendorId || !f.productId) continue;',
            ''],

        ['a read-only share is mounted writable',
            '                .concat(share.readOnly ? [\'--readonly\'] : [])',
            '                .concat([])'],

        ['a share folder is not made on the host first',
            '            makeDir(share.hostPath);',
            ''],

        //A snapshot is a point on a disk.
        ['the disk is blanked while its snapshots still stand on it',
            "            var deepest = (had.snapshots || []).slice().sort(function (a, b) { return b.depth - a.depth; });",
            '            var deepest = [];'],

        ['snapshots are removed parent first, which cannot work',
            'return b.depth - a.depth;',
            'return a.depth - b.depth;'],

        ['the register goes on pointing at a snapshot that is gone',
            '        if (forget) forget();',
            ''],

        ['the disk is deleted while it is still attached',
            "        await vbox.run(['storageattach', name, '--storagectl', 'SATA', '--port', '0', '--device', '0',\n            '--type', 'hdd', '--medium', 'none'], { tags: [name] });",
            ''],

        ['the file is left behind, so the next build fails on a path still there',
            "await vbox.run(['closemedium', 'disk', disk, '--delete'], { timeout: 300000, tags: [name] });",
            "await vbox.run(['closemedium', 'disk', disk], { timeout: 300000, tags: [name] });"],

        ['a machine with no disk is blanked anyway',
            "        if (!disk || disk === 'none') {\n            to.warn('there is no disk attached to blank; installing onto whatever is there');\n            return null;\n        }",
            ''],

        ['snapshots that cannot be read stop the disk being blanked',
            "        } catch (e) {\n            to.warn('could not read its snapshots before blanking the disk: ' + e.message);\n        }",
            '        } catch (e) { throw e; }']
    ]
};
