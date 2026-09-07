"use strict";

/**
 * Service worker for Flag Guesser.
 *
 * App shell: network first, falling back to cache so updates ship immediately
 * but the game still opens offline.
 * Flag images: cache first, so previously seen flags never need the network.
 */
const VERSION = "1.2.0";
const SHELL_CACHE = `flag-guesser-shell-${VERSION}`;
const FLAG_CACHE = "flag-guesser-flags-v1";
const FLAG_HOST = "flagcdn.com";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/countries.js",
  "./js/storage.js",
  "./js/audio.js",
  "./js/engine.js",
  "./js/app.js",
  "./assets/favicon.svg",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("flag-guesser-shell-") && key !== SHELL_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.hostname === FLAG_HOST) {
    event.respondWith(cacheFirst(request, FLAG_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
    throw error;
  }
}
