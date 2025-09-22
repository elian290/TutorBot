const firebaseConfig = {
  apiKey: "AIzaSyDvUac4ETO-gUy0NZRgysdNmOzviTSTmOg",
  authDomain: "tutorbot-1.firebaseapp.com",
  projectId: "tutorbot-1",
  storageBucket: "tutorbot-1.appspot.com", // fix typo: should be .appspot.com
  messagingSenderId: "429605110036",
  appId: "1:429605110036:web:b86d87b50c227ace32c201"
};
firebase.initializeApp(firebaseConfig);
window.auth = firebase.auth();