# A base image for Agent Packages whose work is a model reading and writing.
#
# WHY THIS EXISTS. A package declares what a host must have and never carries
# the harness that runs it (12.9), so the emitter installs none: it writes
# AGENT_HARNESS_BIN into every image and leaves the program at that path to
# the base. No base had one. So every package that declares no command for its
# job (12.3 `run`) built cleanly and then refused its first message with "the
# harness is not in this container", which is the split working as written and
# an image nobody could use. explainer-critic is that package: its offered job
# declares control by a model, and reading a page against the story rules is
# not a step a program can take.
#
# A base is where a harness is allowed to be installed, because a base belongs
# to the operator and not to any package. This context adds opencode and the
# one script that starts it to whichever agentmesh base it is pointed at, and
# nothing else. Nothing in it is specific to what is underneath.
#
# It holds no key, no model, no address, no account identifier and no package:
# it is the same image for every agent that ever runs on it. Which model an
# agent thinks with and whose key pays for it are the owner's instruction, and
# they arrive per container as variables on the job, the same two facts a host
# install reads out of the argfile and the credential store.
#
# THREE TAGS COME OUT OF THIS ONE CONTEXT, because a package that wakes a model
# and needs no browser must not be handed one, and a package that reads a video
# needs the video tools and no browser at all: the plain harness base, the one
# with the browser under it, and the one with the video tools under it. Which
# base is underneath is a build argument, and `gcloud builds submit --tag` has
# nowhere to put one, so all three go through the config beside this file,
# which is also where the three FROM images are written down:
#
#   cd fleet-manager/image/bases/agentmesh-harness
#   gcloud builds submit --config cloudbuild.yaml --project <project> .
#
# That config is one vendor's shape, and an operator with a Docker daemon has no
# use for it. The same three builds are three ordinary commands, each naming the
# image underneath and what that image is expected to carry:
#
#   docker build --build-arg FROM_IMAGE=<their base> \
#     --build-arg REQUIRE_BINARIES="<what that base provides>" \
#     -t <their registry>/agentmesh-harness-base:<tag> .
#
# ../../build-bases.mjs prints all three, filled in from a catalogue, in the
# order they have to run, and a test holds the two paths to the same arguments.
# The registry is a placeholder filled from the environment file (env/<name>.json
# gcp.registry) by build-bases.sh and ../../build-bases.mjs; built as written, FROM
# stops on it rather than quietly building on another environment's image.
ARG FROM_IMAGE={gcp.registry}/agentmesh-base:0.88.6
FROM ${FROM_IMAGE}

# Pinned by version, and npm checks the tarball against the digest the registry
# publishes for it, which is the same bargain the emitted Dockerfile makes with
# a lockfile: fetched from somewhere, but only these bytes. A harness that
# upgraded itself would be a container running something other than what was
# built, and the image digest in the deployment record would be saying nothing.
ARG OPENCODE_VERSION=1.18.30
# The path the emitter writes into AGENT_HARNESS_BIN. It is spelled here as
# well as in emit-image.mjs because neither file can read the other: the base
# is built by an operator months before a package is emitted onto it. The
# catalogue entry carries the same path, which is how the emitter learns it
# from the operator rather than from its own default.
ARG HARNESS_BIN=/opt/harness/bin/harness
# What the image underneath must already have on its path, space separated, and
# checked by the proof at the end. It is a build argument because the image
# underneath is one: three tags come out of this context, the catalogue claims
# a different set of binaries for each of them, and the only binary all three
# have in common is the adapter, which is this default. A tag built from the
# wrong FROM image would publish saying it carries ffmpeg and nothing here
# would have looked, and the first anyone would hear of it is a package dying
# four minutes into its own build. The config beside this file gives each tag
# the list the catalogue claims for it, so the two say the same thing and a
# test can read both.
ARG REQUIRE_BINARIES=agentmesh
# What the proof at the end asks opencode about. It is not a default for
# anything that runs: no model and no provider is baked, and a container with
# no AGENT_MODEL is refused by the script below rather than given one.
ARG PROOF_MODEL=google/gemini-2.5-flash
ARG PROOF_KEY_VAR=GOOGLE_GENERATIVE_AI_API_KEY

RUN npm install -g opencode-ai@${OPENCODE_VERSION} --no-audit --no-fund --loglevel=error

# Outside the agent's home, for the reason the entrypoint is: an agent that can
# edit the program its own host wakes for it is not running what was installed.
COPY harness ${HARNESS_BIN}
# Beside the script that runs it, because the script calls it by its own
# directory: two files, one place, and neither is in the agent's home.
COPY opencode-config.mjs /opt/harness/bin/opencode-config.mjs
RUN chmod 0755 ${HARNESS_BIN}

