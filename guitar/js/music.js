// Порт музыкальной логики из Android-версии (Chords.kt, ChordText.kt, Capo.kt, Notes.kt, Tunings.kt, ChordShapes.kt)
export const RUSSIAN = 'RUSSIAN', INTERNATIONAL = 'INTERNATIONAL';
export const AUTO = 'AUTO', SHARPS = 'SHARPS', FLATS = 'FLATS';

const SHARP_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT_NAMES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const BASE = { C:0, D:2, E:4, F:5, G:7, A:9, B:11, H:11 };
const SUFFIX_TOKEN = '(?:maj|Maj|min|dim|aug|sus|add|no|omit|alt|m|M|\\+|-|°|ø|Δ|\\d{1,2}|#|b|♯|♭|\\(|\\)|,|/(?=\\d))';
const CHORD_RE = new RegExp('^([A-H])([#b♯♭]?)((?:' + SUFFIX_TOKEN + ')*)(?:/([A-H])([#b♯♭]?))?$');
const mod12 = v => ((v % 12) + 12) % 12;

function noteIndex(letter, acc, notation) {
  let base = BASE[letter];
  if (letter === 'B' && notation === RUSSIAN) base = 10;
  const shift = (acc === '#' || acc === '♯') ? 1 : (acc === 'b' || acc === '♭') ? -1 : 0;
  if (letter === 'B' && notation === RUSSIAN && shift === -1) return 10;
  if (letter === 'B' && shift === 1) return 0;
  return mod12(base + shift);
}

export const Chords = {
  parse(token, notation = RUSSIAN) {
    const t = (token || '').trim();
    if (!t || t.length > 16) return null;
    const m = CHORD_RE.exec(t); if (!m) return null;
    const [, r, acc, suffix, b = '', bAcc = ''] = m;
    if (suffix.startsWith('b') && acc) return null;
    if ((suffix.match(/\(/g) || []).length !== (suffix.match(/\)/g) || []).length) return null;
    return {
      root: noteIndex(r, acc, notation),
      rootFlat: acc === 'b' || acc === '♭' || (notation === RUSSIAN && r === 'B' && !acc),
      suffix,
      bass: b ? noteIndex(b, bAcc, notation) : null,
      bassFlat: bAcc === 'b' || bAcc === '♭' || (notation === RUSSIAN && b === 'B' && !bAcc),
      usedH: r === 'H' || b === 'H'
    };
  },
  isChord(t) { return Chords.parse(t, RUSSIAN) != null; },
  noteName(index, flat, notation, useH = notation === RUSSIAN) {
    const i = mod12(index);
    if (notation === RUSSIAN) {
      if (i === 11) return useH ? 'H' : 'B';
      if (i === 10) return flat ? 'B' : 'A#';
    }
    return flat ? FLAT_NAMES[i] : SHARP_NAMES[i];
  },
  prefersFlatKey(root, suffix) {
    const minor = (suffix.startsWith('m') && !suffix.startsWith('maj')) || suffix.startsWith('dim') || suffix.startsWith('°');
    return minor ? (root === 10 || root === 3) : (root === 10 || root === 3 || root === 8 || root === 1);
  },
  transpose(chord, semitones, notation = RUSSIAN, pref = AUTO, outNotation = notation) {
    const s = mod12(semitones);
    if (s === 0 && outNotation === notation) return chord;
    const p = Chords.parse(chord, notation); if (!p) return chord;
    const newRoot = (p.root + s) % 12;
    const flat = pref === SHARPS ? false : pref === FLATS ? true : (s === 0 ? p.rootFlat : (p.rootFlat || Chords.prefersFlatKey(newRoot, p.suffix)));
    let out = Chords.noteName(newRoot, flat, outNotation) + p.suffix;
    if (p.bass != null) {
      const nb = (p.bass + s) % 12;
      const bFlat = pref === SHARPS ? false : pref === FLATS ? true : (s === 0 ? p.bassFlat : flat);
      out += '/' + Chords.noteName(nb, bFlat, outNotation);
    }
    return out;
  },
  inferNotation(chords, def) {
    return chords.some(c => c.startsWith('H') || c.includes('/H')) ? RUSSIAN : def;
  }
};

