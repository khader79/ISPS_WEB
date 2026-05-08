importScripts(
  "https://www.gstatic.com/firebasejs/12.12.1/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/12.12.1/firebase-messaging-compat.js",
);
firebase.initializeApp({
  apiKey: "AIzaSyBHFT1kSAa0kwxfQQWK4ZSMcv-N0PdqIr8",
  authDomain: "iot-smart-parking-49293.firebaseapp.com",
  databaseURL: "https://iot-smart-parking-49293-default-rtdb.firebaseio.com",
  projectId: "iot-smart-parking-49293",
  storageBucket: "iot-smart-parking-49293.appspot.com",
  messagingSenderId: "9229464595",
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
  });
});
