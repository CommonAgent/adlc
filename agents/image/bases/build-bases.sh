#!/usr/bin/env bash
# Build base images on Cloud Build in the environment's project, with the
# registry filled from the environment file (env/<AGENTMESH_ENV>.json, default
# prod). The catalogue and the harness build config name their registry as
# {gcp.registry}; this is what turns that into a real address for a build.
#
#   bash build-bases.sh harness [_KEY=value ...]
#       the three harness tags, per agentmesh-harness/cloudbuild.yaml, with
#       any substitution given replacing the config's own
#   bash build-bases.sh <dir> <image to publish>
#       one base from <dir>/Dockerfile, built on the image its catalogue
#       entry records as built_from (e.g. agentmesh-chromium-video)
#
# AGENTMESH_ENV=dev builds into dev's registry. Nothing is built without an
# explicit argument, and the Dockerfiles carry no default base any more, so a
# build that skips this script stops at its FROM line instead of quietly
# building on prod's images.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
. "$REPO/env/am-env.sh"
GCLOUD="${GCLOUD:-gcloud}"
PROJECT="$(am_env gcp.project)"
IMAGE_DIR="$HERE/.."

what="${1:-}"
if [ "$what" = "harness" ]; then
  shift
  # Every substitution the config declares, filled from the environment, with
  # any _KEY=value given after `harness` replacing the config's own (a new
  # output tag, before the repository names it). {gcp.registry} in an override
  # is filled too.
  subs="$(cd "$IMAGE_DIR" && node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { fillRegistry } from "./emit-image.mjs";
    const text = fillRegistry(readFileSync("bases/agentmesh-harness/cloudbuild.yaml", "utf8"));
    const subs = Object.fromEntries([...text.matchAll(/^\s{2}(_[A-Z0-9_]+):\s*(.+)$/gm)].map((m) => [m[1], m[2].trim()]));
    for (const a of process.argv.slice(1)) {
      const m = /^(_[A-Z0-9_]+)=(.+)$/.exec(a);
      if (!m || !(m[1] in subs)) throw new Error(`${a} is not KEY=value for a substitution the config declares`);
      subs[m[1]] = fillRegistry(` ${m[2]}`).slice(1);
    }
    const pairs = Object.entries(subs).map(([k, v]) => `${k}=${v}`);
    if (pairs.some((p) => p.includes(","))) throw new Error("a substitution holds a comma; pass them another way");
    console.log(pairs.join(","));
  ' "$@")"
  # The config itself names {gcp.registry} in its substitutions block, which is
  # not valid YAML for gcloud to read, so it is handed a copy with the registry
  # filled in (the --substitutions above still decide every value).
  cfg="$(mktemp)"; trap 'rm -f "$cfg"' EXIT
  (cd "$IMAGE_DIR" && node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { fillRegistry } from "./emit-image.mjs";
    process.stdout.write(fillRegistry(readFileSync("bases/agentmesh-harness/cloudbuild.yaml", "utf8")));
  ') > "$cfg"
  cd "$HERE/agentmesh-harness"
  "$GCLOUD" builds submit --config "$cfg" --project "$PROJECT" --timeout=40m --substitutions="$subs" .
  exit $?
fi

if [ -n "$what" ] && [ -n "${2:-}" ] && [ -f "$HERE/$what/Dockerfile" ]; then
  from="$(cd "$IMAGE_DIR" && DIR="bases/$what/Dockerfile" node --input-type=module -e '
    import { readBases } from "./emit-image.mjs";
    const b = readBases().find((x) => x.dockerfile === process.env.DIR && x.built_from);
    if (!b) throw new Error(`no catalogue entry is built from ${process.env.DIR}`);
    console.log(b.built_from);
  ')"
  cfg="$(mktemp)"; trap 'rm -f "$cfg"' EXIT
  printf '{"steps":[{"name":"gcr.io/cloud-builders/docker","args":["build","--build-arg","FROM_IMAGE=%s","-t","%s","."]}],"images":["%s"]}\n' "$from" "$2" "$2" > "$cfg"
  cd "$HERE/$what"
  exec "$GCLOUD" builds submit --config "$cfg" --project "$PROJECT" --timeout=40m .
fi

echo "usage: bash build-bases.sh harness | <dir> <image to publish>" >&2
exit 2
