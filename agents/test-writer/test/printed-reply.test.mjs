// Every suite runs each job's command the way the host does and reads the
// reply the way the host does (technical debt 657, 2026-10-31).
//   node --test test/printed-reply.test.mjs
//
// What is worth pinning. consonant-ledger (ab_c2add1d21b685b80aa) and
// consonant-meter (ab_5f3651347f159dc723) were drafted with run.reply
// "json:consonant-count-report.md". Their scripts printed
// {"code":0,"reply":"..."} and wrote the report to out/, so the object had no
// member by that name. The suite never ran the command line and the sandbox
// ran only the suite, so the mismatch passed Test, Code and Package. On the
// host every job exited 0 with its report made, the host read no reply, recorded
// the job as stopped and told the sender the work was cut short, and Conformance
// came back inconclusive.
//
// So every suite carries a fourth standard file, test/printed-reply.test.mjs,
// copied whole from the references. It runs each job's command itself, with
// an empty message and no files, and reads the reply as the host's entrypoint
// does (agents/image/one-message.mjs: replyOf, then answerOf, then a reply that
// is empty after trimming is no answer). Its reading is held to the host's
// here, case by case, by importing the host's own functions.
//
// Nothing here reaches a network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { answerOf, replyOf as hostReplyOf } from "../../image/one-message.mjs";
import { commandsOf, fillCommand, hostReply, printedReplyProblems, replyOf } from "../references/printed-reply.test.mjs";
import { INSTRUCTION, REPLY_TEST, STANDARD_TESTS, replyTestAt, withStandardTests } from "../scripts/write-suite.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MASTER = join(HERE, "..", "references", "printed-reply.test.mjs");

test("the reading is the host's: replyOf gives what one-message.mjs's replyOf gives, case by case", () => {
  const outs = ["", "plain words", '{"code":0,"reply":"Seven consonants."}', '{"reply":""}', '{"reply":null}', '{"reply":3}',
    '{"reply":{"a":1}}', '{"code":0}', "not json {", '{"reply":"x"}\n{"reply":"y"}', '["reply"]', '{"consonant-count-report.md":"r"}'];
  for (const reply of [undefined, "stdout", "json:reply", "json:consonant-count-report.md", "json:code"]) {
    for (const out of outs) {
      assert.equal(replyOf(reply, out), hostReplyOf(reply === undefined ? {} : { reply }, out), `${reply} over ${JSON.stringify(out)}`);
    }
  }
});

