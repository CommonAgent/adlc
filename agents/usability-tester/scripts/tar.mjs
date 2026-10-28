// A package tarball, read into memory: every regular file by its path inside
// the package folder, with its bytes. node's own zlib and nothing else.
//
// The package maker tars the package folder under the package's name
// (`<name>/agent-descriptor.json`, ...); the first path segment is taken off,
// so a file is named the way it sits in the package.
//
//   needs: node >= 22
//   import { readPackage } from "./tar.mjs"
import { gunzipSync } from "node:zlib";

const field = (b, at, len) => b.subarray(at, at + len).toString("latin1").replace(/\0.*$/s, "");

/** {files: Map<path, Buffer>, root} from a .tar.gz, or throws in words. */
export function readPackage(bytes) {
  let tar;
  try { tar = gunzipSync(bytes); } catch { throw new Error("the package is not a gzip file"); }
  const files = new Map();
  let longName = null;
  let root = null;
  for (let at = 0; at + 512 <= tar.length;) {
    const head = tar.subarray(at, at + 512);
    if (head.every((x) => x === 0)) break;
    const size = parseInt(field(head, 124, 12).trim() || "0", 8);
    const type = field(head, 156, 1) || "0";
    const prefix = field(head, 345, 155);
    let name = longName ?? (prefix ? `${prefix}/${field(head, 0, 100)}` : field(head, 0, 100));
    longName = null;
    const body = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = body.toString("utf8").replace(/\0.*$/s, ""); continue; }
    if (type === "x" || type === "g") {
      const m = /\d+ path=([^\n]+)\n/.exec(body.toString("utf8"));
      if (m) longName = m[1];
      continue;
    }
    if (type !== "0" && type !== "\0") continue;
    name = name.replace(/^\.\//, "");
    const parts = name.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    root ??= parts[0];
    files.set(parts.slice(1).join("/"), Buffer.from(body));
  }
  if (!files.size) throw new Error("the package holds no files");
  return { files, root };
}
