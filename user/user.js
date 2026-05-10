import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  getDatabase, ref, onValue, set, update, runTransaction, get,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";
import {
  getAuth, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

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

const $ = id => document.getElementById(id);
const gateStatusMsg = $("gateStatusMsg");
const submitOtpBtn = $("submitOtpBtn");
let currentUser = null;
let currentReservation = null;
let countdownInterval = null;
let gateRespUnsubscribe = null;

function msg(text, type = "info") {
  const el = $("toast");
  el.textContent = text;
  el.className = `toast ${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3500);
}

function showStatus(el, text, isError = false) {
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#f87171" : "#4ade80";
  clearTimeout(el._st);
  el._st = setTimeout(() => { el.textContent = ""; el.style.color = ""; }, 4000);
}

function resetOtpBtn() {
  if (submitOtpBtn) {
    submitOtpBtn.disabled = false;
    submitOtpBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> فتح البوابة`;
  }
}

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

async function refreshUserReservation() {
  if (!currentUser) return;
  try {
    const snap = await get(ref(db, "reservations"));
    const reservations = snap.val() || {};
    let found = null;
    const now = Date.now();
    for (const key in reservations) {
      const r = reservations[key];
      if (r.userId === currentUser.uid && r.status === "ACTIVE" && r.expireTime > now) {
        found = { reservationId: r.reservationId, slotId: r.slotId, expireAt: r.expireTime, otpActive: r.otp?.active };
        break;
      }
    }
    currentReservation = found;
    $("activeReservationSection").classList.toggle("hidden", !found);
    $("bookingSection").classList.toggle("hidden", !!found);
    $("activeReservationSpan").textContent = found ? "1" : "0";
    if (found) {
      $("activeSlotDisplay").textContent = found.slotId;
      $("activeReservationId").textContent = found.reservationId.slice(-8).toUpperCase();
      startCountdown(found.expireAt);
    } else {
      if (countdownInterval) clearInterval(countdownInterval);
      $("countdownDisplay").textContent = "";
    }
  } catch { /* ignore */ }
}

function startCountdown(expireAt) {
  if (countdownInterval) clearInterval(countdownInterval);
  const update = () => {
    const rem = expireAt - Date.now();
    if (rem <= 0) {
      clearInterval(countdownInterval);
      currentReservation = null;
      refreshUserReservation();
      msg("انتهت صلاحية الحجز", "info");
    }
    const el = $("countdownDisplay");
    el.textContent = rem > 0
      ? `${Math.floor(rem / 60000)}:${Math.floor((rem % 60000) / 1000).toString().padStart(2, "0")}`
      : "انتهى";
    el.className = `timer ${rem > 120000 ? "ok" : rem > 30000 ? "warn" : "critical"}`;
  };
  update();
  countdownInterval = setInterval(update, 1000);
}

async function createReservation() {
  if (!currentUser) { msg("الرجاء تسجيل الدخول", "err"); return; }
  if (currentReservation) { msg("لديك حجز نشط بالفعل", "err"); return; }
  const slotId = $("slotSelect").value;
  if (!slotId) { msg("اختر موقفاً", "err"); return; }
  const minutes = parseInt($("durationMinutes").value);
  if (isNaN(minutes) || minutes < 5) { msg("المدة لا تقل عن 5 دقائق", "err"); return; }
  const now = Date.now();
  const expireAt = now + minutes * 60 * 1000;
  const reservationId = `RES_${now}_${currentUser.uid.slice(-6)}`;
  const otpCode = generateOTP();
  try {
    const result = await runTransaction(ref(db, `slots/${slotId}`), (slot) => {
      if (!slot || slot.occupied || slot.reserved) return;
      return { ...slot, reserved: true, reservedBy: currentUser.uid, reservedUntil: expireAt, currentReservation: reservationId, status: "RESERVED", lastUpdate: now };
    });
    if (!result.committed) throw new Error("الموقف لم يعد متاحاً");
    await set(ref(db, `reservations/${reservationId}`), {
      reservationId, userId: currentUser.uid, slotId, status: "ACTIVE", paymentStatus: "PENDING",
      price: 0, hours: minutes / 60, startTime: now, expireTime: expireAt, createdAt: now,
      otp: { code: otpCode, active: true, used: false, expireAt },
    });
    await set(ref(db, "liveAccess/entry"), {
      otp: otpCode, reservationId, userId: currentUser.uid, slotId,
      active: true, used: false, expireAt, accessType: "RESERVATION", createdAt: now,
    });
    msg(`✅ تم حجز ${slotId}! توجه إلى البوابة واقرأ الكود من شاشة LCD`, "ok");
    refreshUserReservation();
  } catch (err) {
    msg(err.message, "err");
  }
}

