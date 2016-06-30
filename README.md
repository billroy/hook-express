


# Install

    git clone
    cd
    npm install
    node hook

# Example: creating a web hook to return the time

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


# Example: fetching all hooks

    $ http :3000/hooks
    {
        "hook_6": {
            "hook": "res.send(new Date());",
            "hookId": "hook_6",
            "method": "get",
            "path": "/time"
        }
    }

# Example: fetching a single hook by hookId

        $ http :3000/hooks/hook_6
        {
            "hook_6": {
                "hook": "res.send(new Date());",
                "hookId": "hook_6",
                "method": "get",
                "path": "/time"
            }
        }


# Example: deleting a hook

    $ http delete :3000/hooks/hook_6
    deleted

    $ http :3000/hooks
    {}


# Example: deleting all hooks

    $ http delete :3000/hooks/*
    deleted
