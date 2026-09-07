"use strict";

/**
 * Persistence layer for Flag Guesser.
 *
 * Wraps localStorage with JSON encoding, a key prefix and graceful fallbacks
 * so the game keeps working in private windows or when storage is blocked.
 */
const Storage = (() => {
  const PREFIX = "flagguesser.v1.";
  const MAX_SCORES = 100;
  const MAX_NAME_LENGTH = 20;
  const UNSAFE_NAME_CHARS = new RegExp("[<>\u0000-\u001f]", "g");
  const memory = new Map();

  const DEFAULT_SETTINGS = Object.freeze({
    playerName: "",
    sound: true,
    theme: "system",
    lastMode: "classic",
    lastDifficulty: "medium",
    lastRegion: "world"
  });

  const DEFAULT_STATS = Object.freeze({
    games: 0,
    answered: 0,
    correct: 0,
    bestStreak: 0,
    bestScores: {},
    countries: {}
  });

  function detectLocalStorage() {
    try {
      const probe = `${PREFIX}probe`;
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  const hasLocalStorage = typeof window !== "undefined" && detectLocalStorage();

  function read(key, fallback) {
    try {
      const raw = hasLocalStorage ? window.localStorage.getItem(PREFIX + key) : memory.get(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      const raw = JSON.stringify(value);
      if (hasLocalStorage) window.localStorage.setItem(PREFIX + key, raw);
      else memory.set(key, raw);
      return true;
    } catch {
      return false;
    }
  }

  function remove(key) {
    try {
      if (hasLocalStorage) window.localStorage.removeItem(PREFIX + key);
      else memory.delete(key);
    } catch {
      /* Ignore storage errors. */
    }
  }

  function sanitiseName(name) {
    return String(name || "")
      .replace(UNSAFE_NAME_CHARS, "")
      .trim()
      .slice(0, MAX_NAME_LENGTH);
  }

  function getSettings() {
    const stored = read("settings", {});
    const merged = { ...DEFAULT_SETTINGS, ...(stored && typeof stored === "object" ? stored : {}) };
    merged.playerName = sanitiseName(merged.playerName);
    merged.sound = Boolean(merged.sound);
    if (!["system", "dark", "light"].includes(merged.theme)) merged.theme = "system";
    return merged;
  }

  function saveSettings(settings) {
    const next = { ...getSettings(), ...settings };
    next.playerName = sanitiseName(next.playerName);
    write("settings", next);
    return next;
  }

  function compareScores(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    return a.date - b.date;
  }

  function getScores(mode) {
    const list = read("scores", []);
    const valid = Array.isArray(list) ? list.filter((entry) => entry && typeof entry.score === "number") : [];
    const filtered = mode ? valid.filter((entry) => entry.mode === mode) : valid;
    return filtered.sort(compareScores);
  }

  /**
   * Stores a finished game and returns its rank within the same mode.
   * @returns {{ id: string, rank: number, isBest: boolean }}
   */
  function addScore(entry) {
    const record = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      name: sanitiseName(entry.name) || "Player",
      score: Math.max(0, Math.round(entry.score || 0)),
      mode: entry.mode,
      difficulty: entry.difficulty,
      region: entry.region,
      accuracy: entry.accuracy || 0,
      bestStreak: entry.bestStreak || 0,
      answered: entry.answered || 0,
      date: Date.now()
    };

    const all = getScores();
    all.push(record);
    all.sort(compareScores);
    write("scores", all.slice(0, MAX_SCORES));

    const sameMode = all.filter((item) => item.mode === record.mode);
    const rank = sameMode.findIndex((item) => item.id === record.id) + 1;
    return { id: record.id, rank, isBest: rank === 1 };
  }

  function clearScores() {
    remove("scores");
  }

  function getStats() {
    const stored = read("stats", {});
    const stats = { ...DEFAULT_STATS, ...(stored && typeof stored === "object" ? stored : {}) };
    stats.bestScores = { ...(stats.bestScores || {}) };
    stats.countries = { ...(stats.countries || {}) };
    return stats;
  }

  /**
   * Updates lifetime stats from a finished game.
   * @param {object} summary Result of GameEngine#summary()
   * @param {Array<{ code: string, correct: boolean }>} history
   */
  function recordGame(summary, history) {
    const stats = getStats();
    stats.games += 1;
    stats.answered += summary.answered;
    stats.correct += summary.correct;
    stats.bestStreak = Math.max(stats.bestStreak, summary.bestStreak);

    if (summary.mode !== "practice") {
      const previous = stats.bestScores[summary.mode] || 0;
      stats.bestScores[summary.mode] = Math.max(previous, summary.score);
    }

    for (const entry of history || []) {
      const bucket = stats.countries[entry.code] || { seen: 0, correct: 0 };
      bucket.seen += 1;
      if (entry.correct) bucket.correct += 1;
      stats.countries[entry.code] = bucket;
    }

    write("stats", stats);
    return stats;
  }

  function resetAll() {
    remove("settings");
    remove("scores");
    remove("stats");
  }

  return {
    DEFAULT_SETTINGS,
    isPersistent: hasLocalStorage,
    getSettings,
    saveSettings,
    getScores,
    addScore,
    clearScores,
    getStats,
    recordGame,
    resetAll
  };
})();
