import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  update,
  get,
  remove,
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

let currentUser = null;
let allData = {
  slots: {},
  users: {},
  reservations: {},
  liveAccess: {},
  system: {},
  gates: {},
  logs: {},
};

function showAlert(msg, type) {
  const div = document.createElement("div");
  div.innerText = msg;
  div.style.cssText = `position:fixed; bottom:20px; right:20px; background:${type === "success" ? "#10b981" : "#ef4444"}; color:white; padding:12px 20px; border-radius:40px; z-index:9999; box-shadow:0 8px 20px rgba(0,0,0,0.3); font-weight:500; backdrop-filter:blur(8px);`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

function updateESP32Status() {
  const sys = allData.system || {};
  const lastBeat = sys.lastHeartbeat || 0;
  const now = Date.now();
  const isOnline = lastBeat > 0 && now - lastBeat < 15000;
  const espSpan = document.getElementById("espStatusAdmin");
  if (espSpan) {
    espSpan.innerHTML = isOnline
      ? '<span class="badge-online">🟢 متصل</span>'
      : '<span class="badge-offline">🔴 غير متصل</span>';
  }
  const wifiSpan = document.getElementById("wifiStatusAdmin");
  if (wifiSpan) wifiSpan.innerHTML = sys.wifi ? "🟢 متصل" : "🔴 مقطوع";
  const heartbeatSpan = document.getElementById("lastHeartbeatAdmin");
  if (heartbeatSpan)
    heartbeatSpan.innerText = lastBeat
      ? new Date(lastBeat).toLocaleTimeString("ar")
      : "--";
  const heapSpan = document.getElementById("freeHeapAdmin");
  if (heapSpan) heapSpan.innerText = sys.freeHeap || "--";
}

function updateDashboardStats() {
  const slots = allData.slots || {};
  const occupied = Object.values(slots).filter((s) => s.occupied).length;
  const available = Object.keys(slots).length - occupied;
  const availableSpan = document.getElementById("adminAvailable");
  if (availableSpan) availableSpan.innerText = available;
  const occupiedSpan = document.getElementById("adminOccupied");
  if (occupiedSpan) occupiedSpan.innerText = occupied;
  const activeResSpan = document.getElementById("adminActiveRes");
  if (activeResSpan) {
    const activeRes = Object.values(allData.reservations || {}).filter(
      (r) => r.status === "ACTIVE" && r.expireTime > Date.now(),
    ).length;
    activeResSpan.innerText = activeRes;
  }
  const totalUsersSpan = document.getElementById("adminTotalUsers");
  if (totalUsersSpan)
    totalUsersSpan.innerText = Object.keys(allData.users || {}).length;
  updateESP32Status();
}

function renderSlots() {
  const tbody = document.getElementById("slotsTable");
  if (!tbody) return;
  const slots = allData.slots || {};
  tbody.innerHTML = "";
  for (let [id, slot] of Object.entries(slots)) {
    tbody.innerHTML += `<tr>
      <td><strong>${id}</strong></td>
      <td>${slot.occupied ? "مشغول" : slot.reserved ? "محجوز" : "متاح"}</td>
      <td>${slot.reservedBy || "--"}</td>
      <td>${slot.reservedUntil ? new Date(slot.reservedUntil).toLocaleString("ar") : "--"}</td>
    </tr>`;
  }
}

function renderReservations() {
  const tbody = document.getElementById("reservationsTable");
  if (!tbody) return;
  const reservations = allData.reservations || {};
  tbody.innerHTML = "";
  for (let [id, r] of Object.entries(reservations)) {
    if (r.status === "ACTIVE" || r.status === "PENDING") {
      tbody.innerHTML += `<tr>
        <td>${r.userId?.slice(0, 8)}...</td>
        <td>${r.slotId}</td>
        <td>${r.status}</td>
        <td>${r.expireTime ? new Date(r.expireTime).toLocaleString("ar") : "--"}</td>
        <td>${r.otp?.code || "--"}</td>
      </tr>`;
    }
  }
}

function renderLiveAccess() {
  const tbody = document.getElementById("liveAccessTable");
  if (!tbody) return;
  const live = allData.liveAccess || {};
  tbody.innerHTML = "";
  for (let [id, acc] of Object.entries(live)) {
    if (acc.active && acc.expireAt > Date.now()) {
      tbody.innerHTML += `<tr>
        <td>${acc.otp}</td>
        <td>${acc.userId?.slice(0, 8)}..</td>
        <td>${acc.slotId || "موظف"}</td>
        <td>${new Date(acc.expireAt).toLocaleString("ar")}</td>
        <td><button onclick="revokeCode('${id}')">إلغاء</button></td>
      </tr>`;
    }
  }
}

function renderUsers() {
  const tbody = document.getElementById("usersTable");
  if (!tbody) return;
  const users = allData.users || {};
  tbody.innerHTML = "";
  for (let [uid, user] of Object.entries(users)) {
    tbody.innerHTML += `<tr>
      <td>${user.email}</td>
      <td>${user.role || "user"}</td>
      <td>${user.active ? "نشط" : "معطل"}</td>
      <td><select onchange="updateUserRole('${uid}', this.value)">
          <option ${user.role === "user" ? "selected" : ""}>user</option>
          <option ${user.role === "staff" ? "selected" : ""}>staff</option>
          <option ${user.role === "admin" ? "selected" : ""}>admin</option>
        </select></td>
    </tr>`;
  }
}

function renderLogs() {
  const tbody = document.getElementById("logsTable");
  if (!tbody) return;
  const logs = allData.logs || {};
  const entries = Object.entries(logs).slice(-30).reverse();
  tbody.innerHTML = "";
  for (let [id, log] of entries) {
    tbody.innerHTML += `<tr>
      <td>${new Date(log.time).toLocaleString("ar")}</td>
      <td>${log.action}</td>
      <td>${log.userId || "النظام"}</td>
    </tr>`;
  }
}

window.updateUserRole = async (uid, role) => {
  await update(ref(db, `users/${uid}`), { role });
  showAlert("✅ تم تحديث الدور", "success");
};
window.revokeCode = async (codeId) => {
  await update(ref(db, `liveAccess/${codeId}`), { active: false });
  showAlert("✅ تم إلغاء الكود", "success");
};
window.controlGate = async (gate, open) => {
  await update(ref(db, `gates/${gate}`), { open, lastAction: Date.now() });
  showAlert(
    `${gate === "entry" ? "بوابة الدخول" : "بوابة الخروج"} ${open ? "مفتوحة ✅" : "مغلقة 🔒"}`,
    "success",
  );
};

// مستمعات Firebase
onValue(ref(db, "slots"), (snap) => {
  allData.slots = snap.val() || {};
  renderSlots();
  updateDashboardStats();
});
onValue(ref(db, "reservations"), (snap) => {
  allData.reservations = snap.val() || {};
  renderReservations();
  updateDashboardStats();
});
onValue(ref(db, "liveAccess"), (snap) => {
  allData.liveAccess = snap.val() || {};
  renderLiveAccess();
});
onValue(ref(db, "users"), (snap) => {
  allData.users = snap.val() || {};
  renderUsers();
  updateDashboardStats();
});
onValue(ref(db, "system"), (snap) => {
  allData.system = snap.val() || {};
  updateDashboardStats();
  updateESP32Status();
});
onValue(ref(db, "gates"), (snap) => {
  allData.gates = snap.val() || {};
  const entryGateSpan = document.getElementById("entryGateStatus");
  if (entryGateSpan)
    entryGateSpan.innerHTML = allData.gates.entry?.open
      ? "🟢 مفتوحة"
      : "🔴 مغلقة";
  const exitGateSpan = document.getElementById("exitGateStatus");
  if (exitGateSpan)
    exitGateSpan.innerHTML = allData.gates.exit?.open
      ? "🟢 مفتوحة"
      : "🔴 مغلقة";
});
onValue(ref(db, "logs"), (snap) => {
  allData.logs = snap.val() || {};
  renderLogs();
});

// أزرار التحكم
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener("click", async () => {
    const price = document.getElementById("pricePerHour")?.value;
    const hold = document.getElementById("defaultHold")?.value;
    if (price && hold) {
      await update(ref(db, "system/parking"), {
        pricePerHour: parseFloat(price),
        defaultHoldMinutes: parseInt(hold),
      });
      showAlert("✅ تم حفظ الإعدادات", "success");
    }
  });
}

