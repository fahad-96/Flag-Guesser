"use strict";

/**
 * UI controller for Flag Guesser.
 *
 * Owns the DOM, clocks and screen transitions. All rules live in engine.js.
 */
(() => {
  const FLAG_BASE = "https://flagcdn.com";
  const ADVANCE_AFTER_CORRECT_MS = 900;
  const ADVANCE_AFTER_WRONG_MS = 1600;
  const GAME_OVER_DELAY_MS = 1200;
  const TOAST_MS = 2600;

  const REASON_LABELS = {
    lives: "Out of lives",
    time: "Time is up",
    quit: "Round ended",
    complete: "Round complete"
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const dom = {
    screens: $$(".screen"),
    setupForm: $("#setup-form"),
    regionSelect: $("#region-select"),
    roundsPanel: $("[data-rounds-panel]"),
    customRoundsWrap: $("[data-custom-rounds]"),
    customRoundsInput: $("#custom-rounds"),
    poolHint: $("#pool-hint"),
    startButton: $("#start-button"),
    homeStats: {
      games: $('[data-stat="games"]'),
      bestClassic: $('[data-stat="bestClassic"]'),
      bestTimed: $('[data-stat="bestTimed"]'),
      accuracy: $('[data-stat="accuracy"]')
    },
    hud: {
      mode: $('[data-hud="mode"]'),
      sub: $('[data-hud="sub"]'),
      score: $('[data-hud="score"]'),
      streak: $('[data-hud="streak"]'),
      livesWrap: $('[data-hud="lives-wrap"]'),
      lives: $('[data-hud="lives"]'),
      clockWrap: $('[data-hud="clock-wrap"]'),
      clock: $('[data-hud="clock"]'),
      progressWrap: $('[data-hud="progress-wrap"]'),
      progress: $('[data-hud="progress"]'),
      timer: $('[data-hud="timer"]'),
      timerFill: $('[data-hud="timer-fill"]'),
      fiftyLeft: $('[data-hud="fifty-left"]')
    },
    quizPrompt: $(".quiz__prompt"),
    flagCard: $('[data-flag="card"]'),
    flagImg: $('[data-flag="img"]'),
    flagFallback: $('[data-flag="fallback"]'),
    flagHint: $('[data-flag="hint"]'),
    options: $$(".option"),
    hintButton: $('[data-action="hint"]'),
    fiftyButton: $('[data-action="fifty"]'),
    feedback: $("[data-feedback]"),
    nextButton: $('[data-action="next"]'),
    result: {
      reason: $('[data-result="reason"]'),
      score: $('[data-result="score"]'),
      setup: $('[data-result="setup"]'),
      badge: $('[data-result="badge"]'),
      answered: $('[data-result="answered"]'),
      correct: $('[data-result="correct"]'),
      accuracy: $('[data-result="accuracy"]'),
      streak: $('[data-result="streak"]'),
      time: $('[data-result="time"]'),
      missed: $('[data-result="missed"]'),
      missedEmpty: $('[data-result="missed-empty"]')
    },
    boardTabs: $$("[data-board]"),
    boardPanel: $("#board-panel"),
    boardBody: $("[data-board-body]"),
    boardEmpty: $("[data-board-empty]"),
    pauseDialog: $("#pause-dialog"),
    settingsDialog: $("#settings-dialog"),
    settingsForm: $("#settings-form"),
    helpDialog: $("#help-dialog"),
    confirmDialog: $("#confirm-dialog"),
    confirmTitle: $('[data-confirm="title"]'),
    confirmMessage: $('[data-confirm="message"]'),
    confirmOk: $('[data-confirm="ok"]'),
    toast: $("[data-toast]"),
    themeMeta: $('meta[name="theme-color"]')
  };

  const state = {
    settings: Storage.getSettings(),
    screen: "home",
    engine: null,
    question: null,
    lastSetup: null,
    questionStartedAt: 0,
    questionDeadline: 0,
    questionTiming: false,
    globalDeadline: 0,
    paused: false,
    pausedAt: 0,
    rafId: 0,
    advanceTimer: 0,
    advancePending: false,
    lastTickSecond: null,
    flagFormat: "svg",
    lastSummary: null,
    lastScoreId: null,
    boardMode: "classic",
    toastTimer: 0
  };

  const numberFormat = new Intl.NumberFormat();
  const dateFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

  /* Helpers --------------------------------------------------------------- */

  function flagUrl(code, format) {
    const lower = code.toLowerCase();
    if (format === "png") return `${FLAG_BASE}/w640/${lower}.png`;
    if (format === "thumb") return `${FLAG_BASE}/w80/${lower}.png`;
    return `${FLAG_BASE}/${lower}.svg`;
  }

  function preloadFlag(country) {
    if (!country) return;
    const image = new Image();
    image.decoding = "async";
    image.src = flagUrl(country.code, "svg");
  }

  function formatNumber(value) {
    return numberFormat.format(value || 0);
  }

  function formatDuration(ms) {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  function regionLabel(regionId) {
    const region = REGIONS.find((item) => item.id === regionId);
    return region ? region.label : regionId;
  }

  function modeLabel(modeId, rounds) {
    const mode = MODES[modeId] ? MODES[modeId].label : modeId;
    return Number.isFinite(rounds) && rounds ? `${mode} · ${roundsLabel(rounds)}` : mode;
  }

  function setupLabel(modeId, difficultyId, regionId, rounds) {
    const difficulty = DIFFICULTIES[difficultyId] ? DIFFICULTIES[difficultyId].label : difficultyId;
    return `${modeLabel(modeId, rounds)} · ${difficulty} · ${regionLabel(regionId)}`;
  }

  function bump(element) {
    element.classList.remove("is-bump");
    void element.offsetWidth;
    element.classList.add("is-bump");
  }

  function toast(message, kind) {
    clearTimeout(state.toastTimer);
    dom.toast.textContent = message;
    dom.toast.dataset.kind = kind || "info";
    dom.toast.hidden = false;
    requestAnimationFrame(() => dom.toast.classList.add("is-visible"));
    state.toastTimer = setTimeout(() => {
      dom.toast.classList.remove("is-visible");
      state.toastTimer = setTimeout(() => {
        dom.toast.hidden = true;
      }, 300);
    }, TOAST_MS);
  }

  /**
   * Shows a confirmation dialog and resolves with the user's choice.
   * @returns {Promise<boolean>}
   */
  function confirmDialog(title, message, okLabel) {
    return new Promise((resolve) => {
      dom.confirmTitle.textContent = title;
      dom.confirmMessage.textContent = message;
      dom.confirmOk.textContent = okLabel || "Confirm";
      dom.confirmDialog.returnValue = "";
      const onClose = () => {
        dom.confirmDialog.removeEventListener("close", onClose);
        resolve(dom.confirmDialog.returnValue === "ok");
      };
      dom.confirmDialog.addEventListener("close", onClose);
      dom.confirmDialog.showModal();
    });
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = theme;

    if (dom.themeMeta) {
      const background = getComputedStyle(root).getPropertyValue("--bg").trim();
      if (background) dom.themeMeta.setAttribute("content", background);
    }
  }

  function showScreen(name, options) {
    const opts = options || {};
    state.screen = name;
    let active = null;
    for (const screen of dom.screens) {
      const match = screen.dataset.screen === name;
      screen.hidden = !match;
      if (match) active = screen;
    }
    document.body.dataset.screen = name;
    window.scrollTo({ top: 0, behavior: "auto" });

    if (active && opts.focus !== false) {
      const heading = $("h1, h2", active);
      if (heading) heading.focus({ preventScroll: true });
    }
  }

  function gameIsActive() {
    return Boolean(state.engine && !state.engine.finished);
  }

  /* Home ------------------------------------------------------------------ */

  function populateRegions() {
    dom.regionSelect.innerHTML = "";
    for (const region of REGIONS) {
      const option = document.createElement("option");
      option.value = region.id;
      option.textContent = region.label;
      dom.regionSelect.append(option);
    }
  }

  function readSetup() {
    const form = dom.setupForm;
    const mode = form.elements.mode.value;
    const roundsChoice = form.elements.rounds.value;
    const customRounds = normaliseRounds(dom.customRoundsInput.value) || ROUNDS.defaultCustom;

    let rounds = null;
    if (MODES[mode] && MODES[mode].rounds) {
      rounds = roundsChoice === "custom" ? customRounds : normaliseRounds(roundsChoice);
    }

    return {
      mode,
      difficulty: form.elements.difficulty.value,
      region: form.elements.region.value,
      rounds,
      roundsChoice,
      customRounds
    };
  }

  function restoreSetup() {
    const { lastMode, lastDifficulty, lastRegion, lastRounds, lastCustomRounds } = state.settings;
    const form = dom.setupForm;
    const modeInput = form.querySelector(`input[name="mode"][value="${lastMode}"]`);
    const difficultyInput = form.querySelector(`input[name="difficulty"][value="${lastDifficulty}"]`);
    const roundsInput = form.querySelector(`input[name="rounds"][value="${lastRounds}"]`);
    if (modeInput) modeInput.checked = true;
    if (difficultyInput) difficultyInput.checked = true;
    if (roundsInput) roundsInput.checked = true;
    dom.customRoundsInput.value = String(normaliseRounds(lastCustomRounds) || ROUNDS.defaultCustom);
    if (REGIONS.some((region) => region.id === lastRegion)) dom.regionSelect.value = lastRegion;
    syncRoundsPanel();
  }

  /** Shows the round-length picker only for modes that use it. */
  function syncRoundsPanel() {
    const setup = readSetup();
    const supportsRounds = Boolean(MODES[setup.mode] && MODES[setup.mode].rounds);
    dom.roundsPanel.hidden = !supportsRounds;
    dom.customRoundsWrap.hidden = !supportsRounds || setup.roundsChoice !== "custom";
  }

  function updatePoolHint() {
    syncRoundsPanel();
    const setup = readSetup();
    const size = buildPool(COUNTRIES, setup.difficulty, setup.region).length;
    const tooSmall = size < 4;

    let hint = `${size} flags in this set`;
    if (!tooSmall && setup.rounds) {
      hint = `${roundsLabel(setup.rounds)} from ${size} flags`;
    }

    dom.poolHint.textContent = tooSmall ? "Not enough flags in this set. Widen the region or difficulty." : hint;
    dom.poolHint.classList.toggle("is-warning", tooSmall);
    dom.startButton.disabled = tooSmall;
  }

  function renderHomeStats() {
    const stats = Storage.getStats();
    dom.homeStats.games.textContent = formatNumber(stats.games);
    dom.homeStats.bestClassic.textContent = formatNumber(stats.bestScores.classic || 0);
    dom.homeStats.bestTimed.textContent = formatNumber(stats.bestScores.timed || 0);
    const accuracy = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0;
    dom.homeStats.accuracy.textContent = `${accuracy}%`;
  }

  /* Game lifecycle -------------------------------------------------------- */

  function startGame(setup) {
    let engine;
    try {
      engine = new GameEngine({
        countries: COUNTRIES,
        confusableGroups: CONFUSABLE_GROUPS,
        mode: setup.mode,
        difficulty: setup.difficulty,
        region: setup.region,
        rounds: setup.rounds
      });
    } catch (error) {
      toast(error.message || "Could not start the game.", "error");
      return;
    }

    abandonGame();
    state.engine = engine;
    state.lastSetup = { ...setup };
    state.settings = Storage.saveSettings({
      lastMode: setup.mode,
      lastDifficulty: setup.difficulty,
      lastRegion: setup.region,
      lastRounds: setup.roundsChoice || state.settings.lastRounds,
      lastCustomRounds: setup.customRounds || state.settings.lastCustomRounds
    });

    renderHudChrome();
    showScreen("game", { focus: false });
    engine.start();

    if (engine.mode.totalSeconds) {
      state.globalDeadline = performance.now() + engine.mode.totalSeconds * 1000;
      renderClock(engine.mode.totalSeconds * 1000);
    }

    nextQuestion();
    startLoop();
  }

  function abandonGame() {
    cancelAnimationFrame(state.rafId);
    clearTimeout(state.advanceTimer);
    state.rafId = 0;
    state.advanceTimer = 0;
    state.advancePending = false;
    state.engine = null;
    state.question = null;
    state.paused = false;
    state.questionTiming = false;
  }

  function endGame(reason) {
    const engine = state.engine;
    if (!engine) return;

    cancelAnimationFrame(state.rafId);
    clearTimeout(state.advanceTimer);
    state.rafId = 0;
    state.advancePending = false;
    state.paused = false;
    state.questionTiming = false;

    const summary = engine.finish(reason);
    state.lastSummary = summary;
    state.question = null;

    Storage.recordGame(summary, engine.history);

    let rank = null;
    if (engine.mode.saveScore && summary.score > 0) {
      rank = Storage.addScore({
        name: state.settings.playerName,
        score: summary.score,
        mode: summary.mode,
        difficulty: summary.difficulty,
        region: summary.region,
        rounds: summary.rounds,
        accuracy: summary.accuracy,
        bestStreak: summary.bestStreak,
        answered: summary.answered
      });
      state.lastScoreId = rank.id;
    }

    renderResults(summary, rank);
    renderHomeStats();
    showScreen("results");
    Sfx.play(rank && rank.isBest ? "highscore" : "over");
  }

  function pauseGame() {
    if (!gameIsActive() || state.paused) return;
    state.paused = true;
    state.pausedAt = performance.now();
    clearTimeout(state.advanceTimer);
    dom.pauseDialog.returnValue = "";
    dom.pauseDialog.showModal();
  }

  function resumeGame() {
    if (!state.paused) return;
    const delta = performance.now() - state.pausedAt;
    state.questionStartedAt += delta;
    state.questionDeadline += delta;
    state.globalDeadline += delta;
    state.paused = false;

    if (!gameIsActive()) return;
    if (state.advancePending) scheduleAdvance(400);
  }

  /* Questions ------------------------------------------------------------- */

  function nextQuestion() {
    clearTimeout(state.advanceTimer);
    state.advancePending = false;
    const engine = state.engine;
    if (!engine || engine.finished) return;

    const question = engine.nextQuestion();
    if (!question) return;
    state.question = question;
    renderQuestion(question);
    preloadFlag(engine.peekNextCountry());
  }

  function renderQuestion(question) {
    const { country, options } = question;

    state.questionTiming = false;
    state.flagFormat = "svg";
    dom.flagCard.classList.add("is-loading");
    dom.flagFallback.hidden = true;
    dom.flagImg.hidden = false;
    dom.flagImg.src = flagUrl(country.code, "svg");
    dom.flagHint.hidden = true;
    dom.flagHint.textContent = "";

    dom.options.forEach((button, index) => {
      const option = options[index];
      button.dataset.code = option ? option.code : "";
      $(".option__text", button).textContent = option ? option.name : "";
      button.disabled = true;
      button.classList.remove("is-correct", "is-wrong", "is-removed");
    });

    dom.feedback.textContent = "";
    dom.feedback.className = "feedback";
    dom.nextButton.hidden = true;
    renderQuestionTimer(1);
    if (state.engine.mode.questionClock) renderClock(state.engine.mode.questionSeconds * 1000);
    updateLifelines();
    renderHud();
  }

  function onFlagLoaded() {
    if (!state.question || state.question.answered) return;
    dom.flagCard.classList.remove("is-loading");
    dom.options.forEach((button) => {
      button.disabled = button.classList.contains("is-removed");
    });
    beginQuestionClock();
  }

  function onFlagError() {
    if (!state.question) return;
    if (state.flagFormat === "svg") {
      state.flagFormat = "png";
      dom.flagImg.src = flagUrl(state.question.country.code, "png");
      return;
    }
    dom.flagCard.classList.remove("is-loading");
    dom.flagImg.hidden = true;
    dom.flagFallback.hidden = false;
  }

  function beginQuestionClock() {
    if (state.questionTiming) return;
    const engine = state.engine;
    const now = performance.now();
    state.questionStartedAt = now;
    state.questionTiming = true;
    state.lastTickSecond = null;
    if (engine.mode.questionSeconds) {
      state.questionDeadline = now + engine.mode.questionSeconds * 1000;
    }
  }

  function selectAnswer(code) {
    const engine = state.engine;
    const question = state.question;
    if (!engine || !question || question.answered || state.paused || !state.questionTiming) return;

    const elapsed = performance.now() - state.questionStartedAt;
    const result = engine.answer(code, elapsed);
    if (result) presentResult(result);
  }

  function presentResult(result) {
    const engine = state.engine;
    state.questionTiming = false;

    dom.options.forEach((button) => {
      button.disabled = true;
      if (button.dataset.code === result.country.code) button.classList.add("is-correct");
      else if (result.chosen && button.dataset.code === result.chosen.code) button.classList.add("is-wrong");
    });

    if (result.correct) {
      let message = `Correct! +${formatNumber(result.points)} points`;
      if (result.streak >= 3) message += ` with a ${result.streak} streak`;
      dom.feedback.textContent = message;
      dom.feedback.className = "feedback is-good";
      bump(dom.hud.score);
      Sfx.play("correct");
    } else {
      dom.feedback.textContent = result.timedOut
        ? `Time is up. That was ${result.country.name}.`
        : `Not quite. That was ${result.country.name}.`;
      dom.feedback.className = "feedback is-bad";
      Sfx.play("wrong");

      if (engine.mode.wrongPenaltySeconds) {
        state.globalDeadline -= engine.mode.wrongPenaltySeconds * 1000;
        dom.hud.clock.classList.remove("is-hit");
        void dom.hud.clock.offsetWidth;
        dom.hud.clock.classList.add("is-hit");
      }
    }

    renderHud();

    if (result.gameOver) {
      const reason = result.reason || engine.endReason || "lives";
      dom.nextButton.hidden = true;
      clearTimeout(state.advanceTimer);
      state.advanceTimer = setTimeout(() => endGame(reason), GAME_OVER_DELAY_MS);
      return;
    }

    // Every answer moves on by itself. The Next button only skips the wait.
    dom.nextButton.hidden = false;
    scheduleAdvance(result.correct ? ADVANCE_AFTER_CORRECT_MS : ADVANCE_AFTER_WRONG_MS);
  }

  function scheduleAdvance(delay) {
    clearTimeout(state.advanceTimer);
    state.advancePending = true;
    state.advanceTimer = setTimeout(advance, delay);
  }

  function advance() {
    clearTimeout(state.advanceTimer);
    state.advancePending = false;
    if (!gameIsActive() || state.paused) return;
    if (state.question && !state.question.answered) return;
    nextQuestion();
  }

  /* Rendering ------------------------------------------------------------- */

  function renderHudChrome() {
    const { mode, difficulty, region, rounds } = state.engine;
    dom.hud.mode.textContent = modeLabel(mode.id, rounds);
    dom.hud.sub.textContent = `${difficulty.label} · ${regionLabel(region)}`;
    dom.hud.livesWrap.hidden = mode.lives === null;
    dom.hud.clockWrap.hidden = !(mode.totalSeconds || mode.questionClock);
    dom.hud.progressWrap.hidden = !(mode.id === "practice" || rounds);
    dom.hud.timer.hidden = !mode.questionSeconds || Boolean(mode.questionClock);
    dom.hud.clock.classList.remove("is-low", "is-hit");
  }

  function renderHud() {
    const engine = state.engine;
    if (!engine) return;

    dom.hud.score.textContent = formatNumber(engine.score);
    dom.hud.streak.textContent = String(engine.streak);

    if (engine.mode.lives !== null) {
      dom.hud.lives.innerHTML = "";
      for (let i = 0; i < engine.mode.lives; i++) {
        const heart = document.createElement("span");
        heart.className = "heart";
        if (i >= engine.lives) heart.classList.add("is-lost");
        dom.hud.lives.append(heart);
      }
      dom.hud.lives.setAttribute("aria-label", `${engine.lives} of ${engine.mode.lives} lives left`);
    }

    if (engine.mode.id === "practice" || engine.rounds) {
      const number = state.question ? state.question.number : engine.answered;
      dom.hud.progress.textContent = `${number} / ${engine.rounds || engine.poolSize}`;
    }

    updateLifelines();
  }

  function updateLifelines() {
    const engine = state.engine;
    const question = state.question;
    const active = Boolean(engine && question && !question.answered && !engine.finished);

    dom.hintButton.disabled = !active || question.hintUsed;
    const fiftyLeft = engine ? engine.fiftyFiftyLeft : 0;
    dom.fiftyButton.disabled = !active || question.fiftyUsed || fiftyLeft <= 0;
    dom.hud.fiftyLeft.textContent = Number.isFinite(fiftyLeft) ? String(fiftyLeft) : "∞";
  }

  function renderQuestionTimer(ratio) {
    const clamped = Math.max(0, Math.min(1, ratio));
    dom.hud.timerFill.style.transform = `scaleX(${clamped})`;
    dom.hud.timer.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
    dom.hud.timer.classList.toggle("is-low", clamped < 0.25);
  }

  function renderClock(leftMs) {
    const seconds = Math.ceil(leftMs / 1000);
    dom.hud.clock.textContent = String(seconds);
    dom.hud.clock.classList.toggle("is-low", seconds <= 10);
  }

  /* Main loop ------------------------------------------------------------- */

  function startLoop() {
    cancelAnimationFrame(state.rafId);
    const loop = () => {
      state.rafId = requestAnimationFrame(loop);
      tick();
    };
    state.rafId = requestAnimationFrame(loop);
  }

  function tick() {
    const engine = state.engine;
    if (!engine || engine.finished || state.paused) return;
    const now = performance.now();

    if (engine.mode.totalSeconds) {
      const left = Math.max(0, state.globalDeadline - now);
      renderClock(left);
      if (left <= 0) {
        endGame("time");
        return;
      }
    }

    const question = state.question;
    if (engine.mode.questionSeconds && question && !question.answered && state.questionTiming) {
      const total = engine.mode.questionSeconds * 1000;
      const left = Math.max(0, state.questionDeadline - now);
      if (engine.mode.questionClock) renderClock(left);
      else renderQuestionTimer(left / total);

      const secondsLeft = Math.ceil(left / 1000);
      if (left > 0 && secondsLeft <= 3 && secondsLeft !== state.lastTickSecond) {
        state.lastTickSecond = secondsLeft;
        Sfx.play("tick");
      }

      if (left <= 0) {
        const result = engine.timeout();
        if (result) presentResult(result);
      }
    }
  }

  /* Results --------------------------------------------------------------- */

  function renderResults(summary, rank) {
    const mode = MODES[summary.mode];
    dom.result.reason.textContent = REASON_LABELS[summary.reason] || "Round ended";
    dom.result.score.textContent = formatNumber(summary.score);
    dom.result.setup.textContent = setupLabel(summary.mode, summary.difficulty, summary.region, summary.rounds);

    if (rank && rank.isBest) {
      dom.result.badge.textContent = "New personal best!";
      dom.result.badge.hidden = false;
    } else if (rank) {
      dom.result.badge.textContent = `#${rank.rank} on the ${mode.label} board`;
      dom.result.badge.hidden = false;
    } else if (!mode.saveScore) {
      dom.result.badge.textContent = "Practice rounds are not ranked";
      dom.result.badge.hidden = false;
    } else {
      dom.result.badge.hidden = true;
    }

    dom.result.answered.textContent = formatNumber(summary.answered);
    dom.result.correct.textContent = formatNumber(summary.correct);
    dom.result.accuracy.textContent = `${summary.accuracy}%`;
    dom.result.streak.textContent = formatNumber(summary.bestStreak);
    dom.result.time.textContent = formatDuration(summary.durationMs);

    dom.result.missed.innerHTML = "";
    const hasMissed = summary.missed.length > 0;
    dom.result.missedEmpty.hidden = hasMissed;
    dom.result.missed.hidden = !hasMissed;

    for (const country of summary.missed) {
      const item = document.createElement("li");
      item.className = "missed__item";

      const image = document.createElement("img");
      image.className = "missed__flag";
      image.src = flagUrl(country.code, "thumb");
      image.alt = "";
      image.width = 48;
      image.height = 32;
      image.loading = "lazy";
      image.decoding = "async";

      const text = document.createElement("span");
      const name = document.createElement("span");
      name.className = "missed__name";
      name.textContent = country.name;
      const capital = document.createElement("span");
      capital.className = "missed__capital";
      capital.textContent = `Capital: ${country.capital}`;
      text.append(name, capital);

      item.append(image, text);
      dom.result.missed.append(item);
    }
  }

  async function shareScore() {
    const summary = state.lastSummary;
    if (!summary) return;

    const text =
      `I scored ${formatNumber(summary.score)} in Flag Guesser ` +
      `(${setupLabel(summary.mode, summary.difficulty, summary.region, summary.rounds)}) ` +
      `with ${summary.accuracy}% accuracy and a best streak of ${summary.bestStreak}. Can you beat it?`;
    const url = window.location.href.split("#")[0];

    if (navigator.share) {
      try {
        await navigator.share({ title: "Flag Guesser", text, url });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast("Score copied to clipboard");
    } catch {
      toast("Sharing is not available in this browser", "error");
    }
  }

  /* Leaderboard ----------------------------------------------------------- */

  function renderLeaderboard(modeId) {
    state.boardMode = modeId || state.boardMode;
    for (const tab of dom.boardTabs) {
      const selected = tab.dataset.board === state.boardMode;
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) dom.boardPanel.setAttribute("aria-labelledby", tab.id);
    }

    const scores = Storage.getScores(state.boardMode).slice(0, 10);
    dom.boardBody.innerHTML = "";
    dom.boardEmpty.hidden = scores.length > 0;
    dom.boardBody.parentElement.parentElement.hidden = scores.length === 0;

    scores.forEach((entry, index) => {
      const row = document.createElement("tr");
      if (entry.id === state.lastScoreId) row.classList.add("is-you");

      const rank = document.createElement("td");
      const rankBadge = document.createElement("span");
      rankBadge.className = "board__rank";
      if (index === 0) rankBadge.classList.add("is-gold");
      rankBadge.textContent = String(index + 1);
      rank.append(rankBadge);

      const difficultyName = DIFFICULTIES[entry.difficulty] ? DIFFICULTIES[entry.difficulty].label : entry.difficulty;
      const setupParts = [difficultyName, regionLabel(entry.region)];
      if (Number.isFinite(entry.rounds) && entry.rounds) setupParts.unshift(roundsLabel(entry.rounds));

      const cells = [
        entry.name,
        formatNumber(entry.score),
        `${entry.accuracy}%`,
        String(entry.bestStreak),
        setupParts.join(" · "),
        dateFormat.format(new Date(entry.date))
      ];

      row.append(rank);
      for (const value of cells) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      dom.boardBody.append(row);
    });
  }

  /* Settings -------------------------------------------------------------- */

  function openSettings() {
    const form = dom.settingsForm;
    form.elements.playerName.value = state.settings.playerName;
    form.elements.sound.checked = state.settings.sound;
    form.elements.theme.value = state.settings.theme;
    dom.settingsDialog.showModal();
  }

  function saveSettingsFromForm() {
    const form = dom.settingsForm;
    state.settings = Storage.saveSettings({
      playerName: form.elements.playerName.value,
      sound: form.elements.sound.checked,
      theme: form.elements.theme.value
    });
    applyTheme(state.settings.theme);
    Sfx.setEnabled(state.settings.sound);
    toast("Settings saved");
  }

  /* Actions --------------------------------------------------------------- */

  const actions = {
    async home() {
      if (gameIsActive()) {
        if (state.screen === "game" && !state.paused) {
          pauseGame();
          return;
        }
        const leave = await confirmDialog("Leave this round?", "Your progress will be lost.", "Leave");
        if (!leave) return;
        abandonGame();
      }
      renderHomeStats();
      updatePoolHint();
      showScreen("home");
    },
    leaderboard() {
      if (gameIsActive() && state.screen === "game") {
        pauseGame();
        return;
      }
      renderLeaderboard();
      showScreen("leaderboard");
    },
    help() {
      if (gameIsActive() && state.screen === "game" && !state.paused) pauseGame();
      dom.helpDialog.showModal();
    },
    settings() {
      if (gameIsActive() && state.screen === "game" && !state.paused) pauseGame();
      openSettings();
    },
    pause() {
      pauseGame();
    },
    resume() {
      dom.pauseDialog.close("resume");
    },
    restart() {
      dom.pauseDialog.close("restart");
    },
    "end-game"() {
      dom.pauseDialog.close("end");
    },
    quit() {
      dom.pauseDialog.close("quit");
    },
    next() {
      advance();
    },
    hint() {
      const engine = state.engine;
      if (!engine || !state.questionTiming) return;
      const capital = engine.useHint();
      if (!capital) return;
      dom.flagHint.textContent = `Capital: ${capital}`;
      dom.flagHint.hidden = false;
      updateLifelines();
      Sfx.play("click");
    },
    fifty() {
      const engine = state.engine;
      if (!engine || !state.questionTiming) return;
      const removed = engine.useFiftyFifty();
      if (!removed) return;
      for (const button of dom.options) {
        if (removed.includes(button.dataset.code)) {
          button.classList.add("is-removed");
          button.disabled = true;
        }
      }
      updateLifelines();
      Sfx.play("click");
    },
    "retry-flag"() {
      if (!state.question) return;
      state.flagFormat = "svg";
      dom.flagFallback.hidden = true;
      dom.flagImg.hidden = false;
      dom.flagCard.classList.add("is-loading");
      dom.flagImg.src = `${flagUrl(state.question.country.code, "svg")}?retry=${Date.now()}`;
    },
    "skip-flag"() {
      const engine = state.engine;
      if (!engine || !state.question) return;
      engine.skip();
      nextQuestion();
    },
    "play-again"() {
      if (state.lastSetup) startGame(state.lastSetup);
      else actions.home();
    },
    share() {
      shareScore();
    },
    async "clear-scores"() {
      const ok = await confirmDialog("Clear all scores?", "This removes every leaderboard entry on this device.", "Clear");
      if (!ok) return;
      Storage.clearScores();
      state.lastScoreId = null;
      renderLeaderboard();
      toast("Leaderboard cleared");
    },
    async "reset-data"() {
      const ok = await confirmDialog("Reset all data?", "Settings, stats and scores will be wiped from this device.", "Reset");
      if (!ok) return;
      Storage.resetAll();
      state.settings = Storage.getSettings();
      state.lastScoreId = null;
      applyTheme(state.settings.theme);
      Sfx.setEnabled(state.settings.sound);
      dom.settingsDialog.close();
      restoreSetup();
      updatePoolHint();
      renderHomeStats();
      toast("All data reset");
    },
    "close-dialog"(target) {
      const dialog = target.closest("dialog");
      if (dialog) dialog.close();
    }
  };

  /* Events ---------------------------------------------------------------- */

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const handler = actions[target.dataset.action];
      if (!handler) return;
      event.preventDefault();
      Sfx.unlock();
      handler(target, event);
    });

    document.addEventListener("pointerdown", () => Sfx.unlock(), { once: true });

    $("[data-options]").addEventListener("click", (event) => {
      const button = event.target.closest(".option");
      if (!button || button.disabled) return;
      Sfx.unlock();
      selectAnswer(button.dataset.code);
    });

    dom.setupForm.addEventListener("submit", (event) => {
      event.preventDefault();
      Sfx.unlock();
      startGame(readSetup());
    });

    dom.setupForm.addEventListener("change", updatePoolHint);
    dom.customRoundsInput.addEventListener("input", updatePoolHint);
    dom.customRoundsInput.addEventListener("blur", () => {
      dom.customRoundsInput.value = String(normaliseRounds(dom.customRoundsInput.value) || ROUNDS.defaultCustom);
      updatePoolHint();
    });

    dom.flagImg.addEventListener("load", onFlagLoaded);
    dom.flagImg.addEventListener("error", onFlagError);

    dom.pauseDialog.addEventListener("close", () => {
      const value = dom.pauseDialog.returnValue || "resume";
      dom.pauseDialog.returnValue = "";
      switch (value) {
        case "restart":
          if (state.lastSetup) startGame(state.lastSetup);
          break;
        case "end":
          endGame("quit");
          break;
        case "quit":
          abandonGame();
          renderHomeStats();
          updatePoolHint();
          showScreen("home");
          break;
        default:
          resumeGame();
      }
    });

    dom.settingsForm.addEventListener("submit", saveSettingsFromForm);

    for (const dialog of [dom.helpDialog, dom.settingsDialog]) {
      dialog.addEventListener("close", () => {
        if (state.paused && !dom.pauseDialog.open) resumeGame();
      });
    }

    for (const tab of dom.boardTabs) {
      tab.addEventListener("click", () => renderLeaderboard(tab.dataset.board));
    }

    document.addEventListener("keydown", onKeyDown);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && gameIsActive() && state.screen === "game" && !state.paused) pauseGame();
    });

    window.addEventListener("beforeunload", (event) => {
      if (gameIsActive() && state.engine.answered > 0) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;

    const target = event.target;
    const tag = target && target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (target && target.isContentEditable)) return;
    if (document.querySelector("dialog[open]")) return;

    if (!gameIsActive() || state.screen !== "game") return;

    switch (event.key) {
      case "1":
      case "2":
      case "3":
      case "4": {
        const button = dom.options[Number(event.key) - 1];
        if (button && !button.disabled) {
          event.preventDefault();
          button.click();
        }
        break;
      }
      case "Enter":
      case " ": {
        if (tag === "BUTTON") return;
        if (!dom.nextButton.hidden) {
          event.preventDefault();
          advance();
        }
        break;
      }
      case "h":
      case "H":
        actions.hint();
        break;
      case "f":
      case "F":
        actions.fifty();
        break;
      case "Escape":
        event.preventDefault();
        pauseGame();
        break;
      default:
        break;
    }
  }

  /* Boot ------------------------------------------------------------------ */

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const secure =
      window.location.protocol === "https:" ||
      ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (!secure) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* Offline support is optional. */
      });
    });
  }

  function init() {
    applyTheme(state.settings.theme);
    Sfx.setEnabled(state.settings.sound);
    populateRegions();
    restoreSetup();
    updatePoolHint();
    renderHomeStats();
    bindEvents();
    registerServiceWorker();
    showScreen("home", { focus: false });
  }

  init();
})();
