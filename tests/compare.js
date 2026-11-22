// Compares web/converter.js with the Python converter output: node tests/compare.js TEMPLATE.syx PY_OUT_DIR INPUT.syx...
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { messages, convert } = require("../web/converter.js");
const [template, pyDir, ...inputs] = process.argv.slice(2);
const tpl = new Uint8Array(fs.readFileSync(template));
const py = {};
for (const f of fs.readdirSync(pyDir).filter(f => f.endsWith(".syx"))) py[f] = fs.readFileSync(path.join(pyDir, f));
let same = 0, diff = 0;
const seen = new Set();
for (const file of inputs) {
  for (const m of messages(new Uint8Array(fs.readFileSync(file)))) {
    const h = crypto.createHash("md5").update(Buffer.from(m.subarray(15))).digest("hex");
    if (seen.has(h)) continue;
    seen.add(h);
    const r = convert(m, tpl);
    const fname = `${r.grade}_${r.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "patch"}_${h.slice(0, 4)}.syx`;
    const ref = py[fname];
    if (ref && Buffer.compare(Buffer.from(r.bytes), ref) === 0) same++; else { diff++; if (diff < 5) console.log(h, r.name); }
  }
}
console.log(same, diff);
process.exit(diff ? 1 : 0);
