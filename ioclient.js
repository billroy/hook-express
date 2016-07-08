#! /usr/bin/env node

// parse command line arguments
var argv = require('yargs')
    .usage('Usage: $0 --url=[http://localhost:3000]')
	.default('url', 'http://localhost:3000')
    .default('auth', 'hook:express')
    .argv;

console.log('ioclient here! v0.1');
console.log(argv);

var ioclient = require('socket.io-client');

function show(data) {
    console.log(JSON.stringify(data, null, 4));
}

// connect to api endpoint with username/password
// retrieve 'connect.sid' cookie
// pass cookie to io.connect below
// TODO: research how!

var conn = ioclient.connect(argv.url);

conn.on('hx.hook.log', function(data) {show(data);});

//conn.emit('hx.boot');

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (key) {
	if (argv.verbose) console.log('Key:', key, typeof key);
  	if ((key === '\u0003') || (key == 'q')) process.exit();
});
