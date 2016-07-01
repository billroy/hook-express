hook-express README.md
7/1/16 -br

![Editor](https://raw.githubusercontent.com/billroy/hook-express/master/doc/editor.png "Using the editor")

![Command line](https://raw.githubusercontent.com/billroy/hook-express/master/doc/cli.png "Using the API")

# What is it?

hook-express a micro-service host and laboratory for expressjs.  

The hook-express server is an expressjs web app that can live-edit its routing and per-route behavior on the fly.  You can add and edit routes and route functions (which are called here "hooks") through the hooks API or a web-based editor interface, without restarting the server to change configurations.

The server exposes an API that provides for manipulation of hooks, and an editor interface for editing hooks through-the-web.


# What is a hook?

A hook is a set of javascript statements that implement the business logic of an API endpoint for a micro-service.

The code for a hook is the core of an express route dispatch function.  For example, considering this express route dispatch function:

    app.use('/time', function(req, res) {
        res.send(new Date());
    });

The "hook" part is just the guts of the function:

    res.send(new Date());

# Install

    git clone https://github.com/billroy/hook-express.git
    cd hook-express
    npm install
    node hook-express

Open a browser on http://localhost:3000/editor

# Static files

You can add files to be static-served to the public/ directory and hook-express will serve them at '/'.  So, the file public/index.html is the home page for the site.

# API Example: creating a web hook to return the time

    $ http -b :3000/time
    Cannot GET /time

    $ http -b :3000/hooks path=/time hook='res.send(new Date());'
    {
        "hook": "res.send(new Date());",
        "hookId": "hook_6",
        "method": "get",
        "path": "/time"
    }

    $ http -b :3000/time
    "2016-06-29T00:21:58.973Z"


# API Example: fetching all hooks

    $ http :3000/hooks
    {
        "hook_6": {
            "hook": "res.send(new Date());",
            "hookId": "hook_6",
            "method": "get",
            "path": "/time"
        }
    }

# API Example: fetching a single hook by hookId

        $ http :3000/hooks/hook_6
        {
            "hook_6": {
                "hook": "res.send(new Date());",
                "hookId": "hook_6",
                "method": "get",
                "path": "/time"
            }
        }


# API Example: deleting a hook

    $ http delete :3000/hooks/hook_6
    deleted

    $ http :3000/hooks
    {}


# API Example: deleting all hooks

    $ http delete :3000/hooks/*
    deleted
