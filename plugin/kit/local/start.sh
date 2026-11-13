#!/bin/sh
# The agent's container on the local AgentMesh (node .adlc/local.mjs). The
# first start trades the single-use agent key for the agent's credential,
# kept on the container's volume, so a restart is the same agent and the key
# is never needed again. Then the adapter serves the agent: each message runs
# the bridge, which hands it to the package's own entrypoint.
set -eu
export HOME=/data/home
mkdir -p "$HOME"
if [ ! -s "$HOME/.agentmesh/adapter/mesh.creds" ]; then
  agentmesh mesh-home set "$LOCAL_MESH_HOME"
  agentmesh bootstrap "$LOCAL_AGENT_KEY"
fi
unset LOCAL_AGENT_KEY
exec agentmesh start --cmd "node /opt/local/bridge.mjs" --raw --name "$AGENT_NAME" --unattended --acts-for organization
