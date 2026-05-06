import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  update,
  runTransaction,
  get,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getAuth,
  signOut,
  onAuthStateChanged,
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

// DOM Elements
const slotsGrid = document.getElementById("slotsGrid");
const availableCount = document.getElementById("availableCount");
const occupiedCount = document.getElementById("occupiedCount");
const activeReservationSpan = document.getElementById("activeReservation");
const slotSelect = document.getElementById("slotSelect");
const durationMinutes = document.getElementById("durationMinutes");
const createReservationBtn = document.getElementById("createReservationBtn");
const cancelReservationBtn = document.getElementById("cancelReservationBtn");
const activeReservationCard = document.getElementById("activeReservationCard");
const reservationNumberSpan = document.getElementById("reservationNumber");
const expiryCountdownSpan = document.getElementById("expiryCountdown");
const gateOtpInput = document.getElementById("gateOtpInput");
const submitOtpBtn = document.getElementById("submitOtpBtn");
const gateStatusMsg = document.getElementById("gateStatusMsg");
const espStatus = document.getElementById("espStatus");
const wifiStatus = document.getElementById("wifiStatus");
const gateEntryStatus = document.getElementById("gateEntryStatus");
const systemLog = document.getElementById("systemLog");
const reserveStatus = document.getElementById("reserveStatus");
const userEmailSpan = document.getElementById("userEmail");
const errorLogDiv = document.getElementById("errorLog");

let currentUser = null;
let currentReservation = null;
let countdownInterval = null;

function showStatus(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? "#f87171" : "#4ade80";
  setTimeout(() => {
    if (el.textContent === msg) el.textContent = "";
  }, 4000);
}

function showError(msg) {
  if (errorLogDiv) {
    errorLogDiv.textContent = msg;
    errorLogDiv.classList.remove("hidden");
    setTimeout(() => errorLogDiv.classList.add("hidden"), 5000);
  }
  console.error(msg);
}

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

async function refreshUserReservation() {
  if (!currentUser) return;
  try {
    const reservationsSnap = await get(ref(db, "reservations"));
    const reservations = reservationsSnap.val() || {};
    let found = null;
    const now = Date.now();
    for (let key in reservations) {
      const r = reservations[key];
      if (
        r.userId === currentUser.uid &&
        r.status === "ACTIVE" &&
        r.expireTime > now &&
        r.otp?.active === true
      ) {
        found = {
          reservationId: r.reservationId,
          slotId: r.slotId,
          expireAt: r.expireTime,
        };
        break;
      }
    }
    currentReservation = found;
    if (currentReservation) {
      activeReservationSpan.innerText = `الموقف ${currentReservation.slotId}`;
      activeReservationCard.classList.remove("hidden");
      reservationNumberSpan.innerText =
        currentReservation.reservationId.slice(-12);
      startCountdown(currentReservation.expireAt);
    } else {
      activeReservationSpan.innerText = "لا يوجد";
      activeReservationCard.classList.add("hidden");
      if (countdownInterval) clearInterval(countdownInterval);
    }
  } catch (err) {
    showError(err.message);
  }
}

function startCountdown(expireAt) {
  if (countdownInterval) clearInterval(countdownInterval);
  const update = () => {
    const remaining = expireAt - Date.now();
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      expiryCountdownSpan.innerText = "انتهى";
      activeReservationCard.classList.add("hidden");
      currentReservation = null;
      activeReservationSpan.innerText = "لا يوجد";
      refreshUserReservation();
    } else {
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      expiryCountdownSpan.innerText = `${mins}:${secs.toString().padStart(2, "0")}`;
    }
  };
  update();
  countdownInterval = setInterval(update, 1000);
}

