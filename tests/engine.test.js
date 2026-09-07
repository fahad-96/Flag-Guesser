"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { COUNTRIES, REGIONS, CONFUSABLE_GROUPS } = require("../js/countries.js");
const {
  GameEngine,
  MODES,
  ROUNDS,
  DIFFICULTIES,
  SCORING,
  computePoints,
  buildPool,
  normaliseRounds,
  roundsLabel
} = require("../js/engine.js");

/** Small deterministic generator so tests are repeatable. */
function seededRng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeEngine(overrides) {
  return new GameEngine({
    countries: COUNTRIES,
    confusableGroups: CONFUSABLE_GROUPS,
    mode: "classic",
    difficulty: "hard",
    region: "world",
    rng: seededRng(42),
    ...overrides
  });
}

test("dataset has unique codes, valid regions and tiers", () => {
  const codes = new Set(COUNTRIES.map((country) => country.code));
  assert.equal(codes.size, COUNTRIES.length);
  assert.ok(COUNTRIES.length >= 195);

  const regionIds = new Set(REGIONS.filter((region) => region.id !== "world").map((region) => region.id));
  for (const country of COUNTRIES) {
    assert.match(country.code, /^[A-Z]{2}$/, `bad code ${country.code}`);
    assert.ok(country.name.length > 0);
    assert.ok(country.capital.length > 0);
    assert.ok(regionIds.has(country.region), `unknown region for ${country.code}`);
    assert.ok([1, 2, 3].includes(country.tier), `bad tier for ${country.code}`);
  }
});

test("every confusable code exists in the dataset", () => {
  const codes = new Set(COUNTRIES.map((country) => country.code));
  for (const group of CONFUSABLE_GROUPS) {
    assert.ok(group.length >= 2);
    for (const code of group) assert.ok(codes.has(code), `unknown confusable ${code}`);
  }
});

test("difficulty pools are non-empty and nested as expected", () => {
  const easy = buildPool(COUNTRIES, "easy", "world");
  const medium = buildPool(COUNTRIES, "medium", "world");
  const hard = buildPool(COUNTRIES, "hard", "world");
  const expert = buildPool(COUNTRIES, "expert", "world");

  assert.ok(easy.length >= 4);
  assert.ok(medium.length > easy.length);
  assert.equal(hard.length, COUNTRIES.length);
  assert.ok(expert.length > 0);
  for (const country of easy) assert.ok(medium.includes(country));

  for (const region of REGIONS) {
    const pool = buildPool(COUNTRIES, "hard", region.id);
    assert.ok(pool.length >= 4, `region ${region.id} too small`);
  }
});

test("engine rejects filters that leave fewer than four flags", () => {
  assert.throws(() => makeEngine({ difficulty: "easy", region: "Oceania" }), RangeError);
  assert.throws(() => makeEngine({ mode: "nope" }), /Unknown mode/);
});

test("questions offer four unique options including the answer", () => {
  const engine = makeEngine();
  for (let i = 0; i < 50; i++) {
    const question = engine.nextQuestion();
    const codes = question.options.map((option) => option.code);
    assert.equal(codes.length, 4);
    assert.equal(new Set(codes).size, 4);
    assert.ok(codes.includes(question.country.code));
    engine.answer(question.country.code, 1000);
  }
});

test("flags do not repeat until the pool is exhausted", () => {
  const engine = makeEngine({ mode: "practice", difficulty: "easy" });
  const seen = [];
  for (let i = 0; i < engine.poolSize; i++) {
    const question = engine.nextQuestion();
    seen.push(question.country.code);
    engine.answer(question.country.code, 500);
  }
  assert.equal(new Set(seen).size, engine.poolSize);

  const next = engine.nextQuestion();
  assert.notEqual(next.country.code, seen[seen.length - 1]);
});

