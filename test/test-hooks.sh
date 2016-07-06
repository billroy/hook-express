#! /bin/bash

set -x
http -a hook:express :3000/hx/hooks path=/random hook='res.send(""+Math.random());'
http -a hook:express :3000/random
http -a hook:express :3000/hx/hooks path=/echo method=post hook='res.send(req.body);'
http -a hook:express :3000/echo foo=bar
http -a hook:express :3000/hx/hooks path=/count hook='res.send(""+res.locals.context.requestCount);'
http -a hook:express :3000/hx/hooks path=/time hook='res.send(new Date());'
http -a hook:express :3000/time
http -a hook:express :3000/count
http -a hook:express :3000/hx/hooks

#http -a hook:express :3000/hooks path=/hook2 hook=" \
#require('request').get('http://localhost:3000/hooks', function(err, response, body) { \
#    if (err) return res.status(400).send(err); \
#    res.send(body); \
#});"
#http -a hook:express :3000/hook2
