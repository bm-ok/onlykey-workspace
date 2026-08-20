//rectify hands this to every plugin as the third argument to its setup,
//keyed by the service name the plugin provides. so `theme` below arrives as
//`config.theme` inside src/app/ui/theme.

module.exports = function () {

    var Config = {

        //src/main plugins
        window: {
            width: 1640,
            height: 1040
        },

        tray: {
            icon: 'icon.png'//relative to the project root
        },

        //app plugins
        theme: {
            mode: null//'light' | 'dark', or null to follow the os
        }

    };

    return Config;
}
