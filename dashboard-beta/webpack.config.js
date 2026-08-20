const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

//two of the three boots are bundled. src/window.js gathers every
//src/app/*/window.js, src/server.js every src/app/*/server.js — so a plugin
//declares where it runs by which files it has, and neither bundle carries the
//other's half. the third boot, src/main.js, is loaded off disk by nw.js.
module.exports = (env, argv = {}) => {

    const isProduction = ((argv.mode || process.env.NODE_ENV) == 'production');
    const mode = isProduction ? 'production' : 'development';

    const babel = {
        test: /\.jsx?$/,
        exclude: /node_modules/,
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
            new HtmlWebpackPlugin({ template: path.join(__dirname, 'src', 'index.html') }),
            ...(isProduction ? [] : [new webpack.HotModuleReplacementPlugin()])
        ]
    };

    const server = {
        name: 'server',
        target: 'node',
        mode,
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
    //development branch of src/app/build, which is what keeps webpack itself
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
