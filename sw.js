// Deliberately pass-through: SPASH must never serve stale application or
// remote data while offline. A new worker takes control immediately after
// activation, and the browser checks this file for updates on navigation.
const SPASH_WORKER_VERSION = '2026-11-06-1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
