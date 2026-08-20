var React = require('react');
var { useState, useEffect } = React;

//the window half of the example plugin. its node half is in ./server.js.
//delete this folder and build your own.
plugin.consumes = ['react', 'theme', 'appPackage', 'io'];
plugin.provides = [];
async function plugin(imports, register) {
    var { react, theme, appPackage, io } = imports;

    var NavBar = theme.navbar;

    function App() {
        var [pong, setPong] = useState(null);

        useEffect(function () {
            io.emit('ping', {}, function (reply) { setPong(reply); });
        }, []);

        return (<>
            <NavBar title="Hello world!" sub_title={'v' + appPackage.version} />
            <div className="container">
                <p>{appPackage.title} is running.</p>
                <p className="text-secondary">
                    {pong ? 'the node side answered over socket.io, pid ' + pong.pid : 'asking the node side...'}
                </p>
            </div>
        </>);
    }

    react.root.render(<App />);

    await register(null, {});
}
module.exports = plugin;