test("the answer is the host's: a named answer piece, then the answer file, then the reply, trimmed", () => {
  const dir = mkdtempSync(join(tmpdir(), "printed-reply-answer-"));
  try {
    writeFileSync(join(dir, "pieces.json"), JSON.stringify([{ name: "count", path: "out/count.md", media_type: "text/markdown" }]));
    mkdirSync(join(dir, "out"));
    writeFileSync(join(dir, "out", "count.md"), "  # count\n\n7\n ");
    writeFileSync(join(dir, "answer.txt"), "  from the file  ");
    const cases = [
      { piece: "count", answerFile: join(dir, "answer.txt"), stdout: "said" },
      { piece: "missing", answerFile: join(dir, "answer.txt"), stdout: "said" },
      { piece: null, answerFile: join(dir, "answer.txt"), stdout: "said" },
      { piece: null, answerFile: join(dir, "none.txt"), stdout: "  said  " },
      { piece: null, answerFile: join(dir, "none.txt"), stdout: "   " },
      { piece: null, answerFile: null, stdout: "" },
    ];
    for (const c of cases) {
      const host = answerOf({ install: c.piece ? { answer: { piece: c.piece } } : {}, jobDir: dir, answerFile: c.answerFile, stdout: c.stdout }).text;
      assert.equal(hostReply({ answerPiece: c.piece, jobDir: dir, answerFile: c.answerFile, stdout: c.stdout }), host, JSON.stringify(c));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("each job's command comes from agent-runtime-requirements.json, or a spec.json's jobs, with its reply and message file", () => {
  const folder = { run: { "count-letters": { command: ["node", "{home}/{package}/skills/count-letters/scripts/count.mjs", "--job", "{job_dir}"], reply: "json:reply", message_file: "{job_dir}/message.txt" } }, job_seconds: 60 };
  assert.deepEqual(commandsOf(folder).map((j) => [j.slug, j.reply, j.message_file]), [["count-letters", "json:reply", "{job_dir}/message.txt"]]);
  const spec = { job_seconds: 90, jobs: [{ slug: "a", run: { command: ["node", "x.mjs"] } }, { slug: "b" }] };
  assert.deepEqual(commandsOf(spec).map((j) => [j.slug, j.reply, j.seconds]), [["a", "stdout", 60]]);
  assert.deepEqual(commandsOf(null), []);
});

test("the command is filled as the host fills it, and a script the packed layout puts under skills/<job>/ is found under scripts/", () => {
  const root = mkdtempSync(join(tmpdir(), "printed-reply-fill-"));
  try {
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts", "count.mjs"), "");
    const got = fillCommand(["node", "{home}/{package}/skills/count-letters/scripts/count.mjs", "--job", "{job_dir}", "--records", "{records}", "--to", "{in_reply_to}", "{nobody}"],
      { root, job_dir: "/j", records: "/r", work: "/w" });
    assert.equal(got[1].replace(/\\/g, "/"), join(root, "scripts", "count.mjs").replace(/\\/g, "/"));
    assert.deepEqual(got.slice(2), ["--job", "/j", "--records", "/r", "--to", "none", "{nobody}"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a reply the host would read as nothing is named by job, with what was printed and why the host calls it cut short", () => {
  const job = { slug: "count-consonants", reply: "json:consonant-count-report.md" };
  const p = printedReplyProblems(job, { stdout: '{"code":0,"reply":"There are 7 consonants."}', reply: "" });
  assert.equal(p.length, 1);
  assert.match(p[0], /^job count-consonants: /);
  assert.match(p[0], /run\.reply is "json:consonant-count-report\.md"/);
  assert.match(p[0], /no member consonant-count-report\.md \(it has code, reply\)/);
  assert.match(p[0], /cut short/);
  assert.match(p[0], /spec/);
  assert.match(printedReplyProblems({ slug: "a", reply: "json:reply" }, { stdout: "Seven.", reply: "" })[0], /not one JSON object/);
  assert.match(printedReplyProblems({ slug: "a", reply: "json:reply" }, { stdout: '{"reply":"  "}', reply: "" })[0], /reply member is empty/);
  assert.match(printedReplyProblems({ slug: "a", reply: "stdout" }, { stdout: "", reply: "" })[0], /printed nothing/);
  assert.deepEqual(printedReplyProblems({ slug: "a", reply: "json:reply" }, { stdout: '{"reply":"Seven."}', reply: "Seven." }), []);
});

/** A package folder with one job, its script and the standard file, run with node --test. */
function runPackage({ reply, script }) {
  const root = mkdtempSync(join(tmpdir(), "printed-reply-package-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "test"));
    writeFileSync(join(root, "agent-runtime-requirements.json"), JSON.stringify({
      format: "agent-runtime-requirements-v1", job_seconds: 60,
      run: { "count-consonants": { command: ["node", "{home}/{package}/skills/count-consonants/scripts/count.mjs", "--job", "{job_dir}", "--records", "{records}", "--text-file", "{job_dir}/message.txt"], reply, message_file: "{job_dir}/message.txt" } },
    }));
    writeFileSync(join(root, "scripts", "count.mjs"), script);
    cpSync(MASTER, join(root, "test", "printed-reply.test.mjs"));
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];
    const r = spawnSync(process.execPath, ["--test", "test/printed-reply.test.mjs"], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const COUNTS = `import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const job = process.argv[process.argv.indexOf("--job") + 1];
mkdirSync(join(job, "out"), { recursive: true });
writeFileSync(join(job, "out", "consonant-count-report.md"), "# count\\n");
console.log(JSON.stringify({ code: 3, reply: "There was no sentence, so there was nothing to count." }));
`;

test("the standard file passes a job whose script prints the member run.reply names", () => {
  const r = runPackage({ reply: "json:reply", script: COUNTS });
  assert.equal(r.status, 0, r.out);
});

test("the standard file fails the consonant-ledger case: run.reply names a member the script never prints", () => {
  const r = runPackage({ reply: "json:consonant-count-report.md", script: COUNTS });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /no member consonant-count-report\.md/);
});

test("the standard file fails a script stood in as empty, which prints nothing", () => {
  assert.notEqual(runPackage({ reply: "json:reply", script: "" }).status, 0);
  assert.notEqual(runPackage({ reply: "stdout", script: "" }).status, 0);
});

test("the test writer adds it to every suite, never writes it with the model, and ships it for both skills", () => {
  assert.equal(REPLY_TEST, "test/printed-reply.test.mjs");
  assert.ok(STANDARD_TESTS.includes(REPLY_TEST));
  assert.equal(replyTestAt({}), MASTER);
  assert.deepEqual(withStandardTests([{ path: "test/a.test.mjs", text: "a" }], { replyTest: "r" }).map((f) => f.path), ["test/a.test.mjs", REPLY_TEST]);
  assert.match(INSTRUCTION, /test\/printed-reply\.test\.mjs/);
  const plugin = JSON.parse(readFileSync(join(HERE, "..", "plugin.json"), "utf8"));
  const skills = plugin.extensions["net.agentdoc.package"].build.skills;
  for (const slug of ["write-a-suite", "write-the-suite"]) {
    assert.ok(skills[slug].references.includes("references/printed-reply.test.mjs"), `${slug} does not carry it`);
    assert.match(readFileSync(join(HERE, "..", "skills", slug, "SKILL.md"), "utf8"), /references\/printed-reply\.test\.mjs/, `${slug}'s SKILL.md does not list it`);
  }
});
