# The link's image (node .adlc/local.mjs link): node, the agent-messaging SDK
# from its public release, and link.mjs. It runs as root because it reads the
# linked agents' keys from their own volumes, which their adapters keep
# readable only by the user they run as.
FROM node:22-bookworm-slim
WORKDIR /opt/link
RUN npm install --no-audit --no-fund --omit=dev https://storage.googleapis.com/agentmesh-releases/agent-messaging-0.68.0.tgz && mkdir -p /data
COPY link.mjs /opt/link/link.mjs
CMD ["node", "/opt/link/link.mjs"]
