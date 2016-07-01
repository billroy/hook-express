# hook-express README.md

![Editor](https://raw.githubusercontent.com/billroy/hook-express/master/doc/editor.png "Using the editor")

![Command line](https://raw.githubusercontent.com/billroy/hook-express/master/doc/cli.png "Using the API")

## What is it?

hook-express a micro-service host and laboratory for expressjs.  

The hook-express server is an expressjs web app that can live-edit its routing and per-route behavior on the fly.  You can add and edit routes and route functions (which are called here "hooks") through the hooks API or a web-based editor interface, without restarting the server to change configurations.

The server exposes an API that provides for manipulation of hooks, and an editor interface for editing hooks through-the-web.


## What is a hook?

A hook is a set of javascript statements that implement the business logic of an API endpoint for a micro-service.

The code for a hook is the core of an express route dispatch function.  For example, considering this express route dispatch function:

    app.use('/time', function(req, res) {
        res.send(new Date());
    });

The "hook" part is just the guts of the function:

    res.send(new Date());

## Install

    git clone https://github.com/billroy/hook-express.git
    cd hook-express
    npm install
    node hook-express

Open a browser on http://localhost:3000/editor

## Default username and password

The editor and API require a username and password for access.  It is important to be aware that the code running in a hook has access to the local file system!

The default username is 'hook' and the default password is 'express'.

Please change the username and password or risk becoming a security statistic.

You can change the username and password by setting these environment variables before starting hook-express:

    HOOK_EXPRESS_API_USERNAME
    HOOK_EXPRESS_API_PASSWORD

You can also add usernames to the 'apiUsers' table in hook-express.js.



## Static files

You can add files to be static-served to the public/ directory and hook-express will serve them at '/'.  So, the file public/index.html is the home page for the site.

## HttPie

The examples below use the excellent "http" utility from HttPie: https://httpie.org -- it is well-suited for this sort of use because, unlike curl and wget, it has json-friendly defaults.

## API Example: creating a web hook to return the time

    $ http -b -a hook:express :3000/time
    Cannot GET /time

    $ http -b -a hook:express :3000/hooks path=/time hook='res.send(new Date());'
    {
        "hook": "res.send(new Date());",
        "hookId": "hook_6",
        "method": "get",
        "path": "/time"
    }

    $ http -b -a hook:express :3000/time
    "2016-06-29T00:21:58.973Z"


## API Example: fetching all hooks

    $ http -a hook:express :3000/hooks
    {
        "hook_6": {
            "hook": "res.send(new Date());",
            "hookId": "hook_6",
            "method": "get",
            "path": "/time"
        }
    }

## API Example: fetching a single hook by hookId

        $ http -a hook:express :3000/hooks/hook_6
        {
            "hook_6": {
                "hook": "res.send(new Date());",
                "hookId": "hook_6",
                "method": "get",
                "path": "/time"
            }
        }


## API Example: deleting a hook

    $ http delete -a hook:express :3000/hooks/hook_6
    deleted

    $ http :3000/hooks
    {}


## API Example: deleting all hooks

    $ http delete -a hook:express :3000/hooks/*
    deleted