# The catalogue says the images built from this context provide a harness on
# top of whatever the base under them had. These are the lines that make the
# harness half of that claim true: the catalogue is only
# a claim, and a base that quietly lost one of these would send every package
# built on it to a build failure, or worse to a refusal at its first message,
# instead of failing here, once, where an operator is watching.
#
# PRESENT IS NOT THE SAME AS WORKING, and each line below is here because of a
# way this image could hold opencode and the script and still give a wrong
# answer that looks like a right one.
#
# What the base underneath was supposed to bring is checked here as well as
# there, because which base is underneath is a build argument: a context
# pointed at the wrong image would publish a tag the catalogue says carries the
# adapter, or the browser, or the tools that read video, and nothing would have
# looked. Presence is all this asks for. Whether ffmpeg can decode an ordinary
# video is proved where ffmpeg is installed, by a video that build makes, and
# installing a harness on top cannot take that away.
#
# The whole proof runs as a NON-ROOT user in a home of its own. The emitted
# image runs as uid 10001 with a home the build made, and a harness that works
# as root and not as the agent is a harness that passes every check here and
# refuses every message there: opencode writes its session state under HOME,
# and a global install whose own files the agent cannot read fails only for the
# agent.
RUN set -eu ; \
    P=/tmp/harness-proof ; \
    mkdir -p "$P" ; \
    useradd -u 10099 -d "$P" -s /bin/sh prover ; \
    chown -R prover:prover "$P" ; \
    as_prover() { su prover -s /bin/sh -c "cd $P && HOME=$P $*" ; } ; \
    provider="${PROOF_MODEL%%/*}" ; \
    command -v opencode ; \
    for b in ${REQUIRE_BINARIES} ; do \
      command -v "$b" || { echo "the image this was built on has no $b on its path, and the catalogue says this tag carries one" >&2 ; exit 1 ; } ; \
    done ; \
    as_prover "opencode --version" ; \
    test -x ${HARNESS_BIN} ; \
    if as_prover "opencode models | grep -q \"^$provider/\"" ; then \
      echo "this image lists $provider models with no key in the environment, so the next check proves nothing" >&2 ; exit 1 ; fi ; \
    as_prover "${PROOF_KEY_VAR}=placeholder-not-a-key opencode models | grep -Fxq ${PROOF_MODEL}" ; \
    if as_prover "opencode models | grep -q \"^$provider/\"" ; then \
      echo "opencode kept $provider after seeing the variable once, so a placeholder is now written into a layer" >&2 ; exit 1 ; fi ; \
    if as_prover "${HARNESS_BIN} 'a prompt'" 2>"$P/e" ; then \
      echo "the harness answered with no AGENT_MODEL set, so it chose a model nobody instructed" >&2 ; exit 1 ; fi ; \
    grep -q AGENT_MODEL "$P/e" ; \
    if as_prover "AGENT_MODEL=${PROOF_MODEL} ${HARNESS_BIN} 'a prompt'" 2>"$P/e" ; then \
      echo "the harness answered with no provider key in the environment, so it reached a model some other way" >&2 ; exit 1 ; fi ; \
    grep -q "${PROOF_MODEL}" "$P/e" ; \
    if ! as_prover "MESH_JOB_DIR=/mesh/jobs/a/m1 AGENT_DIRECTORY_RECORDS=/mesh/state/a/records node /opt/harness/bin/opencode-config.mjs" >"$P/c" ; then \
      echo "the directories a container is given cannot be turned into a configuration, so opencode would refuse to read its own job folder" >&2 ; exit 1 ; fi ; \
    node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).permission.external_directory; for (const p of ["/mesh/jobs/a/m1/*","/mesh/state/a/records/**"]) if (c[p]!=="allow") { console.error("the grant does not cover "+p); process.exit(1); } if (c["/mesh"]||c["/mesh/*"]||c["/mesh/**"]) { console.error("the grant covers the whole mount, which holds every other agent state"); process.exit(1); } if (c["*"]!=="deny"||Object.keys(c)[0]!=="*") { console.error("an unbound directory is not denied first, so opencode run would ask, reject itself and end the run"); process.exit(1); }' "$P/c" ; \
    as_prover "AGENT_MODEL=${PROOF_MODEL} ${PROOF_KEY_VAR}=placeholder-not-a-key timeout 180 ${HARNESS_BIN} 'say ok'" >"$P/o" 2>"$P/e" || true ; \
    if grep -q "^harness: " "$P/e" ; then \
      echo "the harness refused a model opencode lists, which is this base failing from the other side:" >&2 ; cat "$P/e" >&2 ; exit 1 ; fi ; \
    if grep -qE "Unknown argument|Not enough non-option arguments|^Usage:" "$P/e" ; then \
      echo "opencode read the script's own arguments as a mistake, so every message would come back as a usage error:" >&2 ; cat "$P/e" >&2 ; exit 1 ; fi ; \
    userdel prover ; \
    rm -rf "$P"
