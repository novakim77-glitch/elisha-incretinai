// IncretinAi PWA Service Worker v1.0
const CACHE_NAME = 'incretinai-v7.3.0';
const BASE = '/elisha-incretinai';
const APP_SHELL = [
  BASE + '/IncretinAi_v7.0_Adaptive.html',
  BASE + '/icons/icon-192x192.png',
  BASE + '/icons/icon-512x512.png'
];

// Install: pre-cache app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for app shell, network-only for Firebase/API
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET requests
  if (e.request.method !== 'GET') return;

  // Network-only for Firebase API calls (Firestore handles its own offline cache)
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com') ||
      url.hostname.includes('firebasestorage.googleapis.com')) {
    return;
  }

  // Network-only for Firebase SDK scripts (versioned by CDN)
  if (url.hostname === 'www.gstatic.com' && url.pathname.includes('firebase')) {
    return;
  }

  // Network-first: try network, fall back to cache (ensures latest version)
  e.respondWith(
    fetch(e.request).then(response => {
      // Cache the fresh response for offline use
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
