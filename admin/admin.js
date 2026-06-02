import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  onChildAdded,
  set,
  update,
  get,
  remove,
  push,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";
import {
  getAuth,
  signOut,
  onAuthStateChanged,
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

window.__fb = { db, ref, set, update, get, remove, onValue, push };

// ===== EVENT-DRIVEN STATE MACHINE =====
const syncState = {
  events: [],
  arrivalCount: 0,
  departureCount: 0,
  validatedCount: 0,
  rejectedCount: 0,
  savedTransactions: 0,
  totalCloudTx: 0,
  latencySum: 0,
  latencyCount: 0,
  currentMode: "auto",
  overrideLog: [],
  lastSlotStates: {},
};

function recordEvent(slotId, fromState, toState, validated, latency) {
  const event = {
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    time: Date.now(),
    slotId,
    fromState,
    toState,
    validated,
    createdCloudTx: validated,
    latency: latency || Math.floor(Math.random() * 80 + 10),
  };
  syncState.events.unshift(event);
  if (syncState.events.length > 200) syncState.events.length = 200;

  if (fromState === "EMPTY" && toState === "OCCUPIED") syncState.arrivalCount++;
  if (fromState === "OCCUPIED" && toState === "EMPTY") syncState.departureCount++;

  if (validated) {
    syncState.validatedCount++;
    syncState.totalCloudTx++;
  } else {
    syncState.rejectedCount++;
  }

  syncState.savedTransactions = syncState.arrivalCount + syncState.departureCount - syncState.totalCloudTx;
  syncState.latencySum += event.latency;
  syncState.latencyCount++;

  renderEvents();
  updateEventStats();
  updateCloudSyncDisplay(event);
  updateFlowVisualizer(toState, validated);
}

function detectTransition(slots) {
  const prev = syncState.lastSlotStates;
  for (const [id, slot] of Object.entries(slots)) {
    const prevOcc = prev[id];
    const currOcc = slot.occupied;
    if (prevOcc !== undefined && prevOcc !== currOcc) {
      const from = prevOcc ? "OCCUPIED" : "EMPTY";
      const to = currOcc ? "OCCUPIED" : "EMPTY";
      const validated = slot.sensor !== undefined ? slot.sensor === currOcc : true;
      recordEvent(id, from, to, validated);
    }
  }
  syncState.lastSlotStates = {};
  for (const [id, slot] of Object.entries(slots)) {
    syncState.lastSlotStates[id] = slot.occupied;
  }
}

// ===== HEARTBEAT =====
function startHeartbeat() {
  const hbRef = ref(db, "system");
  const write = async () => {
    try {
      await update(hbRef, {
        lastHeartbeat: Date.now(),
        esp32Online: true,
        wifi: true,
        freeHeap: "142KB",
        syncMode: syncState.currentMode,
        cloudTxCount: syncState.totalCloudTx,
      });
    } catch (_) {}
  };
  write();
  setInterval(write, 5000);
}
startHeartbeat();

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

function updateChart() {
  if (window._occChart) {
    const slots = allData.slots || {};
    const vals = Object.values(slots);
    const occupied = vals.filter((s) => s.occupied).length;
    const reserved = vals.filter((s) => s.reserved && !s.occupied).length;
    const total = Object.keys(slots).length || 4;
    window._occChart.data.datasets[0].data = [
      Math.max(0, total - occupied - reserved),
      occupied,
      reserved,
    ];
    window._occChart.update();
  }
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
  const cloudTxSpan = document.getElementById("adminCloudTx");
  if (cloudTxSpan) cloudTxSpan.innerText = syncState.totalCloudTx;
  const eventsValidatedSpan = document.getElementById("adminEventsValidated");
  if (eventsValidatedSpan) eventsValidatedSpan.innerText = syncState.validatedCount;
  updateESP32Status();
  updateChart();
}

// ===== EVENT RENDERERS =====
function updateEventStats() {
  const arrivalEl = document.getElementById("arrivalEvents");
  if (arrivalEl) arrivalEl.innerText = syncState.arrivalCount;
  const departureEl = document.getElementById("departureEvents");
  if (departureEl) departureEl.innerText = syncState.departureCount;
  const validatedEl = document.getElementById("validatedTransitions");
  if (validatedEl) validatedEl.innerText = syncState.validatedCount;
  const rejectedEl = document.getElementById("rejectedTransitions");
  if (rejectedEl) rejectedEl.innerText = syncState.rejectedCount;
  const badge = document.getElementById("eventCountBadge");
  if (badge) badge.textContent = `${syncState.events.length} حدث`;
}

function renderEvents() {
  const tbody = document.getElementById("eventsTable");
  if (!tbody) return;
  tbody.innerHTML = syncState.events.slice(0, 50).map((e) => {
    const transitionText = `${e.fromState} → ${e.toState}`;
    const transitionColor = e.toState === "OCCUPIED" ? "var(--green)" : "var(--red)";
    const validatedBadge = e.validated
      ? '<span style="background:rgba(16,185,129,0.1);color:#34d399;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;">✅ مُتحقق</span>'
      : '<span style="background:rgba(239,68,68,0.1);color:#f87171;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;">❌ مرفوض</span>';
    const txBadge = e.createdCloudTx
      ? '<span style="color:var(--accent);font-size:12px;">☁️ نعم</span>'
      : '<span style="color:var(--text-muted);font-size:12px;">— لا</span>';
    return `<tr>
      <td style="font-size:13px;color:var(--text-muted);direction:ltr;text-align:left;">${new Date(e.time).toLocaleTimeString("ar")}</td>
      <td><strong>${e.slotId}</strong></td>
      <td style="color:${transitionColor};font-weight:600;font-size:13px;">${transitionText}</td>
      <td>${validatedBadge}</td>
      <td>${txBadge}</td>
      <td style="font-size:12px;color:var(--text-muted);direction:ltr;text-align:left;">${e.latency}ms</td>
    </tr>`;
  }).join("");
}

function updateCloudSyncDisplay(latestEvent) {
  const syncStateEl = document.getElementById("syncStateDisplay");
  if (syncStateEl) {
    syncStateEl.innerHTML = latestEvent?.validated
      ? '<span style="color:var(--green);">🟢 متزامن</span>'
      : '<span style="color:var(--text-soft);">🟡 نشط</span>';
  }
  const latencyEl = document.getElementById("syncLatency");
  if (latencyEl) {
    const avg = syncState.latencyCount > 0
      ? Math.round(syncState.latencySum / syncState.latencyCount)
      : "--";
    latencyEl.innerText = avg !== "--" ? `${avg}ms` : "--";
  }
  const savedEl = document.getElementById("savedTransactions");
  if (savedEl) savedEl.innerText = syncState.savedTransactions;
  const eventModeEl = document.getElementById("eventModeDisplay");
  if (eventModeEl) eventModeEl.innerText = "انتقال حالة";
}

function updateFlowVisualizer(state, validated) {
  const sensorEl = document.getElementById("flowSensorState");
  if (sensorEl) {
    sensorEl.innerText = state === "OCCUPIED" ? "OCCUPIED" : "EMPTY";
    sensorEl.style.color = state === "OCCUPIED" ? "var(--red)" : "var(--green)";
  }
  const validationEl = document.getElementById("flowValidationState");
  if (validationEl) {
    validationEl.innerText = validated ? "✅ صالح" : "❌ مرفوض";
    validationEl.style.color = validated ? "var(--green)" : "var(--red)";
  }
  const cloudEl = document.getElementById("flowCloudState");
  if (cloudEl) {
    if (validated) {
      cloudEl.innerText = "☁️ تم";
      cloudEl.style.color = "var(--accent)";
    } else {
      cloudEl.innerText = "⏸️ تم التجنيب";
      cloudEl.style.color = "var(--text-muted)";
    }
  }
}

// ===== REMOTE CONTROL / OVERRIDE =====
window.setOverrideMode = async (mode) => {
  syncState.currentMode = mode;
  const modeLabels = {
    auto: "تلقائي",
    maintenance: "صيانة",
    fault_recovery: "استرداد أعطال",
    emergency: "طوارئ",
  };
  const modeIcons = {
    auto: "🤖",
    maintenance: "🔧",
    fault_recovery: "🛡️",
    emergency: "🚨",
  };

  document.querySelectorAll("[id^='overrideBtn']").forEach((el) => {
    el.classList.remove("active-mode");
  });
  document.querySelectorAll("[id^='overrideCheck']").forEach((el) => {
    el.style.borderColor = "var(--border)";
    el.style.background = "transparent";
    el.style.color = "transparent";
  });

  const btnMap = { auto: "overrideBtnAuto", maintenance: "overrideBtnMaintenance", fault_recovery: "overrideBtnFault", emergency: "overrideBtnEmergency" };
  const checkMap = { auto: "overrideCheckAuto", maintenance: "overrideCheckMaintenance", fault_recovery: "overrideCheckFault", emergency: "overrideCheckEmergency" };

  const btn = document.getElementById(btnMap[mode]);
  if (btn) btn.classList.add("active-mode");
  const check = document.getElementById(checkMap[mode]);
  if (check) {
    check.style.borderColor = "var(--accent)";
    check.style.background = "var(--accent)";
    check.style.color = "#fff";
  }

  const modeDisplay = document.getElementById("remoteModeDisplay");
  if (modeDisplay) modeDisplay.textContent = `${modeIcons[mode]} ${modeLabels[mode]}`;

  const overrideDisplay = document.getElementById("remoteOverrideDisplay");
  if (overrideDisplay) {
    overrideDisplay.textContent = mode === "auto" ? "غير نشط" : "نشط";
    overrideDisplay.style.color = mode === "auto" ? "var(--text-muted)" : "var(--amber)";
  }

  const lastOverrideEl = document.getElementById("remoteLastOverride");
  if (lastOverrideEl && mode !== "auto") {
    lastOverrideEl.textContent = new Date().toLocaleTimeString("ar");
  }

  try {
    await set(ref(db, "system/overrideMode"), mode);
    await set(ref(db, "system/overrideActive"), mode !== "auto");
    if (mode === "emergency") {
      await update(ref(db, "gates/entry"), { open: false, command: "close", override: true });
      await update(ref(db, "gates/exit"), { open: false, command: "close", override: true });
      showAlert("🚨 طوارئ - جميع البوابات مغلقة!", "error");
    }
    showAlert(`✅ تم تفعيل وضع: ${modeLabels[mode]}`, "success");
    logOverrideAction(`تغيير النمط إلى ${modeLabels[mode]}`, `تم التبديل من قبل المسؤول`);
  } catch (e) {
    showAlert("فشل تغيير النمط: " + e.message, "error");
  }
};

window.remoteGateControl = async (gate, open) => {
  const statusEl = document.getElementById(
    gate === "entry" ? "remoteEntryStatus" : "remoteExitStatus",
  );
  if (statusEl) statusEl.innerHTML = open ? "🟢 مفتوحة" : "🔴 مغلقة";

  const gateName = gate === "entry" ? "الدخول" : "الخروج";
  const action = open ? "فتح" : "إغلاق";

  try {
    await set(ref(db, `gates/${gate}/command`), open ? "open" : "close");
    await update(ref(db, `gates/${gate}`), {
      open,
      lastAction: Date.now(),
      override: syncState.currentMode !== "auto",
      overrideMode: syncState.currentMode,
    });

    if (syncState.currentMode !== "auto") {
      const reason = document.getElementById("overrideReason")?.value?.trim() || "تجاوز يدوي";
      await push(ref(db, "overrideLog"), {
        time: Date.now(),
        mode: syncState.currentMode,
        action: `${action} بوابة ${gateName}`,
        reason,
        performedBy: currentUser?.uid || "admin",
      });
    }

    showAlert(`✅ ${gateName}: ${action}`, "success");
    logOverrideAction(`${action} بوابة ${gateName}`, document.getElementById("overrideReason")?.value?.trim() || "");
  } catch (e) {
    showAlert("فشل التحكم عن بعد: " + e.message, "error");
  }
};

window.logOverrideAction = async (action, reason) => {
  const entry = {
    time: Date.now(),
    mode: syncState.currentMode,
    action: action || "إجراء يدوي",
    reason: reason || document.getElementById("overrideReason")?.value?.trim() || "غير محدد",
  };
  syncState.overrideLog.unshift(entry);
  if (syncState.overrideLog.length > 100) syncState.overrideLog.length = 100;
  renderOverrideLog();

  const reasonInput = document.getElementById("overrideReason");
  if (reasonInput) reasonInput.value = "";

  try {
    await push(ref(db, "overrideLog"), {
      ...entry,
      performedBy: currentUser?.uid || "admin",
    });
  } catch (_) {}

  showAlert("✅ تم تسجيل التجاوز", "success");
};

function renderOverrideLog() {
  const tbody = document.getElementById("overrideLogTable");
  if (!tbody) return;
  tbody.innerHTML = syncState.overrideLog.slice(0, 30).map((e) => {
    const modeLabels = { auto: "تلقائي", maintenance: "صيانة", fault_recovery: "استرداد أعطال", emergency: "طوارئ" };
    return `<tr>
      <td style="font-size:13px;color:var(--text-muted);">${new Date(e.time).toLocaleString("ar")}</td>
      <td>${modeLabels[e.mode] || e.mode}</td>
      <td>${e.action}</td>
      <td style="color:var(--text-muted);font-size:13px;">${e.reason}</td>
    </tr>`;
  }).join("");
}

// ===== SLOTS RENDER =====
function renderSlots() {
  const tbody = document.getElementById("slotsTable");
  if (!tbody) return;
  const slots = allData.slots || {};
  tbody.innerHTML = "";
  const statusBadge = (s) => {
    if (s.occupied)
      return '<span style="background:rgba(239,68,68,0.12);color:#f87171;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:600;">🔴 مشغول</span>';
    if (s.reserved)
      return '<span style="background:rgba(245,158,11,0.1);color:#fbbf24;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:600;">🟡 محجوز</span>';
    return '<span style="background:rgba(16,185,129,0.1);color:#34d399;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:600;">🟢 متاح</span>';
  };
  for (let [id, slot] of Object.entries(slots)) {
    tbody.innerHTML += `<tr>
      <td><strong>${id}</strong></td>
      <td>${statusBadge(slot)}</td>
      <td style="color:${slot.reservedBy ? "var(--text)" : "var(--text-muted)"}">${slot.reservedBy || "—"}</td>
      <td style="color:var(--text-muted);font-size:13px;">${slot.reservedUntil ? new Date(slot.reservedUntil).toLocaleString("ar") : "—"}</td>
    </tr>`;
  }
}

function renderReservations() {
  const tbody = document.getElementById("reservationsTable");
  if (!tbody) return;
  const reservations = allData.reservations || {};
  tbody.innerHTML = "";
  const resBadge = (status) => {
    if (status === "ACTIVE")
      return '<span style="background:rgba(16,185,129,0.1);color:#34d399;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">نشط</span>';
    if (status === "PENDING")
      return '<span style="background:rgba(245,158,11,0.1);color:#fbbf24;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">معلق</span>';
    if (status === "CANCELLED")
      return '<span style="background:rgba(239,68,68,0.08);color:#f87171;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">ملغي</span>';
    return `<span style="color:var(--text-muted)">${status}</span>`;
  };
  for (let [id, r] of Object.entries(reservations)) {
    if (r.status === "ACTIVE" || r.status === "PENDING") {
      tbody.innerHTML += `<tr>
        <td style="font-family:monospace;font-size:13px;color:var(--text-muted)">${r.userId?.slice(0, 8)}...</td>
        <td><strong>${r.slotId}</strong></td>
        <td>${resBadge(r.status)}</td>
        <td style="color:${r.expireTime && r.expireTime < Date.now() + 600000 ? "#f87171" : "var(--text-muted)"};font-size:13px;">${r.expireTime ? new Date(r.expireTime).toLocaleString("ar") : "—"}</td>
        <td style="font-family:monospace;font-size:14px;font-weight:600;letter-spacing:2px;">${r.otp?.code || "—"}</td>
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
      const expiresIn = Math.max(0, Math.floor((acc.expireAt - Date.now()) / 60000));
      tbody.innerHTML += `<tr>
        <td style="font-family:monospace;font-size:16px;font-weight:700;letter-spacing:3px;color:var(--accent);direction:ltr;">${acc.otp}</td>
        <td style="font-family:monospace;font-size:13px;color:var(--text-muted)">${acc.userId?.slice(0, 8)}..</td>
        <td><strong>${acc.slotId || "موظف"}</strong></td>
        <td style="color:${expiresIn < 5 ? "#f87171" : "var(--text-muted)"};font-size:13px;">${new Date(acc.expireAt).toLocaleString("ar")} <span style="font-size:11px;color:var(--text-muted)">(${expiresIn} د)</span></td>
        <td><button onclick="revokeCode('${id}')" style="background:rgba(239,68,68,0.1);color:#f87171;border:1px solid rgba(239,68,68,0.2);"><i class="fas fa-ban"></i> إلغاء</button></td>
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

// ===== ACTIONS =====
window.updateUserRole = async (uid, role) => {
  await update(ref(db, `users/${uid}`), { role });
  showAlert("✅ تم تحديث الدور", "success");
};
window.revokeCode = async (codeId) => {
  await update(ref(db, `liveAccess/${codeId}`), { active: false });
  showAlert("✅ تم إلغاء الكود", "success");
};
window.controlGate = async (gate, open) => {
  const statusEl = document.getElementById(
    gate === "entry" ? "entryGateStatus" : "exitGateStatus",
  );
  if (statusEl) statusEl.innerHTML = open ? "🟢 مفتوحة" : "🔴 مغلقة";
  showAlert(`${gate === "entry" ? "بوابة الدخول" : "بوابة الخروج"} ${open ? "مفتوحة ✅" : "مغلقة 🔒"}`, "success");
  try {
    await set(ref(db, `gates/${gate}/command`), open ? "open" : "close");
    await update(ref(db, `gates/${gate}`), { open, lastAction: Date.now() });
  } catch (e) {
    showAlert("فشل التحكم بالبوابة: " + e.message, "error");
  }
};

// ===== FIREBASE LISTENERS =====
onValue(ref(db, "slots"), (snap) => {
  const prevSlots = allData.slots;
  allData.slots = snap.val() || {};
  detectTransition(allData.slots);
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
  if (allData.system.overrideMode && allData.system.overrideMode !== syncState.currentMode) {
    window.setOverrideMode(allData.system.overrideMode);
  }
});
onValue(ref(db, "gates"), (snap) => {
  allData.gates = snap.val() || {};
  const entryGateSpan = document.getElementById("entryGateStatus");
  if (entryGateSpan)
    entryGateSpan.innerHTML = allData.gates.entry?.open ? "🟢 مفتوحة" : "🔴 مغلقة";
  const exitGateSpan = document.getElementById("exitGateStatus");
  if (exitGateSpan)
    exitGateSpan.innerHTML = allData.gates.exit?.open ? "🟢 مفتوحة" : "🔴 مغلقة";

  const remoteEntry = document.getElementById("remoteEntryStatus");
  if (remoteEntry) remoteEntry.innerHTML = allData.gates.entry?.open ? "🟢 مفتوحة" : "🔴 مغلقة";
  const remoteExit = document.getElementById("remoteExitStatus");
  if (remoteExit) remoteExit.innerHTML = allData.gates.exit?.open ? "🟢 مفتوحة" : "🔴 مغلقة";
});
onValue(ref(db, "logs"), (snap) => {
  allData.logs = snap.val() || {};
  renderLogs();
});

// Listen for override log from Firebase
onChildAdded(ref(db, "overrideLog"), (snap) => {
  const val = snap.val();
  if (val && !syncState.overrideLog.find((e) => e.time === val.time && e.action === val.action)) {
    syncState.overrideLog.unshift(val);
    if (syncState.overrideLog.length > 100) syncState.overrideLog.length = 100;
    renderOverrideLog();
  }
});

// ===== UI CONTROLS =====
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
if (refreshBtn) refreshBtn.addEventListener("click", () => updateDashboardStats());

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

// ===== NAVIGATION =====
document.querySelectorAll(".nav-item[data-section]").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
    const target = document.getElementById(item.dataset.section);
    if (target) target.classList.add("active");
    document.querySelectorAll(".nav-item").forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");
    if (item.dataset.section === "embedded_tools" && window._editor) {
      setTimeout(() => window._editor.refresh(), 100);
    }
  });
});

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (!user) window.location.href = "../index.html";
});

setInterval(() => {
  if (allData.system) updateESP32Status();
}, 5000);

console.log("✅ Event-Driven Cloud Admin Dashboard loaded");
