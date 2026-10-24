// Stands in for a bucket mounted with gcsfuse whose upload fails on close
// (2026-10-08: "FinalizeUpload failed ... input/output error"). Loaded with
// --import before the entrypoint's storage guard, so the guard wraps this
// failing write the way it wraps the real one. FAKE_STORAGE_FAULT names the
// file and how many writes of it fail: "pitches.json:2", or
// "pitches.json:always".
const fs = process.getBuiltinModule("node:fs");
const [name, times] = String(process.env.FAKE_STORAGE_FAULT ?? "").split(":");
if (name) {
  let left = times === "always" ? Infinity : Number(times) || 0;
  const real = fs.writeFileSync;
  fs.writeFileSync = function faulty(path, ...rest) {
    if (typeof path === "string" && path.endsWith(name) && left > 0) {
      left -= 1;
      const err = new Error(`EIO: i/o error, close (FinalizeUpload failed for ${name}: input/output error)`);
      err.code = "EIO";
      throw err;
    }
    return real.call(this, path, ...rest);
  };
  process.getBuiltinModule("node:module").syncBuiltinESMExports();
}
