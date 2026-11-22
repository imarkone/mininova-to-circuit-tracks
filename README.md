# MiniNova / UltraNova → Circuit Tracks patch converter

Converts **Novation MiniNova and UltraNova** synth patches (`.syx`, single patches or banks) into synth patches for the
**Novation Circuit Tracks**. The Circuit Tracks synth engine is a reduced MiniNova engine, so many patches carry over well.

- **Web page** – open [`web/index.html`](web/index.html) in Chrome, Edge or Firefox (works offline), drop `.syx` files,
  download single patches or a ZIP with all patches and `report.csv`. Nothing is uploaded.
- **Python** – `python3 mininova_to_ct.py initial_patch.syx OUT_DIR bank1.syx bank2.syx ...`

Both produce identical bytes (`node tests/compare.js initial_patch.syx PY_OUT_DIR inputs...`).

Load the result in [Novation Components](https://components.novationmusic.com/) (Synth → Upload Patch, or Packs), or open
it with the [Circuit Tracks Patch Preview and Random Sound Generator](https://github.com/imarkone/Novation-Components-Live-Patch-Preview-for-Circuit-Tracks)
extension (*Open .syx*), which also applies the original delay and reverb to the Circuit Tracks project.

## Grades

| Grade | Meaning |
| --- | --- |
| A | No major loss. |
| B | One major loss. |
| C | Two or more major losses – it will sound different. |

Major losses: `osc3` (third oscillator), `filter2` (second filter), `matrix` (modulation without a CT equivalent),
`arp` (arpeggiator), `wave` (a MiniNova wave the CT does not have; replaced by Saw).

## What is converted

| MiniNova | Circuit Tracks |
| --- | --- |
| Oscillators 1–2 | Oscillators 1–2. Oscillator 3 moves into slot 2 when oscillator 2 is unused (with ring mod 1×3). |
| Detuned copy of oscillator 1 (same wave and semitones) | Folded into oscillator 1 as Density / Density Detune (`osc_folded`). |
| Unison (voices, detune) | Density / Density Detune (`unison_as_density`). |
| Mixer, Pre/Post FX level | Mixer, Pre/Post FX level. |
| Filter 1 (filter 2 when a parallel pair leans to it) | Filter. 14 filter types mapped to the 6 CT types. |
| Envelopes 1–3 | Envelopes 1–3; an envelope 4–6 used by the matrix replaces envelope 3 when that is free. |
| LFO 1–2 | LFO 1–2; LFO 3 replaces LFO 2 when LFO 2 is unused. |
| Modulation matrix | CT matrix (CT sources and destinations only). |
| Mod wheel slots | CT matrix slots controlled by **Macro 1** (`modwheel_macro1`). |
| Distortion 1, Chorus 1, EQ | Distortion, Chorus/Phaser, EQ. |
| Delay, reverb | Stored in the patch (see below) and in `report.csv`. On the CT they are project effects. |
| Category, genre, voice mode, portamento, pre-glide, keyboard octave | Same. |

Not available on the Circuit Tracks: 3 oscillators at once, 2 filters, LFO 3 next to LFO 2, envelopes 4–6 next to
envelope 3, oscillator hardness, chorus 2–4, compressor, gator, arpeggiator, vocoder, tweak knobs, aftertouch.

## Delay and reverb stored in the patch

The reserved data bytes 18–31 of the Circuit Tracks patch (zero in all Novation patches checked) hold:
`77` (marker), `1` (version), reverb type, reverb decay, reverb damping, reverb send, delay time, delay sync,
delay feedback, delay width, delay left-right ratio, delay slew, delay send, checksum (sum of the 13 bytes & 127).
The values use the same ranges as the Circuit Tracks project FX (MIDI channel 16, NRPN 1:6–1:11 and 1:18–1:20,
sends CC 88/89 reverb and CC 111/112 delay for Synth 1/2).

## Sources

- MiniNova patch byte map: [nclavaud/mininova-web-editor](https://github.com/nclavaud/mininova-web-editor) (`src/redux/patch.js`)
- MiniNova parameters: [midi.guide – Novation MiniNova](https://midi.guide/d/novation/mininova/)
- Circuit Tracks patch format and project FX: Circuit Tracks Programmer's Reference Guide V3
- Macro destinations: checked against Novation Components on factory patches

Community project, not affiliated with Novation or Focusrite. No patches are included; convert your own `.syx` files.
