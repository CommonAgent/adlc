#!/bin/bash
# The ops agents' first install on a fleet host: agentbuilder (the package
# maker), deploymgr (the deployment manager) and agentevaluator (the
# conformance checker), each as an agent on the ops node with its own key,
# its name, its descriptor, and a brain the fleet supervisor wakes per message.
#
# WHY THIS IS A BOOTSTRAP. These three are the Agent SDLC's own tools: the
# package maker packs, the deploy request is filed, the deployment manager
# installs, the conformance checker proves. A package goes through them; they
# are not packages, and nothing installs the installer. Prod got them by hand
# in August and September 2026 (fleet-manager/declare-roles.sh, the brains,
# the adapter node move of 2026-09-22, the naming batch of 2026-09-26). This
# script is that hand work written down once, so a new environment gets the
# same three the same way. Read ops-agents/README.md before running it.
#
# Run as root on the fleet host, from the staged folder (ops-agents/README.md
# says how it is staged):
#
#   sudo bash /tmp/ops-agents/install-on-host.sh /tmp/ops-agents
#
# The staged folder holds the rendered brains, the pack-as-node script, the
# responses bridge, the pm2 file, follow-names.mjs, each agent's listing,
# public line and unbound descriptor, and tokens.json: one single-use agent
# key per agent, minted for the platform account. The keys are read from that
# file, never printed, and the file is removed at the end.
#
# Safe to run again: an agent whose node folder already holds an identity is
# not added twice, and a file already in place is kept beside a backup when it
# changes.
set -euo pipefail
STAGE="${1:?the staged folder}"
FLEET=/opt/fleet
ROOT=$FLEET/node-ops
NAMES="agentbuilder deploymgr agentevaluator"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
set -a; . /etc/environment; set +a

place() { # place <src> <dest> <mode> [owner]
  local src="$1" dest="$2" mode="$3" owner="${4:-root:root}"
  if [ -f "$dest" ] && cmp -s "$src" "$dest"; then echo "  same: $dest"; return; fi
  [ -f "$dest" ] && cp -p "$dest" "$dest.bak-$STAMP"
  install -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$src" "$dest"
  echo "  placed: $dest"
}

echo "== the harness and the bridge"
if [ ! -x /usr/bin/codex ]; then
  npm i -g @openai/codex@0.144.6 >/dev/null 2>&1
fi
echo "  codex: $(/usr/bin/codex --version 2>/dev/null || echo missing)"
place "$STAGE/responses-bridge.mjs" $FLEET/responses-bridge.mjs 0644
place "$STAGE/follow-names.mjs" $FLEET/follow-names.mjs 0644
place "$STAGE/agentbuilder-pack-as-node.sh" $FLEET/agentbuilder-pack-as-node.sh 0755
for n in $NAMES; do place "$STAGE/brains/$n.sh" $FLEET/brains/$n.sh 0755; done
if [ ! -f $FLEET/ecosystem.config.js ]; then
  place "$STAGE/ecosystem.config.js" $FLEET/ecosystem.config.js 0644
else
  echo "  kept: $FLEET/ecosystem.config.js (this host has its own pm2 file; its ops entries are not changed here)"
fi
visudo -c >/dev/null && echo "  sudoers: valid"

echo "== the ops node's folders"
install -d -m 0710 -o mesh-node -g mesh-node $ROOT $ROOT/agents
TOKENS="$STAGE/tokens.json"
for n in $NAMES; do
  dir=$ROOT/agents/$n
  home_id=/home/$n/.agentmesh/adapter/identity.json
  if [ -f "$dir/identity.json" ]; then
    echo "  $n: already on the ops node ($(node -e 'console.log(require(process.argv[1]).public_key.slice(0,12))' "$dir/identity.json")...)"
  else
    token=$(node -e 'const t=require(process.argv[1])[process.argv[2]];if(!t)process.exit(3);process.stdout.write(t)' "$TOKENS" "$n") || { echo "  $n: no agent key in tokens.json; skipped"; continue; }
    if [ -f "$home_id" ]; then
      # The key the host already made for this agent (runbook 1.6) becomes its
      # mesh identity, so what it has signed here stays its own.
      stage_dir=$ROOT/agents/.$n.adding
      rm -rf "$stage_dir"; install -d -m 0700 -o mesh-node -g mesh-node "$stage_dir"
      install -m 0600 -o mesh-node -g mesh-node "$home_id" "$stage_dir/identity.json"
      creds=$(mktemp -d)
      chown mesh-node "$creds"
      sudo -u mesh-node env MESH_ADAPTER_STATE="$stage_dir" MESH_CREDS_FILE="$creds/mesh.creds" /usr/bin/mesh-adapter bootstrap "$token" 2>&1 | grep -E "belongs to|named|fail|error" | sed "s/^/  $n: /" || true
      rm -rf "$creds"
      mv "$stage_dir" "$dir"
    else
      sudo -u mesh-node env MESH_ADAPTER_STATE=$ROOT /usr/bin/mesh-adapter agent add "$n" --token "$token" 2>&1 | grep -E "added|belongs to|named|fail|error" | sed "s/^/  $n: /" || true
      install -d -m 0700 -o "$n" -g "$n" /home/$n/.agentmesh /home/$n/.agentmesh/adapter
      install -m 0600 -o "$n" -g "$n" "$dir/identity.json" "$home_id"
    fi
  fi
  [ -f "$dir/identity.json" ] || { echo "  $n: no identity on the ops node; stopped here for this agent"; continue; }
  for f in listing.json public.json; do install -m 0600 -o mesh-node -g mesh-node "$STAGE/agents/$n/$f" "$dir/$f"; done
  if [ ! -f "$dir/descriptor.json" ]; then
    install -m 0600 -o mesh-node -g mesh-node "$STAGE/agents/$n/descriptor.json" "$dir/descriptor.json"
  fi
  if [ "$n" = agentbuilder ] && [ ! -f "$dir/price.json" ]; then
    # Free, as on prod since 2026-09-15: the process runner holds no agreement
    # with the platform's own agents, and a paid default refuses it.
    printf '%s\n' '{"sku":"default","covers":{"agent":true},"price":{"model":"free"},"provider":{"id":"internal"}}' > "$dir/price.json"
    chown mesh-node:mesh-node "$dir/price.json"; chmod 0600 "$dir/price.json"
  fi
done
rm -f "$TOKENS"

echo "== the pm2 apps"
for app in responses-bridge mesh-node-ops; do
  if pm2 describe "$app" >/dev/null 2>&1; then echo "  $app: already in pm2"; else pm2 start $FLEET/ecosystem.config.js --only "$app" >/dev/null && echo "  $app: started"; fi
done
sleep 20

echo "== the descriptors, bound to each key and its name"
(cd $FLEET && node $FLEET/follow-names.mjs --apply --only "${NAMES// /,}")

echo "== the supervisor's roster"
(cd $FLEET && node $FLEET/roster.mjs && node $FLEET/roster.mjs --check) | tail -3
pm2 save >/dev/null && echo "  pm2 saved"
