/**

var typeStore = app.services.config('test', {
    testing: 'ok-default'
})

console.log(typeStore.testing);//'ok-default', and assigning to it saves

 */

//---------------------------------------------------------------------------
//two stores, one shape: `session` on sessionStorage and `config` on
//localStorage. Ask for a name and a set of defaults, get an object back whose
//properties read from storage and write to it — assigning to one saves.
//
//THIS WAS THE SCAFFOLD'S TYPESCRIPT EXAMPLE and is now plain javascript, which
//its own comment invited: "rename this one to .js if you would rather not have
//any typescript in the tree at all". That is what happened. TypeScript is gone
//from this app entirely — the command that checked it only ever opened this
//file and the declarations beside it, so a green `npm run typecheck` was a
//statement about two files being read as evidence that thirty were sound.
//
//Nothing about the behaviour changed. The three `type X = import(...)` lines,
//the annotations and two casts existed for the checker and erased at build
//time; `$bag` existed only to give the compiler a shape it would accept for
//index access, and is gone with them.
//---------------------------------------------------------------------------

async function plugin(_imports, register) {
    function typeStorage(storageObject) {

        const getStored = (name) => {
            const r = JSON.parse(storageObject.getItem(name));
            if (r) return r;
            setStored(name, {});
            return getStored(name);
        };
        const setStored = (name, typeStoreObj) =>
            storageObject.setItem(name, JSON.stringify(typeStoreObj));

        return function typeStore(typeStore_name, typeStore_defaults) {
            const $typeStore_mem = getStored(typeStore_name);
            const $typeStore_obj = {
                save: function () {
                    setStored(typeStore_name, $typeStore_mem);
                }
            };

            for (const i in typeStore_defaults) {
                if (i === 'save') continue;
                ((typeStore_property, default_value) => {
                    Object.defineProperty($typeStore_obj, typeStore_property, {
                        get() {
                            return $typeStore_mem[typeStore_property];
                        },
                        set(newValue) {
                            $typeStore_mem[typeStore_property] = newValue;
                            $typeStore_obj.save();
                        },
                        enumerable: true,
                        configurable: true,
                    });
                    //read through the getter above, so this asks storage rather
                    //than the defaults — a value already saved is left alone and
                    //only a missing one takes the default
                    if (typeof $typeStore_obj[typeStore_property] === 'undefined') {
                        $typeStore_obj[typeStore_property] = default_value;
                        $typeStore_obj.save();
                    }
                })(i, typeStore_defaults[i]);
            }

            return $typeStore_obj;
        };
    }

    await register(null, {
        session: typeStorage(sessionStorage),
        config: typeStorage(localStorage),
    });
}

plugin.consumes = [];
plugin.provides = ['session', 'config'];

//plain commonjs, same as the rest: `module.exports` at the bottom and no
//import/export statement anywhere. Any of those — even a type-only one — makes
//babel mark the output an es module, and webpack then refuses the
//module.exports.
module.exports = plugin;
