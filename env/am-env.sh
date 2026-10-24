# Source this from a bash script to read the AgentMesh environment file.
#
#   . "$REPO_DIR/env/am-env.sh"
#   PROJECT="$(am_env gcp.project)"
#
# AGENTMESH_ENV picks the environment and defaults to prod, so a script run as
# before reads the values it used to have written into it. The values come from
# env/<name>.json through env/load.cjs, the same reader the services use, so a
# shell script and a service cannot disagree. am_env fails (and so, under
# set -e, does the script) when a value is missing or null.

AM_ENV_DIR="${AM_ENV_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

am_env() {
  node "$AM_ENV_DIR/load.cjs" get "$1"
}
