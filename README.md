# Flag Guesser

A fast, polished flag quiz that runs entirely in the browser. No build step, no framework, no API keys.

## Features

- 199 countries with capitals, regions and difficulty tiers bundled locally
- Three modes: Classic (three lives, twelve seconds per flag), Time Attack (sixty seconds, mistakes cost time) and Practice (no pressure)
- Four difficulty levels and region filters (world, Africa, Americas, Asia, Europe, Oceania)
- Smart distractors: look-alike flags such as Chad and Romania are deliberately offered together
- Streak multiplier, speed bonus and difficulty multiplier
- Lifelines: capital hint and a limited 50/50
- Local leaderboard, lifetime stats and a review list of the flags you missed
- Keyboard play: 1 to 4 to answer, Enter for next, H for hint, F for 50/50, Esc to pause
- Auto pause when the tab loses focus
- Dark and light themes, reduced motion support, screen reader friendly markup
- Generated sound effects via the Web Audio API (no audio files)
- Installable as a PWA with offline support for the app shell and seen flags

## Project structure

```
flag guesser/
  index.html            Markup for every screen and dialog
  css/styles.css        Theme tokens, layout and components
  js/countries.js       Country dataset, regions and confusable groups
  js/engine.js          Pure game rules (pool, questions, scoring, lifelines)
  js/storage.js         localStorage wrapper for settings, scores and stats
  js/audio.js           Web Audio sound effects
  js/app.js             UI controller: screens, clocks, rendering, events
  sw.js                 Service worker for offline support
  manifest.webmanifest  PWA manifest
  assets/favicon.svg    Icon
  tests/engine.test.js  Unit tests for the engine and dataset
```

## Run locally

Open `index.html` directly in a browser, or serve the folder so the service worker is active:

```
npm start
```

Then visit http://localhost:4173.

## Tests

```
npm test
```

Uses the built in Node test runner (Node 18 or newer).

## Deploy

The folder is a static site. Drag it onto Netlify Drop, or connect the repo and set the publish directory to the project root. No build command is needed.

## Customising

- Add or edit countries in `js/countries.js`. Each row is `[code, name, capital, region, tier]`.
- Tune scoring, timers and lives in the `MODES`, `DIFFICULTIES` and `SCORING` objects in `js/engine.js`.
- Bump `VERSION` in `sw.js` when shipping changes so cached shells refresh.

Flag images are served by [Flagpedia](https://flagpedia.net) through flagcdn.com.
