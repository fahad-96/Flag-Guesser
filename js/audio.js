"use strict";

/**
 * Sound effects generated with the Web Audio API.
 *
 * No audio files are needed, so the game works offline and loads instantly.
 * The context is created lazily on the first user gesture, as browsers require.
 */
const Sfx = (() => {
  let context = null;
  let enabled = true;

  function getContext() {
    if (context) return context;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    try {
      context = new AudioContextCtor();
    } catch {
      context = null;
    }
    return context;
  }

  /**
   * Plays a single tone.
   * @param {{ freq: number, duration: number, type?: OscillatorType, gain?: number, delay?: number, slideTo?: number }} note
   */
  function tone(note) {
    const ctx = getContext();
    if (!ctx) return;

    const start = ctx.currentTime + (note.delay || 0);
    const end = start + note.duration;
    const oscillator = ctx.createOscillator();
    const amp = ctx.createGain();

    oscillator.type = note.type || "sine";
    oscillator.frequency.setValueAtTime(note.freq, start);
    if (note.slideTo) oscillator.frequency.exponentialRampToValueAtTime(note.slideTo, end);

    const peak = note.gain || 0.08;
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(peak, start + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(amp);
    amp.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }

  const patterns = {
    click() {
      tone({ freq: 640, duration: 0.05, type: "square", gain: 0.025 });
    },
    correct() {
      tone({ freq: 523.25, duration: 0.12 });
      tone({ freq: 659.25, duration: 0.12, delay: 0.09 });
      tone({ freq: 783.99, duration: 0.22, delay: 0.18 });
    },
    wrong() {
      tone({ freq: 240, duration: 0.28, type: "sawtooth", gain: 0.05, slideTo: 130 });
    },
    tick() {
      tone({ freq: 880, duration: 0.04, type: "square", gain: 0.03 });
    },
    over() {
      tone({ freq: 392, duration: 0.18 });
      tone({ freq: 329.63, duration: 0.18, delay: 0.2 });
      tone({ freq: 261.63, duration: 0.4, delay: 0.4 });
    },
    highscore() {
      tone({ freq: 523.25, duration: 0.12 });
      tone({ freq: 659.25, duration: 0.12, delay: 0.12 });
      tone({ freq: 783.99, duration: 0.12, delay: 0.24 });
      tone({ freq: 1046.5, duration: 0.45, delay: 0.36 });
    }
  };

  function play(name) {
    if (!enabled) return;
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const pattern = patterns[name];
    if (pattern) pattern();
  }

  function setEnabled(value) {
    enabled = Boolean(value);
  }

  /** Call from a user gesture so the browser allows audio playback. */
  function unlock() {
    if (!enabled) return;
    const ctx = getContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  }

  return { play, setEnabled, unlock };
})();
