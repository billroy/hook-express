// hook-express.js
//
// Copyright 2016 by Bill Roy - see LICENSE file
//

function env(key, default_value) {
    return process.env[key] || default_value;
}

// parse command line arguments
var argv = require('yargs')
    .usage('Usage: $0 --port=[3000] --api_base=[/hx] --ssl --ssl_certs=[~/.certs] --load=[file|url] --logfile=[] --loglevel=[info] --capture')
    .default('port', env('PORT', 3000))
    .default('api_base', env('API_BASE', '/hx'))
    .default('ssl', env('SSL', false))
    .default('load', env('LOAD', ''))
    .default('certs', env('CERTS', '~/.certs'))
    .default('logfile', env('LOGFILE', undefined))
    .default('loglevel', env('LOGLEVEL', 'info'))
    .default('capture', env('CAPTURE', false))
    .argv;

console.log('hook-express here! v0.3');
console.log(argv);

var async = require('async');
var fs = require('fs');
var request = require('request');
var util = require('util');

// initialize the express app
var express = require('express');
var app = express();
var router = express.Router();  // router instance for /hx routes
var helmet = require('helmet');
app.use(helmet());              // engage security protections
app.enable('trust proxy');      // configure to support x-forwarded-for header for req.ip

var http = require('http');
var https = require('spdy');

// configure json and url-encoded body parsers
var bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

// initialize hook boss on the app
var hookBoss = require('./hook-boss.js');
hookBoss.init({app: app});

// configure logging
var winston = require('winston');

// awkward but required: must remove/add Console to change options
winston.remove(winston.transports.Console);

// create a custom logger
var CustomLogger = winston.transports.CustomLogger = function (options) {
    this.name = 'customLogger';
    this.level = options.level || 'info';
};
util.inherits(CustomLogger, winston.Transport);
CustomLogger.prototype.log = function (level, msg, meta, callback) {
    // optionally capture 404s as new hooks

    if (argv.debug) {
        console.log('CUSTOM LEVEL:', level);
        console.log('CUSTOM MSG:', msg);
        console.log('CUSTOM META:', meta);
    }

    if (argv.capture && meta && meta.res && meta.res.statusCode && (meta.res.statusCode == 404)) {
        //console.log('creating hook for', meta.req.path);
        hookBoss.save({
            path: meta.req.path,
            method: meta.req.method.toLowerCase(),
            hook: [
                '// ' + msg,
                '// generated ' + new Date(),
                (meta.req.method == 'get') || (meta.req.method == 'GET') ?
                    'res.send("");' :
                    'res.send(req.body || req.params || req.query || "");'
            ].join('\n')
        }, function(err, hook) {
            callback(null, true);
        });
    }
};
winston.add(winston.transports.CustomLogger, {});

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
expressWinston.requestWhitelist.push('ip');
expressWinston.requestWhitelist.push('ips');
expressWinston.requestWhitelist.push('params');
expressWinston.requestWhitelist.push('path');
expressWinston.responseWhitelist.push('body');
app.use(expressWinston.logger({
    winstonInstance: winston
}));


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

// middleware to inject context as res.locals.context
app.use(function(req, res, next) {
    context.requestCount++;
    res.locals.context = context;
    next();
});

router.post('/hooks', authenticate, function(req, res) {
    if (Array.isArray(req.body)) {
        outputHooks = [];
        async.eachSeries(req.body,
            function(hook, next) {
                hookBoss.save(hook, function(err, hook) {
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
        hookBoss.save(req.body, function(err, hook) {
            if (err) return res.status(400).send(err);
            res.send(hook);
        });
    }
});

router.get('/hooks', authenticate, function(req, res) {
    res.send(hookBoss.get());
});

router.get('/hooks/:hookId', authenticate, function(req, res) {
    var hook = hookBoss.get(req.params.hookId || '');
    if (hook) res.send(hook);
    else res.status(404).send('not found');
});

router.delete('/hooks/:hookId', authenticate, function(req, res) {
    if (req.params.hookId == '*') {
        hookBoss.get().forEach(function(hook) {
            hookBoss.remove(hook.hookId);
        });
        res.status(200).send('deleted');
    }
    else {
        if (hookBoss.remove(req.params.hookId)) res.status(200).send('deleted');
        else res.status(404).send('not found');
    }
});


// TODO: experimental; remove
// requires --logfile to be specified
if (argv.logfile) router.get('/logs', authenticate, function(req, res) {
    // Find items logged between today and yesterday.
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
router.get('/routes', authenticate, function(req, res) {
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
router.use('/editor', authenticate, express.static(__dirname + '/editor'));

// mount the app
winston.info('Mounting application on %s', argv.api_base);
app.use(argv.api_base, router);

// serve the static content to anyone
app.use('/', express.static(__dirname + '/public'));

// configure SSL
var server;
if (argv.ssl) {
	console.log('Configuring SSL...');
	var ssl_key = fs.readFileSync(argv.certs + '/server.key').toString();
	var ssl_cert = fs.readFileSync(argv.certs + '/server.crt').toString();
    server = https.createServer({key: ssl_key, cert: ssl_cert}, app);
}
else server = http.createServer(app);

// start the server
var listener = server.listen(argv.port, function() {
    console.log('Server is listening at:', listener.address());

    // load optional startup hooks
    if (argv.load) hookBoss.load(argv.load);
});
