var rectify = require('@bmatusiak/rectify');

//shared by both main boots: src/main.js discovers plugins off disk for dev,
//src/main.prod.js gets them from the bundle. everything after that is the same.

module.exports = async function boot(plugins, host) {

    var app = rectify.build(plugins, host);

    //rectify keeps its destructors private and runs them from here, so hand the
    //lifecycle plugin a way to reach them
    app.services.app.destroyAll = function () { return app.destroy(); };

    app.on('error', function (err) {
        console.error('[main] a plugin failed to start', err && err.stack || err);
    });

    app = await app.start();
    var services = app.services;

    //the startup order, in one readable place rather than hidden in whichever
    //plugin happens to depend on all the others
    await services.build.ready();
    var url = await services.http.listen();

    console.log('listening on ' + url);
    services.lifecycle.publish(url);

    if (services.window) {
        if (services.tray) services.tray.start();
        services.window.open();

        //nw.js is single instance: a second launch is handed to this one
        nw.App.on('open', function () { services.window.show(); });
    }

    services.app.emit('start');
    return app;
};
