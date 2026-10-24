# A base image for Agent Packages that declare ffmpeg, ffprobe and yt-dlp.
#
# WHY THIS EXISTS. An install file names the binaries a package needs, and the
# installer MUST check each one and MUST stop when one is missing, never
# substitute (12.4 rule 1). The emitter turns that rule into a build step, so a
# package can only be imaged onto a base that already has its binaries.
# video-watcher declares ffmpeg to read the video, ffprobe to measure it and
# yt-dlp to fetch it from a video site; no base had any of the three; so it
# could not be imaged at all, which is the rule working and not a bug to code
# around.
#
# A base is where a binary is allowed to be installed, because a base belongs
# to the operator and not to any package. This image is the agentmesh base plus
# the tools that read and fetch video, and nothing else.
#
# It holds no key, no address, no account identifier and no package: it is the
# same image for every agent that ever runs on it. What an agent is, what it
# may reach and what it may spend arrive per container.
#
#   gcloud builds submit --tag gcr.io/<project>/agentmesh-video-base:<tag> .
#
# An operator on another registry overrides the base with
# --build-arg FROM_IMAGE=<their agentmesh base>, which is what the default below
# is for: the argument is the seam, and the default is only so that the image
# this tag was built on is written down here as well as in the catalogue. With a
# Docker daemon and no build service the whole of it is
#
#   docker build --build-arg FROM_IMAGE=<their agentmesh base> \
#     -t <their registry>/agentmesh-video-base:<tag> .
#
# and ../../build-bases.mjs prints that line, filled in, for every base in a
# catalogue. The catalogue entry in ../catalogue.json records which image this
# was built from.
# The registry is a placeholder filled from the environment file (env/<name>.json
# gcp.registry) by build-bases.sh and ../../build-bases.mjs; built as written, FROM
# stops on it rather than quietly building on another environment's image.
ARG FROM_IMAGE={gcp.registry}/agentmesh-base:0.88.6
FROM ${FROM_IMAGE}

# The yt-dlp release this image pins, and the digest that project publishes for
# it. Both are here rather than in the RUN line so an operator can read the pin
# without reading the shell, and move it by rebuilding with a build argument.
ARG YT_DLP_VERSION=2026.08.19
ARG YT_DLP_SHA256=1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6

