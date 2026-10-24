# Turning an Agent Package into a container image

This directory turns an Agent Package into the inputs for a container image: a
Dockerfile and the files it copies. Nothing here builds an image, contacts a
registry, or runs anything from the package. What comes out is a build context,
and `docker build` is your step.

You need node 22 or later, a Docker daemon, a registry you can push to and your
runtime can pull from, and an Agent Package. Everything below is reachable from
those four things alone. Nothing in here needs an account with us.

## The two halves, and which one is yours

A package says what it needs and never which image to build on. The install
file names the runtimes and binaries that must be present, each with a purpose
a person can read, and an installer checks each one and stops when it is
missing, never substituting (common-agent-spec 12.4 rule 1). It names no image,
because an image reference is an address and a package carries no address (12.6
rule 3), and because the same package has to be buildable by anybody on their
own registry.

So the base is not declared. It is resolved. You keep a catalogue of the bases
you have built and what each one provides, `emit-image.mjs` picks the first base
in your catalogue that has everything the package declares, and neither file
carries the other's half.

The catalogue is the operator's file. If you are running your own agents, you
are the operator for them, and the catalogue is yours: it records what is in
your registry, which has nothing to do with the packages you build from and
everything to do with your deployment. The one in `bases/catalogue.json` is
ours. Every image it names is in a private registry you cannot pull from, so
read it as a worked example rather than a starting point, and start from
`bases/catalogue.template.json` instead.

Keep your copy wherever your own operational configuration lives, in version
control, and update it in the same change that builds a base. Do not keep it
inside a package, and do not keep it as an edit to this repository, because
then every update to the tooling is a merge. Name it on the command line with
`--bases <your catalogue>`, which every command below accepts. There is one
other place it can go: the deployment manager reads `DM_IMAGE_BASES` and passes
it on, so a host that runs the emitter can be given the path once rather than
on every call.

## Step one: your catalogue

Copy the template and edit it.

    cp bases/catalogue.template.json ~/my-agents/bases.json

Each entry names an image, says what that image provides, and says why it
exists. The order matters, and it is your preference order, plainest first: the
emitter takes the first base that fits, so a package that needs only node is
not handed an image carrying a browser. The template's notes say what each
member is for.

What you write there is a claim and not a proof. Nothing opens an image to look
inside it. The Dockerfile the emitter writes still checks every declared binary
at build time and fails naming it, so an entry that is wrong buys a build
failure rather than preventing one; the catalogue only moves the common failure
from a slow build to an instant refusal.

Read your catalogue back before you rely on it:

    node emit-image.mjs --check-bases --bases ~/my-agents/bases.json

That prints what this tool sees in each entry, or refuses with the reason. It
is worth doing once: a runtime whose version member is misspelled reads as a
base providing node with no version, which then fails to meet any package that
asks for one, and a harness written without its `bin` is a base that builds
every image cleanly and refuses every message.

## Step two: your bases

Four build contexts are in `bases/`, and between them they build the six images
our own catalogue lists. You can build all of them.

`bases/agentmesh` is node plus the AgentMesh adapter. Almost every package
declares the `agentmesh` binary, because that is how an agent sends, and the
emitter will not install a declared binary on a package's behalf. The adapter
arrives as a tarball, which `npm pack` in `mesh-adapter/` produces, and the
tarball has to be sitting in the build context before you build: docker reads
the context and not this repository.

`bases/agentmesh-chromium` adds Debian's browser and the fonts it draws with.
`bases/agentmesh-video` adds ffmpeg, ffprobe and a pinned yt-dlp.
`bases/agentmesh-harness` adds a harness, which is opencode plus the one script
that starts it, on top of whichever of the others you point it at. That last
one is how a package whose work is a model reading and writing gets something
to wake: a package declares what a host must have and never carries the harness
that runs it (12.9), so the emitter installs none and the base has to have one.

Each context takes the image underneath as a build argument, so none of our
tags has to be in your registry. To get the commands, in the order they have to
run, with those arguments filled in from your own catalogue:

    node build-bases.mjs --bases ~/my-agents/bases.json

