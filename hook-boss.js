// hook boss
//
var fs = require('fs');
var http = require('http');     // for http.METHODS
var require_from_string = require('require-from-string');
var winston = require('winston');

module.exports = {

    app: undefined,     // express app
    hooks: {},          // local hook storage
    nextHookId: 1,      // hook id sequence counter

    init: function(options) {
        this.app = options.app;
    },

    // return a hook by hookId, or the full list of hooks
    get: function(hookId) {
        // return a single hook, not wrapped in an array
        if (hookId) return this.hooks[hookId] || undefined;

        // all hooks: convert the hooks object to an array
        var output = [];
        var self = this;
        Object.keys(this.hooks).forEach(function(key) {
            output.push(self.hooks[key]);
        });
        return output;
    },

    // find hook in app._routes for monkey-patching
    find: function(hook) {
        if (!hook.hookId) return undefined;
        for (var i=0; i < this.app._router.stack.length; i++) {
            var item = this.app._router.stack[i];
            if (!item.route) continue;
            if (item.route.path != hook.path) continue;
            if (!item.route.stack) continue;
            if (!item.route.stack.length) continue;
            if (item.route.stack[0].method != hook.method) continue;
            if (item.route.stack[0].name != hook.hookId) continue;
            return item.route.stack[0];
        }
        return undefined;
    },

    // return the function text for a wrapped hook ready for binding
    functionText: function(hook) {
        var hookText = [
            'module.exports = function ' + hook.hookId + '(req, res) {',
                hook.hook,
            '};'
        ].join('\n');
        //console.log('hookText:', hookText);
        return hookText;
    },

    // save a hook, replacing existing hook if it exists
    save: function(inputHook, next) {

        var hook = {};

        // validate method
        var method = inputHook.method || 'get';
        if (typeof method != 'string') return next('method parameter must be a string');
        if (http.METHODS.indexOf(method.toUpperCase()) < 0) return next('unsupported http method');
        if (!(method.toLowerCase() in this.app)) return next('unsupported app method');
        hook.method = method;

        // validate path
        if (!inputHook.path) return next('path parameter not specified');
        if (typeof inputHook.path != 'string') return next('path parameter must be a string');
        hook.path = inputHook.path;

        // validate hook
        if (!inputHook.hook) return next('hook parameter not specified');
        if (typeof inputHook.hook != 'string') return next('hook parameter must be a string');
        hook.hook = inputHook.hook;

        // transfer hookId if specified
        if (inputHook.hookId) {
            if (typeof inputHook.hookId != 'string') return next('hookId parameter must be a string');
            hook.hookId = inputHook.hookId;
        }

        // existing hook: if a route matching the hookId, method, and path exists,
        // replace its hook function
        var route = this.find(hook);
        if (route) {
            try {
                // monkey-patch route.handle with hook function by same name
                route.handle = require_from_string(this.functionText(hook));
                this.hooks[hook.hookId] = hook;
                return next(null, hook);
            } catch(err) {
                winston.error('Error updating hook:', err);
                return next(err);
            }
        }

        // matching hook does not exist; insert a new one
        try {
            hook.hookId = 'hook_' + this.nextHookId++;   // assign new hookId
            this.app[hook.method.toLowerCase()](hook.path, require_from_string(this.functionText(hook)));
            this.hooks[hook.hookId] = hook;
            return next(null, hook);
        } catch(err) {
            winston.error('Error creating hook:', err);
            return next(err);
        }
    },

    // remove a hook
    // TODO: how does this handle '*'?
    remove: function(hookId) {
        if (!(hookId in this.hooks)) return false;
        var self = this;
        this.app._router.stack.forEach(function(route, index) {
            if (route.name != 'bound dispatch') return;
            if (!route.route) return;
            if (!route.route.stack || !route.route.stack[0]) return;
            if (route.route.stack[0].name == hookId) {
                winston.info('deleting hook at index:', index);
                self.app._router.stack.splice(index, 1);
            }
        });
        delete this.hooks[hookId];
        return true;
    },

    loadFromFile: function(filepath) {
        console.log('Loading hooks from file:', filepath);
        var startupHooks = JSON.parse(fs.readFileSync(filepath).toString());
        var self = this;
        startupHooks.forEach(function(hook, index) {
            console.log('loading hook:', hook);
            self.save(hook, function(err, hook) {
                if (err) console.log('Load error:', hook, err);
            });
        });
    },

    loadFromUrl: function(url) {
        console.log('Loading hooks from url:', url);
        var self = this;
        request.get(url, function(err, response, body) {
            if (err) console.log('Error loading url:', hook, err);
            var hooks = JSON.parse(body);
            console.log('LOADED:', typeof hooks, hooks);
            console.log('loaded hook count:', hooks.length);
            hooks.forEach(function(hook, index) {
                console.log('loading hook:', hook);
                self.save(hook, function(err, hook) {
                    if (err) console.log('Load error:', hook, err);
                });
            });
        });
    },

    load: function(source) {
        if (source.startsWith('http://') || source.startsWith('https://')) {
            this.loadFromUrl(source);
        }
        else this.loadFromFile(source);
    }
};
