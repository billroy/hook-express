// hook-express.js
//
// Copyright 2016 by Bill Roy - see LICENSE file
//

function env(key, default_value) {
    return process.env[key] || default_value;
}

// parse command line arguments
var argv = require('yargs')
    .usage('Usage: $0 --port=[3000] --ssl --certs=[~/.certs] --logfile=[]')
    .default('port', env('PORT', 3000))
    .default('ssl', env('SSL', false))
    .default('load', env('LOAD_HOOKS', ''))
    .default('certs', env('SSL_CERTS', '~/.certs'))
    .default('logfile', env('LOGFILE', undefined))
    .default('loglevel', env('LOGLEVEL', 'info'))
    .argv;

console.log('hook-express here! v0.1');
console.log(argv);

var require_from_string = require('require-from-string');
var fs = require('fs');

// initialize the express app
var express = require('express');
var app = express();
var helmet = require('helmet');
app.use(helmet());
var http = require('http');
var https = require('spdy');

// configure json and url-encoded body parsers
var bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

// configure logging
var winston = require('winston');

// awkward but required: must remove/add Console to change options
winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {
    level: argv.loglevel,
    json: true,
    colorize: true,
    silent: false,
    prettyPrint: true,
    timestamp: true
});

// add file transport if configured
if (argv.logfile) winston.add(winston.transports.File, {
    level: argv.loglevel,
    filename: argv.logfile,
    timestamp: true,
    json: true,
    prettyPrint: false
});

// configure expressWinston middleware with winston / transports per above;
// awkward but required so we have a winston handle for the winston.query handler below
var expressWinston = require('express-winston');
expressWinston.requestWhitelist.push('body');
expressWinston.responseWhitelist.push('body');
app.use(expressWinston.logger({winstonInstance: winston}));


// HTTP basic auth for express 4.0
// via: https://davidbeath.com/posts/expressjs-40-basicauth.html
//
var basicAuth = require('basic-auth');

// api user table seeded with default username and password
var apiUsers = [
    //['username', 'password'],
	[process.env.HOOK_EXPRESS_API_USERNAME || 'hook',
        process.env.HOOK_EXPRESS_API_PASSWORD || 'express']
];

function unauthorized(res) {
    res.set('WWW-Authenticate', 'Basic realm=Hook Express');
    return res.sendStatus(401);
}

function authenticate(req, res, next) {
	var user = basicAuth(req);
	if (!user || !user.name || !user.pass) return unauthorized(res);
	for (var u=0; u < apiUsers.length; u++) {
		if ((user.name == apiUsers[u][0]) && (user.pass == apiUsers[u][1])) {
			if (argv.debug) console.log('Authenticated access for user:', user.name);
			return next();
		}
	}
	console.log('Unauthorized access attempt:', user.name, user.pass);
	return unauthorized(res);
}

// context passed in res.locals.context;
// inject dependencies into your hooks by adding them here
var context = {
    requestCount: 0,
    //db: 'perhaps a database handle here',
};

var hooks = {};
var nextHookId = 1;

// middleware to inject context as res.locals.context
app.use(function(req, res, next) {
    context.requestCount++;
    res.locals.context = context;
    next();
});

// find hook in app._routes for monkey-patching
function findHook(hook) {
    if (!hook.hookId) return undefined;
    for (var i=0; i < app._router.stack.length; i++) {
        var item = app._router.stack[i];
        if (!item.route) continue;
        if (item.route.path != hook.path) continue;
        if (!item.route.stack) continue;
        if (!item.route.stack.length) continue;
        if (item.route.stack[0].method != hook.method) continue;
        if (item.route.stack[0].name != hook.hookId) continue;
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


function saveHook(inputHook, next) {

    var hook = {};

    // validate method
    var method = inputHook.method || 'get';
    if (typeof method != 'string') return next('method parameter must be a string');
    if (http.METHODS.indexOf(method.toUpperCase()) < 0) return next('unsupported http method');
    if (!(method.toLowerCase() in app)) return next('unsupported app method');
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
    var route = findHook(hook);
    if (route) {
        try {
            // monkey-patch route.handle with hook function by same name
            route.handle = require_from_string(hookFunctionText(hook));
            hooks[hook.hookId] = hook;
            return next(null, hook);
        } catch(err) {
            console.log('Error updating hook:', err);
            return next(err);
        }
    }

    // matching hook does not exist; insert a new one
    try {
        hook.hookId = 'hook_' + nextHookId++;   // assign new hookId
        app[hook.method.toLowerCase()](hook.path, require_from_string(hookFunctionText(hook)));
        hooks[hook.hookId] = hook;
        return next(null, hook);
    } catch(err) {
        console.log('Error creating hook:', err);
        return next(err);
    }
}

app.post('/hooks', authenticate, function(req, res) {
    if (Array.isArray(req.body)) {
        outputHooks = [];
        async.eachSeries(req.body,
            function(hook, next) {
                saveHook(hook, function(err, hook) {
                    if (err) return next(err);
                    outputHooks.push(hook);
                    next(null, hook);
                });
            },
            function(err) {
                if (err) return res.status(400).send(err);
                res.send(outputHooks);
            }
        );
    }
    else {
        saveHook(req.body, function(err, hook) {
            if (err) return res.status(400).send(err);
            res.send(hook);
        });
    }
});

app.get('/hooks', authenticate, function(req, res) {
    // convert the hooks object to an array
    var output = [];
    Object.keys(hooks).forEach(function(key) {
        output.push(hooks[key]);
    });
    res.send(output);
});

app.get('/hooks/:hookId', authenticate, function(req, res) {
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

app.delete('/hooks/:hookId', authenticate, function(req, res) {
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


// TODO: experimental; remove
if (argv.logfile) app.get('/hx/logs', authenticate, function(req, res) {
    //
    // Find items logged between today and yesterday.
    //
    var options = {
        from: 0,    //new Date() - 24 * 60 * 60 * 1000,
        until: new Date(),
        limit: 100,
        start: 0,
        order: 'asc',
        fields: ['req', 'res']
    };

    winston.query({}, function (err, results) {
        if (err) return res.status(500).send(err);
        res.send(results);
    });
});


// TODO: experimental; remove
app.get('/hx/routelist', authenticate, function(req, res) {
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

// serve the editor to authenticated users
app.use('/editor', authenticate, express.static(__dirname + '/editor'));

// serve the static content to anyone
app.use('/', express.static(__dirname + '/public'));

// load startup hooks
if (argv.load) {
    var startupHooks = JSON.parse(fs.readFileSync(argv.load).toString());
    console.log('Loading startup hooks...');
    startupHooks.forEach(function(hook, index) {
        console.log('loading hook:', hook);
        saveHook(hook, function(err, hook) {
            if (err) console.log('Load error:', hook, err);
        });
    });
}

// configure SSL
var server;
if (argv.ssl) {
	console.log('Configuring SSL...');
	var ssl_key = fs.readFileSync(argv.certs + '/server.key').toString();
	var ssl_cert = fs.readFileSync(argv.certs + '/server.crt').toString();
    server = https.createServer({key: ssl_key, cert: ssl_cert}, app);
	//var ssl_cabundle = fs.readFileSync(argv.certs + '/server.cabundle').toString();
	//server = https.createServer({key:ssl_key, cert:ssl_cert, ca:ssl_cabundle}, app);
}
else {
	server = http.createServer(app);
}

var listener = server.listen(argv.port, function() {
    console.log('Server is listening at:', listener.address());
});
