# A base image for Agent Packages that declare chromium.
#
# WHY THIS EXISTS. An install file names the binaries a package needs, and the
# installer MUST check each one and MUST stop when one is missing, never
# substitute (12.4 rule 1). The emitter turns that rule into a build step, so a
# package can only be imaged onto a base that already has its binaries.
# explainer-critic and explainer-maker both declare chromium; the agentmesh
# base carries node and the adapter and no browser; so their builds stopped at
# the check, which is the rule working and not a bug to code around.
#
# A base is where a binary is allowed to be installed, because a base belongs
# to the operator and not to any package. This image is the agentmesh base plus
# a browser and the fonts it draws with, and nothing else.
#
# It holds no key, no address, no account identifier and no package: it is the
# same image for every agent that ever runs on it. What an agent is, what it
# may reach and what it may spend arrive per container.
#
#   gcloud builds submit --tag gcr.io/<project>/agentmesh-chromium-base:<tag> .
#
# An operator on another registry overrides the base with
# --build-arg FROM_IMAGE=<their agentmesh base>, which is what the default below
# is for: the argument is the seam, and the default is only so that the image
# this tag was built on is written down here as well as in the catalogue. With a
# Docker daemon and no build service the whole of it is
#
#   docker build --build-arg FROM_IMAGE=<their agentmesh base> \
#     -t <their registry>/agentmesh-chromium-base:<tag> .
#
# and ../../build-bases.mjs prints that line, filled in, for every base in a
# catalogue. The catalogue entry in ../catalogue.json records which image this
# was built from.
# The registry is a placeholder filled from the environment file (env/<name>.json
# gcp.registry) by build-bases.sh and ../../build-bases.mjs; built as written, FROM
# stops on it rather than quietly building on another environment's image.
ARG FROM_IMAGE={gcp.registry}/agentmesh-base:0.88.6
FROM ${FROM_IMAGE}

# chromium is Debian's own package, so the browser is on the distribution's
# update path rather than one this image fetches from somewhere.
#
# The fonts are not decoration. A screenshot taken with a missing font is a
# wrong answer that looks like a right one: the critic plays every step and
# measures whether the text fits the window, and tofu boxes fit differently
# from words. liberation covers the metric-compatible faces a page asks for by
# name, noto-color-emoji covers what would otherwise be an empty box.
RUN set -eu ; \
    export DEBIAN_FRONTEND=noninteractive ; \
    apt-get update ; \
    apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-dejavu-core \
      fonts-noto-color-emoji ; \
    apt-get clean ; \
    rm -rf /var/lib/apt/lists/*

# The catalogue says this image provides node, the adapter and chromium. This
# is the line that makes the claim true: the catalogue is only a claim, and a
# base that quietly lost one of these would send every package built on it to a
# build failure instead of failing here, once, where an operator is watching.
RUN set -eu ; \
    command -v chromium ; \
    chromium --no-sandbox --version ; \
    command -v agentmesh ; \
    node -e 'const v = process.versions.node.split(".").map(Number); if (v[0] < 22) { console.error("this base must carry node >=22 and has " + process.versions.node); process.exit(1); }'
