"use strict";

/**
 * Game engine for Flag Guesser.
 *
 * Pure game logic with no DOM or timer access. The UI layer owns the clocks
 * and calls into the engine, which keeps the rules easy to unit test.
 */

const MODES = Object.freeze({
  classic: Object.freeze({
    id: "classic",
    label: "Classic",
    tagline: "Three lives and thirty seconds per flag. Play 10, 20 or a custom number of flags.",
    lives: 3,
    questionSeconds: 30,
    questionClock: true,
    totalSeconds: null,
    fiftyFifty: 3,
    wrongPenaltySeconds: 0,
    saveScore: true,
    rounds: true
  }),
  timed: Object.freeze({
    id: "timed",
    label: "Time Attack",
    tagline: "Sixty seconds on the clock. Mistakes cost three seconds.",
    lives: null,
    questionSeconds: null,
    totalSeconds: 60,
    fiftyFifty: 2,
    wrongPenaltySeconds: 3,
    saveScore: true
  }),
  practice: Object.freeze({
    id: "practice",
    label: "Practice",
    tagline: "No lives and no clock. Learn every flag at your own pace.",
    lives: null,
    questionSeconds: null,
    totalSeconds: null,
    fiftyFifty: Infinity,
    wrongPenaltySeconds: 0,
    saveScore: false
  })
});

/** Preset round lengths for modes that support a fixed number of flags. */
const ROUNDS = Object.freeze({
  presets: Object.freeze([
    Object.freeze({ id: "10", label: "Rapid 10", count: 10 }),
    Object.freeze({ id: "20", label: "Rapid 20", count: 20 })
  ]),
  min: 5,
  max: 199,
  defaultCustom: 15
});

/**
 * Normalises a requested round count. Returns null for "no limit".
 * @param {unknown} value
 * @returns {number | null}
 */
function normaliseRounds(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return null;
  return Math.min(ROUNDS.max, Math.max(ROUNDS.min, Math.floor(count)));
}

/** Human label for a round length, e.g. "Rapid 10" or "15 flags". */
function roundsLabel(count) {
  const preset = ROUNDS.presets.find((item) => item.count === count);
  if (preset) return preset.label;
  return `${count} flags`;
}

const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ id: "easy", label: "Easy", tiers: [1], multiplier: 1 }),
  medium: Object.freeze({ id: "medium", label: "Medium", tiers: [1, 2], multiplier: 1.25 }),
  hard: Object.freeze({ id: "hard", label: "Hard", tiers: [1, 2, 3], multiplier: 1.5 }),
  expert: Object.freeze({ id: "expert", label: "Expert", tiers: [3], multiplier: 2 })
});

const SCORING = Object.freeze({
  base: 100,
  maxSpeedBonus: 50,
  speedWindowMs: 8000,
  streakStep: 0.1,
  streakCap: 10,
  hintPenalty: 0.5,
  fiftyFiftyPenalty: 0.75,
  minimum: 10
});

/**
 * Returns a shuffled copy of a list using the Fisher-Yates algorithm.
 * @template T
 * @param {ReadonlyArray<T>} list
 * @param {() => number} rng
 * @returns {T[]}
 */
