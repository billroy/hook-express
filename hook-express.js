// hook-express.js
//
// Copyright 2016 by Bill Roy
// MIT license
//

function env(key, default_value) {
    return process.env[key] || default_value;
}

// parse command line arguments
var argv = require('yargs')
    .usage('Usage: $0 --port=[3000] --auth --ssl')
    .default('port', env('PORT', 3000))
    .default('auth', env('AUTH', false))
    .default('ssl', env('SSL', false))
    .argv;

console.log('hook-express here! v0.1');
console.log(argv);

var require_from_string = require('require-from-string');

var express = require('express');
var app = express();            // create an express app
var bodyParser = require('body-parser');
app.use(bodyParser.json());
//var logger = require('morgan');
//app.use(logger('common'));
var winston = require('winston');
var expressWinston = require('express-winston');
var http = require('http');
app.set('x-powered-by', false);

expressWinston.requestWhitelist.push('body');
expressWinston.responseWhitelist.push('body');

app.use(expressWinston.logger({
    transports: [
        new winston.transports.Console({
            json: true,
            colorize: true
        })
    ],
    meta: true, // optional: control whether you want to log the meta data about the request (default to true)
    msg: "HTTP {{req.method}} {{req.url}}", // optional: customize the default logging message. E.g. "{{res.statusCode}} {{req.method}} {{res.responseTime}}ms {{req.url}}"
    //expressFormat: true, // Use the default Express/morgan request formatting, with the same colors. Enabling this will override any msg and colorStatus if true. Will only output colors on transports with colorize set to true
    colorStatus: true, // Color the status code, using the Express/morgan color palette (default green, 3XX cyan, 4XX yellow, 5XX red). Will not be recognized if expressFormat is true
    ignoreRoute: function (req, res) { return false; } // optional: allows to skip some log messages based on request and/or response
}));


// HTTP basic auth for express 4.0
// via: https://davidbeath.com/posts/expressjs-40-basicauth.html
//
if (argv.auth) console.log('Server will use HTTP auth');
else console.log('Server is starting without auth');
var basicAuth = require('basic-auth');

// user table
var users = [
    ['alpha', 'meatball'],
	[process.env.HOOK_USERNAME, process.env.HOOK_PASSWORD]		// [username, password]
];

function authenticate(req, res, next) {

    // all authentications succeed if --auth is not true
    if (!argv.auth) return next();

	function unauthorized(res) {
		res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
		return res.sendStatus(401);
	}

	var user = basicAuth(req);
	if (!user || !user.name || !user.pass) {
		return unauthorized(res);
	}

	for (var u=0; u < users.length; u++) {
		if ((user.name == users[u][0]) && (user.pass == users[u][1])) {
			if (argv.debug) console.log('Authenticated access for user:', user.name);
			return next();
		}
	}
	console.log('Unauthorized access attempt:', user.name, user.pass);
	return unauthorized(res);
}
if (argv.auth) app.use(authenticate);

var context = {
    db: 'database handle here',
    requestCount: 0
};
var hooks = {};
var nextHookId = 1;

app.use(function(req, res, next) {
    context.requestCount++;
    res.locals.context = context;
    next();
});

// find hook in app._routes for monkey-patching
function findHook(hook) {
    console.log('FINDHOOK:', -2, hook);
    if (!hook.hookId) return undefined;
    for (var i=0; i < app._router.stack.length; i++) {
        console.log('FINDHOOK:', -1);
        var item = app._router.stack[i];
        console.log('FINDHOOK:', 0, item);
        if (!item.route) continue;
        console.log('FINDHOOK:', 0.5);
        if (item.route.path != hook.path) continue;
        console.log('FINDHOOK:', 1);
        if (!item.route.stack) continue;
        console.log('FINDHOOK:', 2);
        if (!item.route.stack.length) continue;
        console.log('FINDHOOK:', 3);
        if (item.route.stack[0].method != hook.method) continue;
        console.log('FINDHOOK:', 4);
        if (item.route.stack[0].name != hook.hookId) continue;
        console.log('hook found:', item.route.stack[0]);
        return item.route.stack[0];
    }
    return undefined;
}

function hookFunctionText(hook) {
    var hookText = [
        'module.exports = function ' + hook.hookId + '(req, res) {',
            hook.hook,
        '};'
    ].join('\n');
    //console.log('hookText:', hookText);
    return hookText;
}

