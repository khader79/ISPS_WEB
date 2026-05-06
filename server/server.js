const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs-extra");
const { exec } = require("child_process");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// إعداد رفع الملفات المؤقتة
const upload = multer({ dest: "uploads/" });

// مسار أدوات arduino-cli (حمّل يدوياً أو استخدم المسار المطلق)
const ARDUINO_CLI_PATH = process.env.ARDUINO_CLI_PATH || "arduino-cli";

// التأكد من وجود arduino-cli
console.log(
  "✅ Server started. Make sure arduino-cli is installed and in PATH.",
);

// نقطة النهاية: تجميع الكود
app.post("/compile", upload.single("code"), async (req, res) => {
  const { boardFqbn } = req.body; // e.g., "arduino:avr:uno" or "esp32:esp32:esp32"
  if (!boardFqbn) {
    return res.status(400).json({ error: "FQBN is required" });
  }
  const codeFile = req.file;
  if (!codeFile) {
    return res.status(400).json({ error: "No code file uploaded" });
  }

  const sketchPath = path.join(
    __dirname,
    "uploads",
    codeFile.filename + "_sketch",
  );
  await fs.ensureDir(sketchPath);
  const inoPath = path.join(sketchPath, "sketch.ino");
  await fs.move(codeFile.path, inoPath, { overwrite: true });

  // إضافة المكتبات الشائعة تلقائياً (اختياري)
  const libs = [
    "WiFi",
    "Firebase_ESP_Client",
    "LiquidCrystal_I2C",
    "ESP32Servo",
  ];

  let compileCmd = `${ARDUINO_CLI_PATH} compile --fqbn ${boardFqbn} ${sketchPath}`;
  // إضافة المكتبات إذا وجدت
  for (let lib of libs) {
    compileCmd += ` --libraries "${path.join(__dirname, "libs", lib)}"`; // هذا يتطلب تثبيت المكتبات مسبقاً
  }

  exec(
    compileCmd,
    { maxBuffer: 10 * 1024 * 1024 },
    async (error, stdout, stderr) => {
      if (error) {
        console.error(stderr);
        return res.status(500).json({ error: stderr || error.message });
      }
      // البحث عن ملف bin الناتج
      const buildDir = path.join(sketchPath, "build");
      const files = await fs.readdir(buildDir);
      const binFile = files.find(
        (f) => f.endsWith(".bin") || f.endsWith(".hex"),
      );
      if (!binFile) {
        return res
          .status(500)
          .json({ error: "Compilation succeeded but no binary found" });
      }
      const binPath = path.join(buildDir, binFile);
      const binData = await fs.readFile(binPath);
      // إرسال الملف الثنائي
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename=firmware.bin`);
      res.send(binData);
      // تنظيف: حذف المجلد بعد 5 دقائق
      setTimeout(
        () => fs.remove(sketchPath).catch(console.error),
        5 * 60 * 1000,
      );
    },
  );
});

app.listen(PORT, () =>
  console.log(`🔥 Compiler server running on port ${PORT}`),
);
