#! /usr/bin/env node

// parse command line arguments
var argv = require('yargs')
    .usage('Usage: $0 --url=[http://localhost:3000]')
	.default('url', 'http://localhost:3000')
    .default('auth', 'hook:express')
    .argv;

console.log('ioclient here! v0.1');
console.log(argv);

var request = require('request');

var auth = argv.auth.split(':');

var ioclient = require('socket.io-client');

function show(data) {
    console.log(JSON.stringify(data, null, 4));
}
// connect to api endpoint with username/password
request({
        url: 'http://localhost:3000/hx/hooks',
        method: 'get',
        auth: {
            'user': auth[0],
            'pass': auth[1]
        },
        jar: true       // we want the cookies
    },
    function(err, response, body) {
        if (err) {
            console.log('Error fetching cookie:', err);
            process.exit(-1);
        }
        //console.log('Response:', response.headers['set-cookie']);

        // retrieve 'connect.sid' cookie
        var whole_cookie = response.headers['set-cookie'][0];
        var cookie_data = whole_cookie.split(';')[0].trim();
        //console.log('cookie_data:', cookie_data);

        // pass cookie to io.connect below
        var conn = ioclient.connect(argv.url, {
            extraHeaders: { "x-hx-auth": cookie_data }
        });

        // register for the hx channels
        conn.on('hx.hook.update', function(data) {data.channel = 'hx.hook.update'; show(data);});
        conn.on('hx.hook.delete', function(data) {data.channel = 'hx.hook.delete'; show(data);});
        conn.on('hx.hook.log', function(data) {data.channel = 'hx.hook.log'; show(data);});
        conn.on('hx.ping', function(data) {data.channel = 'hx.ping'; show(data);});
    }
);


process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (key) {
	if (argv.verbose) console.log('Key:', key, typeof key);
  	if ((key === '\u0003') || (key == 'q')) process.exit();
});