# PRESENT IS NOT THE SAME AS WORKING, and each of these lines is here because
# of a way this image could hold all three binaries and still give a wrong
# answer that looks like a right one.
#
# ffmpeg is Debian's own package and it carries ffprobe: one package answers
# two of the three declared binaries, because they are one program built twice.
# The package is the full build, linked against the libav* codec libraries, and
# that is the point rather than an accident. An ffmpeg that cannot decode h264
# or aac fails on the ordinary video, and the agent reports that the video
# could not be read, which a person reads as a bad address.
#
# ca-certificates is not housekeeping. yt-dlp and ffmpeg verify https against
# the system store; node carries its own roots, so the one address form the
# package fetches with node would keep working and hide the fact that the other
# two forms could not open a connection at all.
#
# python3 is what yt-dlp is written in. It is installed for yt-dlp and for
# nothing else; no package declares it as a runtime.
RUN set -eu ; \
    export DEBIAN_FRONTEND=noninteractive ; \
    apt-get update ; \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      ca-certificates ; \
    apt-get clean ; \
    rm -rf /var/lib/apt/lists/*

# yt-dlp is the one binary here that does NOT come from the distribution, and
# the reason is the same reason the distribution is right for everything else.
# A stable release freezes its copy on the day it ships; a video site changes
# the shape of its pages every few weeks; so a frozen yt-dlp is a downloader
# that is on the path, answers --version, and cannot download. Debian bookworm
# carries 2023.03.04. That is the failure this base exists to prevent, arriving
# under a different name.
#
# So the release is pinned by version and checked against the digest the
# project publishes for it, which is the same bargain the emitted Dockerfile
# makes with a lockfile: fetched from somewhere, but only these bytes.
#
# The plain release rather than the standalone one on purpose. The standalone
# build carries its own python and unpacks forty megabytes into /tmp on every
# single run, and /tmp on a burstable sandbox is memory. This is the same
# program with the python already in the image.
RUN set -eu ; \
    python3 -c 'import sys, urllib.request ; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])' \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp" \
      /usr/local/bin/yt-dlp ; \
    echo "${YT_DLP_SHA256}  /usr/local/bin/yt-dlp" | sha256sum -c - ; \
    chmod 0755 /usr/local/bin/yt-dlp

# The catalogue says this image provides node, the adapter, ffmpeg, ffprobe and
# yt-dlp. These are the lines that make the claim true: the catalogue is only a
# claim, and a base that quietly lost one of these would send every package
# built on it to a build failure instead of failing here, once, where an
# operator is watching.
#
# Presence first, because that is what the emitted Dockerfile checks and what a
# refusal would name.
RUN set -eu ; \
    command -v ffmpeg ; \
    command -v ffprobe ; \
    command -v yt-dlp ; \
    command -v agentmesh ; \
    node -e 'const v = process.versions.node.split(".").map(Number); if (v[0] < 22) { console.error("this base must carry node >=22 and has " + process.versions.node); process.exit(1); }'

# Then the work, on a video this line makes, because every check above passes
# on an ffmpeg with no codecs in it. One second of picture and sound, encoded
# as h264 and aac because that is what an ordinary video is, then measured,
# then a frame taken out of it as a JPEG. That is fetch-the-video's measuring,
# find-the-transcript's sound and cut-the-scenes' frames, proved rather than
# assumed.
#
# The scene filter has its own line because cut-the-scenes rests entirely on
# it: an ffmpeg built without libavfilter's select would pass every check above
# and then find no scene changes in any video ever, which reads as a video that
# never cuts rather than as a broken image.
RUN set -eu ; \
    cd /tmp ; \
    ffmpeg -v error -f lavfi -i testsrc=duration=1:size=320x240:rate=10 \
      -f lavfi -i sine=frequency=440:duration=1 \
      -c:v libx264 -c:a aac -shortest -y proof.mp4 ; \
    ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 proof.mp4 | grep -qx h264 ; \
    ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 proof.mp4 | grep -qx aac ; \
    ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 proof.mp4 | grep -qE '^[0-9]' ; \
    ffmpeg -v error -i proof.mp4 -frames:v 1 -y proof.jpg ; \
    test -s proof.jpg ; \
    ffmpeg -v error -i proof.mp4 -filter:v "select='gt(scene,0.3)'" -fps_mode passthrough -f null - ; \
    rm -f proof.mp4 proof.jpg

# And the two things yt-dlp needs that are not yt-dlp. It runs at all only if
# python can run it, so it is asked its version; and it is asked to fetch from
# sites that serve picture and sound as separate streams, which it joins with
# ffmpeg. Without an ffmpeg it can find it hands back a file with no sound, and
# the transcript step then truthfully reports a video with no sound track,
# which is the wrong answer that looks right. So yt-dlp's own locator is asked
# whether it found one, rather than this file assuming that two binaries on the
# same path have met.
#
# The certificate store is checked through python's own ssl rather than by
# looking for the file, because a store that is present and empty fails exactly
# like one that is missing, and only at the first https connection.
RUN set -eu ; \
    yt-dlp --version ; \
    python3 -c 'import sys ; sys.path.insert(0, "/usr/local/bin/yt-dlp") ; from yt_dlp.postprocessor.ffmpeg import FFmpegPostProcessor as F ; p = F() ; print("yt-dlp found ffmpeg:", p.executable) ; sys.exit(0 if p.available else 1)' ; \
    python3 -c 'import ssl, sys ; n = ssl.create_default_context().cert_store_stats()["x509_ca"] ; print("certificate authorities:", n) ; sys.exit(0 if n > 0 else 1)'
