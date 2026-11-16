// Every sound is synthesized with WebAudio — oscillators and shaped noise, no
// audio files. Gunfire is a noise crack over a low thump, pitched and filtered
// per weapon class; the Charge beeps as it arms; round stingers are two or
// three notes. Distant shots pass a volume in, so the same synth serves the
// player loud and a bot across the yard quiet.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return false; }
    master = ctx.createGain();
    master.gain.value = 0.42;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function noise(dur, { freq = 1800, q = 0.7, gain = 0.5, type = 'bandpass', sweepTo = 0, vol = 1 } = {}) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, { type = 'square', gain = 0.2, vol = 1, slideTo = 0, delay = 0 } = {}) {
    if (!ensure()) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function thump(freq, dur, vol) {
    tone(freq, dur, { type: 'sine', gain: 0.7, vol, slideTo: freq * 0.4 });
  }

  return {
    unlock() { ensure(); },
    shot(kind, vol = 1) {
      if (kind === 'sniper') { noise(0.32, { freq: 2600, gain: 0.9, vol, sweepTo: 300 }); thump(120, 0.28, vol); }
      else if (kind === 'shotgun') { noise(0.24, { freq: 1500, gain: 0.9, vol, sweepTo: 240 }); thump(100, 0.22, vol); }
      else if (kind === 'smg') { noise(0.09, { freq: 2400, gain: 0.5, vol, sweepTo: 700 }); thump(150, 0.09, vol * 0.7); }
      else if (kind === 'rifle') { noise(0.13, { freq: 2100, gain: 0.65, vol, sweepTo: 500 }); thump(130, 0.13, vol * 0.85); }
      else { noise(0.1, { freq: 2500, gain: 0.5, vol, sweepTo: 800 }); thump(170, 0.1, vol * 0.6); }
    },
    dry() { tone(1400, 0.04, { type: 'square', gain: 0.08 }); },
    reload() { tone(500, 0.05, { type: 'square', gain: 0.1 }); tone(340, 0.05, { type: 'square', gain: 0.12, delay: 0.32 }); tone(720, 0.05, { type: 'square', gain: 0.12, delay: 0.62 }); },
    draw() { noise(0.08, { freq: 900, gain: 0.15 }); },
    hit() { tone(1900, 0.05, { type: 'sine', gain: 0.16 }); },
    kill() { tone(1500, 0.06, { type: 'sine', gain: 0.16 }); tone(2100, 0.09, { type: 'sine', gain: 0.16, delay: 0.06 }); },
    hurt() { thump(90, 0.14, 0.8); noise(0.1, { freq: 500, gain: 0.25, type: 'lowpass' }); },
    beep(final = false) { tone(final ? 1320 : 880, final ? 0.22 : 0.08, { type: 'square', gain: 0.14 }); },
    plantDone() { tone(880, 0.08, { type: 'square', gain: 0.14 }); tone(1174, 0.14, { type: 'square', gain: 0.14, delay: 0.1 }); },
    explosion() { noise(0.9, { freq: 900, gain: 1, type: 'lowpass', sweepTo: 60 }); thump(60, 0.8, 1); },
    grenade() { noise(0.5, { freq: 1200, gain: 0.7, type: 'lowpass', sweepTo: 120 }); thump(80, 0.4, 0.9); },
    flashPop() { noise(0.16, { freq: 3200, gain: 0.5, sweepTo: 900 }); tone(3400, 0.5, { type: 'sine', gain: 0.05, slideTo: 2600 }); },
    bounce() { tone(300, 0.04, { type: 'square', gain: 0.07 }); },
    buy() { tone(990, 0.06, { type: 'sine', gain: 0.14 }); tone(1320, 0.08, { type: 'sine', gain: 0.12, delay: 0.05 }); },
    denied() { tone(220, 0.09, { type: 'square', gain: 0.1 }); },
    roundWin() { tone(523, 0.12, { type: 'triangle', gain: 0.2 }); tone(659, 0.12, { type: 'triangle', gain: 0.2, delay: 0.11 }); tone(784, 0.22, { type: 'triangle', gain: 0.22, delay: 0.22 }); },
    roundLose() { tone(392, 0.14, { type: 'triangle', gain: 0.2 }); tone(330, 0.14, { type: 'triangle', gain: 0.2, delay: 0.12 }); tone(262, 0.26, { type: 'triangle', gain: 0.2, delay: 0.24 }); },
    throwIt() { noise(0.12, { freq: 700, gain: 0.12, sweepTo: 1400 }); },
  };
}