const OPEN = '⟦', CLOSE = '⟧';
const MARK_RE = /⟦([^⟧]*)⟧/g;
const TAB_LINE = /^\s*[A-Ha-h][#b]?\s*[-|:]?[-0-9|hpbrx/\\~()]{6,}.*$/;
const SEP_TOKENS = new Set(['|','||','|:',':|','-','–','*','x2','x3','x4','(x2)','(x4)','/','%','...']);

export const ChordText = {
  OPEN, CLOSE,
  mark: c => OPEN + c + CLOSE,
  chordsIn: text => [...(text || '').matchAll(MARK_RE)].map(m => m[1]),
  uniqueChords: text => [...new Set(ChordText.chordsIn(text))],
  stripMarks: text => text.replace(MARK_RE, (_, c) => c),
  renderLine(line, semitones, notation, pref, outNotation = notation) {
    const out = []; let i = 0, debt = 0, buf = '';
    const flush = () => { if (buf) { out.push({ text: buf }); buf = ''; } };
    while (i < line.length) {
      const c = line[i];
      if (c === OPEN) {
        const end = line.indexOf(CLOSE, i + 1);
        if (end > i) {
          const orig = line.substring(i + 1, end);
          const shown = Chords.transpose(orig, semitones, notation, pref, outNotation);
          flush(); out.push({ chord: orig, shown });
          const diff = shown.length - orig.length;
          if (diff < 0) buf += ' '.repeat(-diff); else debt += diff;
          i = end + 1; continue;
        }
      }
      if (c === ' ' && debt > 0 && i + 1 < line.length && line[i + 1] === ' ') debt--; else buf += c;
      i++;
    }
    flush(); return out;
  },
  transposeText(text, semitones, notation, pref, outNotation = notation) {
    return text.split('\n').map(l => ChordText.renderLine(l, semitones, notation, pref, outNotation).map(p => p.text ?? p.shown).join('').trimEnd()).join('\n');
  },
  unmarkTabLines(text) {
    return text.split('\n').map(line => {
      const plain = ChordText.stripMarks(line);
      return (line.includes(OPEN) && TAB_LINE.test(plain) && (plain.match(/-/g) || []).length >= 6) ? plain : line;
    }).join('\n');
  },
  autoMark(plain) {
    return plain.split('\n').map(line => {
      if (line.includes(OPEN)) return line;
      const tokens = line.split(/\s+/).filter(t => t.trim());
      const meaningful = tokens.filter(t => !SEP_TOKENS.has(t) && ![...t].every(ch => '|:-–*↓↑V.()x0123456789'.includes(ch)));
      if (!meaningful.length || !meaningful.every(t => Chords.isChord(t.replace(/^[(),]+|[(),]+$/g, '')))) return line;
      return line.replace(/(^|[\s|(])([A-H][^\s|(),]*)(?=$|[\s|),])/g, (m, pre, ch) => pre + (Chords.isChord(ch) ? ChordText.mark(ch) : ch));
    }).join('\n');
  }
};

const EASY = new Set(['0:','2:','4:','7:','9:','9:m','4:m','2:m','4:7','9:7','2:7','7:7','0:7','11:7','9:m7','4:m7','2:m7',
  '0:maj7','5:maj7','2:maj7','9:maj7','2:sus4','9:sus4','4:sus4','2:sus2','9:sus2','0:add9','9:6','2:6','4:6']);
export const Capo = {
  suggest(chords, currentShift, notation) {
    const parsed = chords.map(c => Chords.parse(c, notation)).filter(Boolean);
    if (!parsed.length) return null;
    let best = null;
    for (let capo = 0; capo <= 9; capo++) {
      const shift = currentShift - capo;
      const easy = parsed.filter(p => EASY.has(mod12(p.root + shift) + ':' + p.suffix)).length;
      if (!best || easy > best.easyCount) best = { capo, shift, easyCount: easy, total: parsed.length };
    }
    return best;
  }
};

const N_RU = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','H'];
const N_INT = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const Notes = {
  freq: (midi, a4 = 440) => a4 * Math.pow(2, (midi - 69) / 12),
  midiFloat: (f, a4 = 440) => 69 + 12 * Math.log2(f / a4),
  name: (midi, notation = RUSSIAN) => (notation === RUSSIAN ? N_RU : N_INT)[mod12(midi)] + (Math.floor(midi / 12) - 1),
  pitchClassName: (midi, notation = RUSSIAN) => (notation === RUSSIAN ? N_RU : N_INT)[mod12(midi)],
  parse(s) {
    const m = /^([A-Ha-h])([#b]?)(-?\d)$/.exec((s || '').trim()); if (!m) return null;
    const base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11, H:11 }[m[1].toUpperCase()];
    return (parseInt(m[3]) + 1) * 12 + base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  },
  nearest(f, a4) { const mf = Notes.midiFloat(f, a4); const m = Math.round(mf); return { midi: m, cents: (mf - m) * 100 }; },
  centsBetween: (f, target, a4) => (Notes.midiFloat(f, a4) - target) * 100
};

const t = (name, ...notes) => ({ name, notes });
export const Tunings = {
  instruments: [
    { id: 'guitar6', name: 'Гитара 6 струн', strings: 6, tunings: [
      t('Стандартный (E)', 'E2','A2','D3','G3','B3','E4'), t('Полтона вниз (Eb)', 'D#2','G#2','C#3','F#3','A#3','D#4'),
      t('Тон вниз (D standard)', 'D2','G2','C3','F3','A3','D4'), t('Drop D', 'D2','A2','D3','G3','B3','E4'),
      t('Drop C#', 'C#2','G#2','C#3','F#3','A#3','D#4'), t('Drop C', 'C2','G2','C3','F3','A3','D4'),
      t('Open G', 'D2','G2','D3','G3','B3','D4'), t('Open D', 'D2','A2','D3','F#3','A3','D4'),
      t('Open E', 'E2','B2','E3','G#3','B3','E4'), t('Open C', 'C2','G2','C3','G3','C4','E4'),
      t('Open A', 'E2','A2','C#3','E3','A3','E4'), t('DADGAD', 'D2','A2','D3','G3','A3','D4'),
      t('Русский строй на 6 струнах (Open G)', 'D2','G2','D3','G3','B3','D4') ] },
    { id: 'guitar7ru', name: 'Русская семиструнная', strings: 7, tunings: [
      t('Цыганский / русский (DGBDGBD)', 'D2','G2','B2','D3','G3','B3','D4'),
      t('Минорный (DGA#DGA#D)', 'D2','G2','A#2','D3','G3','A#3','D4'),
      t('Тон вниз (CFACFAC)', 'C2','F2','A2','C3','F3','A3','C4') ] },
    { id: 'guitar7', name: 'Гитара 7 струн (электро)', strings: 7, tunings: [
      t('Стандартный (B)', 'B1','E2','A2','D3','G3','B3','E4'), t('Drop A', 'A1','E2','A2','D3','G3','B3','E4'),
      t('Полтона вниз', 'A#1','D#2','G#2','C#3','F#3','A#3','D#4') ] },
    { id: 'guitar12', name: 'Гитара 12 струн', strings: 12, tunings: [
      t('Стандартный (пары)', 'E3','E2','A3','A2','D4','D3','G4','G3','B3','B3','E4','E4'),
      t('Полтона вниз (пары)', 'D#3','D#2','G#3','G#2','C#4','C#3','F#4','F#3','A#3','A#3','D#4','D#4') ] },
    { id: 'bass4', name: 'Бас-гитара 4 струны', strings: 4, tunings: [
      t('Стандартный (EADG)', 'E1','A1','D2','G2'), t('Drop D', 'D1','A1','D2','G2'),
      t('Полтона вниз', 'D#1','G#1','C#2','F#2'), t('Тон вниз (DGCF)', 'D1','G1','C2','F2') ] },
    { id: 'bass5', name: 'Бас-гитара 5 струн', strings: 5, tunings: [
      t('Стандартный (BEADG)', 'B0','E1','A1','D2','G2'), t('Высокий C (EADGC)', 'E1','A1','D2','G2','C3') ] },
    { id: 'ukulele', name: 'Укулеле', strings: 4, tunings: [
      t('Стандартный (GCEA, высокая G)', 'G4','C4','E4','A4'), t('Низкая G', 'G3','C4','E4','A4'),
      t('D-строй (ADF#H)', 'A4','D4','F#4','B4'), t('Баритон (DGBE)', 'D3','G3','B3','E4') ] }
  ],
  instrument(id) { return Tunings.instruments.find(i => i.id === id) || Tunings.instruments[0]; },
  midis: tuning => tuning.notes.map(Notes.parse).filter(v => v != null)
};

export const TunerLogic = {
  IN_TUNE_CENTS: 5,
  nearestString(f, targets, a4) {
    if (f <= 0 || !targets.length) return -1;
    const m = Notes.midiFloat(f, a4); let best = 0;
    targets.forEach((v, i) => { if (Math.abs(m - v) < Math.abs(m - targets[best])) best = i; });
    return best;
  },
  direction: c => Math.abs(c) <= 5 ? 'OK' : c < 0 ? 'UP' : 'DOWN',
  hint: c => ({ OK: 'В строе ✓', UP: 'Подтяни ↑', DOWN: 'Ослабь ↓' })[TunerLogic.direction(c)],
  stringNumber: (index, count, paired) => paired ? (count / 2) - Math.floor(index / 2) : count - index,
  hz: f => f.toFixed(1).replace('.', ',') + ' Гц',
  cents(c) { const r = Math.round(c); return r === 0 ? '0 ц' : (r > 0 ? '+' + r : '−' + (-r)) + ' ц'; },
  label(index, targets, paired, a4, notation) {
    const m = targets[index];
    return `${TunerLogic.stringNumber(index, targets.length, paired)} ${paired ? 'пара' : 'струна'} — ${Notes.name(m, notation)} · ${TunerLogic.hz(Notes.freq(m, a4))}`;
  }
};

export class InTuneTracker {
  constructor(holdMs = 1000, outCents = 15) { this.holdMs = holdMs; this.outCents = outCents; this.tuned = new Set(); this.runIndex = -1; this.runStart = 0; }
  update(index, cents, now) {
    if (index < 0 || cents == null) { this.runIndex = -1; return false; }
    const before = this.tuned.size;
    if (Math.abs(cents) <= 5) {
      if (this.runIndex !== index) { this.runIndex = index; this.runStart = now; }
      if (now - this.runStart >= this.holdMs) this.tuned.add(index);
    } else { this.runIndex = -1; if (Math.abs(cents) > this.outCents) this.tuned.delete(index); }
    return this.tuned.size !== before;
  }
  progress(index, now) { return (this.runIndex === index && index >= 0) ? Math.min(1, Math.max(0, (now - this.runStart) / this.holdMs)) : 0; }
  reset() { this.tuned.clear(); this.runIndex = -1; }
}

// Аппликатуры (ChordShapes.kt)
const X = -1;
const OPEN_SHAPES = {
  '0:': [X,3,2,0,1,0], '0:7': [X,3,2,3,1,0], '0:maj7': [X,3,2,0,0,0], '0:add9': [X,3,2,0,3,0], '0:sus4': [X,3,3,0,1,1], '0:6': [X,3,2,2,1,0],
  '2:': [X,X,0,2,3,2], '2:m': [X,X,0,2,3,1], '2:7': [X,X,0,2,1,2], '2:m7': [X,X,0,2,1,1], '2:maj7': [X,X,0,2,2,2], '2:sus4': [X,X,0,2,3,3],
  '2:sus2': [X,X,0,2,3,0], '2:6': [X,X,0,2,0,2], '2:m6': [X,X,0,2,0,1],
  '4:': [0,2,2,1,0,0], '4:m': [0,2,2,0,0,0], '4:7': [0,2,0,1,0,0], '4:m7': [0,2,2,0,3,0], '4:maj7': [0,2,1,1,0,0], '4:sus4': [0,2,2,2,0,0],
  '4:6': [0,2,2,1,2,0], '4:m6': [0,2,2,0,2,0],
  '5:': [1,3,3,2,1,1], '5:maj7': [X,X,3,2,1,0], '5:m': [1,3,3,1,1,1],
  '7:': [3,2,0,0,0,3], '7:7': [3,2,0,0,0,1], '7:maj7': [3,2,0,0,0,2], '7:6': [3,2,0,0,0,0], '7:sus4': [3,3,0,0,1,3],
  '9:': [X,0,2,2,2,0], '9:m': [X,0,2,2,1,0], '9:7': [X,0,2,0,2,0], '9:m7': [X,0,2,0,1,0], '9:maj7': [X,0,2,1,2,0], '9:sus4': [X,0,2,2,3,0],
  '9:sus2': [X,0,2,2,0,0], '9:6': [X,0,2,2,2,2], '9:m6': [X,0,2,2,1,2],
  '11:7': [X,2,1,2,0,2], '11:m': [X,2,4,4,3,2], '11:': [X,2,4,4,4,2]
};
const E_SHAPE = { '': [0,2,2,1,0,0], m: [0,2,2,0,0,0], '7': [0,2,0,1,0,0], m7: [0,2,0,0,0,0], maj7: [0,X,1,1,0,X], sus4: [0,2,2,2,0,0],
  '9': [0,2,0,1,0,2], aug: [0,3,2,1,1,0], m6: [0,2,2,0,2,0], '6': [0,2,2,1,2,0] };
const A_SHAPE = { '': [X,0,2,2,2,0], m: [X,0,2,2,1,0], '7': [X,0,2,0,2,0], m7: [X,0,2,0,1,0], maj7: [X,0,2,1,2,0], sus4: [X,0,2,2,3,0],
  sus2: [X,0,2,2,0,0], '6': [X,0,2,2,2,2], m6: [X,0,2,2,1,2], dim: [X,0,1,2,1,X], m7b5: [X,0,1,0,1,X], dim7: [X,0,1,2,1,2],
  aug: [X,0,3,2,2,1], add9: [X,0,2,4,2,0], '9': [X,0,2,4,2,3] };
export const ChordShapes = {
  canonicalSuffix(raw) {
    const r = raw.replace(/♯/g, '#').replace(/♭/g, 'b').replace(/[()]/g, '');
    const map = { '':'', maj:'', M:'', m:'m', min:'m', '-':'m', '7':'7', m7:'m7', min7:'m7', '-7':'m7', maj7:'maj7', M7:'maj7', 'Δ':'maj7', 'Δ7':'maj7', j7:'maj7',
      sus:'sus4', sus4:'sus4', '4':'sus4', sus2:'sus2', '2':'sus2', dim:'dim', '°':'dim', o:'dim', dim7:'dim7', '°7':'dim7', o7:'dim7',
      m7b5:'m7b5', 'm7-5':'m7b5', 'ø':'m7b5', 'ø7':'m7b5', 'm-7b5':'m7b5', aug:'aug', '+':'aug', '+5':'aug', '5+':'aug', '6':'6', m6:'m6', '9':'9', '7/9':'9', add9:'add9', add2:'add9' };
    return r in map ? map[r] : r;
  },
  simplify(s) {
    if (s.startsWith('maj')) return s.includes('7') ? 'maj7' : '';
    if (s.startsWith('m')) return s.includes('7') ? 'm7' : 'm';
    if (s.startsWith('sus')) return 'sus4';
    if (/7|9|11|13/.test(s)) return '7';
    return '';
  },
  exact(root, suf) {
    const o = OPEN_SHAPES[root + ':' + suf]; if (o) return o;
    const pf = v => { const f = mod12(v); return f === 0 ? 12 : f; };
    const sh = (tpl, by) => tpl.map(x => x === X ? X : x + by);
    const c = [];
    if (E_SHAPE[suf]) c.push(sh(E_SHAPE[suf], pf(root - 4)));
    if (A_SHAPE[suf]) c.push(sh(A_SHAPE[suf], pf(root - 9)));
    let best = null, bv = 1e9;
    for (const f of c) { const mx = Math.max(0, ...f.filter(x => x > 0)); if (mx < bv) { bv = mx; best = f; } }
    return best;
  },
  find(root, rawSuffix) {
    const suf = ChordShapes.canonicalSuffix(rawSuffix);
    let e = ChordShapes.exact(root, suf); if (e) return { frets: e, simplified: false, baseSuffix: suf };
    const simple = ChordShapes.simplify(suf);
    e = ChordShapes.exact(root, simple); if (e) return { frets: e, simplified: true, baseSuffix: simple };
    return null;
  }
};

// YIN (PitchDetector.kt)
export function detectPitch(buf, sampleRate, threshold = 0.15, minFreq = 27, maxFreq = 1600) {
  const size = buf.length, half = size >> 1;
  let energy = 0; for (let i = 0; i < size; i++) energy += buf[i] * buf[i];
  if (energy / size < 1e-6) return -1;
  const maxTau = Math.min(half - 1, Math.floor(sampleRate / minFreq));
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const yin = new Float64Array(maxTau + 2);
  yin[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) { let s = 0; for (let i = 0; i < half; i++) { const d = buf[i] - buf[i + tau]; s += d * d; } yin[tau] = s; }
  let run = 0;
  for (let tau = 1; tau <= maxTau; tau++) { run += yin[tau]; yin[tau] = run === 0 ? 1 : yin[tau] * tau / run; }
  let est = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (yin[tau] < threshold) { while (tau + 1 <= maxTau && yin[tau + 1] < yin[tau]) tau++; est = tau; break; }
  }
  if (est === -1) { let b = minTau; for (let t = minTau; t <= maxTau; t++) if (yin[t] < yin[b]) b = t; if (yin[b] < 0.35) est = b; else return -1; }
  let better = est;
  if (est >= 1 && est < maxTau) { const s0 = yin[est - 1], s1 = yin[est], s2 = yin[est + 1]; const den = 2 * (2 * s1 - s2 - s0); if (den !== 0) better = est + (s2 - s0) / den; }
  return sampleRate / better;
}

// Карплус — Стронг (PluckSynth.kt)
export function renderPluck(freq, sampleRate = 44100, seconds = 2.5, seed = 7) {
  const n = Math.floor(sampleRate * seconds), out = new Float32Array(n);
  const delay = sampleRate / freq - 0.5, size = Math.floor(delay) + 3, buf = new Float64Array(size);
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let prev = 0; for (let i = 0; i < size; i++) { const r = rnd() * 2 - 1; prev = 0.6 * r + 0.4 * prev; buf[i] = prev; }
  const decay = Math.min(0.99999, Math.max(0.95, Math.exp(Math.log(0.001) / (freq * seconds * 0.9))));
  let w = 0, last = 0; const d = Math.floor(delay), frac = delay - d;
  for (let i = 0; i < n; i++) {
    const r1 = (w - d + size * 4) % size, r2 = (w - d - 1 + size * 4) % size;
    const delayed = buf[r1] * (1 - frac) + buf[r2] * frac;
    const y = decay * 0.5 * (delayed + last); last = delayed; buf[w] = y; w = (w + 1) % size; out[i] = y;
  }
  let peak = 1e-9; for (const v of out) peak = Math.max(peak, Math.abs(v));
  const fade = Math.floor(sampleRate / 20);
  for (let i = 0; i < n; i++) { let g = 0.8 / peak; if (i > n - fade) g *= (n - i) / fade; if (i < 64) g *= i / 64; out[i] *= g; }
  return out;
}

export const ScrollMath = {
  MIN: 0.25, MAX: 3, STEP: 0.05, LINES_PER_SEC: 0.4,
  clamp: v => Math.min(3, Math.max(0.25, Math.round(v / 0.05) * 0.05)),
  plus: v => ScrollMath.clamp(v + 0.1), minus: v => ScrollMath.clamp(v - 0.1),
  label: v => v.toFixed(2) + '×',
  mmss: s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
};
