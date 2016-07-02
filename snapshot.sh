#!/bin/bash
http -a hook:express :3000/hooks | jq . > startup-hooks.json