That prints a `docker build` line per base and builds nothing. Read it, then
run it or pipe it to a shell, and push each tag when its build succeeds. Every
argument comes out of the catalogue: which image goes underneath, and what that
image is expected to carry. A line above a command means something has to be
fixed before that command will work, such as a file the context copies that is
not in it.

A catalogue's `dockerfile` paths are relative to this directory, which is where
`--root` defaults to, so they keep working from a catalogue you have moved
elsewhere. If you have copied the build contexts out as well, or written your
own, pass `--root <dir>` to say what your paths are relative to.

`bases/agentmesh-harness/cloudbuild.yaml` is our own path and is specific to
one vendor's build service. It exists because three tags come out of that one
context and `gcloud builds submit --tag` has nowhere to put a build argument.
Ignore it unless you are on that service; `build-bases.mjs` produces the same
three builds with the same arguments, and a test in here holds the two to it.

The `ARG FROM_IMAGE` defaults in those Dockerfiles name our registry. They are
there so that the image a tag was built on is written down in the build context
as well as in the catalogue. Nothing you run should reach them, because both
`build-bases.mjs` and `gcloud builds submit --config` pass the argument
explicitly. If you build one of these by hand, pass it yourself:

    docker build -f bases/agentmesh-chromium/Dockerfile \
      --build-arg FROM_IMAGE=registry.example.com/you/agentmesh-base:1 \
      -t registry.example.com/you/agentmesh-chromium-base:1 bases/agentmesh-chromium

## Step three: the build context for a package

    node emit-image.mjs --package ./my-package --out ./ctx --bases ~/my-agents/bases.json

That writes a Dockerfile, the entrypoint, the lockfile checker, the job's
command where the package names one, a copy of the package verbatim, and
`build-inputs.json`. The last one is the record: which base, on whose word,
whether the base was checked against the catalogue, the package's digests, what
the build checks, what it deliberately does not create, and every variable the
container has to be given at run time. It is what a build record is written
from (12.7.1), and it is the file to read when you are deciding what to put in
a deployment.

`--base <image>` overrides the resolution when you want a particular image. A
base your catalogue lists is still checked against what the package declares; a
base it does not list is accepted on your word, and the record says it was not
checked, so a build that then stops at a missing binary reads back to that line.

Then build and push it yourself:

    docker build -t registry.example.com/you/my-agent:1 ./ctx
    docker push registry.example.com/you/my-agent:1

## Step four: running one message

The image answers one message and exits. There is no loop in it: the loop
belongs to whatever wakes the container, and a container that polled an inbox
would be an always-on machine wearing a container's clothes.

Whatever starts the container has to give it `MESH_JOB_DIR`, the job folder for
this one message, and `MESH_MESSAGE_FILE`, a file holding one inbox entry as
JSON with `id`, `from`, `handle`, `text`, `in_reply_to`, `kind` and `files[]` of
`{path, media_type}`. The words for the sender are written to
`MESH_REPLY_FILE`, which defaults to `reply.txt` in the job folder, and a
record of what happened is written to `outcome.json` beside it. Delivered
pieces go under the job folder's `out/` and are listed in its `pieces.json`.
The exit code is 0 when it answered, 2 when it refused before any work ran, 3
when the work finished with nothing to say, and 4 when the job hit its time cap.

Everything else the container needs is named in the emitted Dockerfile's
closing comment and in `build-inputs.json` under `needed_at_run_time`. Each
declared directory is bound by setting `AGENT_DIRECTORY_<NAME>` to a path on
storage that outlives a single run, because 12.7.1 requires exactly that and a
container's own filesystem outlives nothing; the image deliberately does not
create them, since a directory of the same name inside a layer is a decoy that
swallows every record written to it and takes them with it when the container
exits. Each credential and each setting is an environment variable the install
file names. Each required ceiling is a number you set. An `mcp` role is bound
by mounting `mcp.json` into the binding directory, which is `/etc/agent`. A
package whose work wakes a model also needs `AGENT_MODEL` and the variable its
provider reads, which are your instruction and your key and are in no layer.
`AGENT_NAME` is the installed name the agent answers as, and it falls back to
the package's name, which is right for one agent and wrong the moment you run
two from the same image.

The container runs as uid 10001, so whatever you bind those directories to has
to be writable by it.

