// IncretinAi PWA Service Worker v2.0
// Strategy: Network-first with version-based cache busting
// On deploy: bump APP_VERSION → old caches auto-purged → users get fresh code

const APP_VERSION = '7.5.0';
const CACHE_NAME = 'incretinai-v' + APP_VERSION;
const BASE = '/elisha-incretinai';
const APP_SHELL = [
  BASE + '/IncretinAi_v7.0_Adaptive.html',
  BASE + '/icons/icon-192x192.png',
  BASE + '/icons/icon-512x512.png'
];

// Install: pre-cache app shell, then immediately activate (no waiting)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())  // Don't wait for old SW to die
  );
});

// Activate: purge ALL old caches, then claim all clients immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())  // Take control of all open tabs NOW
     .then(() => {
       // Notify all clients that a new version is active
       self.clients.matchAll({ type: 'window' }).then(clients => {
         clients.forEach(client => client.postMessage({
           type: 'SW_UPDATED',
           version: APP_VERSION
         }));
       });
     })
  );
});

// Fetch strategy: Network-first with cache-busting for HTML
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET
  if (e.request.method !== 'GET') return;

  // Network-only: Firebase APIs (Firestore handles its own offline cache)
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com') ||
      url.hostname.includes('firebasestorage.googleapis.com')) {
    return;
  }

  // Network-only: Firebase SDK scripts
  if (url.hostname === 'www.gstatic.com' && url.pathname.includes('firebase')) {
    return;
  }

  // HTML files: network-first with cache-busting (bypass browser HTTP cache)
  const isHTML = url.pathname.endsWith('.html') || url.pathname === BASE + '/';
  if (isHTML) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })  // ← KEY: bypasses browser HTTP cache
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(e.request))  // Offline fallback
    );
    return;
  }

  // Other assets (icons, etc): network-first, normal cache
  e.respondWith(
    fetch(e.request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return response;
    }).catch(() => caches.match(e.request))
  );
});

// --- FCM Background Messages ---
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAmvW0gVPtybG43_nsPVXTNWFAA4MkTmk8",
  authDomain: "incretina-i-pro.firebaseapp.com",
  projectId: "incretina-i-pro",
  storageBucket: "incretina-i-pro.firebasestorage.app",
  messagingSenderId: "649157897211",
  appId: "1:649157897211:web:0f31b8985aad5f6d14795e"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || 'IncretinAi';
  const options = {
    body: payload.notification?.body || '',
    icon: BASE + '/icons/icon-192x192.png',
    badge: BASE + '/icons/icon-192x192.png',
    data: payload.data
  };
  self.registration.showNotification(title, options);
});

// Handle notification click — open/focus the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if (client.url.includes('IncretinAi') && 'focus' in client) return client.focus();
        }
        return clients.openWindow(BASE + '/IncretinAi_v7.0_Adaptive.html');
      })
  );
});
