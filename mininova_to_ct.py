#!/usr/bin/env python3
"""Convert Novation MiniNova / UltraNova patches (526-byte SysEx) to Circuit Tracks synth patches (350 bytes).

Usage: mininova_to_ct.py TEMPLATE.syx OUT_DIR INPUT.syx [INPUT.syx ...]
  TEMPLATE.syx  a Circuit Tracks "Initial Patch" (defaults for macros and bytes the conversion does not set)
Writes OUT_DIR/<grade>_<name>_<id>.syx per patch and OUT_DIR/report.csv (losses per patch, delay/reverb of the original).

Grades: A = no major loss, B = one, C = more (major: osc3, filter2, matrix, arp, wave).
Extras of version 2:
- unison and detuned oscillator copies become CT Density / Density Detune
- matrix slots that use the mod wheel become CT matrix slots driven by Macro 1 (via the "Mod Matrix n" macro destination)
- the original delay and reverb are stored in the reserved bytes 18-31 of the CT patch (see FX_META below), so a player can
  set the Circuit Tracks project FX (MIDI channel 16) when the patch is opened

MiniNova byte offsets (whole message, F0 = 0) follow nclavaud/mininova-web-editor (src/redux/patch.js);
voice bytes 31-40 follow the MiniNova CC list (category, genre, ..., polyphony, portamento, pre-glide, octave, unison).
Circuit Tracks offsets follow the Circuit Tracks Programmer's Reference Guide (data byte d = message byte - 9).
"""
import csv, hashlib, os, re, sys

HDR = 9  # Circuit Tracks: F0 00 20 29 01 64 00 00 00, then 340 data bytes, F7


def messages(path):
    data = open(path, "rb").read()
    pos = 0
    while (start := data.find(b"\xf0", pos)) >= 0:
        end = data.find(b"\xf7", start)
        if end < 0:
            break
        msg = data[start:end + 1]
        pos = end + 1
        if len(msg) == 526 and msg[1:5] == bytes([0x00, 0x20, 0x29, 0x03]):
            yield msg


# MiniNova matrix sources (byte value) -> Circuit Tracks source byte; None = not available on the CT.
SRC_DIRECT, SRC_LFO3P, SRC_LFO3B, SRC_ENV3, SRC_ENV4, SRC_ENV5, SRC_ENV6 = 0, 10, 11, 14, 15, 16, 17
# MiniNova filter type (0-13) -> CT filter type (LP12, LP24, BP6, BP12, HP12, HP24)
FILTER_TYPE = [0, 0, 1, 1, 2, 3, 2, 3, 2, 3, 4, 4, 5, 5]
# MiniNova polyphony (Mono, Mono AG, Poly 1, Poly 2, Mono 2) -> CT (Mono, Auto-Glide, Poly)
POLY = [0, 1, 2, 2, 0]
# Effect slot types
FX_DIST1, FX_DELAY, FX_REVERB, FX_CHORUS1, FX_CHORUS_OTHER, FX_GATOR = 4, (6, 7), (8, 9), 10, (11, 12, 13), 14


def osc_used(m, n):
    return m[76 + n - 1] > 0


