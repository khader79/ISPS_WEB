/**
 * Universal Reload Protection
 * Prevents accidental page refreshes from:
 * - Live Server extensions
 * - Auto-reload extensions
 * - External watchers
 * - Network errors
 */

(function () {
  "use strict";

  // Track reload attempts for logging
  let reloadAttempts = [];

  // Flag to allow intentional reloads
  window.__allowReload = false;

  // Store original reload function
  const originalReload = window.location.reload;

  // Block any reload attempts that aren't explicitly allowed
  window.location.reload = function () {
    if (window.__allowReload) {
      window.__allowReload = false;
      return originalReload.call(window.location);
    }
    const stack = new Error().stack || "";
    reloadAttempts.push({
      time: new Date().toLocaleTimeString("ar"),
      stack: stack.split("\n").slice(1, 3).join(" "),
    });
    console.warn(
      "⚠️ Reload attempt blocked:",
      reloadAttempts[reloadAttempts.length - 1],
    );
  };

  // Block location changes (but allow intentional navigation)
  const originalLocationReplace = window.location.replace;
  window.location.replace = function (url) {
    if (window.__allowReload || url !== window.location.href) {
      window.__allowReload = false;
      return originalLocationReplace.call(window.location, url);
    }
    console.warn("⚠️ Redirect attempt blocked to:", url);
  };

  // Use Object.defineProperty for read-only properties
  try {
    Object.defineProperty(window.location, "reload", {
      value: function () {
        if (window.__allowReload) {
          window.__allowReload = false;
          return originalReload.call(window.location);
        }
        const stack = new Error().stack || "";
        reloadAttempts.push({
          time: new Date().toLocaleTimeString("ar"),
          stack: stack.split("\n").slice(1, 3).join(" "),
        });
        console.warn("🛡️ Reload attempt blocked at:", stack.split("\n")[1]);
      },
      writable: false,
      configurable: false,
    });
  } catch (e) {
    console.warn(
      "Note: Could not override location.reload (may be prevented by browser security)",
    );
  }

  // Monitor unload/beforeunload events (which trigger reloads)
  window.addEventListener(
    "beforeunload",
    function (e) {
      // Allow legitimate navigation only
      if (window.__allowReload === true) return;
      // Silently block accidental reloads
    },
    true,
  );

  // Expose utility to allow intentional reloads when needed
  window.safeReload = function (delayMs = 0) {
    window.__allowReload = true;
    setTimeout(() => {
      window.location.reload();
    }, delayMs);
  };

  // Log all reload attempts (for debugging)
  window.getReloadAttempts = () => reloadAttempts;

  console.log("🛡️ Reload protection enabled");
})();