/*
// update an existing hook, or create a new one
function updateHook(hook) {

    // existing hook: if a route matching the hookId, method, and path exists,
    // replace its hook function
    var route = findHook(hook);
    if (route) {
        try {
            // monkey-patch route.handle with hook function by same name
            route.handle = require_from_string(hookFunctionText(hook));
            hooks[hookId] = hook;
            return res.send(hook);
        } catch(err) {
            console.log('Error updating hook:', err);
            return res.status(500).send(err);
        }
    }

    // matching hook does not exist; insert a new one
    try {
        hook.hookId = 'hook_' + nextHookId++;   // assign new hookId
        app[method.toLowerCase()](req.body.path, require_from_string(hookFunctionText(hook)));
        hooks[hookId] = hook;
        res.send(hook);
    } catch(err) {
        console.log('Error creating hook:', err);
        res.status(500).send(err);
    }
}
*/

app.post('/hooks', function(req, res) {

    var hook = {};

    // validate method
    var method = req.body.method || 'get';
    if (http.METHODS.indexOf(method.toUpperCase()) < 0) return res.status(400).send('unsupported http method');
    if (!(method.toLowerCase() in app)) return res.status(400).send('unsupported app method');
    hook.method = method;

    // validate path
    if (!req.body.path) return res.status(400).send('path parameter not specified');
    hook.path = req.body.path;

    // validate hook
    if (!req.body.hook) return res.status(400).send('hook parameter not specified');
    hook.hook = req.body.hook;

    // transfer hookId if specified
    if (req.body.hookId) hook.hookId = req.body.hookId;

    // existing hook: if a route matching the hookId, method, and path exists,
    // replace its hook function
    var route = findHook(hook);
    if (route) {
        try {
            // monkey-patch route.handle with hook function by same name
            route.handle = require_from_string(hookFunctionText(hook));
            hooks[hook.hookId] = hook;
            return res.send(hook);
        } catch(err) {
            console.log('Error updating hook:', err);
            return res.status(500).send(err);
        }
    }

    // matching hook does not exist; insert a new one
    try {
        hook.hookId = 'hook_' + nextHookId++;   // assign new hookId
        app[method.toLowerCase()](req.body.path, require_from_string(hookFunctionText(hook)));
        hooks[hook.hookId] = hook;
        res.send(hook);
    } catch(err) {
        console.log('Error creating hook:', err);
        res.status(500).send(err);
    }

/***
////////////////////////////////
    // assign hookId
    var hookId = 'hook_' + nextHookId++;

    // build hook function text
    var hookText = [
        'module.exports = function ' + hookId + '(req, res) {',
            req.body.hook,
        '};'
    ].join('\n');
    //console.log('hookText:', hookText);

    // configure the hook
    try {
        var hookFunction = require_from_string(hookText);
        app[method.toLowerCase()](req.body.path, hookFunction);
        hooks[hookId] = {
            method: method,
            path: req.body.path,
            hook: req.body.hook,
            hookId: hookId
        };
        res.send(hooks[hookId]);
    } catch(err) {
        console.log('Error:', err);
        res.status(500).send(err);
    }
/////////////////////////////////
***/
});

app.get('/hooks', function(req, res) {
    // TODO: convert to array of hooks here, instead of sending object
    res.send(hooks);
});

app.get('/hooks/:hookId', function(req, res) {
    if (req.params.hookId in hooks) res.send(hooks[req.params.hookId]);
    else res.status(404).send('not found');
});


function removeHook(hookId) {
    if (!(hookId in hooks)) return false;
    app._router.stack.forEach(function(route, index) {
        if (route.name != 'bound dispatch') return;
        if (!route.route) return;
        if (!route.route.stack || !route.route.stack[0]) return;
        if (route.route.stack[0].name == hookId) {
            console.log('deleting hook at index:', index);
            app._router.stack.splice(index, 1);
        }
    });
    delete hooks[hookId];
    return true;
}

app.delete('/hooks/:hookId', function(req, res) {
    if (req.params.hookId == '*') {
        Object.keys(hooks).forEach(function(hookId) {
            removeHook(hookId);
        });
        res.status(200).send('deleted');
    }
    else {
        if (removeHook(req.params.hookId)) res.status(200).send('deleted');
        else res.status(404).send('not found');
    }
});


app.get('/routelist', function(req, res) {
    console.log('_router:', app._router);
    var output = [];
    app._router.stack.forEach(function(route) {
        console.log(route.name, route.path, route.keys, route.regexp, route.route);

        if (route && route.route && route.route.stack && route.route.stack.length)
            console.log('function:', route.route.stack[0].handle);

        output.push({
            name: route.name,
            path: route.path,
            keys: route.keys,
            regexp: route.regexp,
            route: route.route
        });
    });
    res.send(output);
});


app.use('/', express.static(__dirname + '/public'));
app.use('/editor', express.static(__dirname + '/editor'));

var listener = app.listen(argv.port, function() {
    console.log('Server is listening at:', listener.address());
});
