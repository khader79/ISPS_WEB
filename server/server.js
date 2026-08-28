const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs-extra");
const { exec, execSync } = require("child_process");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.text({ limit: "5mb" }));

const WORK_DIR = path.join(os.tmpdir(), "smart-parking-compiler");
const UPLOAD_DIR = path.join(WORK_DIR, "uploads");
const CLI_PATH = path.join(__dirname, "arduino-cli", "arduino-cli.exe");
const BUILD_DIR = path.join(WORK_DIR, "builds");

const upload = multer({ dest: UPLOAD_DIR });

fs.ensureDirSync(BUILD_DIR);
fs.ensureDirSync(UPLOAD_DIR);

console.log("✅ Compiler server starting...");
console.log(`🔧 arduino-cli: ${CLI_PATH}`);

// List available boards
app.get("/boards", (req, res) => {
  exec(
    `"${CLI_PATH}" board listall --format json`,
    { maxBuffer: 50 * 1024 * 1024 },
    (err, stdout) => {
      if (err) return res.json({ boards: [] });
      try {
        const data = JSON.parse(stdout);
        res.json(data);
      } catch {
        res.json({ boards: [] });
      }
    },
  );
});

// List installed libraries
app.get("/libs", (req, res) => {
  exec(`"${CLI_PATH}" lib list --format json`, (err, stdout) => {
    if (err) return res.json({ libs: [] });
    try {
      res.json(JSON.parse(stdout));
    } catch {
      res.json({ libs: [] });
    }
  });
});

// Compile endpoint
app.post("/compile", upload.single("code"), async (req, res) => {
  const boardFqbn = req.body.boardFqbn || "esp32:esp32:esp32";
  let code = "";

  if (req.file) {
    code = await fs.readFile(req.file.path, "utf8");
    await fs.remove(req.file.path).catch(() => {});
  } else if (req.body.code) {
    code = req.body.code;
  } else if (typeof req.body === "string") {
    code = req.body;
  }

  if (!code || !code.trim()) {
    return res.status(400).json({ error: "No code provided" });
  }

  const sketchId = crypto.randomBytes(8).toString("hex");
  const sketchPath = path.join(UPLOAD_DIR, `sketch_${sketchId}`);
  const buildPath = path.join(BUILD_DIR, sketchId);

  try {
    await fs.ensureDir(sketchPath);
    await fs.ensureDir(buildPath);
    const sketchName = `sketch_${sketchId}`;
    await fs.writeFile(path.join(sketchPath, `${sketchName}.ino`), code);

    const cmd = `"${CLI_PATH}" compile --fqbn ${boardFqbn} --build-path "${buildPath}" "${sketchPath}"`;

    console.log(`🔨 Compiling ${sketchId}...`);

    exec(
      cmd,
      { maxBuffer: 50 * 1024 * 1024, timeout: 120000 },
      async (error, stdout, stderr) => {
        if (error) {
          console.error(`❌ Compile failed: ${sketchId}`);
          await fs.remove(sketchPath).catch(() => {});
          await fs.remove(buildPath).catch(() => {});
          return res.status(500).json({
            error: stderr || error.message,
            stdout: stdout || "",
          });
        }

        console.log(`✅ Compiled: ${sketchId}`);

        try {
          const files = await fs.readdir(buildPath);
          const binFile = files.find((f) => f.endsWith(".bin"));
          if (!binFile) {
            throw new Error("No .bin file found in build output");
          }
          const binPath = path.join(buildPath, binFile);
          const binData = await fs.readFile(binPath);

          res.json({
            success: true,
            sketchId,
            binary: binData.toString("base64"),
            fileName: binFile,
            size: binData.length,
          });

          setTimeout(
            () => {
              fs.remove(sketchPath).catch(() => {});
              fs.remove(buildPath).catch(() => {});
            },
            5 * 60 * 1000,
          );
        } catch (e) {
          res
            .status(500)
            .json({
              error: "Compilation OK but binary not found: " + e.message,
            });
        }
      },
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`🔥 Compiler server running on http://localhost:${PORT}`);
  console.log(`   POST /compile  — compile Arduino code`);
  console.log(`   GET  /boards   — list supported boards`);
  console.log(`   GET  /libs     — list installed libraries`);
});