async function createReservation() {
  if (!currentUser) {
    showStatus(reserveStatus, "الرجاء تسجيل الدخول أولاً", true);
    return;
  }
  const slotId = slotSelect.value;
  if (!slotId) {
    showStatus(reserveStatus, "اختر موقفاً أولاً", true);
    return;
  }
  const minutes = parseInt(durationMinutes.value);
  if (isNaN(minutes) || minutes < 5) {
    showStatus(reserveStatus, "المدة لا تقل عن 5 دقائق", true);
    return;
  }
  const now = Date.now();
  const expireAt = now + minutes * 60 * 1000;
  const reservationId = `RES_${now}_${currentUser.uid.slice(-6)}`;
  const otpCode = generateOTP();
  try {
    const slotRef = ref(db, `slots/${slotId}`);
    const result = await runTransaction(slotRef, (slot) => {
      if (!slot || slot.occupied || slot.reserved) return;
      return {
        ...slot,
        reserved: true,
        reservedBy: currentUser.uid,
        reservedUntil: expireAt,
        currentReservation: reservationId,
        status: "RESERVED",
        lastUpdate: now,
      };
    });
    if (!result.committed) throw new Error("الموقف لم يعد متاحاً");
    await set(ref(db, `reservations/${reservationId}`), {
      reservationId,
      userId: currentUser.uid,
      slotId,
      status: "ACTIVE",
      paymentStatus: "PENDING",
      price: 0,
      hours: minutes / 60,
      startTime: now,
      expireTime: expireAt,
      createdAt: now,
      otp: { code: otpCode, active: true, used: false, expireAt },
    });
    await set(ref(db, `liveAccess/ACC_${reservationId}`), {
      otp: otpCode,
      reservationId,
      userId: currentUser.uid,
      slotId,
      active: true,
      used: false,
      expireAt,
      accessType: "RESERVATION",
      createdAt: now,
    });
    showStatus(
      reserveStatus,
      `✅ تم حجز ${slotId}! رقم الحجز: ${reservationId.slice(-8)}`,
    );
    refreshUserReservation();
  } catch (err) {
    showStatus(reserveStatus, err.message, true);
  }
}

async function cancelReservation() {
  if (!currentReservation || !currentUser) {
    showStatus(reserveStatus, "لا يوجد حجز نشط", true);
    return;
  }
  const { reservationId, slotId } = currentReservation;
  try {
    await update(ref(db), {
      [`slots/${slotId}/reserved`]: false,
      [`slots/${slotId}/reservedBy`]: null,
      [`slots/${slotId}/reservedUntil`]: null,
      [`slots/${slotId}/currentReservation`]: null,
      [`slots/${slotId}/status`]: "EMPTY",
      [`reservations/${reservationId}/status`]: "CANCELLED",
      [`reservations/${reservationId}/otp/active`]: false,
      [`liveAccess/ACC_${reservationId}/active`]: false,
    });
    showStatus(reserveStatus, "تم إلغاء الحجز");
    currentReservation = null;
    refreshUserReservation();
  } catch (err) {
    showStatus(reserveStatus, err.message, true);
  }
}

async function submitGateOTP() {
  const otp = gateOtpInput.value.trim();
  if (!otp || !/^\d{4,6}$/.test(otp)) {
    showStatus(gateStatusMsg, "أدخل كود صحيح من 4-6 أرقام", true);
    return;
  }
  if (!currentUser) {
    showStatus(gateStatusMsg, "الرجاء تسجيل الدخول", true);
    return;
  }
  const requestId = `REQ_${Date.now()}_${currentUser.uid.slice(-6)}`;
  try {
    await set(ref(db, `commands/gateRequests/${requestId}`), {
      otp,
      userId: currentUser.uid,
      status: "pending",
      createdAt: Date.now(),
    });
    showStatus(gateStatusMsg, "تم إرسال الطلب، انتظر فتح البوابة...");
    gateOtpInput.value = "";
    const reqRef = ref(db, `commands/gateRequests/${requestId}`);
    const unsubscribe = onValue(reqRef, (snap) => {
      const data = snap.val();
      if (data && data.status !== "pending") {
        if (data.status === "granted")
          showStatus(gateStatusMsg, "✅ تم فتح البوابة، ادخل الآن");
        else
          showStatus(
            gateStatusMsg,
            `❌ رفض: ${data.message || "كود غير صالح"}`,
            true,
          );
        unsubscribe();
      }
    });
  } catch (err) {
    showStatus(gateStatusMsg, err.message, true);
  }
}

