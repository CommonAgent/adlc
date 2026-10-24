# The AgentMesh base image: a node runtime with the adapter on the path.
#
# WHY THIS EXISTS. Every agent package declares `agentmesh` among its required
# binaries, because that is how an agent sends: the adapter holds the key and
# speaks the mesh. The image emitter refuses to install a declared binary on a
# package's behalf, which is 12.4 rule 1 working as written, and fails the
# build naming that binary's purpose. So the binary has to already be in the
# base, and this is the base.
#
# It is the plainest one. Anything a particular package needs beyond node and
# the adapter belongs in a base layered on top of this, the way
# bases/agentmesh-chromium does, so that a package needing chromium does not
# force chromium onto a package that does not.
#
# WHAT IT IS NOT. It carries no key, no credential, no address and no account
# identifier. It is a runtime, not an agent. What makes an agent is the package
# layered on top and the identity handed in at start, and both of those arrive
# after this image is built.
#
# The adapter arrives as a tarball rather than from a registry because that is
# how it is released today: `npm pack` in mesh-adapter/ produces it, and the
# version in the tag below must match the tarball's.
#
#   cd fleet-manager/image/bases/agentmesh
#   cp ../../../../mesh-adapter/mesh-adapter-<version>.tgz .
#   docker build -t <your registry>/agentmesh-base:<version> .
#
# The tarball has to be in the context, because docker reads the context and not
# the repository. The line above is the whole of it for an operator with a
# Docker daemon; ours goes through a build service instead, which changes the
# command and nothing in this file. Either way, ../../build-bases.mjs prints the
# command for every base a catalogue names, in the order they have to run, with
# the image underneath filled in from that catalogue.
ARG NODE_BASE=node:22-bookworm-slim
FROM ${NODE_BASE}

ARG ADAPTER_TARBALL=mesh-adapter-0.88.6.tgz
COPY ${ADAPTER_TARBALL} /tmp/adapter.tgz
RUN npm install -g /tmp/adapter.tgz --no-audit --no-fund --loglevel=error \
 && rm -f /tmp/adapter.tgz

# Prove what this base claims to provide, in the image, once, where an operator
# is watching. A base that quietly loses the adapter would otherwise be found
# by every package that builds on it, one slow cloud build at a time.
RUN command -v agentmesh >/dev/null || { echo "the adapter is not on the path" >&2; exit 1; } \
 && node -e 'const v=process.versions.node.split(".").map(Number); if (v[0] < 22) { console.error("node is " + process.versions.node + ", and packages declare >=22"); process.exit(1); }'