def convert(m, template):
    out = bytearray(template)
    d = lambda i, v: out.__setitem__(HDR + i, max(0, min(127, int(v))))
    losses = set()
    name = m[15:31].decode("latin-1")
    for i, ch in enumerate(name.ljust(16)[:16]):
        out[HDR + i] = ord(ch) if 32 <= ord(ch) < 127 else 32
    d(16, m[31] if m[31] <= 14 else 0)          # category
    d(17, m[32] if m[32] <= 9 else 0)           # genre

    # voice
    d(32, POLY[m[34]] if m[34] < 5 else 2)
    d(33, m[35])                                # portamento
    d(34, m[36])                                # pre-glide (centred 64)
    oct_raw = m[38]
    octave = oct_raw if oct_raw <= 4 else oct_raw - 128 if oct_raw >= 124 else 0
    d(35, 64 + max(-6, min(5, octave)))
    # unison (1-4 voices, detune) -> Density / Density Detune on the oscillators
    unison = (min(127, 24 + 24 * m[39]), min(127, max(10, m[40]))) if m[39] > 0 else None
    if unison:
        losses.add("unison_as_density")

    # oscillators: which MiniNova oscillators land in CT slots 1 and 2.
    # A copy of osc 1 (same wave and semitones, a few cents apart) is folded into osc 1 as Density / Density Detune.
    density = {}
    level = {1: m[76], 2: m[77], 3: m[78]}
    used = [n for n in (1, 2, 3) if level[n] > 0 or (n == 3 and (m[79] or m[80]))]

    def same_as_1(n):
        a, b = 46, 46 + 10 * (n - 1)
        return m[a] == m[b] and m[a + 7] == m[b + 7] and abs(m[a + 8] - m[b + 8]) <= 30 and not (n == 3 and (m[79] or m[80]))

    if len(used) == 3:
        for n in (3, 2):
            if same_as_1(n):
                density[1] = (64, min(127, 4 * abs(m[54] - m[46 + 10 * (n - 1) + 8]) + 20))
                used.remove(n)
                level[n] = 0
                losses.add("osc_folded")
                break
    o3_used = 3 in used
    slots = [1, 2]
    osc3_to_2 = False
    if o3_used:
        if 2 not in used and m[80] == 0:
            slots = [1, 3]
            osc3_to_2 = True
        else:
            losses.add("osc3")
    for ct_slot, src in enumerate(slots):
        base = 46 + 10 * (src - 1)              # wave, wtint, pwwti, vsync, hardness, density, dtune, semi, cents, pitch
        ct = 36 + 9 * ct_slot                   # wave, interp, index, vsync, density, dtune, semi, cents, bend
        wave = m[base]
        if wave > 13:
            losses.add("wave")
            wave = 2
        d(ct, wave); d(ct + 1, m[base + 1]); d(ct + 2, m[base + 2]); d(ct + 3, m[base + 3])
        dens, dtune = m[base + 5], m[base + 6]
        if ct_slot == 0 and 1 in density and dens < density[1][0]:
            dens, dtune = density[1]
        if unison and dens < unison[0]:
            dens, dtune = unison
        d(ct + 4, dens); d(ct + 5, dtune); d(ct + 6, max(40, min(88, m[base + 7])))
        d(ct + 7, m[base + 8]); d(ct + 8, m[base + 9])
        if m[base + 4] < 120 and m[76 + src - 1] > 0:
            losses.add("hardness")   # 127 = default (no softening)

    # mixer: osc levels, ring mod, noise, pre/post FX
    d(54, m[76]); d(55, m[78] if osc3_to_2 else level[2])
    d(56, m[79] if osc3_to_2 else 0)
    if not osc3_to_2 and (m[79] or m[80]):
        losses.add("ringmod")
    d(57, m[81]); d(58, m[83]); d(59, m[84])

    # filter: routing (Bypass, Single, Series, Parallel, Parallel 2, Drum), the louder filter of a parallel pair is kept
    routing, balance = m[86], m[87]
    use2 = routing in (3, 4) and balance > 96
    if routing in (2, 4) or (routing == 3 and 32 <= balance <= 96):
        losses.add("filter2")
    f = 97 if use2 else 89                       # drive, drive type, type, freq/track order differs between filters
    if use2:
        drive, dtype, ftype, track, freq, env2, res, q = m[97], m[98], m[99], m[100], m[101], m[102], m[103], m[104]
    else:
        drive, dtype, ftype, freq, track, res, q, env2 = m[89], m[90], m[91], m[92], m[93], m[94], m[95], m[96]
    d(60, 0); d(61, drive); d(62, dtype if dtype <= 6 else 0)
    d(63, FILTER_TYPE[ftype] if ftype < 14 else 1)
    d(64, 127 if routing == 0 else freq); d(65, track); d(66, res); d(67, q); d(68, env2)

    # envelopes 1-3 (velocity/delay, A, D, S, R)
    d(69, m[115]); [d(70 + i, m[116 + i]) for i in range(4)]
    d(74, m[129]); [d(75 + i, m[130 + i]) for i in range(4)]
    d(79, m[143]); [d(80 + i, m[144 + i]) for i in range(4)]

    # matrix (needed before the LFOs: an unused LFO 2 / envelope 3 can take LFO 3 / envelopes 4-6)
    slots_mx = []
    for n in range(20):
        b = 339 + 5 * n
        s1, s2, anim, depth, dest = m[b], m[b + 1], m[b + 2], m[b + 3], m[b + 4]
        if depth != 64:
            slots_mx.append((s1, s2, anim, depth, dest))
    used_src = {s for s1, s2, a, dp, de in slots_mx if a == 0 for s in (s1, s2)}
    lfo3_to_2 = bool(used_src & {SRC_LFO3P, SRC_LFO3B}) and not used_src & {8, 9}
    free_env3 = SRC_ENV3 not in used_src
    env_to_3 = None
    for e in (SRC_ENV4, SRC_ENV5, SRC_ENV6):
        if e in used_src and free_env3:
            env_to_3, free_env3 = e, False

    # LFO 1 and 2 (LFO 3 into slot 2 when LFO 2 is not modulating anything)
    for ct_slot, base in enumerate((199, 217 if lfo3_to_2 else 208)):
        ct = 84 + 8 * ct_slot                    # shape, phase, slew, delay, delay sync, rate, rate sync, flags
        flags = m[base + 8] if base != 217 else m[225]
        d(ct, m[base] if m[base] <= 37 else 0); d(ct + 1, m[base + 1]); d(ct + 2, m[base + 2])
        d(ct + 3, m[base + 4]); d(ct + 4, m[base + 5]); d(ct + 5, m[base + 6]); d(ct + 6, m[base + 7]); d(ct + 7, flags & 0x7F)
    if env_to_3 is not None:
        b = 157 + 14 * (env_to_3 - SRC_ENV4)     # env 4-6: delay, A, D, S, R
        d(79, m[b]); [d(80 + i, m[b + 1 + i]) for i in range(4)]

    # effects: slot types and levels
    fx = [(m[228 + i], m[233 + i]) for i in range(5)]
    dist = next((lvl for t, lvl in fx if t == FX_DIST1 and lvl > 0), 0)
    chorus = next((lvl for t, lvl in fx if t == FX_CHORUS1 and lvl > 0), 0)
    delay = max([lvl for t, lvl in fx if t in FX_DELAY] + [0])
    reverb = max([lvl for t, lvl in fx if t in FX_REVERB] + [0])
    if any(t in FX_CHORUS_OTHER and lvl > 0 for t, lvl in fx):
        losses.add("chorus2-4")
    if any(t == FX_GATOR and lvl > 0 for t, lvl in fx):
        losses.add("gator")
    if delay:
        losses.add("delay")
    if reverb:
        losses.add("reverb")
    # FX_META (reserved bytes 18-31, zero in every Novation patch checked): 77 marker, 1 version, reverb type, decay,
    # damping, reverb send, delay time, delay sync, feedback, width, left-right ratio, slew, delay send, checksum.
    dslot = max(((lvl, t) for t, lvl in fx if t in FX_DELAY), default=(0, 6))
    rslot = max(((lvl, t) for t, lvl in fx if t in FX_REVERB), default=(0, 8))
    db = 262 if dslot[1] == 6 else 268          # delay 1 / delay 2: time, sync, feedback, width, ratio, slew
    rb = 274 if rslot[1] == 8 else 277          # reverb 1 / reverb 2: type, decay, damping
    meta = [77, 1, min(m[rb], 5), m[rb + 1], m[rb + 2], rslot[0],
            m[db], min(m[db + 1], 35), m[db + 2], m[db + 3], min(m[db + 4], 12), m[db + 5], dslot[0]]
    meta.append(sum(meta) & 0x7F)
    for i, v in enumerate(meta):
        d(18 + i, v)
    d(100, min(70, dist // 2)); d(116, m[256] if m[256] <= 6 else 0); d(117, m[257])
    d(102, chorus); d(118, m[280] & 1); d(119, m[281]); d(120, m[282]); d(121, m[283]); d(122, m[284]); d(123, m[285])
    eq_on = any(t == 1 and lvl > 0 for t, lvl in fx)
    for i, (lvl_b, frq_b) in enumerate(((238, 239), (240, 241), (242, 243))):  # MiniNova: level, frequency per band
        d(105 + 2 * i, m[frq_b] if eq_on else 64)
        d(106 + 2 * i, m[lvl_b] if eq_on else 64)
    if m[317]:
        losses.add("arp")

    # matrix
    def src(s):
        if s in (0, 4, 5, 6, 7, 8, 9):
            return s
        if s in (SRC_LFO3P, SRC_LFO3B) and lfo3_to_2:
            return s - 2
        if s in (12, 13, 14):
            return s - 2
        if s == env_to_3:
            return 12
        return None

    def dest(t):
        table = {0: 0, 1: 1, 2: 2, 4: 3, 5: 4, 7: 5, 8: 6, 13: 7, 14: 8, 16: 9, 19: 11, 21: 12, 23: 13, 26: 14, 27: 15, 29: 16, 30: 17}
        if osc3_to_2:
            table.update({3: 2, 6: 4, 9: 6, 15: 8, 17: 10})
        if use2:
            table.update({20: 11, 22: 12, 24: 13})
            table.pop(19); table.pop(21); table.pop(23)
        if lfo3_to_2:
            table.update({28: 15})
        return table.get(t)

    ct_slots, wheel = [], []                  # wheel: indexes of CT slots driven by Macro 1
    for s1, s2, anim, depth, dt in slots_mx:
        if anim != 0:
            losses.add("animate")
            continue
        if s1 in (2, 3) or s2 in (2, 3):
            continue                              # aftertouch / expression: performance control only
        is_wheel = s1 == 1 or s2 == 1             # mod wheel: becomes Macro 1
        a = SRC_DIRECT if s1 == 1 else src(s1)
        b = SRC_DIRECT if s2 == 1 else src(s2)
        t = dest(dt)
        if a is None or b is None or t is None:
            losses.add("modwheel" if is_wheel else "matrix")
            continue
        if is_wheel:
            if len(wheel) >= 4:
                losses.add("modwheel")
                continue
            wheel.append((len(ct_slots), depth))
            ct_slots.append((a, b, 64, t))        # no effect until Macro 1 is turned up
        else:
            ct_slots.append((a, b, depth, t))
    if len(ct_slots) > 20:
        losses.add("matrix")
    for n in range(20):
        a, b, depth, t = ct_slots[n] if n < len(ct_slots) else (0, 0, 64, 0)
        d(124 + 4 * n, a); d(125 + 4 * n, b); d(126 + 4 * n, depth); d(127 + 4 * n, t)
    # Macro 1 (bytes 204-220): knob position, then 4 slots of destination, start, end, depth.
    # Macro destination 51 + n = "Mod Matrix n+1" (checked against the editor on factory patches).
    if wheel:
        d(204, 0)
        for k in range(4):
            slot, depth = wheel[k] if k < len(wheel) else (None, 64)
            d(205 + 4 * k, 51 + slot if slot is not None and slot < 20 else 0)
            d(206 + 4 * k, 0); d(207 + 4 * k, 127); d(208 + 4 * k, depth if slot is not None else 64)
        losses.add("modwheel_macro1")
    return bytes(out), sorted(losses), name.strip(), delay, reverb, meta


MAJOR = {"osc3", "filter2", "matrix", "arp", "wave"}
INFO = {"unison_as_density", "osc_folded", "modwheel_macro1"}   # changes that keep the sound, listed in their own column


def main():
    template, out_dir, inputs = open(sys.argv[1], "rb").read(), sys.argv[2], sys.argv[3:]
    os.makedirs(out_dir, exist_ok=True)
    seen, rows = set(), []
    for path in inputs:
        for m in messages(path):
            h = hashlib.md5(m[15:]).hexdigest()
            if h in seen:
                continue
            seen.add(h)
            patch, losses, name, delay, reverb, meta = convert(m, template)
            major = sorted(set(losses) & MAJOR)
            fname = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_") or "patch"
            fname = f"{'A' if not major else 'B' if len(major) == 1 else 'C'}_{fname}_{h[:4]}.syx"
            open(os.path.join(out_dir, fname), "wb").write(patch)
            rows.append({"file": fname, "name": name, "source": os.path.basename(path), "grade": fname[0],
                         "major_losses": " ".join(major), "minor_losses": " ".join(sorted(set(losses) - MAJOR - INFO)),
                         "adapted": " ".join(sorted(set(losses) & INFO)),
                         "orig_delay_level": delay, "orig_reverb_level": reverb,
                         "reverb_type": meta[2], "reverb_decay": meta[3], "delay_time": meta[6], "delay_sync": meta[7],
                         "delay_feedback": meta[8]})
    rows.sort(key=lambda r: (r["grade"], r["name"].lower()))
    with open(os.path.join(out_dir, "report.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)


if __name__ == "__main__":
    main()
