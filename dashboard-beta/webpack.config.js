const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const appPackage = require('./package.json');

//two of the three boots are bundled. src/window.js gathers every plugin's
//window.js, src/server.js every server.js — so a plugin declares where it runs
//by which files it has, and neither bundle carries the other's half. the third
//boot, src/main.js, is loaded off disk by nw.js.
//
//a plugin is a folder one level under src/app or two: src/app/queue, or
//src/app/repositories/changes. the second level is the grouping, so the tree
//says what the app's tab row says. see the note over the require.context call
//in each boot file for why it stops at two.
module.exports = (env, argv = {}) => {

    const isProduction = ((argv.mode || process.env.NODE_ENV) == 'production');
    const mode = isProduction ? 'production' : 'development';

    const babel = {
        test: /\.jsx?$/,
        //AND EVERY `vendor/` FOLDER, WHICH IS THE SAME ARGUMENT AS node_modules
        //made against a folder this app happens to track. What is vendored is a
        //SHIPPED BUILD — already down-levelled by whoever published it — so the
        //only thing babel can do to one is change it.
        //
        //AND IT CAN. Babel's default sourceType is `module`, so a file it
        //decides is a module gets its top-level `this` rewritten to `undefined`
        //— which is how a UMD wrapper stops finding the global it was written
        //to attach to, at run time, with no build error anywhere.
        exclude: /node_modules|[\\/]vendor[\\/]/,
        use: {
            loader: 'babel-loader',
            options: {
                presets: [
                    '@babel/preset-env',
                    //classic, the sources use commonjs require('react')
                    ['@babel/preset-react', { runtime: 'classic' }]
                ]
            }
        }
    };

    const resolve = { extensions: ['.js', '.jsx', '.json'] };

    //inlined as a string, ie the bootstrap-icons sprite sheet
    const asString = { test: /\.(txt|svg)$/i, type: 'asset/source' };

    const windowBundle = {
        name: 'window',
        target: 'web',
        mode,
        //the hot client talks to webpack-hot-middleware in main.js
        entry: isProduction
            ? path.join(__dirname, 'src', 'window.js')
            : ['webpack-hot-middleware/client?reload=true&overlay=true', path.join(__dirname, 'src', 'window.js')],
        resolve,
        output: {
            path: path.resolve(__dirname, 'dist'),
            //named after its entry, so it cannot collide with the packaged main
            //bundle, which also writes into dist
            filename: 'window.js',
            publicPath: '/'
        },
        devtool: !isProduction ? 'inline-source-map' : false,
        module: {
            rules: [
                babel,
                //PLAIN CSS, WHICH ONLY VENDORED CODE BRINGS. Nothing written in
                //this app is a .css file — the theme and every plugin sheet are
                //scss. This rule exists because xterm ships a stylesheet it
                //cannot lay out without, and a vendored file is not one to
                //rewrite into our syntax: the whole point of vendoring is that
                //what is here is what they published.
                {
                    test: /\.css$/i,
                    use: ['style-loader', 'css-loader']
                },
                {
                    test: /\.s[ac]ss$/i,
                    use: [
                        'style-loader',
                        'css-loader',
                        {
                            loader: 'sass-loader',
                            options: {
                                //sass resolves `@use "bootstrap/scss/..."` itself.
                                //sass-loader's webpack importer cannot: inside nw's
                                //node context its canonicalize() returns a URL that
                                //dart-sass does not recognise as one.
                                webpackImporter: false,
                                sassOptions: {
                                    quietDeps: true,//to supress opt in warnings
                                    loadPaths: [path.join(__dirname, 'node_modules')]
                                }
                            }
                        }
                    ]
                },
                asString,
                { test: /\.(eot|ttf|woff|woff2|png|jpg|gif)$/i, type: 'asset' }
            ]
        },
        plugins: [
            new HtmlWebpackPlugin({
                template: path.join(__dirname, 'src', 'index.html'),
                //One source for the name, shared with tools/build.js.
                title: appPackage.title || appPackage.name
            }),
            ...(isProduction ? [] : [new webpack.HotModuleReplacementPlugin()])
        ]
    };

    //---- files that are SENT rather than bundled ---------------------------
    //
    //A payload is not a module. These are handed to something else to run — a
    //Linux guest, or git as a credential helper — so they must arrive BYTE FOR
    //BYTE, with their shebang and their line endings intact. Bundling one would
    //rewrite it into something only this process can load.
    //
    //They land beside the server bundle because that is what `__dirname`
    //resolves to once packaged — see `node: { __dirname: false }` below.
    //
    //THIS EXISTS BECAUSE ONE OF THEM WAS ALREADY MISSING. `keys/server.js`
    //points at `path.join(__dirname, 'credential-helper.js')`, nothing ever
    //copied it, and `dist/credential-helper.js` did not exist — so a push using
    //the helper would have failed with ENOENT at the moment it mattered, with a
    //message about a file rather than about a sign-in.
    const PAYLOADS = [
        { from: path.join(__dirname, 'src', 'app', 'keys', 'credential-helper.js'), to: 'credential-helper.js' },
        { from: path.join(__dirname, 'src', 'app', 'vms', 'provision', 'scripts'), to: 'provision' },

        //THE SEED SET: the skills, jobs, prompts and contracts a fresh install
        //can be brought back up from. Shipped rather than generated, because the
        //moment it is needed is the moment there is nothing here to generate it
        //from -- see src/app/bootstrap.
        //
        //ONE FILE AND NOT A FOLDER OF THE SAME DOCUMENTS. The repo held both for
        //a day and two copies of anything drift the moment one is edited; the
        //tar is the one that gets restored FROM, so it is the one that is true.
        //It is pinned `binary` in .gitattributes, because a checkout that
        //"fixed" the line endings inside it would break its own checksums.
        { from: path.join(__dirname, 'okc-bootstrap.tar'), to: 'okc-bootstrap.tar' },
        //THE DOCS, beside the bundle, for a packaged app with no repository
        //above it. In development the app reads ../docs -- the repository's
        //copy, the one git sees -- and this copy is never read.
        { from: path.join(__dirname, 'docs'), to: 'docs' },

        //THE GIT HOOK, WHICH RUNS ON THIS HOST AND IS THE THING THAT REFUSES.
        //
        //`core.hooksPath` points git at this folder when it runs `receive-pack`,
        //so it must be a real directory on disk with a real file in it — see
        //../repositories/gitserve/gitapi.js. It is not the repository's own hook
        //and never becomes one: nothing is written into the repositories being
        //protected, so they stay ordinary checkouts.
        //
        //IT IS THE MOST EXPENSIVE ONE HERE TO GET WRONG. The helper above was
        //missing and would have failed with ENOENT at a push. This one failing
        //to be found does not fail the push — git carries on WITHOUT a hook, so
        //a machine would be able to push anything anywhere and nothing would say
        //a word. The root .gitattributes pins the folder to LF for the same
        //reason: a hook with a carriage return in its shebang does not run.
        { from: path.join(__dirname, 'src', 'app', 'repositories', 'gitserve', 'hooks'), to: 'git-hooks' },

        //WHAT A JOB IS HANDED, AND THE WATCHER, which run ON A MACHINE and not
        //here. They are read as text and written into a guest, so what must
        //arrive is what somebody wrote — bundled, a guest would receive babel's
        //output, with this app's own module graph folded into it.
        //
        //They are real files rather than strings in a source file for the same
        //reason: both can then be linted, syntax-checked and read like the code
        //they are.
        { from: path.join(__dirname, 'src', 'app', 'vms', 'dispatch', 'guest'), to: 'guest' },

        //THE DRILLS AND THE HARNESS, for two reasons beyond the one above.
        //
        //The board shows each check's SOURCE and fingerprints it, both from
        //`fn.toString()` — bundled, that would be babel's output rather than
        //what somebody wrote, and every fingerprint would move the day a preset
        //changed. And the loader walks a directory and requires what it finds,
        //which webpack cannot follow at all: bundling would have produced an
        //empty kit rather than an error.
        //
        //THE TWO MUST LAND SUCH THAT `../../harness` STILL RESOLVES from inside
        //a suite folder — which is why the harness goes to the top of dist and
        //the suites go one level under it, exactly as they sit in src.
        { from: path.join(__dirname, 'src', 'app', 'tests', 'harness.js'), to: 'harness.js' },
        { from: path.join(__dirname, 'src', 'app', 'tests', 'helpers.js'), to: 'helpers.js' },
        { from: path.join(__dirname, 'src', 'app', 'tests', 'suites'), to: 'suites' }
    ];

    //WHAT THE SOURCE NO LONGER HAS, the destination should not either. Walks the
    //COPY and asks the source about each entry, rather than diffing both ways:
    //everything the source has was just written, so the only question left is
    //what is here that should not be.
    function prune(from, to) {
        for (const entry of fs.readdirSync(to, { withFileTypes: true })) {
            const here = path.join(to, entry.name);
            const there = path.join(from, entry.name);

            if (!fs.existsSync(there)) {
                fs.rmSync(here, { recursive: true, force: true });
                continue;
            }
            if (entry.isDirectory()) prune(there, here);
        }
    }

    //Copied on every emit, including every watch rebuild, so editing a script
    //takes effect on the next boot with nothing to restart — which is the whole
    //promise vms/provision/scripts.js makes about reading them fresh.
    const copyPayloads = {
        apply(compiler) {
            compiler.hooks.afterEmit.tapAsync('copy-payloads', (compilation, done) => {
                try {
                    const out = compiler.options.output.path;
                    for (const { from, to } of PAYLOADS) {
                        if (!fs.existsSync(from)) continue;
                        fs.cpSync(from, path.join(out, to), { recursive: true });

                        //AND WHAT IS NO LONGER THERE HAS TO GO. cpSync adds and
                        //overwrites; it never removes. A drill renamed in src
                        //therefore kept RUNNING from its old copy here, and
                        //since the reason drills get renamed is that their old
                        //name was wrong, what the board showed was a broken
                        //check nobody could find the source of.
                        //
                        //ONLY EVER INSIDE THIS PAYLOAD'S OWN DESTINATION, and
                        //only where the source says a directory: a delete that
                        //walks from `out` itself is one bad `to` away from
                        //taking the build with it.
                        if (fs.statSync(from).isDirectory()) prune(from, path.join(out, to));
                    }
                    done();
                } catch (e) {
                    //LOUD, because the failure it prevents is silent: a missing
                    //payload only shows up as ENOENT deep in something else.
                    compilation.errors.push(new Error('could not copy payloads: ' + e.message));
                    done();
                }
            });
        }
    };

    const server = {
        name: 'server',
        target: 'node',
        mode,
        plugins: [copyPayloads],
        entry: path.join(__dirname, 'src', 'server.js'),
        resolve,
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'server.js',
            library: { type: 'commonjs2' }
        },
        devtool: 'source-map',
        //keep the real __dirname, webpack's default mocks it to "/"
        node: { __dirname: false, __filename: false },
        //anything from node_modules stays a real require, so the browser-only
        //half of a plugin is never loaded here, only skipped
        externals: [
            function ({ request }, callback) {
                //bare specifiers only, an absolute path here would swallow the entry
                if (request && !request.startsWith('.') && !path.isAbsolute(request))
                    return callback(null, 'commonjs ' + request);
                callback();
            }
        ],
        module: {
            rules: [
                babel,
                //scss becomes an inert string here, style-loader would touch the DOM
                { test: /\.s[ac]ss$/i, type: 'asset/source' },
                asString,
                { test: /\.(eot|ttf|woff|woff2|png|jpg|gif)$/i, type: 'asset/source' }
            ]
        }
    };

    //the packaged main. only built by tools/build.js, never in development.
    //
    //nothing is external: the point is one file with no node_modules beside it,
    //so express, socket.io and the plugins all go in. BUILD_PROD folds away the
    //development branch of src/app/core/build, which is what keeps webpack itself
    //from being dragged in with it.
    const main = {
        name: 'main',
        target: 'node',
        mode: 'production',
        entry: path.join(__dirname, 'src', 'main.prod.js'),
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'main.js'
        },
        devtool: false,
        resolve,
        //__dirname would otherwise be mocked to "/" and the plugins that use it
        //would quietly look in the wrong place
        node: { __dirname: false, __filename: false },
        module: { rules: [babel, asString] },
        plugins: [
            new webpack.DefinePlugin({ BUILD_PROD: JSON.stringify(true) }),
            //express reaches for a view engine by name at runtime; nothing here
            //renders server side templates, so the miss is expected
            new webpack.ContextReplacementPlugin(/express.lib/, /$^/)
        ],
        //socket.io and express both probe for optional native extras
        ignoreWarnings: [{ module: /node_modules/ }],
        stats: { errorDetails: true }
    };

    return argv.bundle == 'main' ? [main] : [windowBundle, server];
}