function shuffle(list, rng) {
  const result = list.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Builds a lookup from a country code to the set of codes it is often
 * confused with.
 * @param {ReadonlyArray<ReadonlyArray<string>>} groups
 * @returns {Map<string, Set<string>>}
 */
function buildConfusableIndex(groups) {
  const index = new Map();
  for (const group of groups) {
    for (const code of group) {
      if (!index.has(code)) index.set(code, new Set());
      const bucket = index.get(code);
      for (const other of group) {
        if (other !== code) bucket.add(other);
      }
    }
  }
  return index;
}

/**
 * Calculates the points for a correct answer.
 * @param {{ elapsedMs: number, streak: number, hintUsed: boolean, fiftyUsed: boolean, difficultyMultiplier: number }} input
 * @returns {number}
 */
function computePoints(input) {
  const speedRatio = clamp(1 - input.elapsedMs / SCORING.speedWindowMs, 0, 1);
  const streakMultiplier = 1 + Math.min(input.streak, SCORING.streakCap) * SCORING.streakStep;

  let points = SCORING.base + SCORING.maxSpeedBonus * speedRatio;
  points *= streakMultiplier;
  points *= input.difficultyMultiplier;
  if (input.hintUsed) points *= SCORING.hintPenalty;
  if (input.fiftyUsed) points *= SCORING.fiftyFiftyPenalty;

  return Math.max(SCORING.minimum, Math.round(points));
}

/**
 * Filters the dataset by difficulty tiers and region.
 * @param {ReadonlyArray<import("./countries").Country>} countries
 * @param {string} difficultyId
 * @param {string} region
 */
function buildPool(countries, difficultyId, region) {
  const difficulty = DIFFICULTIES[difficultyId];
  if (!difficulty) return [];
  return countries.filter(
    (country) =>
      difficulty.tiers.includes(country.tier) &&
      (region === "world" || country.region === region)
  );
}

class GameEngine {
  /**
   * @param {object} options
   * @param {ReadonlyArray<import("./countries").Country>} options.countries
   * @param {string} options.mode
   * @param {string} options.difficulty
   * @param {string} [options.region]
   * @param {ReadonlyArray<ReadonlyArray<string>>} [options.confusableGroups]
   * @param {() => number} [options.rng]
   * @param {number} [options.optionCount]
   * @param {number | null} [options.rounds] Number of flags before the round ends. Only used by modes with rounds.
   */
  constructor(options) {
    const opts = options || {};
    const mode = MODES[opts.mode];
    const difficulty = DIFFICULTIES[opts.difficulty];
    if (!mode) throw new Error(`Unknown mode: ${opts.mode}`);
    if (!difficulty) throw new Error(`Unknown difficulty: ${opts.difficulty}`);

    this.mode = mode;
    this.difficulty = difficulty;
    this.region = opts.region || "world";
    this.rounds = mode.rounds ? normaliseRounds(opts.rounds) : null;
    this.rng = typeof opts.rng === "function" ? opts.rng : Math.random;
    this.optionCount = opts.optionCount || 4;

    const countries = opts.countries || [];
    this.byCode = new Map(countries.map((country) => [country.code, country]));
    this.confusables = buildConfusableIndex(opts.confusableGroups || []);
    this.pool = buildPool(countries, difficulty.id, this.region);

    if (this.pool.length < this.optionCount) {
      throw new RangeError("Not enough flags match those filters. Try a wider region or difficulty.");
    }

    this.queue = shuffle(this.pool, this.rng);
    this.queueIndex = 0;

    this.score = 0;
    this.lives = mode.lives;
    this.streak = 0;
    this.bestStreak = 0;
    this.answered = 0;
    this.correct = 0;
    this.fiftyFiftyLeft = mode.fiftyFifty;
    this.history = [];
    this.current = null;
    this.finished = false;
    this.endReason = null;
    this.startedAt = null;
    this.endedAt = null;
  }

  /** Number of flags in the active pool. */
  get poolSize() {
    return this.pool.length;
  }

  /** Marks the start of play. Safe to call more than once. */
  start(now) {
    if (this.startedAt === null) this.startedAt = typeof now === "number" ? now : Date.now();
  }

  /** The country that the next call to nextQuestion() will use, if known. */
  peekNextCountry() {
    if (this.queueIndex < this.queue.length) return this.queue[this.queueIndex];
    return null;
  }

  /**
   * Produces the next question. Flags do not repeat until every flag in the
   * pool has been shown once.
   */
  nextQuestion() {
    if (this.finished) return null;
    this.start();

    if (this.queueIndex >= this.queue.length) {
      const last = this.current ? this.current.country : null;
      this.queue = shuffle(this.pool, this.rng);
      this.queueIndex = 0;
      if (last && this.queue.length > 1 && this.queue[0] === last) {
        const swap = 1 + Math.floor(this.rng() * (this.queue.length - 1));
        [this.queue[0], this.queue[swap]] = [this.queue[swap], this.queue[0]];
      }
    }

    const country = this.queue[this.queueIndex];
    this.queueIndex += 1;

    this.current = {
      number: this.answered + 1,
      country,
      options: this.buildOptions(country),
      answered: false,
      hintUsed: false,
      fiftyUsed: false,
      removed: []
    };
    return this.current;
  }

  /**
   * Chooses answer options for a target country. Confusable flags come first,
   * then flags from the same region, then anything else in the pool.
   * @param {import("./countries").Country} target
   */
  buildOptions(target) {
    const picks = [];
    const used = new Set([target.code]);
    const needed = this.optionCount - 1;

    const take = (candidates, limit) => {
      for (const candidate of candidates) {
        if (picks.length >= Math.min(needed, limit)) break;
        if (used.has(candidate.code)) continue;
        picks.push(candidate);
        used.add(candidate.code);
      }
    };

    const confusableCodes = Array.from(this.confusables.get(target.code) || []);
    const confusables = shuffle(confusableCodes, this.rng)
      .map((code) => this.byCode.get(code))
      .filter((country) => country && this.pool.includes(country));
    take(confusables, 2);

    const sameRegion = this.pool.filter((country) => country.region === target.region);
    take(shuffle(sameRegion, this.rng), needed);
    take(shuffle(this.pool, this.rng), needed);

    return shuffle([target, ...picks], this.rng);
  }

  /** Reveals the capital for the current flag. Returns null if unavailable. */
  useHint() {
    const question = this.current;
    if (!question || question.answered || question.hintUsed || this.finished) return null;
    question.hintUsed = true;
    return question.country.capital;
  }

  /** Removes two wrong options. Returns the removed codes or null. */
  useFiftyFifty() {
    const question = this.current;
    if (!question || question.answered || question.fiftyUsed || this.finished) return null;
    if (this.fiftyFiftyLeft <= 0) return null;

    const wrong = question.options.filter((option) => option.code !== question.country.code);
    const removed = shuffle(wrong, this.rng)
      .slice(0, 2)
      .map((option) => option.code);

    question.fiftyUsed = true;
    question.removed = removed;
    if (Number.isFinite(this.fiftyFiftyLeft)) this.fiftyFiftyLeft -= 1;
    return removed;
  }

  /**
   * Submits an answer for the current question.
   * @param {string | null} code Chosen country code, or null for a timeout.
   * @param {number} elapsedMs Time taken to answer.
   */
  answer(code, elapsedMs) {
    const question = this.current;
    if (!question || question.answered || this.finished) return null;

    question.answered = true;
    const correct = code === question.country.code;
    const timedOut = code === null;
    this.answered += 1;

    let points = 0;
    if (correct) {
      this.correct += 1;
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      points = computePoints({
        elapsedMs: Math.max(0, elapsedMs || 0),
        streak: this.streak,
        hintUsed: question.hintUsed,
        fiftyUsed: question.fiftyUsed,
        difficultyMultiplier: this.difficulty.multiplier
      });
      this.score += points;
    } else {
      this.streak = 0;
      if (this.lives !== null) this.lives = Math.max(0, this.lives - 1);
    }

    this.history.push({
      code: question.country.code,
      chosen: code,
      correct,
      timedOut,
      points,
      elapsedMs,
      hintUsed: question.hintUsed,
      fiftyUsed: question.fiftyUsed
    });

    const outOfLives = this.lives !== null && this.lives <= 0;
    const complete = this.rounds !== null && this.answered >= this.rounds;
    if (outOfLives) this.finish("lives");
    else if (complete) this.finish("complete");
    const gameOver = outOfLives || complete;

    return {
      correct,
      timedOut,
      points,
      score: this.score,
      streak: this.streak,
      lives: this.lives,
      gameOver,
      reason: gameOver ? this.endReason : null,
      country: question.country,
      chosen: code === null ? null : this.byCode.get(code) || null
    };
  }

  /** Treats the current question as unanswered when the clock runs out. */
  timeout() {
    const seconds = this.mode.questionSeconds || 0;
    return this.answer(null, seconds * 1000);
  }

  /** Drops the current question without counting it (used when a flag fails to load). */
  skip() {
    if (!this.current || this.current.answered) return false;
    this.current = null;
    return true;
  }

  /**
   * Ends the game.
   * @param {string} reason One of "lives", "time", "quit", "complete".
   */
  finish(reason) {
    if (!this.finished) {
      this.finished = true;
      this.endReason = reason || "quit";
      this.endedAt = Date.now();
      if (this.startedAt === null) this.startedAt = this.endedAt;
    }
    return this.summary();
  }

  /** A plain object describing the finished (or in-progress) game. */
  summary() {
    const missedCodes = [];
    const seen = new Set();
    for (const entry of this.history) {
      if (!entry.correct && !seen.has(entry.code)) {
        seen.add(entry.code);
        missedCodes.push(entry.code);
      }
    }

    const endedAt = this.endedAt || Date.now();
    const startedAt = this.startedAt || endedAt;

    return {
      mode: this.mode.id,
      difficulty: this.difficulty.id,
      region: this.region,
      rounds: this.rounds,
      score: this.score,
      answered: this.answered,
      correct: this.correct,
      wrong: this.answered - this.correct,
      accuracy: this.answered ? Math.round((this.correct / this.answered) * 100) : 0,
      bestStreak: this.bestStreak,
      missed: missedCodes.map((code) => this.byCode.get(code)).filter(Boolean),
      durationMs: Math.max(0, endedAt - startedAt),
      reason: this.endReason,
      poolSize: this.pool.length,
      finishedAt: endedAt
    };
  }
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    GameEngine,
    MODES,
    ROUNDS,
    DIFFICULTIES,
    SCORING,
    computePoints,
    buildPool,
    shuffle,
    normaliseRounds,
    roundsLabel
  };
}