test("correct answers score, build streaks and keep lives", () => {
  const engine = makeEngine();
  const first = engine.nextQuestion();
  const result = engine.answer(first.country.code, 0);

  assert.equal(result.correct, true);
  assert.equal(result.streak, 1);
  assert.equal(result.lives, 3);
  const expected = computePoints({
    elapsedMs: 0,
    streak: 1,
    hintUsed: false,
    fiftyUsed: false,
    difficultyMultiplier: DIFFICULTIES.hard.multiplier
  });
  assert.equal(result.points, expected);
  assert.equal(engine.score, expected);
});

test("wrong answers reset the streak, cost a life and end the game at zero", () => {
  const engine = makeEngine();
  engine.nextQuestion();
  engine.answer(engine.current.country.code, 100);
  assert.equal(engine.streak, 1);

  let result = null;
  for (let i = 0; i < 3; i++) {
    const question = engine.nextQuestion();
    const wrong = question.options.find((option) => option.code !== question.country.code);
    result = engine.answer(wrong.code, 100);
  }

  assert.equal(engine.streak, 0);
  assert.equal(result.lives, 0);
  assert.equal(result.gameOver, true);
  assert.equal(engine.finished, true);
  assert.equal(engine.endReason, "lives");
  assert.equal(engine.nextQuestion(), null);
});

test("classic rounds end with 'complete' after the chosen number of flags", () => {
  const engine = makeEngine({ rounds: 10 });
  assert.equal(engine.rounds, 10);

  let result = null;
  for (let i = 0; i < 10; i++) {
    const question = engine.nextQuestion();
    assert.ok(question, `question ${i + 1} should exist`);
    assert.equal(question.number, i + 1);
    result = engine.answer(question.country.code, 100);
    if (i < 9) assert.equal(result.gameOver, false);
  }

  assert.equal(result.gameOver, true);
  assert.equal(result.reason, "complete");
  assert.equal(engine.finished, true);
  assert.equal(engine.lives, 3);
  assert.equal(engine.nextQuestion(), null);
  assert.equal(engine.summary().rounds, 10);
  assert.equal(engine.summary().reason, "complete");
});

test("a single wrong answer never ends a classic round", () => {
  const engine = makeEngine({ rounds: 20 });
  const question = engine.nextQuestion();
  const wrong = question.options.find((option) => option.code !== question.country.code);
  const result = engine.answer(wrong.code, 100);
  assert.equal(result.gameOver, false);
  assert.equal(result.lives, 2);
  assert.ok(engine.nextQuestion());
});

test("losing all lives beats the round limit", () => {
  const engine = makeEngine({ rounds: 20 });
  let result = null;
  for (let i = 0; i < 3; i++) {
    const question = engine.nextQuestion();
    const wrong = question.options.find((option) => option.code !== question.country.code);
    result = engine.answer(wrong.code, 100);
  }
  assert.equal(result.gameOver, true);
  assert.equal(result.reason, "lives");
  assert.equal(engine.answered, 3);
});

test("round counts are normalised and only apply to modes with rounds", () => {
  assert.equal(normaliseRounds("10"), 10);
  assert.equal(normaliseRounds(15.7), 15);
  assert.equal(normaliseRounds(1), ROUNDS.min);
  assert.equal(normaliseRounds(9999), ROUNDS.max);
  assert.equal(normaliseRounds("abc"), null);
  assert.equal(normaliseRounds(null), null);

  assert.equal(roundsLabel(10), "Rapid 10");
  assert.equal(roundsLabel(20), "Rapid 20");
  assert.equal(roundsLabel(15), "15 flags");

  assert.equal(makeEngine({ mode: "timed", rounds: 10 }).rounds, null);
  assert.equal(makeEngine({ mode: "practice", rounds: 10 }).rounds, null);
  assert.equal(makeEngine().rounds, null);
  assert.equal(MODES.classic.questionSeconds, 30);
});

test("timeouts count as wrong answers", () => {
  const engine = makeEngine();
  engine.nextQuestion();
  const result = engine.timeout();
  assert.equal(result.correct, false);
  assert.equal(result.timedOut, true);
  assert.equal(engine.lives, 2);
  assert.equal(engine.history[0].chosen, null);
});