async function cancelReservationFor(slotId, reservationId) {
  if (!currentUser) { msg("الرجاء تسجيل الدخول", "err"); return; }
  try {
    await update(ref(db), {
      [`slots/${slotId}/reserved`]: false,
      [`slots/${slotId}/reservedBy`]: null,
      [`slots/${slotId}/reservedUntil`]: null,
      [`slots/${slotId}/currentReservation`]: null,
      [`slots/${slotId}/status`]: "EMPTY",
      [`reservations/${reservationId}/status`]: "CANCELLED",
      [`reservations/${reservationId}/otp/active`]: false,
      "liveAccess/entry/active": false,
      "liveAccess/entry/otp": "",
      "liveAccess/entry/used": true,
    });
    msg("تم إلغاء الحجز", "info");
    if (currentReservation?.reservationId === reservationId) {
      currentReservation = null;
    }
    refreshUserReservation();
  } catch (err) { msg(err.message, "err"); }
}

async function cancelReservation() {
  if (!currentReservation || !currentUser) { msg("لا يوجد حجز نشط", "err"); return; }
  await cancelReservationFor(currentReservation.slotId, currentReservation.reservationId);
}

async function submitGateOTP() {
  const otp = $("gateOtpInput")?.value.trim();
  if (!otp || !/^\d{4,6}$/.test(otp)) { showStatus(gateStatusMsg, "أدخل الكود الصحيح من 4 أرقام", true); return; }
  if (!currentUser) { showStatus(gateStatusMsg, "الرجاء تسجيل الدخول", true); return; }
  if (!currentReservation) { showStatus(gateStatusMsg, "ليس لديك حجز نشط", true); return; }

  const requestId = `REQ_${Date.now()}_${currentUser.uid.slice(-6)}`;
  try {
    await set(ref(db, "commands/gateOpenRequest"), {
      requestId, otp, userId: currentUser.uid, slotId: currentReservation.slotId,
      status: "pending", message: "", createdAt: Date.now(),
    });
    await set(ref(db, `commands/gateRequests/${requestId}`), {
      otp, userId: currentUser.uid, status: "pending", createdAt: Date.now(), message: "",
    });
    showStatus(gateStatusMsg, "⏳ جارٍ التحقق من الكود...");
    submitOtpBtn.disabled = true;
    submitOtpBtn.innerHTML = `<span class="spinner"></span> جاري التحقق...`;

    $("gateOtpInput").value = "";

    if (gateRespUnsubscribe) gateRespUnsubscribe();
    const respRef = ref(db, "commands/gateOpenRequest/status");
    const timeout = setTimeout(() => {
      gateRespUnsubscribe?.();
      showStatus(gateStatusMsg, "⏱️ لم يتم اكتشاف سيارة خلال 20 ثانية", true);
      resetOtpBtn();
    }, 20000);

    gateRespUnsubscribe = onValue(respRef, (snap) => {
      const val = snap.val();
      if (val === "pending" || val === "processing" || val === "idle") return;
      clearTimeout(timeout);
      gateRespUnsubscribe?.();
      if (val === "granted") {
        showStatus(gateStatusMsg, "✅ تم فتح البوابة، ادخل الآن!");
        update(ref(db), {
          "liveAccess/entry/active": false, "liveAccess/entry/used": true, "liveAccess/entry/otp": "",
        });
        msg("تم فتح البوابة! الكود ملغي", "ok");
      } else if (val === "denied") {
        get(ref(db, "commands/gateOpenRequest/message")).then(s => {
          showStatus(gateStatusMsg, `❌ ${s.val() || "رُفض الطلب"}`, true);
        });
      }
      resetOtpBtn();
    });
  } catch (err) {
    showStatus(gateStatusMsg, err.message, true);
    resetOtpBtn();
  }
}