const emergencyStopBtn = document.getElementById("emergencyStopBtn");
if (emergencyStopBtn) {
  emergencyStopBtn.addEventListener("click", async () => {
    await update(ref(db, "gates/entry"), { open: false });
    await update(ref(db, "gates/exit"), { open: false });
    showAlert("🛑 إيقاف طوارئ - جميع البوابات مغلقة", "error");
  });
}

const refreshBtn = document.getElementById("refreshBtn");
if (refreshBtn)
  refreshBtn.addEventListener("click", () => updateDashboardStats());

const clearLogsBtn = document.getElementById("clearLogsBtn");
if (clearLogsBtn) {
  clearLogsBtn.addEventListener("click", async () => {
    await remove(ref(db, "logs"));
    showAlert("✅ تم مسح السجلات", "success");
  });
}

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "../index.html";
  });
}

// فتح Embedded Tools في نافذة جديدة
const openEmbeddedToolsBtn = document.getElementById("openEmbeddedToolsBtn");
if (openEmbeddedToolsBtn) {
  openEmbeddedToolsBtn.addEventListener("click", () => {
    window.open("./embedded-tools.html", "_blank");
  });
}

// التنقل بين الأقسام
document.querySelectorAll(".nav-item[data-section]").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".section").forEach((s) => {
      s.classList.remove("active");
    });
    const target = document.getElementById(item.dataset.section);
    if (target) target.classList.add("active");
    document.querySelectorAll(".nav-item").forEach((nav) => {
      nav.classList.remove("active");
    });
    item.classList.add("active");
  });
});

onAuthStateChanged(auth, (user) => {
  if (!user) window.location.href = "../index.html";
});

// تحديث دوري لحالة ESP32 كل 5 ثوانٍ
setInterval(() => {
  if (allData.system) updateESP32Status();
}, 5000);

console.log("✅ لوحة الإدارة العربية جاهزة (بدون محرر IDE)");
