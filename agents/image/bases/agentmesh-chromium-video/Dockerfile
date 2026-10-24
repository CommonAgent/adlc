# A base image for Agent Packages that declare chromium AND ffmpeg.
#
# WHY THIS EXISTS. The animation renderer (animation-blocks/animation-renderer)
# draws every frame of a video in headless chromium and joins the frames and
# the narration with ffmpeg. The chromium base has no ffmpeg and the video base
# has no chromium, so the renderer resolved to nothing and could not be imaged,
# which is the rule working (12.4 rule 1: never substitute). This is the
# chromium base plus Debian's ffmpeg, which carries ffprobe with it. Fonts are
# the chromium base's; a package that wants the explainer's type carries it
# (Debian bookworm has no IBM Plex package).
#
# It holds no key, no address, no account identifier and no package.
#
#   bash ../build-bases.sh agentmesh-chromium-video <registry>/agentmesh-chromium-video-base:<tag>
#
# Another registry: --build-arg FROM_IMAGE=<their chromium base>.
# The registry is a placeholder filled from the environment file (env/<name>.json
# gcp.registry) by build-bases.sh and ../../build-bases.mjs; built as written, FROM
# stops on it rather than quietly building on another environment's image.
ARG FROM_IMAGE={gcp.registry}/agentmesh-chromium-base:0.88.6-1
FROM ${FROM_IMAGE}

RUN set -eu ; \
    export DEBIAN_FRONTEND=noninteractive ; \
    apt-get update ; \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates ; \
    apt-get clean ; \
    rm -rf /var/lib/apt/lists/*

# Present is not working: make a one-second clip from a generated tone and
# picture, and measure it, so a build that cannot encode h264 and aac fails
# here and not in the first customer's render.
RUN set -eu ; \
    command -v ffmpeg ; \
    command -v ffprobe ; \
    ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=size=320x180:rate=12 -f lavfi -i sine=frequency=440 \
      -t 1 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest /tmp/probe.mp4 ; \
    ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/probe.mp4 ; \
    rm -f /tmp/probe.mp4 ; \
    command -v chromium