function renderSlots(slots) {
  if (!slots) return;
  let occupied = 0,
    available = 0;
  slotsGrid.innerHTML = "";
  for (let [id, slot] of Object.entries(slots)) {
    const isOccupied = slot.occupied === true;
    const isReserved = slot.reserved === true;
    if (isOccupied) occupied++;
    else if (!isReserved) available++;
    const div = document.createElement("div");
    div.className = `slot ${isOccupied ? "occupied" : isReserved ? "reserved" : "free"}`;
    div.innerHTML = `<div class="slot-id">${id}</div><div class="slot-status">${isOccupied ? "مشغول" : isReserved ? "محجوز" : "متاح"}</div>`;
    if (!isOccupied && !isReserved)
      div.onclick = () => {
        slotSelect.value = id;
        createReservation();
      };
    slotsGrid.appendChild(div);
  }
  availableCount.innerText = available;
  occupiedCount.innerText = occupied;
  const currentVal = slotSelect.value;
  slotSelect.innerHTML = '<option value="">اختر الموقف</option>';
  for (let [id, slot] of Object.entries(slots)) {
    if (!slot.occupied && !slot.reserved)
      slotSelect.innerHTML += `<option value="${id}">${id}</option>`;
  }
  if (currentVal && slotSelect.querySelector(`option[value="${currentVal}"]`))
    slotSelect.value = currentVal;
}

// Real-time listeners
onValue(ref(db, "slots"), (snap) => {
  if (snap.exists()) renderSlots(snap.val());
});
onValue(ref(db, "parking"), (snap) => {
  if (snap.exists()) {
    availableCount.innerText = snap.val().available || 0;
    occupiedCount.innerText = snap.val().occupied || 0;
  }
});
onValue(ref(db, "system"), (snap) => {
  if (snap.exists()) {
    const sys = snap.val();
    const now = Date.now();
    const lastBeat = sys.lastHeartbeat || 0;
    const isOnline = lastBeat > 0 && now - lastBeat < 15000;
    espStatus.innerHTML = isOnline
      ? '<span style="color:#22c55e">🟢 متصل</span>'
      : '<span style="color:#ef4444">🔴 غير متصل</span>';
    wifiStatus.innerHTML = sys.wifi ? "🟢 متصل" : "🔴 مقطوع";
    systemLog.innerText = `آخر نبضة قلب: ${lastBeat ? new Date(lastBeat).toLocaleTimeString() : "--"} | الذاكرة الحرة: ${sys.freeHeap || "?"} بايت`;
  } else {
    espStatus.innerHTML = '<span style="color:#ef4444">🔴 غير متصل</span>';
    wifiStatus.innerHTML = "🔴 مقطوع";
  }
});
onValue(ref(db, "gates"), (snap) => {
  if (snap.exists())
    gateEntryStatus.innerText = snap.val().entry?.open ? "مفتوحة" : "مغلقة";
});
onValue(ref(db, "reservations"), () => refreshUserReservation());
onValue(ref(db, "liveAccess"), () => refreshUserReservation());

// Auth
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../index.html";
    return;
  }
  currentUser = user;
  userEmailSpan.innerText = user.email;
  const roleSnap = await get(ref(db, `users/${user.uid}/role`));
  if (!roleSnap.exists())
    await set(ref(db, `users/${user.uid}`), {
      email: user.email,
      role: "user",
      createdAt: Date.now(),
      active: true,
      wallet: 0,
    });
  refreshUserReservation();
});

createReservationBtn.onclick = createReservation;
cancelReservationBtn.onclick = cancelReservation;
submitOtpBtn.onclick = submitGateOTP;
document.getElementById("logoutBtn").onclick = async () => {
  await signOut(auth);
  window.location.href = "../index.html";
};