test("timed and practice modes never lose lives", () => {
  for (const mode of ["timed", "practice"]) {
    const engine = makeEngine({ mode });
    for (let i = 0; i < 5; i++) {
      const question = engine.nextQuestion();
      const wrong = question.options.find((option) => option.code !== question.country.code);
      const result = engine.answer(wrong.code, 100);
      assert.equal(result.gameOver, false);
      assert.equal(result.lives, null);
    }
  }
});

test("fifty fifty removes two wrong options and is limited per game", () => {
  const engine = makeEngine();
  assert.equal(engine.fiftyFiftyLeft, MODES.classic.fiftyFifty);

  const question = engine.nextQuestion();
  const removed = engine.useFiftyFifty();
  assert.equal(removed.length, 2);
  assert.ok(!removed.includes(question.country.code));
  assert.equal(engine.useFiftyFifty(), null, "cannot use twice on one question");
  assert.equal(engine.fiftyFiftyLeft, MODES.classic.fiftyFifty - 1);

  engine.answer(question.country.code, 100);
  for (let i = 0; i < MODES.classic.fiftyFifty - 1; i++) {
    const next = engine.nextQuestion();
    assert.ok(engine.useFiftyFifty());
    engine.answer(next.country.code, 100);
  }
  engine.nextQuestion();
  assert.equal(engine.useFiftyFifty(), null, "no uses left");
});

test("hints reveal the capital and halve the points", () => {
  const engine = makeEngine();
  const question = engine.nextQuestion();
  const capital = engine.useHint();
  assert.equal(capital, question.country.capital);
  assert.equal(engine.useHint(), null);

  const withHint = engine.answer(question.country.code, 0);
  const full = computePoints({
    elapsedMs: 0,
    streak: 1,
    hintUsed: false,
    fiftyUsed: false,
    difficultyMultiplier: DIFFICULTIES.hard.multiplier
  });
  assert.equal(withHint.points, Math.round(full * SCORING.hintPenalty));
});

test("points reward speed and streaks within limits", () => {
  const base = { hintUsed: false, fiftyUsed: false, difficultyMultiplier: 1 };
  const fast = computePoints({ ...base, elapsedMs: 0, streak: 1 });
  const slow = computePoints({ ...base, elapsedMs: SCORING.speedWindowMs * 2, streak: 1 });
  assert.equal(fast, Math.round((SCORING.base + SCORING.maxSpeedBonus) * 1.1));
  assert.equal(slow, Math.round(SCORING.base * 1.1));

  const capped = computePoints({ ...base, elapsedMs: 0, streak: 50 });
  const atCap = computePoints({ ...base, elapsedMs: 0, streak: SCORING.streakCap });
  assert.equal(capped, atCap);
});

test("summary reports accuracy and unique missed flags", () => {
  const engine = makeEngine({ mode: "practice" });
  const first = engine.nextQuestion();
  engine.answer(first.country.code, 100);

  const second = engine.nextQuestion();
  const wrong = second.options.find((option) => option.code !== second.country.code);
  engine.answer(wrong.code, 100);

  const summary = engine.finish("quit");
  assert.equal(summary.answered, 2);
  assert.equal(summary.correct, 1);
  assert.equal(summary.accuracy, 50);
  assert.equal(summary.missed.length, 1);
  assert.equal(summary.missed[0].code, second.country.code);
  assert.equal(summary.reason, "quit");
});

test("skip drops the question without counting it", () => {
  const engine = makeEngine();
  engine.nextQuestion();
  assert.equal(engine.skip(), true);
  assert.equal(engine.current, null);
  assert.equal(engine.answered, 0);
  assert.equal(engine.answer("US", 100), null);
});

test("same seed produces the same sequence", () => {
  const a = makeEngine({ rng: seededRng(7) });
  const b = makeEngine({ rng: seededRng(7) });
  for (let i = 0; i < 10; i++) {
    const qa = a.nextQuestion();
    const qb = b.nextQuestion();
    assert.equal(qa.country.code, qb.country.code);
    assert.deepEqual(qa.options.map((o) => o.code), qb.options.map((o) => o.code));
    a.answer(qa.country.code, 100);
    b.answer(qb.country.code, 100);
  }
});
