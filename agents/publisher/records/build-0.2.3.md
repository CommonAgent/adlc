# publisher 0.2.3: one meaning for MESH_API_BASE

Date: 2026-10-05.

## Why

Technical debt 271: the deployment manager gives a container job
MESH_API_BASE as the platform's origin with no path (urls.app, for example
https://app.agentmesh.ai), and the process runner reads it that way, but this
package's broker read it as the API root with /v1 already on it. A job given
the origin asked https://app.agentmesh.ai/stack-credential, which is not
there. Found proving quiz-maker 0.5.0's trial on dev (its page was not
staged) and, after the prod fleet roll, on explainer-maker 0.14.1's prod
trial (no staged link).

## What changed

- The broker reads MESH_API_BASE as the origin and adds /v1 (apiRootOf). A
  value that already ends in /v1, set by hand before the meaning was
  settled, is read as it stands; none gives the default as before.

## Tests

The broker's own tests cover the origin with and without a trailing slash,
a value ending in /v1, and none.

## Who held each step

The harness (Claude Code) wrote the change and the tests, on the owner's
approval of trials (relayed by the coordinator, 2026-10-04) and the
coordinator's instruction to settle debt 271. Packaging, the deploy request
and the install go through the agent builder, the platform account's deploy
queue and deploymgr, on dev first.
