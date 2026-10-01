/* Poolposition – Hintergrund-Benachrichtigungen (Firebase Cloud Messaging) */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
importScripts('/config.js');
firebase.initializeApp(self.PP_CONFIG.firebase);
const messaging = firebase.messaging();
/* Benachrichtigungen mit Titel/Text zeigt der Browser selbst an; ein Tipp darauf öffnet die App (Link aus der Nachricht). */
