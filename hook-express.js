// hook-express.js
//
// Copyright 2016 by Bill Roy - see LICENSE file
//

function env(key, default_value) {
    return process.env[key] || default_value;
}

// parse command line arguments
var argv = require('yargs')
    .usage('Usage: $0 --port=[3000] --api_base=[/hx] --ssl --ssl_certs=[~/.certs] --load=[file|url] --logfile=[] --loglevel=[info] --capture --no_static')
    .default('port', env('PORT', 3000))
    .default('api_base', env('API_BASE', '/hx'))
    .default('ssl', env('SSL', false))
    .default('load', env('LOAD', ''))
    .default('certs', env('CERTS', '~/.certs'))
    .default('logfile', env('LOGFILE', undefined))
    .default('loglevel', env('LOGLEVEL', 'info'))
    .default('capture', env('CAPTURE', false))
    .default('no_static', env('NO_STATIC', undefined))
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
var io;                         // socket.io handle
var router = express.Router();  // router instance for /hx routes
var helmet = require('helmet');
app.use(helmet());              // engage security protections
app.enable('trust proxy');      // configure to support x-forwarded-for header for req.ip

var cookie_secret = '343243sfdjksdf423443';
var cookie_signature = require('cookie-signature');
//var cookieParser = require('cookie-parser');
var session = require('express-session');
app.use(session({
    secret: cookie_secret
}));

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

    if (argv.debug) {
        console.log('CUSTOM LEVEL:', level);
        console.log('CUSTOM MSG:', msg);
        console.log('CUSTOM META:', meta);
    }

    // delete authorization header so it isn't logged;
    // can't find a way to do this in express-winston
    if (meta && meta.req && meta.req.headers && meta.req.headers.authorization) {
        delete meta.req.headers.authorization;
    }

    // update socket.io clients if it's a hook invocation
    // TODO: remove meta.req.route
    // TODO: populate level, timestamp?
    if (msg) meta.message = msg;
    if (meta && meta.req && meta.req.route && meta.req.route.stack &&
            (meta.req.route.stack.length == 1) &&
            (meta.req.route.stack[0].name.startsWith('hook_'))) {
        io.emit('hx.hook.log', {
            hookId: meta.req.route.stack[0].name,
            log: meta
        });
    }

    // optionally capture 404s as new hooks
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
            io.emit('hx.hook.update', hook);
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
expressWinston.requestWhitelist.push('route');
expressWinston.requestWhitelist.push('session');

expressWinston.responseWhitelist.push('body');
expressWinston.responseWhitelist.push('headers');

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
    res.set('WWW-Authenticate', 'Basic realm=hook-express');
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
app.use(function injectContext(req, res, next) {
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
                io.emit('hx.hook.update', outputHooks);
                res.send(outputHooks);
            }
        );
    }
    else {
        hookBoss.save(req.body, function(err, hook) {
            if (err) return res.status(400).send(err);
            io.emit('hx.hook.update', hook);
            res.send(hook);
        });
    }
});

router.get('/hooks', authenticate, function(req, res) {
    res.send(hookBoss.get());
});

router.get('/hooks/:hookId', authenticate, function(req, res) {
    winston.info('REQUEST.ROUTE:', req.route);
    var hook = hookBoss.get(req.params.hookId || '');
    if (hook) res.send(hook);
    else res.status(404).send('not found');
});

router.delete('/hooks/:hookId', authenticate, function(req, res) {
    if (req.params.hookId == '*') {
        hookBoss.get().forEach(function(hook) {
            io.emit('hx.hook.delete', hook.hookId);
            hookBoss.remove(hook.hookId);
        });
        res.status(200).send('deleted');
    }
    else {
        if (hookBoss.remove(req.params.hookId)) {
            io.emit('hx.hook.delete', req.params.hookId);
            res.status(200).send('deleted');
        }
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
if (!argv.no_static) app.use('/', express.static(__dirname + '/public'));

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
var sockets = [];
var listener = server.listen(argv.port, function() {
    winston.info('Server is listening at:', listener.address());

    // load optional startup hooks
    if (argv.load) hookBoss.load(argv.load);

    // start up socket.io
    io = require('socket.io').listen(listener);

    io.use(function(socket, next) {
        //console.log('handshake cookie data:', socket.request.headers.cookie);
        //console.log('IO.USE AUTH CHECK');

        // parse the cookies.  surely there is a better way.
        // TODO: consider refactor per express-session/index.js::getcookie
        var cookie, encoded_cookie, cookie_text_parts;
        if (socket && socket.request && socket.request.headers &&
                socket.request.headers.cookie) {
            cookie_parts = socket.request.headers.cookie.split(';');
            var cookies = {};
            cookie_parts.forEach(function(cookie_text, index) {
                var cookie_text_parts = cookie_text.split('=');
                cookies[cookie_text_parts[0].trim()] = decodeURIComponent( cookie_text_parts[1].trim());
            });
            if (!cookies['connect.sid']) return next('unauthorized..');
            encoded_cookie = cookies['connect.sid'].slice(2);
            cookie = cookie_signature.unsign(encoded_cookie, cookie_secret);
            if (cookie === false) return next('unauthorized...');
            //console.log('authenticated via cookie');
            return next();
        }
        else if (socket && socket.handshake && socket.handshake.headers &&
                    socket.handshake.headers['x-hx-auth']) {
            //console.log('attempting x-hx-auth');
            cookie_text_parts = socket.handshake.headers['x-hx-auth'].split('=');
            encoded_cookie = decodeURIComponent(cookie_text_parts[1].trim());
            cookie = cookie_signature.unsign(encoded_cookie.slice(2), cookie_secret);
            if (cookie === false) return next('unauthorized....');
            //console.log('authenticated via x-hx-auth');
            return next();
        }
        else return next('unauthorized');
    });

    io.sockets.on('connection', function(socket) {
        sockets.push(socket);
        socket.on('hx.pong', function(data) {
            console.log('*** Pong:', data);
        });
        socket.on('hello', function(data) {
            console.log('*** Hello:', data);
        });

        socket.emit('hx.ping', {time: new Date().getTime()});

        //socket.on('getlogs', function(data) {
        //    socket.emit('logs', data);
        //});
    });

});
