// Page logic: read .syx files, convert with converter.js, list results, download single patches or a ZIP.
(() => {
  "use strict";
  const { messages, convert } = window.MiniNovaToCT;
  let lang = /^sk|^cs/i.test(navigator.language || "") ? "sk" : "en";
  let results = [], filter = "all";
  // Language file connection point: texts.js (window.CT_TEXTS).
  const T = (key, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.replace("{" + k + "}", v), window.CT_TEXTS[lang][key] || key);
  const $ = id => document.getElementById(id);

  const hash = bytes => { let h = 2166136261; for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0; return h.toString(16).padStart(8, "0"); };
  const slug = s => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "patch";

  async function addFiles(files) {
    const seen = new Set(results.map(r => r.key));
    for (const file of files) {
      const data = new Uint8Array(await file.arrayBuffer());
      const msgs = messages(data);
      if (!msgs.length) { $("status").textContent = file.name + ": " + T("none"); continue; }
      for (const m of msgs) {
        const key = hash(m.subarray(15));
        if (seen.has(key)) continue;
        seen.add(key);
        const r = convert(m, window.CT_TEMPLATE);
        r.key = key; r.source = file.name;
        r.file = `${r.grade}_${slug(r.name)}_${key.slice(0, 4)}.syx`;
        results.push(r);
      }
    }
    results.sort((a, b) => a.grade.localeCompare(b.grade) || a.name.localeCompare(b.name));
    render();
  }

  const visible = () => results.filter(r => filter === "all" || (filter === "ab" ? r.grade !== "C" : r.grade === "A"));

  function download(name, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const REPORT_COLUMNS = ["file", "name", "source", "grade", "major_losses", "minor_losses", "adapted", "orig_delay_level", "orig_reverb_level",
    "reverb_type", "reverb_decay", "delay_time", "delay_sync", "delay_feedback"];
  const csvCell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  function report(list) {
    const rows = list.map(r => [r.file, r.name, r.source, r.grade, r.major.join(" "), r.minor.join(" "), r.adapted.join(" "), r.delay, r.reverb,
      r.meta[2], r.meta[3], r.meta[6], r.meta[7], r.meta[8]].map(csvCell).join(","));
    return [REPORT_COLUMNS.join(","), ...rows].join("\n") + "\n";
  }

  // Minimal stored ZIP writer.
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = d => { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    for (const { name, data } of files) {
      const nb = enc.encode(name), crc = crc32(data), local = new DataView(new ArrayBuffer(30)), entry = new DataView(new ArrayBuffer(46));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nb.length, true);
      entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true); entry.setUint16(28, nb.length, true); entry.setUint32(42, offset, true);
      parts.push(new Uint8Array(local.buffer), nb, data); central.push(new Uint8Array(entry.buffer), nb);
      offset += 30 + nb.length + data.length;
    }
    const size = central.reduce((a, c) => a + c.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  function render() {
    document.title = T("title");
    for (const el of document.querySelectorAll("[data-t]")) el.textContent = T(el.dataset.t);
    for (const o of $("filter").options) o.textContent = T("filter_" + o.value);
    const list = visible(), count = g => results.filter(r => r.grade === g).length;
    $("count").textContent = results.length ? T("count", { n: results.length, a: count("A"), b: count("B"), c: count("C") }) : "";
    $("zip").disabled = !list.length;
    const body = $("rows");
    body.textContent = "";
    for (const r of list) {
      const tr = document.createElement("tr");
      const cells = [r.grade, r.name, r.source, r.major.join(" "), r.minor.join(" "), r.adapted.join(" "), `${r.delay} / ${r.reverb}`];
      for (const c of cells) { const td = document.createElement("td"); td.textContent = c; tr.append(td); }
      const td = document.createElement("td"), b = document.createElement("button");
      b.textContent = ".syx"; b.onclick = () => download(r.file, new Blob([r.bytes], { type: "application/octet-stream" }));
      td.append(b); tr.append(td); body.append(tr);
    }
  }

  $("pickBtn").onclick = () => $("pick").click();
  $("pick").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };
  $("filter").onchange = e => { filter = e.target.value; render(); };
  $("lang").onclick = () => { lang = lang === "sk" ? "en" : "sk"; render(); };
  $("zip").onclick = () => {
    const list = visible();
    download("mininova-to-circuit-tracks.zip", zip([...list.map(r => ({ name: r.file, data: r.bytes })), { name: "report.csv", data: new TextEncoder().encode(report(list)) }]));
  };
  const drop = $("drop");
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); addFiles([...e.dataTransfer.files]); };
  render();
})();
