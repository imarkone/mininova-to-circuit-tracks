// MiniNova / UltraNova (526-byte SysEx) -> Circuit Tracks synth patch (350 bytes).
// Port of mininova_to_ct.py; both must produce identical bytes (checked by tests/compare.js).
// MiniNova offsets: whole message (F0 = 0), from nclavaud/mininova-web-editor. Circuit Tracks: data byte d = message byte - 9.
(function (root) {
  "use strict";
  const HDR = 9;
  const SRC_DIRECT = 0, SRC_LFO3P = 10, SRC_LFO3B = 11, SRC_ENV3 = 14, SRC_ENV4 = 15, SRC_ENV5 = 16, SRC_ENV6 = 17;
  const FILTER_TYPE = [0, 0, 1, 1, 2, 3, 2, 3, 2, 3, 4, 4, 5, 5];
  const POLY = [0, 1, 2, 2, 0];
  const FX_DIST1 = 4, FX_DELAY = [6, 7], FX_REVERB = [8, 9], FX_CHORUS1 = 10, FX_CHORUS_OTHER = [11, 12, 13], FX_GATOR = 14;
  const MAJOR = ["osc3", "filter2", "matrix", "arp", "wave"];
  const INFO = ["unison_as_density", "osc_folded", "modwheel_macro1"];

  function messages(bytes) {
    const out = [];
    let pos = 0;
    for (;;) {
      const start = bytes.indexOf(0xF0, pos);
      if (start < 0) break;
      const end = bytes.indexOf(0xF7, start);
      if (end < 0) break;
      const msg = bytes.subarray(start, end + 1);
      pos = end + 1;
      if (msg.length === 526 && msg[1] === 0x00 && msg[2] === 0x20 && msg[3] === 0x29 && msg[4] === 0x03) out.push(msg);
    }
    return out;
  }

  function convert(m, template) {
    const out = Uint8Array.from(template);
    const d = (i, v) => { out[HDR + i] = Math.max(0, Math.min(127, Math.trunc(v))); };
    const losses = new Set();
    let name = "";
    for (let i = 15; i < 31; i++) name += String.fromCharCode(m[i]);
    for (let i = 0; i < 16; i++) { const c = i < name.length ? name.charCodeAt(i) : 32; out[HDR + i] = c >= 32 && c < 127 ? c : 32; }
    d(16, m[31] <= 14 ? m[31] : 0);
    d(17, m[32] <= 9 ? m[32] : 0);

    d(32, m[34] < 5 ? POLY[m[34]] : 2);
    d(33, m[35]);
    d(34, m[36]);
    const octRaw = m[38];
    const octave = octRaw <= 4 ? octRaw : octRaw >= 124 ? octRaw - 128 : 0;
    d(35, 64 + Math.max(-6, Math.min(5, octave)));
    const unison = m[39] > 0 ? [Math.min(127, 24 + 24 * m[39]), Math.min(127, Math.max(10, m[40]))] : null;
    if (unison) losses.add("unison_as_density");

    const density = {};
    const level = { 1: m[76], 2: m[77], 3: m[78] };
    const used = [1, 2, 3].filter(n => level[n] > 0 || (n === 3 && (m[79] || m[80])));
    const sameAs1 = n => {
      const a = 46, b = 46 + 10 * (n - 1);
      return m[a] === m[b] && m[a + 7] === m[b + 7] && Math.abs(m[a + 8] - m[b + 8]) <= 30 && !(n === 3 && (m[79] || m[80]));
    };
    if (used.length === 3) {
      for (const n of [3, 2]) {
        if (sameAs1(n)) {
          density[1] = [64, Math.min(127, 4 * Math.abs(m[54] - m[46 + 10 * (n - 1) + 8]) + 20)];
          used.splice(used.indexOf(n), 1);
          level[n] = 0;
          losses.add("osc_folded");
          break;
        }
      }
    }
    const o3Used = used.includes(3);
    let slots = [1, 2], osc3To2 = false;
    if (o3Used) {
      if (!used.includes(2) && m[80] === 0) { slots = [1, 3]; osc3To2 = true; } else losses.add("osc3");
    }
    slots.forEach((src, ctSlot) => {
      const base = 46 + 10 * (src - 1), ct = 36 + 9 * ctSlot;
      let wave = m[base];
      if (wave > 13) { losses.add("wave"); wave = 2; }
      d(ct, wave); d(ct + 1, m[base + 1]); d(ct + 2, m[base + 2]); d(ct + 3, m[base + 3]);
      let dens = m[base + 5], dtune = m[base + 6];
      if (ctSlot === 0 && density[1] && dens < density[1][0]) [dens, dtune] = density[1];
      if (unison && dens < unison[0]) [dens, dtune] = unison;
      d(ct + 4, dens); d(ct + 5, dtune); d(ct + 6, Math.max(40, Math.min(88, m[base + 7])));
      d(ct + 7, m[base + 8]); d(ct + 8, m[base + 9]);
      if (m[base + 4] < 120 && m[76 + src - 1] > 0) losses.add("hardness");
    });

    d(54, m[76]); d(55, osc3To2 ? m[78] : level[2]);
    d(56, osc3To2 ? m[79] : 0);
    if (!osc3To2 && (m[79] || m[80])) losses.add("ringmod");
    d(57, m[81]); d(58, m[83]); d(59, m[84]);

    const routing = m[86], balance = m[87];
    const use2 = (routing === 3 || routing === 4) && balance > 96;
    if (routing === 2 || routing === 4 || (routing === 3 && balance >= 32 && balance <= 96)) losses.add("filter2");
    let drive, dtype, ftype, freq, track, res, q, env2;
    if (use2) [drive, dtype, ftype, track, freq, env2, res, q] = [m[97], m[98], m[99], m[100], m[101], m[102], m[103], m[104]];
    else [drive, dtype, ftype, freq, track, res, q, env2] = [m[89], m[90], m[91], m[92], m[93], m[94], m[95], m[96]];
    d(60, 0); d(61, drive); d(62, dtype <= 6 ? dtype : 0);
    d(63, ftype < 14 ? FILTER_TYPE[ftype] : 1);
    d(64, routing === 0 ? 127 : freq); d(65, track); d(66, res); d(67, q); d(68, env2);

    d(69, m[115]); for (let i = 0; i < 4; i++) d(70 + i, m[116 + i]);
    d(74, m[129]); for (let i = 0; i < 4; i++) d(75 + i, m[130 + i]);
    d(79, m[143]); for (let i = 0; i < 4; i++) d(80 + i, m[144 + i]);

    const slotsMx = [];
    for (let n = 0; n < 20; n++) {
      const b = 339 + 5 * n;
      if (m[b + 3] !== 64) slotsMx.push([m[b], m[b + 1], m[b + 2], m[b + 3], m[b + 4]]);
    }
    const usedSrc = new Set();
    for (const [s1, s2, a] of slotsMx) if (a === 0) { usedSrc.add(s1); usedSrc.add(s2); }
    const lfo3To2 = (usedSrc.has(SRC_LFO3P) || usedSrc.has(SRC_LFO3B)) && !usedSrc.has(8) && !usedSrc.has(9);
    let freeEnv3 = !usedSrc.has(SRC_ENV3), envTo3 = null;
    for (const e of [SRC_ENV4, SRC_ENV5, SRC_ENV6]) if (usedSrc.has(e) && freeEnv3) { envTo3 = e; freeEnv3 = false; }

    [199, lfo3To2 ? 217 : 208].forEach((base, ctSlot) => {
      const ct = 84 + 8 * ctSlot, flags = base !== 217 ? m[base + 8] : m[225];
      d(ct, m[base] <= 37 ? m[base] : 0); d(ct + 1, m[base + 1]); d(ct + 2, m[base + 2]);
      d(ct + 3, m[base + 4]); d(ct + 4, m[base + 5]); d(ct + 5, m[base + 6]); d(ct + 6, m[base + 7]); d(ct + 7, flags & 0x7F);
    });
    if (envTo3 !== null) {
      const b = 157 + 14 * (envTo3 - SRC_ENV4);
      d(79, m[b]); for (let i = 0; i < 4; i++) d(80 + i, m[b + 1 + i]);
    }

    const fx = [0, 1, 2, 3, 4].map(i => [m[228 + i], m[233 + i]]);
    const first = (test) => { const f = fx.find(([t, l]) => test(t) && l > 0); return f ? f[1] : 0; };
    const dist = first(t => t === FX_DIST1), chorus = first(t => t === FX_CHORUS1);
    const delay = Math.max(0, ...fx.filter(([t]) => FX_DELAY.includes(t)).map(([, l]) => l));
    const reverb = Math.max(0, ...fx.filter(([t]) => FX_REVERB.includes(t)).map(([, l]) => l));
    if (fx.some(([t, l]) => FX_CHORUS_OTHER.includes(t) && l > 0)) losses.add("chorus2-4");
    if (fx.some(([t, l]) => t === FX_GATOR && l > 0)) losses.add("gator");
    if (delay) losses.add("delay");
    if (reverb) losses.add("reverb");
    // Python max() over (level, type) tuples: highest level, ties broken by the higher type.
    const best = (types, def) => fx.filter(([t]) => types.includes(t)).map(([t, l]) => [l, t])
      .reduce((a, b) => (a === null || b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a), null) || def;
    const dslot = best(FX_DELAY, [0, 6]), rslot = best(FX_REVERB, [0, 8]);
    const db = dslot[1] === 6 ? 262 : 268, rb = rslot[1] === 8 ? 274 : 277;
    const meta = [77, 1, Math.min(m[rb], 5), m[rb + 1], m[rb + 2], rslot[0],
      m[db], Math.min(m[db + 1], 35), m[db + 2], m[db + 3], Math.min(m[db + 4], 12), m[db + 5], dslot[0]];
    meta.push(meta.reduce((a, b) => a + b, 0) & 0x7F);
    meta.forEach((v, i) => d(18 + i, v));
    d(100, Math.min(70, Math.floor(dist / 2))); d(116, m[256] <= 6 ? m[256] : 0); d(117, m[257]);
    d(102, chorus); d(118, m[280] & 1); d(119, m[281]); d(120, m[282]); d(121, m[283]); d(122, m[284]); d(123, m[285]);
    const eqOn = fx.some(([t, l]) => t === 1 && l > 0);
    [[238, 239], [240, 241], [242, 243]].forEach(([lvlB, frqB], i) => {
      d(105 + 2 * i, eqOn ? m[frqB] : 64);
      d(106 + 2 * i, eqOn ? m[lvlB] : 64);
    });
    if (m[317]) losses.add("arp");

    const src = s => {
      if ([0, 4, 5, 6, 7, 8, 9].includes(s)) return s;
      if ((s === SRC_LFO3P || s === SRC_LFO3B) && lfo3To2) return s - 2;
      if (s === 12 || s === 13 || s === 14) return s - 2;
      if (s === envTo3) return 12;
      return null;
    };
    const table = { 0: 0, 1: 1, 2: 2, 4: 3, 5: 4, 7: 5, 8: 6, 13: 7, 14: 8, 16: 9, 19: 11, 21: 12, 23: 13, 26: 14, 27: 15, 29: 16, 30: 17 };
    if (osc3To2) Object.assign(table, { 3: 2, 6: 4, 9: 6, 15: 8, 17: 10 });
    if (use2) { Object.assign(table, { 20: 11, 22: 12, 24: 13 }); delete table[19]; delete table[21]; delete table[23]; }
    if (lfo3To2) table[28] = 15;
    const dest = t => (t in table ? table[t] : null);

    const ctSlots = [], wheel = [];
    for (const [s1, s2, anim, depth, dt] of slotsMx) {
      if (anim !== 0) { losses.add("animate"); continue; }
      if (s1 === 2 || s1 === 3 || s2 === 2 || s2 === 3) continue;
      const isWheel = s1 === 1 || s2 === 1;
      const a = s1 === 1 ? SRC_DIRECT : src(s1), b = s2 === 1 ? SRC_DIRECT : src(s2), t = dest(dt);
      if (a === null || b === null || t === null) { losses.add(isWheel ? "modwheel" : "matrix"); continue; }
      if (isWheel) {
        if (wheel.length >= 4) { losses.add("modwheel"); continue; }
        wheel.push([ctSlots.length, depth]);
        ctSlots.push([a, b, 64, t]);
      } else ctSlots.push([a, b, depth, t]);
    }
    if (ctSlots.length > 20) losses.add("matrix");
    for (let n = 0; n < 20; n++) {
      const [a, b, depth, t] = n < ctSlots.length ? ctSlots[n] : [0, 0, 64, 0];
      d(124 + 4 * n, a); d(125 + 4 * n, b); d(126 + 4 * n, depth); d(127 + 4 * n, t);
    }
    if (wheel.length) {
      d(204, 0);
      for (let k = 0; k < 4; k++) {
        const [slot, depth] = k < wheel.length ? wheel[k] : [null, 64];
        d(205 + 4 * k, slot !== null && slot < 20 ? 51 + slot : 0);
        d(206 + 4 * k, 0); d(207 + 4 * k, 127); d(208 + 4 * k, slot !== null ? depth : 64);
      }
      losses.add("modwheel_macro1");
    }
    const all = [...losses].sort();
    const major = all.filter(l => MAJOR.includes(l));
    return {
      bytes: out, name: name.trim(), grade: major.length === 0 ? "A" : major.length === 1 ? "B" : "C",
      major, minor: all.filter(l => !MAJOR.includes(l) && !INFO.includes(l)), adapted: all.filter(l => INFO.includes(l)),
      delay, reverb, meta
    };
  }

  const api = { messages, convert };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MiniNovaToCT = api;
})(typeof window !== "undefined" ? window : globalThis);
