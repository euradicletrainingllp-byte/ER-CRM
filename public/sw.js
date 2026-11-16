// Minimal service worker — makes the CRM installable as an app.
// No caching: data is live from Excel, so every request goes to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
