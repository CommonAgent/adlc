// Stands in for an outside agent that answers over HTTP, in the shape of
// langchain-ai/design-agent's self-hosted API: GET /health; POST
// /threads/{id}/messages {text} answering {reply, files, working}; GET
// /threads/{id}/updates?after=N answering {updates, cursor}; GET
// /threads/{id}/files/{name}; POST /threads/{id}/attachments (multipart).
// Every route but /health needs `authorization: Bearer <token>`, the token
// taken from DESIGN_AGENT_API_TOKENS (token:caller).
//
// It writes what it saw, one JSON line per event, to FAKE_RECORD: its start
// (pid, folder, the environment it was given), each ask, each attachment.
//
//   a message whose text says "background" leaves work running (working:
//   true), and the first poll brings one update; with FAKE_POLL_FLAG=1 the
//   poll answers say working: false as well.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.env.DESIGN_AGENT_API_PORT);
const host = process.env.DESIGN_AGENT_API_HOST || "127.0.0.1";
const token = String(process.env.DESIGN_AGENT_API_TOKENS ?? "").split(":")[0];
const record = (o) => { if (process.env.FAKE_RECORD) appendFileSync(process.env.FAKE_RECORD, `${JSON.stringify(o)}\n`); };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("a fake logo")]);

record({
  event: "start", pid: process.pid, cwd: process.cwd(),
  env: Object.fromEntries(["PATH", "HOME", "IMAGE_OWN", "FAKE_SETTING", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "AGENTMESH_MODEL_URL", "LD_LIBRARY_PATH", "MESH_JOB_DIR", "AGENT_DIRECTORY_WORK"]
    .map((k) => [k, process.env[k] ?? null])),
  tokens_set: token.length === 64,
});

const json = (res, status, o) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const chunks = [];
  req.on("data", (d) => chunks.push(d));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
    if (req.headers.authorization !== `Bearer ${token}`) { record({ event: "refused", path: url.pathname }); return json(res, 401, { detail: "unauthorized" }); }
    let m;
    if (req.method === "POST" && (m = /^\/threads\/([^/]+)\/messages$/.exec(url.pathname))) {
      const { text } = JSON.parse(body.toString("utf8"));
      record({ event: "ask", thread: decodeURIComponent(m[1]), text });
      if (/background/.test(text)) return json(res, 200, { reply: "Here is a first look.", files: ["logo.png"], working: true });
      return json(res, 200, { reply: `You said: ${text}`, files: [], working: false });
    }
    if (req.method === "GET" && (m = /^\/threads\/([^/]+)\/updates$/.exec(url.pathname))) {
      const after = Number(url.searchParams.get("after") ?? 0);
      record({ event: "poll", after });
      return json(res, 200, { updates: after === 0 ? ["The render finished."] : [], cursor: 1, ...(process.env.FAKE_POLL_FLAG ? { working: false } : {}) });
    }
    if (req.method === "GET" && (m = /^\/threads\/([^/]+)\/files\/([^/]+)$/.exec(url.pathname))) {
      if (decodeURIComponent(m[2]) !== "logo.png") return json(res, 404, { detail: "no such file" });
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(PNG);
    }
    if (req.method === "POST" && (m = /^\/threads\/([^/]+)\/attachments$/.exec(url.pathname))) {
      const text = body.toString("latin1");
      const fields = [...text.matchAll(/name="([^"]+)"; filename="([^"]+)"/g)];
      record({ event: "attach", fields: fields.map((f) => f[1]), names: fields.map((f) => f[2]), type: req.headers["content-type"] });
      return json(res, 200, { paths: fields.map((f) => `/workspace/attachments/${f[2]}`) });
    }
    return json(res, 404, { detail: "nothing here" });
  });
}).listen(port, host);