If one of those is missing, the container refuses the message, names what was
missing, and runs nothing. It prints no values, so a refusal in a log never
carries the credential it was complaining about.

## What each declaration in install.json does to the build

`runtimes[]` and `binaries[]` become a check in the image and a constraint on
which base can answer. Every one is checked at build time and the build stops
naming the thing and the purpose the package gave for it. Nothing is ever
installed to make one pass.

`dependencies[]` becomes one `npm ci --ignore-scripts` per lockfile, into the
agent's own home and never system-wide, with the lockfile's digest checked
first so it is the lockfile that was built rather than a lockfile. This is why
a package compiles to an image at all: a lockfile has nowhere to live once the
workspace is fresh for every message, and an agent that installs its own
dependencies at run time is an agent whose dependencies nobody pinned.

`systems[]` becomes names in the closing comment and in the record, never
values. A service role becomes the variable its credential arrives in, an `mcp`
role becomes an entry you mount in `mcp.json`, and a directory role becomes a
folder under the bound work directory.

`ceilings[]` becomes a `CEILING_<ROLE>` variable the container refuses to run
without. The number is yours; a package may suggest one and the suggestion
binds nothing.

`directories[]` becomes an `AGENT_DIRECTORY_<NAME>` variable, and nothing in
the image.

`job_seconds` becomes the cap the entrypoint stops the work at.
`wants_replies` tells the entrypoint that a reply to work this agent sent is a
message to answer. `run` is the command the package names for its job (12.3):
the host runs it and wakes no model, unless the command says the turn needs
judgment, in which case a model is woken for that message. `answer.piece` names
which delivered piece is the reply, which is worth setting, because a harness
prints a transcript of its own thinking and the tail of a transcript is not a
deliverable.

## What the emitter refuses, and why

A directory with no `plugin.json`, or a manifest with no package extension: it
is not an Agent Package, and one from before the format has to be built again.

A file that does not hash to the digest the manifest or the install file names
for it: this is not the package that was built, so nothing built from it could
be tied to a build record.

A descriptor carrying a subject: that is a bound descriptor and not a draft. A
package's descriptor has no subject (12.2).

An install file carrying a credential value, an address, an endpoint or an
account identifier: an image is built once and copied everywhere, so anything
baked into it is bound for every agent that ever runs it (12.6 rule 3). The
same scan runs over every file this tool writes, before it is written, because
an image with a credential in a layer is not unpublished, only revoked.

A skill's `scripts` carrying `node_modules`: the lockfile is the authority, and
a directory copied in beside it would be installed by nothing and checked by
nothing.

A lockfile the package does not carry, or with no `package.json` beside it:
`npm ci` in a directory with no manifest installs nothing and says so in a line
a build log swallows.

A command on more than one job, or a command carrying a placeholder the host
does not substitute: a message does not say which offering it is for, and a
command that ran with the literal text `{job_dir}` in it would be worse than
one that refused.

No base in your catalogue with everything the package declares, the harness
included: the refusal names what is missing, what each missing thing is for,
and what every base in the catalogue was missing. Build a base that has it, add
it to the catalogue with what it provides, and emit again.

An output directory that is not empty, unless you pass `--force`.

## Where to look next

`emit-image.mjs` is the emitter, and its comments are the reasoning for the
split between what is baked and what arrives at run time. `one-message.mjs` is
the entrypoint that goes into every image. `bases/catalogue.template.json` is
the shape of a catalogue with the reasoning in it. The tests are in `test/`,
and `node --test "test/*.test.mjs"` runs them; `test/another-operator.test.mjs`
is the one that holds this whole path together for somebody who is not us.

## The tests

    node --test "test/*.test.mjs"

The fixtures are real packages, built by the package maker beside this folder
from a folder of package sources laid out as `<family>/<name>/spec.json`, such
as the AgentMesh repository's `packages/`. Name it with `ADLC_PACKAGES`; the
suites that build no package (`job-usage`, `tenant-host` and `wake-host`) run
without it. One `tenant-host` test drives a message through the AgentMesh
fleet supervisor and needs `ADLC_FLEET_SUPERVISOR`, the path to it.
