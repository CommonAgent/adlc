// The lockfile in the image is the lockfile that was built, or the build stops.
// Copied into the image by the emitted Dockerfile and run once per lockfile,
// immediately before the dependencies are installed from it.
//
// WHY. The install file names each lockfile with its digest and the build
// record names the same digests, and that chain is the only reason the words
// "installed from the lockfile" mean anything. A COPY that picked up an edited
// lockfile would install different dependencies under the same package version
// and nothing downstream would notice, because the digest nobody checked is
// the only place the difference shows.
//
//   needs: node >= 22; nothing else, so it runs on the bare base image
//   node check-lockfile.mjs <lockfile> <sha256>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [file, want] = process.argv.slice(2);
if (!file || !want) {
  console.error("usage: check-lockfile.mjs <lockfile> <sha256>");
  process.exit(2);
}
let bytes;
try {
  bytes = readFileSync(file);
} catch {
  console.error(`${file} is not in the image: the install file names it and the copy did not bring it`);
  process.exit(1);
}
const got = createHash("sha256").update(bytes).digest("hex");
if (got !== want) {
  console.error(`${file} does not hash to the digest the install file names for it `
    + `(named ${want.slice(0, 12)}..., found ${got.slice(0, 12)}...); this is not the package that was built`);
  process.exit(1);
}
