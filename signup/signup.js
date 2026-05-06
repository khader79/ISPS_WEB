import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBHFT1kSAa0kwxfQQWK4ZSMcv-N0PdqIr8",
  authDomain: "iot-smart-parking-49293.firebaseapp.com",
  databaseURL: "https://iot-smart-parking-49293-default-rtdb.firebaseio.com",
  projectId: "iot-smart-parking-49293",
  storageBucket: "iot-smart-parking-49293.appspot.com",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const confirmInput = document.getElementById("confirmPassword");
const nameInput = document.getElementById("displayName");
const signupBtn = document.getElementById("signupBtn");
const statusDiv = document.getElementById("status");

function showStatus(msg, isError = false) {
  statusDiv.textContent = msg;
  statusDiv.className = `status ${isError ? "error" : "success"}`;
  setTimeout(() => {
    if (statusDiv.textContent === msg) statusDiv.textContent = "";
  }, 4000);
}

signupBtn.onclick = async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  const confirm = confirmInput.value.trim();
  const displayName = nameInput.value.trim();

  if (!email || !password) {
    showStatus("⚠️ البريد الإلكتروني وكلمة المرور مطلوبة", true);
    return;
  }
  if (password !== confirm) {
    showStatus("❌ كلمة المرور وتأكيدها غير متطابقين", true);
    return;
  }
  if (password.length < 6) {
    showStatus("❌ كلمة المرور يجب أن تكون 6 أحرف على الأقل", true);
    return;
  }

  signupBtn.disabled = true;
  signupBtn.textContent = "جاري إنشاء الحساب...";

  try {
    // 1. إنشاء المستخدم في Firebase Authentication
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password,
    );
    const user = userCredential.user;

    // 2. تحديث الاسم في Auth (اختياري)
    if (displayName) {
      await updateProfile(user, { displayName: displayName });
    }

    // 3. إضافة بيانات المستخدم في Realtime Database (دور user افتراضي)
    await set(ref(db, `users/${user.uid}`), {
      email: email,
      name: displayName || "مستخدم جديد",
      role: "user",
      active: true,
      wallet: 0,
      createdAt: Date.now(),
      lastLogin: Date.now(),
    });

    showStatus("✅ تم إنشاء الحساب بنجاح! جاري التوجيه...");

    // 4. توجيه المستخدم إلى لوحة المستخدم بعد 1.5 ثانية
    setTimeout(() => {
      window.location.href = "../user/index.html";
    }, 1500);
  } catch (error) {
    let errorMsg = error.message;
    if (error.code === "auth/email-already-in-use")
      errorMsg = "البريد الإلكتروني مستخدم بالفعل";
    else if (error.code === "auth/invalid-email")
      errorMsg = "بريد إلكتروني غير صالح";
    else if (error.code === "auth/weak-password")
      errorMsg = "كلمة المرور ضعيفة (6 أحرف على الأقل)";
    showStatus("❌ " + errorMsg, true);
    signupBtn.disabled = false;
    signupBtn.textContent = "إنشاء حساب";
  }
};