function renderSlots(slots) {
  if (!slots) return;
  let occ = 0, avail = 0;
  const grid = $("slotsGrid");
  grid.innerHTML = "";
  for (const [id, slot] of Object.entries(slots)) {
    const isOcc = slot.occupied === true;
    const isRes = slot.reserved === true;
    const isMyRes = isRes && slot.reservedBy === currentUser?.uid && slot.currentReservation;
    if (isOcc) occ++; else if (!isRes) avail++;

    const div = document.createElement("div");
    div.className = `slot ${isOcc ? "occ" : isMyRes ? "mine" : isRes ? "res" : "free"}`;

    div.innerHTML = `
      <div class="slot-id">${id}</div>
      <div class="slot-icon">${isOcc ? "🚗" : isMyRes ? "🔑" : isRes ? "📌" : "⬜"}</div>
      <div class="slot-status">${isOcc ? "مشغول" : isMyRes ? "حجزي" : isRes ? "محجوز" : "متاح"}</div>
      ${isMyRes ? '<button class="slot-cancel-btn" title="إلغاء الحجز">✕</button>' : ''}
    `;

    if (isMyRes) {
      const cancelBtn = div.querySelector(".slot-cancel-btn");
      cancelBtn.onclick = (e) => {
        e.stopPropagation();
        cancelReservationFor(id, slot.currentReservation);
      };
    } else if (!isOcc && !isRes) {
      div.onclick = () => { $("slotSelect").value = id; createReservation(); };
    }

    grid.appendChild(div);
  }
  $("availableCount").textContent = avail;
  $("occupiedCount").textContent = occ;
  const cur = $("slotSelect").value;
  $("slotSelect").innerHTML = '<option value="">اختر موقف</option>';
  for (const [id, slot] of Object.entries(slots))
    if (!slot.occupied && !slot.reserved)
      $("slotSelect").innerHTML += `<option value="${id}">${id}</option>`;
  if (cur && $("slotSelect").querySelector(`option[value="${cur}"]`)) $("slotSelect").value = cur;
}

onValue(ref(db, "slots"), snap => { if (snap.exists()) renderSlots(snap.val()); });
onValue(ref(db, "parking"), snap => {
  if (snap.exists()) {
    $("availableCount").textContent = snap.val().available || 0;
    $("occupiedCount").textContent = snap.val().occupied || 0;
  }
});
onValue(ref(db, "system"), snap => {
  const sys = snap.val();
  const online = sys?.esp32Online === true;
  $("espStatus").innerHTML = online
    ? '<span class="dot dot-green"></span> متصل'
    : '<span class="dot dot-red"></span> غير متصل';
  $("wifiStatus").innerHTML = sys?.wifi ? "🟢 متصل" : "🔴 مقطوع";
});
onValue(ref(db, "gates"), snap => {
  $("gateEntryStatus").innerHTML = snap.val()?.entry?.open
    ? '<span class="dot dot-green"></span> مفتوحة'
    : '<span class="dot dot-red"></span> مغلقة';
});
onValue(ref(db, "reservations"), () => refreshUserReservation());
onValue(ref(db, "liveAccess"), () => refreshUserReservation());

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "../index.html"; return; }
  currentUser = user;
  $("userEmail").textContent = user.email;
  const roleSnap = await get(ref(db, `users/${user.uid}/role`));
  if (!roleSnap.exists())
    await set(ref(db, `users/${user.uid}`), { email: user.email, role: "user", createdAt: Date.now(), active: true, wallet: 0 });
  refreshUserReservation();
});

$("createReservationBtn").onclick = createReservation;
$("cancelReservationBtn").onclick = cancelReservation;
$("submitOtpBtn").onclick = submitGateOTP;
$("gateOtpInput").onkeydown = e => { if (e.key === "Enter") submitGateOTP(); };
document.getElementById("logoutBtn").onclick = async () => { await signOut(auth); window.location.href = "../index.html"; };
