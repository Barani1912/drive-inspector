// ============================================================
//  Drive & Folder Size Analyzer — Ultimate High Performance Edition
//  Features: Interactive Treemap, Category Breakdown, Reveal in Explorer,
//            Offline Rules Engine, Compact Dynamic Renderer & In-Browser Scan
//  Usage:  node index.js [--path C:\] [--port 7654] [--no-ai]
// ============================================================

"use strict";

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const http  = require("http");
const url   = require("url");
const { exec } = require("child_process");

// ---------- 1. CLI ARGS & .ENV LOADER ----------
(function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  } catch (_) {}
})();

// Parse CLI flags
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--path" && args[i + 1]) process.env.SCAN_PATH = args[++i];
  else if (arg === "--port" && args[i + 1]) process.env.PORT = args[++i];
  else if (arg === "--out" && args[i + 1]) process.env.OUT_DIR = args[++i];
  else if (arg === "--no-ai") process.env.ENABLE_AI = "false";
  else if (arg === "--ai") process.env.ENABLE_AI = "true";
  else if (arg === "--md") process.env.WRITE_MD = "true";
}

// ---------- 2. CONFIGURATION ----------
let ROOT_DIR = process.env.SCAN_PATH
  ? path.resolve(process.env.SCAN_PATH)
  : "C:\\";

const GB_BYTES          = 1073741824;
const GEMINI_API_KEY    = process.env.API_KEY || "";
const GEMINI_BATCH_SIZE = 100;
let SERVER_PORT         = Number(process.env.PORT) || 7654;
const ENABLE_AI         = (process.env.ENABLE_AI || "false").toLowerCase() === "true";
const WRITE_MD          = (process.env.WRITE_MD || "").toLowerCase() === "true";

const OUT_DIR = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : process.cwd();

let isScanInProgress = false;

function deriveBaseName(scanPath) {
  const norm = path.resolve(scanPath);
  const driveMatch = norm.match(/^([A-Za-z]):[/\\]?$/);
  if (driveMatch) return `${driveMatch[1].toLowerCase()}-drive`;
  const parts = norm.replace(/[/\\]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return parts || "scan";
}

let BASE_NAME   = deriveBaseName(ROOT_DIR);
let OUT_HTML    = path.join(OUT_DIR, `${BASE_NAME}-tree.html`);
const OUT_STATUS  = path.join(OUT_DIR, "status.json");
const OUT_PATCHES = path.join(OUT_DIR, "patches.json");
let OUT_MD      = path.join(OUT_DIR, `${BASE_NAME}-report.md`);

// ---------- 3. OFFLINE CLEANUP RULES & CATEGORY CLASSIFIER ----------
const FOLDER_CLEANUP_RULES = new Map([
  ["node_modules", "Node.js dependencies. Recreated via 'npm install'."],
  [".next", "Next.js build cache and compiled pages."],
  [".nuxt", "Nuxt.js build output. Safe to delete."],
  [".turbo", "Turborepo build cache. Safe to delete."],
  [".svelte-kit", "SvelteKit build artifacts. Safe to delete."],
  ["dist", "Compiled distribution artifacts. Rebuildable from source."],
  ["build", "Build output directory. Rebuildable from source."],
  ["out", "Exported build directory. Rebuildable from source."],
  ["target", "Rust/Java/Maven build output directory."],
  ["bin", "Compiled binary directory. Safe to remove if buildable from source."],
  ["obj", "Intermediate compiler artifacts."],
  ["__pycache__", "Python bytecode cache files."],
  [".pytest_cache", "PyTest cache and temporary data."],
  [".mypy_cache", "Mypy type check cache."],
  [".tox", "Python Tox virtualenvs and test artifacts."],
  [".venv", "Python virtual environment. Recreated with requirements.txt."],
  ["venv", "Python virtual environment. Recreated with requirements.txt."],
  ["env", "Python virtual environment."],
  [".gradle", "Gradle build cache and daemon logs."],
  [".dart_tool", "Dart/Flutter build tools cache."],
  ["pods", "CocoaPods iOS dependencies."],

  ["temp", "Temporary files directory. Safe to clean."],
  ["tmp", "Temporary files directory. Safe to clean."],
  ["cache", "Application cache directory. Safe to clear."],
  [".cache", "User cache directory. Safe to clear."],
  ["caches", "Application cache storage."],
  ["cachestorage", "Web and browser cache storage."],
  ["code cache", "Chromium/Electron V8 bytecode cache."],
  ["gpucache", "GPU shader and texture cache."],
  ["dawncache", "WebGPU shader cache."],
  ["shadercache", "Graphics shader cache."],
  ["crashdumps", "Application crash memory dumps."],
  ["logs", "Application log files."],
  ["log", "Log files."],

  ["npm-cache", "NPM global cache. Safe to clean (npm cache clean --force)."],
  ["yarn-cache", "Yarn package cache. Safe to clear (yarn cache clean)."],
  ["pnpm-store", "PNPM global package store."],
  ["pip", "Python pip cache. Safe to clean."],
  ["nuget", "NuGet package cache."],

  ["deliveryoptimization", "Windows Update peer delivery cache."],
  ["softwaredistribution", "Windows Update cache."],
  ["$recycle.bin", "Windows Recycle Bin deleted files container."],
  ["windows.old", "Previous Windows installation backup."],
  ["msdownld.tmp", "Old Microsoft setup temporary files."]
]);

const FILE_EXT_CLEANUP_RULES = new Map([
  [".tmp", "Temporary file. Safe to delete."],
  [".temp", "Temporary file. Safe to delete."],
  [".log", "Log file. Safe to delete or archive."],
  [".bak", "Backup copy. Safe to delete if original is intact."],
  [".old", "Old backup file."],
  [".dmp", "System / application crash dump."],
  [".mdmp", "Minidump crash report."],
  [".crdownload", "Incomplete Chrome/Edge download file."],
  [".part", "Incomplete download part file."],
  [".chk", "Recovered file fragment from chkdsk."],
  [".thumb", "Cached image thumbnail."],
  [".swp", "Vim / editor swap file."]
]);

const EXACT_FILE_RULES = new Map([
  ["thumbs.db", "Windows thumbnail cache database."],
  [".ds_store", "macOS folder display metadata."],
  ["ehthumbs.db", "Windows Media Center thumbnail cache."],
  ["desktop.ini", "Custom folder view settings."],
  ["npm-debug.log", "NPM error log file."],
  ["yarn-error.log", "Yarn error log file."],
  ["pnpm-debug.log", "PNPM error log file."]
]);

function getOfflineCleanupReason(name, isFolder) {
  const lower = (name || "").toLowerCase();
  if (isFolder) {
    if (FOLDER_CLEANUP_RULES.has(lower)) return FOLDER_CLEANUP_RULES.get(lower);
  } else {
    if (EXACT_FILE_RULES.has(lower)) return EXACT_FILE_RULES.get(lower);
    const ext = path.extname(lower);
    if (FILE_EXT_CLEANUP_RULES.has(ext)) return FILE_EXT_CLEANUP_RULES.get(ext);
  }
  return null;
}

function getItemCategory(name, isFolder, isRemovable) {
  if (isRemovable) return "removable";
  const lower = (name || "").toLowerCase();
  if (isFolder) {
    if (["node_modules", ".next", ".nuxt", "dist", "build", "target", "bin", "obj", "__pycache__", ".venv", "venv", ".gradle"].includes(lower)) return "dev";
    if (["temp", "tmp", "cache", ".cache", "caches", "crashdumps", "logs"].includes(lower)) return "cache";
    return "folder";
  }
  const ext = path.extname(lower);
  if ([".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mp3", ".wav", ".flac", ".aac", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".psd", ".ai"].includes(ext)) return "media";
  if ([".zip", ".rar", ".7z", ".tar", ".gz", ".iso", ".vhd", ".vhdx", ".wim", ".cab", ".dmg"].includes(ext)) return "archive";
  if ([".exe", ".msi", ".dll", ".sys", ".app", ".dmg", ".deb", ".rpm"].includes(ext)) return "binary";
  if ([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md"].includes(ext)) return "document";
  if ([".js", ".ts", ".jsx", ".tsx", ".py", ".rs", ".go", ".cpp", ".c", ".h", ".java", ".html", ".css", ".json", ".yaml", ".yml", ".sql"].includes(ext)) return "code";
  return "other";
}

// ---------- 4. HELPERS ----------
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${u[i]}`;
}

function escapeHtml(t) {
  return String(t || "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeMd(t) {
  return String(t || "").replaceAll("*", "\\*").replaceAll("_", "\\_").replaceAll("`", "\\`");
}

function safeName(fullPath, isRoot = false) {
  if (isRoot) return ROOT_DIR.endsWith("\\") || ROOT_DIR.endsWith("/") ? ROOT_DIR : ROOT_DIR + path.sep;
  return path.basename(fullPath) || fullPath;
}

function sortEntries(a, b) {
  const sa = typeof a.size === "number" ? a.size : 0;
  const sb = typeof b.size === "number" ? b.size : 0;
  if (sb !== sa) return sb - sa;
  return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
}

function countGbItems(node) {
  let c = 0;
  if (typeof node.size === "number" && node.size >= GB_BYTES) c++;
  if (node.children) for (const ch of node.children) c += countGbItems(ch);
  return c;
}

let scanTelemetry = {
  files: 0,
  folders: 0,
  bytes: 0,
  currentPath: "",
  startTime: Date.now(),
  lastStatusWrite: 0
};

function writeStatus(phase, batch = 0, total = 0, found = 0, message = "", extra = {}) {
  try {
    const elapsedSec = Math.floor((Date.now() - (scanTelemetry.startTime || Date.now())) / 1000);
    fs.writeFileSync(
      OUT_STATUS,
      JSON.stringify({
        phase,
        batch,
        total,
        found,
        message,
        target: ROOT_DIR,
        baseName: BASE_NAME,
        files: extra.files !== undefined ? extra.files : scanTelemetry.files,
        folders: extra.folders !== undefined ? extra.folders : scanTelemetry.folders,
        bytes: extra.bytes !== undefined ? extra.bytes : scanTelemetry.bytes,
        bytesFormatted: extra.bytesFormatted || formatBytes(extra.bytes !== undefined ? extra.bytes : scanTelemetry.bytes),
        currentPath: extra.currentPath || scanTelemetry.currentPath || ROOT_DIR,
        elapsed: extra.elapsed !== undefined ? extra.elapsed : elapsedSec,
        ts: Date.now()
      }),
      "utf8"
    );
  } catch (_) {}
}

function maybeWriteScanStatus(force = false) {
  const now = Date.now();
  if (force || now - scanTelemetry.lastStatusWrite > 250) {
    scanTelemetry.lastStatusWrite = now;
    writeStatus("scan", 0, 0, 0, `Scanning ${ROOT_DIR}…`);
  }
}

function writePatchesJson(removableMap) {
  const obj = {};
  for (const [k, v] of removableMap) obj[k] = v;
  try {
    fs.writeFileSync(OUT_PATCHES, JSON.stringify({ removable: obj }), "utf8");
  } catch (err) {
    console.warn("  Could not write patches.json:", err.message);
  }
}

function openBrowser(url) {
  const cmd =
    process.platform === "win32"  ? `start "" "${url}"` :
    process.platform === "darwin" ? `open "${url}"` :
                                    `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.warn("  Could not auto-open browser:", err.message);
  });
}

function revealInOSExplorer(targetPath) {
  if (!targetPath) return;
  let checkPath = targetPath;
  try {
    fs.accessSync(checkPath, fs.constants.R_OK);
  } catch (_) {
    // If permission or access is denied, fallback to the parent directory
    checkPath = path.dirname(checkPath);
  }
  if (!fs.existsSync(checkPath)) return;

  let cmd = "";
  if (process.platform === "win32") {
    cmd = `explorer.exe /select,"${checkPath}"`;
  } else if (process.platform === "darwin") {
    cmd = `open -R "${checkPath}"`;
  } else {
    cmd = `xdg-open "${path.dirname(checkPath)}"`;
  }
  exec(cmd, () => {
    // Quietly complete to avoid terminal warning spam on locked directories
  });
}

// ---------- 5. SCANNER WITH STATS ACCUMULATOR ----------
const SKIP_SYSTEM_DIRS = new Set([
  "$recycle.bin",
  "system volume information",
  "$winreagent",
  "config.msi",
  "winsxs"
]);

async function scanNode(fullPath, isRoot = false) {
  let stat;
  try {
    stat = await fs.promises.lstat(fullPath);
  } catch (err) {
    return {
      type: "error",
      name: safeName(fullPath, isRoot),
      path: fullPath,
      error: `Cannot access: ${err.code || err.message}`
    };
  }

  if (stat.isSymbolicLink()) {
    return {
      type: "skipped",
      name: safeName(fullPath, isRoot),
      path: fullPath,
      reason: "Symbolic link skipped"
    };
  }

  if (stat.isFile()) {
    const fname = safeName(fullPath, isRoot);
    const offlineReason = getOfflineCleanupReason(fname, false);
    return {
      type: "file",
      name: fname,
      path: fullPath,
      size: stat.size,
      isSelfRemovable: !!offlineReason,
      removableReason: offlineReason || null,
      removableBytes: offlineReason ? stat.size : 0
    };
  }

  if (!stat.isDirectory()) {
    return {
      type: "skipped",
      name: safeName(fullPath, isRoot),
      path: fullPath,
      reason: "Non-standard filesystem node"
    };
  }

  const nameLower = (path.basename(fullPath) || "").toLowerCase();
  if (!isRoot && SKIP_SYSTEM_DIRS.has(nameLower)) {
    return {
      type: "skipped",
      name: safeName(fullPath, isRoot),
      path: fullPath,
      reason: "System directory skipped"
    };
  }

  const folderName = safeName(fullPath, isRoot);
  scanTelemetry.folders++;
  scanTelemetry.currentPath = fullPath;
  maybeWriteScanStatus();

  const folderOfflineReason = isRoot ? null : getOfflineCleanupReason(folderName, true);

  let dirEntries = [];
  try {
    dirEntries = await fs.promises.readdir(fullPath, { withFileTypes: true });
  } catch (err) {
    return {
      type: "error",
      name: folderName,
      path: fullPath,
      error: `Cannot read directory: ${err.code || err.message}`
    };
  }

  const children = [];
  let totalSize = 0, fileCount = 0, folderCount = 0;
  let removableChildCount = 0, removableBytes = 0;

  const CHUNK_SIZE = 32;
  for (let i = 0; i < dirEntries.length; i += CHUNK_SIZE) {
    const chunk = dirEntries.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(chunk.map(async (entry) => {
      if (entry.isSymbolicLink()) return null;
      const childPath = path.join(fullPath, entry.name);
      try {
        return await scanNode(childPath, false);
      } catch (err) {
        return {
          type: "error",
          name: entry.name,
          path: childPath,
          error: err.code || err.message
        };
      }
    }));

    for (const child of results) {
      if (!child) continue;
      children.push(child);
      if (child.type === "file") {
        totalSize += child.size;
        fileCount += 1;
        scanTelemetry.files++;
        scanTelemetry.bytes += child.size;
        if (child.isSelfRemovable) {
          removableChildCount += 1;
          removableBytes += (child.removableBytes || child.size);
        }
      } else if (child.type === "folder") {
        totalSize += child.size;
        fileCount += child.fileCount;
        folderCount += 1 + child.folderCount;
        removableChildCount += (child.removableChildCount || 0) + (child.isSelfRemovable ? 1 : 0);
        removableBytes += (child.removableBytes || 0);
      }
    }
    maybeWriteScanStatus();
  }

  const isSelfRemovable = !!folderOfflineReason;
  if (isSelfRemovable) {
    removableBytes = totalSize;
  }

  children.sort(sortEntries);

  return {
    type: "folder",
    name: folderName,
    path: fullPath,
    size: totalSize,
    fileCount,
    folderCount,
    isSelfRemovable,
    removableReason: folderOfflineReason || null,
    removableChildCount,
    removableBytes,
    children
  };
}

// Category statistics aggregator
function calculateCategoryBreakdown(node) {
  const breakdown = {
    media: 0,
    archive: 0,
    dev: 0,
    cache: 0,
    binary: 0,
    document: 0,
    code: 0,
    other: 0,
    removable: 0
  };

  function traverse(n) {
    if (!n) return;
    const isFolder = n.type === "folder" || n.t === "d";
    const isRemovable = n.isSelfRemovable || n.rm === 1;
    const sz = n.size || n.s || 0;

    if (isRemovable) {
      breakdown.removable += sz;
    }

    if (!isFolder) {
      const cat = getItemCategory(n.name || n.n, false, isRemovable);
      if (breakdown[cat] !== undefined) breakdown[cat] += sz;
      else breakdown.other += sz;
    } else {
      if (n.children) for (const ch of n.children) traverse(ch);
      else if (n.c) for (const ch of n.c) traverse(ch);
    }
  }

  traverse(node);
  return breakdown;
}

// ---------- 6. TARGETED GEMINI AI CLASSIFICATION ----------
function callGemini(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    });
    const options = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
          resolve({ statusCode: res.statusCode, text });
        } catch (e) {
          reject(new Error("Failed to parse Gemini response: " + e.message));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function collectUnclassifiedLargeNames(node, nameSet) {
  if (!node || !node.name) return;
  if (!node.isSelfRemovable && node.size >= 50 * 1024 * 1024) {
    nameSet.add(node.name);
  }
  if (node.children) {
    for (const ch of node.children) collectUnclassifiedLargeNames(ch, nameSet);
  }
}

async function classifyTargetedNames(names, apiKey) {
  const removableMap = new Map();
  if (!ENABLE_AI || !apiKey || names.size === 0) return removableMap;

  const nameArr = [...names];
  const batches = [];
  for (let i = 0; i < nameArr.length; i += GEMINI_BATCH_SIZE)
    batches.push(nameArr.slice(i, i + GEMINI_BATCH_SIZE));

  console.log(`  [AI] ${nameArr.length} targeted items for AI review → ${batches.length} batch(es).`);
  writeStatus("ai", 0, batches.length, 0, `Targeted AI analysis (${nameArr.length} items)…`);

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const prompt = `You are a disk cleanup specialist analyzing file and folder NAMES only.
For each name safe to delete (caches, build artifacts, logs, backups, old temp data):
Return a JSON array: [{"name":"<name>","reason":"<short 1 sentence reason>"}]
If nothing is removable, return [].

Names to review:
${JSON.stringify(batch)}`;

    try {
      const { statusCode, text } = await callGemini(apiKey, prompt);
      if (statusCode === 429) {
        console.warn(`  [AI] Rate limited. Retrying after 30s…`);
        await new Promise((r) => setTimeout(r, 30000));
        bi--;
        continue;
      }
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.name) removableMap.set(item.name, item.reason || "Safe to remove according to AI analysis.");
        }
      }
    } catch (err) {
      console.warn(`  [AI] Batch ${bi + 1} error: ${err.message}`);
    }

    writeStatus("ai", bi + 1, batches.length, removableMap.size, `AI review completed ${bi + 1}/${batches.length}.`);
    if (bi < batches.length - 1) await new Promise((r) => setTimeout(r, 400));
  }
  return removableMap;
}

function applyAiPatchesToTree(node, removableMap) {
  if (removableMap.has(node.name)) {
    node.isSelfRemovable = true;
    node.removableReason = removableMap.get(node.name);
    node.removableBytes = node.size;
  }

  let childRm = node.isSelfRemovable ? 1 : 0;
  let childRmBytes = node.isSelfRemovable ? node.size : 0;

  if (node.children && node.children.length > 0) {
    for (const ch of node.children) {
      const chResult = applyAiPatchesToTree(ch, removableMap);
      childRm += chResult.count;
      childRmBytes += chResult.bytes;
    }
  }

  node.removableChildCount = childRm;
  node.removableBytes = Math.max(node.removableBytes || 0, childRmBytes);
  return { count: childRm, bytes: childRmBytes };
}

// ---------- 7. COMPACT TREE SERIALIZER ----------
function toCompactTree(node) {
  if (!node) return null;
  const item = {
    n: node.name,
    p: node.path,
    t: node.type === "folder" ? "d" : (node.type === "file" ? "f" : (node.type === "error" ? "e" : "s")),
    s: node.size || 0
  };

  if (node.fileCount)   item.fc = node.fileCount;
  if (node.folderCount) item.dc = node.folderCount;
  if (node.isSelfRemovable) {
    item.rm = 1;
    if (node.removableReason) item.rmr = node.removableReason;
  }
  if (node.removableChildCount) item.rc = node.removableChildCount;
  if (node.removableBytes)      item.rb = node.removableBytes;
  if (node.error)               item.err = node.error;
  if (node.reason)              item.rsn = node.reason;

  if (node.children && node.children.length > 0) {
    const IMPORTANT_MIN = 500 * 1024;
    const directChildren = [];
    const smallFiles = [];

    for (const ch of node.children) {
      if (ch.type === "file" && !ch.isSelfRemovable && ch.size < IMPORTANT_MIN) {
        smallFiles.push(ch);
      } else {
        directChildren.push(toCompactTree(ch));
      }
    }

    if (smallFiles.length > 12) {
      const smallTotal = smallFiles.reduce((acc, f) => acc + (f.size || 0), 0);
      directChildren.push({
        n: `${smallFiles.length.toLocaleString()} smaller files (< 500 KB)`,
        p: node.path,
        t: "f",
        s: smallTotal,
        fc: smallFiles.length,
        isSmallGroup: 1
      });
    } else {
      for (const f of smallFiles) directChildren.push(toCompactTree(f));
    }

    item.c = directChildren;
  }

  return item;
}

// ---------- 8. ULTIMATE DYNAMIC HTML REPORT WITH TREEMAP & EXPLORER ----------
function generateDynamicHtml(compactRoot, meta, categoryStats) {
  const jsonData = JSON.stringify(compactRoot);
  const jsonCategories = JSON.stringify(categoryStats);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(meta.rootName)} — DiskScope</title>
<meta name="description" content="Interactive Drive Size Analyzer with Treemap and File Explorer integration"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
:root {
  --bg: #f8faf6;
  --surface: #ffffff;
  --surface2: #eff4ec;
  --border: #d4ded0;
  --border-focus: #4b6b44;
  --text: #1d2719;
  --muted: #53664d;
  --faint: #7d9177;
  
  --primary: #3d5a36;
  --primary-light: #577b4e;
  --primary-surface: #e9f0e6;
  
  --cat-media: #8e44ad;
  --cat-archive: #2980b9;
  --cat-removable: #c0392b;
  --cat-dev: #d35400;
  --cat-binary: #34495e;
  --cat-doc: #27ae60;
  --cat-other: #7f8c8d;
  
  --amber: #b87a14;
  --amber-bg: rgba(184, 122, 20, 0.10);
  --red: #c0392b;
  --red-bg: rgba(192, 57, 43, 0.09);
  --orange: #d96814;
  --orange-bg: rgba(217, 104, 20, 0.10);
  
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --shadow: 0 2px 10px rgba(45, 60, 40, 0.07);
  --shadow-hover: 0 6px 20px rgba(45, 60, 40, 0.12);
  
  --font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --mono: "JetBrains Mono", "Consolas", monospace;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 14px;
  line-height: 1.5;
  padding: 24px 20px 60px;
  min-height: 100vh;
}

.wrap { max-width: 1440px; margin: 0 auto; }

/* Header */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 2px solid var(--border);
}
.page-title {
  font-family: "Outfit", var(--font);
  font-size: 1.85rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  color: var(--primary);
  display: flex;
  align-items: center;
}
.scan-path {
  font-family: var(--mono);
  font-size: 0.85rem;
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--primary);
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  display: inline-block;
  margin-top: 6px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.scan-input-group {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}
.scan-input {
  border: none;
  outline: none;
  font-family: var(--mono);
  font-size: 0.85rem;
  padding: 4px 6px;
  width: 150px;
}

/* Category Breakdown Bar */
.category-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px 18px;
  margin-bottom: 18px;
  box-shadow: var(--shadow);
}
.category-header {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.category-bar {
  display: flex;
  height: 12px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--border);
  margin-bottom: 12px;
}
.cat-segment {
  height: 100%;
  transition: opacity 0.2s;
  cursor: pointer;
}
.cat-segment:hover { opacity: 0.85; }
.category-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.15s;
}
.legend-item:hover { background: var(--surface2); }
.legend-dot { width: 10px; height: 10px; border-radius: 3px; }

/* Stats Cards */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}
.stat-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  box-shadow: var(--shadow);
}
.stat-label {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--faint);
  margin-bottom: 4px;
}
.stat-value {
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--text);
  font-family: var(--mono);
}
.s-gb .stat-value { color: var(--amber); }
.s-rm .stat-value { color: var(--red); }

/* Control Toolbar */
.ctrl-bar {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 10px 16px;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  box-shadow: var(--shadow);
}
.btn-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.btn {
  background: var(--primary);
  color: #fff;
  border: 1px solid transparent;
  padding: 6px 12px;
  font-size: 0.82rem;
  font-weight: 600;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}
.btn:hover { background: var(--primary-light); }
.btn-outline {
  background: var(--surface2);
  color: var(--primary);
  border-color: var(--border);
}
.btn-outline:hover { background: var(--primary-surface); }
.btn-tab {
  background: var(--surface2);
  color: var(--muted);
  border-color: var(--border);
}
.btn-tab.active {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.filter-label {
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface2);
  user-select: none;
}
.filter-label:has(input:checked) {
  background: var(--primary-surface);
  border-color: var(--primary-light);
  color: var(--primary);
  font-weight: 600;
}

/* Search box removed */

/* Tree Container & Treemap Views */
#tree-root {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  box-shadow: var(--shadow);
  overflow-x: auto;
}

#treemap-container {
  display: none;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
  box-shadow: var(--shadow);
}
.tm-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.treemap-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  font-size: 0.8rem;
  color: var(--muted);
  flex-wrap: wrap;
  flex: 1;
}
.bc-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface2);
  border: 1px solid var(--border);
  color: var(--primary);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.bc-pill:hover {
  background: var(--primary-surface);
  border-color: var(--primary-light);
}
.bc-pill .bc-sz {
  font-size: 0.72rem;
  color: var(--faint);
  font-weight: normal;
}
.bc-sep {
  color: var(--faint);
  font-size: 0.75rem;
}
.tm-controls-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.tm-ctrl-btn {
  font-size: 0.78rem;
  padding: 4px 10px;
}
.tm-select {
  font-family: var(--font);
  font-size: 0.78rem;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  color: var(--text);
  cursor: pointer;
  outline: none;
}
.tm-select:hover, .tm-select:focus {
  border-color: var(--primary-light);
}
.treemap-canvas-wrap {
  width: 100%;
  height: 640px;
  position: relative;
  background: #111812;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(0, 0, 0, 0.15);
  overflow: hidden;
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.35);
  user-select: none;
}
.tm-cell {
  position: absolute;
  box-sizing: border-box;
  overflow: hidden;
  cursor: pointer;
  transition: filter 0.12s ease, transform 0.12s ease;
  color: #fff;
  border-radius: 4px;
}
.tm-cell:hover {
  filter: brightness(1.15);
  z-index: 20 !important;
}
.tm-cell-leaf {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 5px 7px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15), 0 1px 3px rgba(0, 0, 0, 0.3);
}
.tm-cell-folder-wrap {
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
.tm-folder-header {
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px;
  background: rgba(0, 0, 0, 0.35);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tm-folder-header:hover {
  background: rgba(0, 0, 0, 0.55);
}
.tm-folder-body {
  position: relative;
  width: 100%;
  height: calc(100% - 22px);
  overflow: hidden;
}
.tm-cell-title {
  font-size: 0.74rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  gap: 4px;
}
.tm-cell-size {
  font-family: var(--mono);
  font-size: 0.68rem;
  opacity: 0.92;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tm-legend-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  font-size: 0.76rem;
  color: var(--muted);
}
.tm-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: default;
}
.tm-legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}
.tm-tooltip {
  position: fixed;
  display: none;
  z-index: 10000;
  pointer-events: none;
  background: rgba(16, 22, 16, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(14px);
  border-radius: 8px;
  padding: 12px 14px;
  color: #f1f5f9;
  font-size: 12px;
  max-width: 380px;
  line-height: 1.45;
  transition: opacity 0.08s ease;
}
.tm-tt-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 2px;
  word-break: break-all;
}
.tm-tt-path {
  font-family: var(--mono);
  font-size: 10px;
  color: #94a3b8;
  word-break: break-all;
  margin-bottom: 8px;
}
.tm-tt-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: 11px;
  margin-bottom: 8px;
}
.tm-tt-lbl { color: #94a3b8; }
.tm-tt-val { font-weight: 600; font-family: var(--mono); color: #f8fafc; text-align: right; }
.tm-tt-badge-rm {
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  margin-bottom: 8px;
}
.tm-tt-hint {
  font-size: 10px;
  color: #6ee7b7;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 6px;
}

/* Tree Nodes & Action Buttons */
.tree-node { margin: 1px 0; user-select: none; }
.node-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.1s ease;
  gap: 10px;
}
.node-row:hover { background: var(--surface2); }
.node-row:hover .row-actions { opacity: 1; pointer-events: auto; }

.node-left {
  display: flex;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.node-expander {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.68rem;
  color: var(--faint);
  transition: transform 0.15s ease;
}
.node-expander.open { transform: rotate(90deg); }
.node-name {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node-name.file-name { font-weight: 400; color: #2c3826; }

.node-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Action Buttons */
.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
}
.btn-act {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 2px 7px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--muted);
  border-radius: 4px;
  cursor: pointer;
}
.btn-act:hover {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

/* Badges */
.badge {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  white-space: nowrap;
}
.badge-gb { background: var(--amber-bg); color: var(--amber); border: 1px solid rgba(184,122,20,0.3); }
.badge-rm { background: var(--red-bg); color: var(--red); border: 1px solid rgba(192,57,43,0.3); }
.badge-rm-child { background: var(--orange-bg); color: var(--orange); border: 1px solid rgba(217,104,20,0.3); }

/* Size & Meta Pills */
.meta-sz {
  font-family: var(--mono);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--primary);
  background: var(--surface2);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  min-width: 76px;
  text-align: right;
}
.meta-counts {
  font-size: 0.74rem;
  color: var(--faint);
  min-width: 130px;
  text-align: right;
}

/* Proportional Size Bar */
.bar-track {
  width: 50px;
  height: 6px;
  background: var(--border);
  border-radius: 999px;
  overflow: hidden;
  flex-shrink: 0;
}
.bar-fill {
  height: 100%;
  background: var(--primary-light);
  border-radius: 999px;
}
.bar-fill.gb { background: var(--amber); }
.bar-fill.rm { background: var(--red); }

.node-children {
  padding-left: 20px;
  border-left: 1px dashed var(--border);
  margin-left: 8px;
}
.hidden-by-filter { display: none !important; }

/* Toast */
#toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: #1e281a;
  color: #fff;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 0.85rem;
  box-shadow: 0 6px 20px rgba(0,0,0,0.3);
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.25s ease;
  pointer-events: none;
  z-index: 9999;
}
#toast.show { opacity: 1; transform: translateY(0); }

.page-footer {
  margin-top: 36px;
  text-align: center;
  font-size: 0.8rem;
  color: var(--faint);
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
</style>
</head>
<body>
<div class="wrap">

  <header class="page-header">
    <div>
      <div class="page-title">DiskScope</div>
    </div>
    <div class="header-actions">
      <div class="scan-input-group">
        <input type="text" id="target-scan-input" class="scan-input" value="${escapeHtml(meta.rootName)}" placeholder="e.g. D:\\"/>
        <button class="btn" onclick="triggerRescan()">⚡ Scan</button>
      </div>
    </div>
  </header>

  <!-- Category Breakdown Section -->
  <div class="category-card">
    <div class="category-header">
      <span>Storage Category Breakdown</span>
      <span>Total: ${escapeHtml(meta.totalSizeFormatted)}</span>
    </div>
    <div class="category-bar" id="cat-bar"></div>
    <div class="category-legend" id="cat-legend"></div>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Total Used Space</div>
      <div class="stat-value">${escapeHtml(meta.totalSizeFormatted)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Files</div>
      <div class="stat-value">${meta.totalFiles.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Subfolders</div>
      <div class="stat-value">${meta.totalFolders.toLocaleString()}</div>
    </div>
    <div class="stat-card s-gb">
      <div class="stat-label">&ge; 1 GB Items</div>
      <div class="stat-value">${meta.totalGbItems.toLocaleString()}</div>
    </div>
    <div class="stat-card s-rm">
      <div class="stat-label">🗑️ Removable Identified</div>
      <div class="stat-value">${meta.removableTotal.toLocaleString()} items</div>
    </div>
  </div>

  <div class="ctrl-bar">
    <div class="btn-group">
      <button class="btn btn-tab active" id="tab-tree" onclick="switchView('tree')">🌲 Tree View</button>
      <button class="btn btn-tab" id="tab-treemap" onclick="switchView('treemap')">🗺️ Treemap View</button>
      <div style="width:1px;height:20px;background:var(--border);margin:0 4px;"></div>
      <button class="btn btn-outline" onclick="expandAll()">📂 Expand All</button>
      <button class="btn btn-outline" onclick="collapseAll()">📁 Collapse All</button>
      <label class="filter-label f-gb">
        <input type="checkbox" id="ck-gb" onchange="applyFilters()"/> &ge; 1 GB
      </label>
      <label class="filter-label f-rm">
        <input type="checkbox" id="ck-rm" onchange="applyFilters()"/> 🗑️ Removable
      </label>
    </div>
    <!-- Search box removed -->
  </div>

  <!-- Tree View -->
  <div id="tree-root"></div>

  <!-- Treemap View -->
  <div id="treemap-container">
    <div class="tm-top-bar">
      <div class="treemap-breadcrumb" id="tm-breadcrumb"></div>
      <div class="tm-controls-group">
        <button class="btn btn-outline tm-ctrl-btn" id="tm-btn-up" onclick="treemapGoUp()" title="Go up to parent directory">⬆ Up</button>
        <button class="btn btn-outline tm-ctrl-btn" onclick="treemapGoTo(TREE_DATA)" title="Reset to Root">🏠 Root</button>
        <select class="tm-select" id="tm-depth-select" onchange="changeTreemapDepth(this.value)" title="Nesting Depth">
          <option value="2" selected>Depth: 2 Levels (Nested)</option>
          <option value="1">Depth: 1 Level (Direct)</option>
        </select>
        <select class="tm-select" id="tm-color-select" onchange="changeTreemapColorMode(this.value)" title="Color Scheme">
          <option value="category" selected>Color: By Category</option>
          <option value="folder">Color: By Folder Hue</option>
        </select>
        <select class="tm-select" id="tm-filter-select" onchange="changeTreemapMinFilter(this.value)" title="Size Filter">
          <option value="0" selected>Filter: All sizes</option>
          <option value="104857600">&ge; 100 MB</option>
          <option value="1073741824">&ge; 1 GB</option>
        </select>
      </div>
    </div>
    <div class="treemap-canvas-wrap" id="tm-wrap"></div>
    <div class="tm-legend-bar" id="tm-legend"></div>
  </div>

  <div id="tm-tooltip" class="tm-tooltip"></div>
  <div id="toast"></div>

  <footer class="page-footer">
    DiskScope &nbsp;&middot;&nbsp; Storage Visualizer &amp; Native Explorer Integration
  </footer>

</div>

<script>
const TREE_DATA = ${jsonData};
const CATEGORIES = ${jsonCategories};
const GB_BYTES = 1073741824;

const CAT_COLORS = {
  media: "var(--cat-media)",
  archive: "var(--cat-archive)",
  removable: "var(--cat-removable)",
  dev: "var(--cat-dev)",
  binary: "var(--cat-binary)",
  document: "var(--cat-doc)",
  code: "#2c3e50",
  other: "var(--cat-other)"
};

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + " " + u[i];
}

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}

function revealInExplorer(filePath, e) {
  if (e) e.stopPropagation();
  if (!filePath) return;
  fetch("/api/open?path=" + encodeURIComponent(filePath))
    .then(r => {
      if (r.ok) showToast("📂 Revealing in File Explorer...");
      else showToast("Could not open path");
    })
    .catch(() => showToast("Explorer API call failed"));
}

function copyPath(filePath, e) {
  if (e) e.stopPropagation();
  if (!filePath) return;
  navigator.clipboard.writeText(filePath).then(() => showToast("📋 Path copied to clipboard!"));
}

function triggerRescan() {
  const target = document.getElementById("target-scan-input").value.trim();
  if (!target) return;
  showToast("⏳ Starting scan for " + target + "...");
  fetch("/api/scan?path=" + encodeURIComponent(target), { method: "POST" })
    .then(r => r.json())
    .then(data => {
      if (data.status === "ok") {
        showToast("Scan started! Reloading when ready...");
        setTimeout(() => location.reload(), 3000);
      }
    });
}

// ---------- RENDER CATEGORY BAR ----------
(function renderCategoryBar() {
  const bar = document.getElementById("cat-bar");
  const legend = document.getElementById("cat-legend");
  const total = TREE_DATA.s || 1;

  for (const [cat, bytes] of Object.entries(CATEGORIES)) {
    if (bytes <= 0) continue;
    const pct = ((bytes / total) * 100).toFixed(1);
    if (pct < 0.5) continue;

    const seg = document.createElement("div");
    seg.className = "cat-segment";
    seg.style.width = pct + "%";
    seg.style.background = CAT_COLORS[cat] || "var(--cat-other)";
    seg.title = cat.toUpperCase() + ": " + formatBytes(bytes) + " (" + pct + "%)";
    bar.appendChild(seg);

    const leg = document.createElement("div");
    leg.className = "legend-item";
    leg.innerHTML = \`<span class="legend-dot" style="background:\${CAT_COLORS[cat]||'var(--cat-other)'}"></span>
      <span>\${cat.toUpperCase()}: <strong>\${formatBytes(bytes)}</strong> (\${pct}%)</span>\`;
    legend.appendChild(leg);
  }
})();

// ---------- TREE VIEW RENDERER ----------
let nodeIdCounter = 0;

function createNodeElement(node, parentSize, depth = 0, isRoot = false) {
  const id = ++nodeIdCounter;
  node._id = id;

  const el = document.createElement("div");
  el.className = "tree-node";
  el.id = "tn-" + id;

  const isFolder = node.t === "d";
  const isGb = typeof node.s === "number" && node.s >= GB_BYTES;
  const isRm = node.rm === 1;
  const hasRmChild = (node.rc || 0) > 0;
  
  el.dataset.isGb = isGb ? "1" : "0";
  el.dataset.isRm = (isRm || hasRmChild) ? "1" : "0";
  el.dataset.name = (node.n || "").toLowerCase();

  const row = document.createElement("div");
  row.className = "node-row";

  // Left
  const left = document.createElement("div");
  left.className = "node-left";

  if (isFolder && node.c && node.c.length > 0) {
    const exp = document.createElement("span");
    exp.className = "node-expander" + (isRoot ? " open" : "");
    exp.textContent = "▶";
    left.appendChild(exp);
  } else {
    const spacer = document.createElement("span");
    spacer.style.width = "16px";
    spacer.style.display = "inline-block";
    left.appendChild(spacer);
  }

  const icon = document.createElement("span");
  icon.textContent = isFolder ? "📁" : (isRm ? "🗑️" : "📄");
  left.appendChild(icon);

  const name = document.createElement("span");
  name.className = "node-name" + (!isFolder ? " file-name" : "");
  name.textContent = node.n;
  left.appendChild(name);

  // Right
  const right = document.createElement("div");
  right.className = "node-right";

  // Action Menu on hover
  if (node.p) {
    const actions = document.createElement("div");
    actions.className = "row-actions";

    const btnRev = document.createElement("button");
    btnRev.className = "btn-act";
    btnRev.textContent = "📂 Reveal";
    btnRev.onclick = (e) => revealInExplorer(node.p, e);
    actions.appendChild(btnRev);

    const btnCopy = document.createElement("button");
    btnCopy.className = "btn-act";
    btnCopy.textContent = "📋 Copy";
    btnCopy.onclick = (e) => copyPath(node.p, e);
    actions.appendChild(btnCopy);

    right.appendChild(actions);
  }

  if (isGb) {
    const bGb = document.createElement("span");
    bGb.className = "badge badge-gb";
    bGb.textContent = "💾 ≥ 1 GB";
    right.appendChild(bGb);
  }

  if (isRm) {
    const bRm = document.createElement("span");
    bRm.className = "badge badge-rm";
    bRm.textContent = isFolder ? "🗑️ Remove Folder" : "🗑️ Can Remove";
    right.appendChild(bRm);
  } else if (hasRmChild) {
    const bChild = document.createElement("span");
    bChild.className = "badge badge-rm-child";
    bChild.textContent = "🗑️ " + node.rc + " inside";
    right.appendChild(bChild);
  }

  const szPill = document.createElement("span");
  szPill.className = "meta-sz";
  szPill.textContent = formatBytes(node.s);
  right.appendChild(szPill);

  if (isFolder) {
    const counts = document.createElement("span");
    counts.className = "meta-counts";
    counts.textContent = (node.fc || 0).toLocaleString() + " files" + (node.dc ? " · " + node.dc.toLocaleString() + " dirs" : "");
    right.appendChild(counts);
  }

  const pct = parentSize > 0 && typeof node.s === "number"
    ? Math.min(100, Math.max(0.5, (node.s / parentSize) * 100)).toFixed(1)
    : null;
  if (pct) {
    const track = document.createElement("div");
    track.className = "bar-track";
    track.title = pct + "% of parent";
    const fill = document.createElement("div");
    fill.className = "bar-fill" + (isGb ? " gb" : (isRm ? " rm" : ""));
    fill.style.width = pct + "%";
    track.appendChild(fill);
    right.appendChild(track);
  }

  row.appendChild(left);
  row.appendChild(right);
  el.appendChild(row);

  if (isFolder && node.c && node.c.length > 0) {
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "node-children";
    childrenContainer.style.display = isRoot ? "block" : "none";
    el.appendChild(childrenContainer);

    let renderedChildren = false;
    function renderSubtree() {
      if (renderedChildren) return;
      for (const ch of node.c) {
        childrenContainer.appendChild(createNodeElement(ch, node.s, depth + 1, false));
      }
      renderedChildren = true;
    }

    if (isRoot) renderSubtree();

    row.addEventListener("click", function(e) {
      if (e.target.closest(".badge") || e.target.closest(".btn-act")) return;
      const isOpen = childrenContainer.style.display === "block";
      if (!isOpen && !renderedChildren) renderSubtree();
      childrenContainer.style.display = isOpen ? "none" : "block";
      const exp = left.querySelector(".node-expander");
      if (exp) exp.classList.toggle("open", !isOpen);
    });

    el._renderSubtree = renderSubtree;
    el._childrenContainer = childrenContainer;
  }

  return el;
}

const rootContainer = document.getElementById("tree-root");
const rootElement = createNodeElement(TREE_DATA, TREE_DATA.s, 0, true);
rootContainer.appendChild(rootElement);

// ---------- TREEMAP SQUARIFIED ENGINE & INTERACTIVE CONTROLS ----------
const treemapState = {
  currentNode: TREE_DATA,
  history: [TREE_DATA],
  depth: 2,
  colorMode: "category",
  minFilter: 0
};

const TM_CATEGORY_COLORS = {
  media:     { bg: "#7c3aed", border: "#8b5cf6", name: "Media" },
  archive:   { bg: "#0284c7", border: "#38bdf8", name: "Archive" },
  removable: { bg: "#dc2626", border: "#f87171", name: "Removable / Cache" },
  dev:       { bg: "#d97706", border: "#fbbf24", name: "Dev / Build" },
  binary:    { bg: "#475569", border: "#94a3b8", name: "Binary / System" },
  document:  { bg: "#059669", border: "#34d399", name: "Document" },
  code:      { bg: "#0891b2", border: "#22d3ee", name: "Code" },
  folder:    { bg: "#2563eb", border: "#60a5fa", name: "Directory" },
  other:     { bg: "#4b5563", border: "#9ca3af", name: "Other" }
};

function getNodeCategory(node) {
  if (node.rm === 1) return "removable";
  const name = (node.n || "").toLowerCase();
  if (["node_modules", ".next", ".nuxt", ".turbo", "dist", "build", "target", "bin", "obj", "__pycache__", ".venv", "venv", ".git", ".gradle"].includes(name)) return "dev";
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  if ([".mp4",".mkv",".avi",".mov",".wmv",".flv",".webm",".mp3",".wav",".flac",".aac",".m4a",".jpg",".jpeg",".png",".gif",".webp",".svg",".psd",".ai"].includes(ext)) return "media";
  if ([".zip",".rar",".7z",".tar",".gz",".bz2",".xz",".iso",".img",".vmdk",".vhd",".cab"].includes(ext)) return "archive";
  if ([".exe",".msi",".dll",".sys",".drv",".ocx",".so",".dylib"].includes(ext)) return "binary";
  if ([".pdf",".doc",".docx",".xls",".xlsx",".ppt",".pptx",".txt",".rtf",".csv"].includes(ext)) return "document";
  if ([".js",".ts",".jsx",".tsx",".py",".java",".c",".cpp",".cs",".go",".rs",".html",".css",".scss",".json",".xml",".yaml",".yml",".md"].includes(ext)) return "code";
  if (node.t === "d") return "folder";
  return "other";
}

function getFolderHue(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

function getNodeColor(node, mode) {
  const currentMode = mode || treemapState.colorMode;
  if (node.rm === 1) return { bg: "#dc2626", border: "#f87171" };
  if (currentMode === "folder" || (node.t === "d" && currentMode === "category")) {
    const hue = getFolderHue(node.n || "dir");
    return {
      bg: "hsl(" + hue + ", 44%, 34%)",
      border: "hsl(" + hue + ", 52%, 48%)"
    };
  }
  const cat = getNodeCategory(node);
  return TM_CATEGORY_COLORS[cat] || TM_CATEGORY_COLORS.other;
}

function switchView(view) {
  const isTree = view === "tree";
  document.getElementById("tree-root").style.display = isTree ? "block" : "none";
  document.getElementById("treemap-container").style.display = isTree ? "none" : "block";
  document.getElementById("tab-tree").classList.toggle("active", isTree);
  document.getElementById("tab-treemap").classList.toggle("active", !isTree);
  if (!isTree) renderTreemap(treemapState.currentNode);
}

function computeSquarifiedLayout(items, x, y, width, height) {
  if (!items || items.length === 0 || width <= 1 || height <= 1) return [];
  const totalValue = items.reduce((sum, item) => sum + (item.s || 0), 0);
  if (totalValue <= 0) return [];
  
  const totalArea = width * height;
  const elements = items.map(item => ({
    node: item,
    area: ((item.s || 0) / totalValue) * totalArea
  })).filter(el => el.area > 0);

  elements.sort((a, b) => b.area - a.area);
  const result = [];

  function worstAspect(row, rowWidth) {
    if (row.length === 0 || rowWidth <= 0) return Infinity;
    const rowArea = row.reduce((s, d) => s + d.area, 0);
    const rowHeight = rowArea / rowWidth;
    if (rowHeight <= 0) return Infinity;
    let maxAspect = 0;
    for (const d of row) {
      const itemLen = d.area / rowHeight;
      const aspect = Math.max(itemLen / rowHeight, rowHeight / itemLen);
      if (aspect > maxAspect) maxAspect = aspect;
    }
    return maxAspect;
  }

  function layoutRow(row, rx, ry, rw, rh, vertical) {
    const rowArea = row.reduce((s, d) => s + d.area, 0);
    if (rowArea <= 0) return;
    if (vertical) {
      const rowH = rowArea / rw;
      let curX = rx;
      for (const d of row) {
        const itemW = d.area / rowH;
        result.push({ node: d.node, x: curX, y: ry, w: itemW, h: rowH });
        curX += itemW;
      }
    } else {
      const rowW = rowArea / rh;
      let curY = ry;
      for (const d of row) {
        const itemH = d.area / rowW;
        result.push({ node: d.node, x: rx, y: curY, w: rowW, h: itemH });
        curY += itemH;
      }
    }
  }

  function squarifyStep(children, curRow, cx, cy, cw, ch) {
    if (children.length === 0) {
      if (curRow.length > 0) layoutRow(curRow, cx, cy, cw, ch, cw <= ch);
      return;
    }
    const shortEdge = Math.min(cw, ch);
    if (shortEdge <= 0) return;
    const head = children[0];
    const newRow = curRow.concat([head]);
    if (curRow.length === 0 || worstAspect(newRow, shortEdge) <= worstAspect(curRow, shortEdge)) {
      squarifyStep(children.slice(1), newRow, cx, cy, cw, ch);
    } else {
      const isShortW = cw <= ch;
      const rowArea = curRow.reduce((s, d) => s + d.area, 0);
      layoutRow(curRow, cx, cy, cw, ch, isShortW);
      if (isShortW) {
        const rowH = rowArea / cw;
        squarifyStep(children, [], cx, cy + rowH, cw, ch - rowH);
      } else {
        const rowW = rowArea / ch;
        squarifyStep(children, [], cx + rowW, cy, cw - rowW, ch);
      }
    }
  }

  squarifyStep(elements, [], x, y, width, height);
  return result;
}

// Tooltip helper
const tmTooltipEl = document.getElementById("tm-tooltip");

function showTreemapTooltip(e, node, parentNode) {
  if (!tmTooltipEl) return;
  const isDir = node.t === "d";
  const parentSize = parentNode ? (parentNode.s || 1) : (TREE_DATA.s || 1);
  const totalDriveSize = TREE_DATA.s || 1;
  const pctParent = ((node.s / parentSize) * 100).toFixed(1);
  const pctTotal = ((node.s / totalDriveSize) * 100).toFixed(1);

  let rmBadgeHtml = "";
  if (node.rm === 1 || (node.rc && node.rc > 0)) {
    rmBadgeHtml = '<div class="tm-tt-badge-rm">🗑️ ' + escapeHtml(node.rmr || (node.rc + ' removable items inside')) + '</div>';
  }

  let countsHtml = "";
  if (isDir) {
    countsHtml = '<span class="tm-tt-lbl">Contains:</span><span class="tm-tt-val">' + (node.fc || 0).toLocaleString() + ' files &middot; ' + (node.dc || 0).toLocaleString() + ' folders</span>';
  }

  tmTooltipEl.innerHTML =
    '<div class="tm-tt-header">' + (isDir ? '📁 ' : '📄 ') + escapeHtml(node.n) + '</div>' +
    '<div class="tm-tt-path">' + escapeHtml(node.p || node.n) + '</div>' +
    rmBadgeHtml +
    '<div class="tm-tt-grid">' +
      '<span class="tm-tt-lbl">Size:</span>' +
      '<span class="tm-tt-val">' + formatBytes(node.s) + ' (' + node.s.toLocaleString() + ' B)</span>' +
      '<span class="tm-tt-lbl">% of ' + (parentNode ? 'folder' : 'view') + ':</span>' +
      '<span class="tm-tt-val">' + pctParent + '%</span>' +
      '<span class="tm-tt-lbl">% of drive:</span>' +
      '<span class="tm-tt-val">' + pctTotal + '%</span>' +
      countsHtml +
    '</div>' +
    '<div class="tm-tt-hint">🖱️ ' + (isDir ? 'Click to zoom in' : 'Click to reveal in Explorer') + ' &bull; 📂 Double-click for Explorer</div>';

  tmTooltipEl.style.display = "block";
  updateTooltipPosition(e);
}

function updateTooltipPosition(e) {
  if (!tmTooltipEl || tmTooltipEl.style.display === "none") return;
  const tipW = tmTooltipEl.offsetWidth || 300;
  const tipH = tmTooltipEl.offsetHeight || 160;
  const pad = 14;

  let left = e.clientX + pad;
  let top = e.clientY + pad;

  if (left + tipW > window.innerWidth - 10) left = e.clientX - tipW - pad;
  if (top + tipH > window.innerHeight - 10) top = e.clientY - tipH - pad;

  tmTooltipEl.style.left = Math.max(10, left) + "px";
  tmTooltipEl.style.top = Math.max(10, top) + "px";
}

function hideTreemapTooltip() {
  if (tmTooltipEl) tmTooltipEl.style.display = "none";
}

function treemapGoTo(node) {
  if (!node) return;
  if (node === TREE_DATA) {
    treemapState.history = [TREE_DATA];
  } else {
    const idx = treemapState.history.indexOf(node);
    if (idx >= 0) {
      treemapState.history = treemapState.history.slice(0, idx + 1);
    } else {
      treemapState.history.push(node);
    }
  }
  renderTreemap(node);
}

function treemapGoUp() {
  if (treemapState.history.length > 1) {
    treemapState.history.pop();
    const prev = treemapState.history[treemapState.history.length - 1];
    renderTreemap(prev);
  }
}

function changeTreemapDepth(val) {
  treemapState.depth = parseInt(val, 10) || 1;
  renderTreemap(treemapState.currentNode);
}

function changeTreemapColorMode(val) {
  treemapState.colorMode = val || "category";
  renderTreemap(treemapState.currentNode);
}

function changeTreemapMinFilter(val) {
  treemapState.minFilter = parseInt(val, 10) || 0;
  renderTreemap(treemapState.currentNode);
}

function renderTreemap(node) {
  treemapState.currentNode = node;
  const wrap = document.getElementById("tm-wrap");
  const bc = document.getElementById("tm-breadcrumb");
  const btnUp = document.getElementById("tm-btn-up");
  const legend = document.getElementById("tm-legend");

  if (!wrap || !bc) return;
  wrap.innerHTML = "";
  bc.innerHTML = "";
  hideTreemapTooltip();

  if (btnUp) {
    btnUp.disabled = treemapState.history.length <= 1;
    btnUp.style.opacity = treemapState.history.length <= 1 ? "0.4" : "1";
    btnUp.style.cursor = treemapState.history.length <= 1 ? "not-allowed" : "pointer";
  }

  // Render Breadcrumb pills
  treemapState.history.forEach((histNode, idx) => {
    if (idx > 0) {
      const sep = document.createElement("span");
      sep.className = "bc-sep";
      sep.textContent = "❯";
      bc.appendChild(sep);
    }
    const pill = document.createElement("div");
    pill.className = "bc-pill";
    const isCurrent = idx === treemapState.history.length - 1;
    pill.innerHTML = "<span>" + (idx === 0 ? "🏠 " : "📁 ") + escapeHtml(histNode.n) + '</span><span class="bc-sz">' + formatBytes(histNode.s) + "</span>";
    if (!isCurrent) {
      pill.onclick = () => {
        treemapState.history = treemapState.history.slice(0, idx + 1);
        renderTreemap(histNode);
      };
    } else {
      pill.style.background = "var(--primary-surface)";
      pill.style.borderColor = "var(--primary-light)";
    }
    bc.appendChild(pill);
  });

  // Filter items
  let items = (node.c || []).filter(ch => (ch.s || 0) >= treemapState.minFilter);
  if (items.length === 0 && (node.c || []).length > 0 && treemapState.minFilter > 0) {
    items = node.c; // fallback if filter hides all
  }

  if (items.length === 0) {
    wrap.innerHTML = "<div style='padding:60px;text-align:center;color:var(--faint);font-size:14px;'>📁 No sub-items to display in this directory</div>";
    if (legend) legend.innerHTML = "";
    return;
  }

  const containerW = wrap.clientWidth || 1360;
  const containerH = wrap.clientHeight || 640;

  const rects = computeSquarifiedLayout(items, 0, 0, containerW, containerH);

  // Category tally for current scope
  const catTally = {};

  rects.forEach(rect => {
    const item = rect.node;
    const cat = getNodeCategory(item);
    catTally[cat] = (catTally[cat] || 0) + (item.s || 0);

    const cellW = Math.max(1, rect.w);
    const cellH = Math.max(1, rect.h);

    const isFolder = item.t === "d";
    const color = getNodeColor(item, treemapState.colorMode);
    const hasChildren = isFolder && item.c && item.c.length > 0;
    const canNest = treemapState.depth >= 2 && hasChildren && cellW >= 95 && cellH >= 70;

    if (canNest) {
      // Nested container cell
      const folderCell = document.createElement("div");
      folderCell.className = "tm-cell tm-cell-folder-wrap";
      folderCell.style.left = Math.round(rect.x) + "px";
      folderCell.style.top = Math.round(rect.y) + "px";
      folderCell.style.width = Math.round(cellW) + "px";
      folderCell.style.height = Math.round(cellH) + "px";
      folderCell.style.border = "1px solid " + color.border;
      folderCell.style.background = color.bg;

      // Header
      const hdr = document.createElement("div");
      hdr.className = "tm-folder-header";
      hdr.innerHTML =
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:6px;">📁 ' + escapeHtml(item.n) + '</span>' +
        '<span style="font-family:var(--mono);font-size:0.68rem;opacity:0.9;">' + formatBytes(item.s) + '</span>';
      hdr.onclick = (e) => {
        e.stopPropagation();
        treemapGoTo(item);
      };
      hdr.ondblclick = (e) => {
        e.stopPropagation();
        if (item.p) revealInExplorer(item.p, e);
      };
      hdr.onmouseenter = (e) => showTreemapTooltip(e, item, node);
      hdr.onmousemove = updateTooltipPosition;
      hdr.onmouseleave = hideTreemapTooltip;
      folderCell.appendChild(hdr);

      // Body nested squarify
      const body = document.createElement("div");
      body.className = "tm-folder-body";
      const innerW = cellW - 2;
      const innerH = cellH - 24;

      const subItems = (item.c || []).filter(ch => (ch.s || 0) > 0);
      const subRects = computeSquarifiedLayout(subItems, 0, 0, innerW, innerH);

      subRects.forEach(sRect => {
        const sItem = sRect.node;
        const sColor = getNodeColor(sItem, treemapState.colorMode);
        const sCell = document.createElement("div");
        sCell.className = "tm-cell tm-cell-leaf";
        sCell.style.left = Math.round(sRect.x) + "px";
        sCell.style.top = Math.round(sRect.y) + "px";
        sCell.style.width = Math.max(1, Math.round(sRect.w) - 1) + "px";
        sCell.style.height = Math.max(1, Math.round(sRect.h) - 1) + "px";
        sCell.style.background = sColor.bg;
        sCell.style.borderColor = sColor.border;

        if (sRect.w >= 50 && sRect.h >= 32) {
          const sTitle = document.createElement("div");
          sTitle.className = "tm-cell-title";
          sTitle.textContent = (sItem.t === "d" ? "📁 " : "📄 ") + sItem.n;
          sCell.appendChild(sTitle);

          if (sRect.h >= 46) {
            const sSize = document.createElement("div");
            sSize.className = "tm-cell-size";
            sSize.textContent = formatBytes(sItem.s);
            sCell.appendChild(sSize);
          }
        }

        sCell.onclick = (e) => {
          e.stopPropagation();
          if (sItem.t === "d") treemapGoTo(sItem);
          else if (sItem.p) revealInExplorer(sItem.p, e);
        };
        sCell.ondblclick = (e) => {
          e.stopPropagation();
          if (sItem.p) revealInExplorer(sItem.p, e);
        };
        sCell.onmouseenter = (e) => showTreemapTooltip(e, sItem, item);
        sCell.onmousemove = updateTooltipPosition;
        sCell.onmouseleave = hideTreemapTooltip;

        body.appendChild(sCell);
      });

      folderCell.appendChild(body);
      wrap.appendChild(folderCell);
    } else {
      // Leaf single cell
      const cell = document.createElement("div");
      cell.className = "tm-cell tm-cell-leaf";
      cell.style.left = Math.round(rect.x) + "px";
      cell.style.top = Math.round(rect.y) + "px";
      cell.style.width = Math.max(1, Math.round(cellW) - 2) + "px";
      cell.style.height = Math.max(1, Math.round(cellH) - 2) + "px";
      cell.style.background = color.bg;
      cell.style.borderColor = color.border;

      if (cellW >= 42 && cellH >= 24) {
        const titleDiv = document.createElement("div");
        titleDiv.className = "tm-cell-title";
        titleDiv.textContent = (isFolder ? "📁 " : "📄 ") + item.n;
        cell.appendChild(titleDiv);

        if (cellH >= 42 && cellW >= 60) {
          const sizeDiv = document.createElement("div");
          sizeDiv.className = "tm-cell-size";
          sizeDiv.textContent = formatBytes(item.s);
          cell.appendChild(sizeDiv);
        }
      }

      cell.onclick = (e) => {
        e.stopPropagation();
        if (isFolder) treemapGoTo(item);
        else if (item.p) revealInExplorer(item.p, e);
      };
      cell.ondblclick = (e) => {
        e.stopPropagation();
        if (item.p) revealInExplorer(item.p, e);
      };
      cell.onmouseenter = (e) => showTreemapTooltip(e, item, node);
      cell.onmousemove = updateTooltipPosition;
      cell.onmouseleave = hideTreemapTooltip;

      wrap.appendChild(cell);
    }
  });

  // Render Treemap Scope Legend
  if (legend) {
    legend.innerHTML = "";
    const totalScopeBytes = Object.values(catTally).reduce((a, b) => a + b, 0) || 1;
    const catKeys = Object.keys(catTally).sort((a, b) => catTally[b] - catTally[a]);

    catKeys.forEach(k => {
      const bytes = catTally[k];
      const pct = ((bytes / totalScopeBytes) * 100).toFixed(1);
      const conf = TM_CATEGORY_COLORS[k] || TM_CATEGORY_COLORS.other;

      const itemEl = document.createElement("div");
      itemEl.className = "tm-legend-item";
      itemEl.innerHTML =
        '<span class="tm-legend-dot" style="background:' + conf.bg + '"></span>' +
        '<span>' + conf.name + ': <strong>' + formatBytes(bytes) + '</strong> (' + pct + '%)</span>';
      legend.appendChild(itemEl);
    });
  }
}

// Window resize listener to keep treemap crisp & responsive
window.addEventListener("resize", () => {
  const tmContainer = document.getElementById("treemap-container");
  if (tmContainer && tmContainer.style.display !== "none") {
    renderTreemap(treemapState.currentNode);
  }
});

// ---------- INTERACTIVE CONTROLS ----------
function expandAll() {
  function openAll(el) {
    if (el._renderSubtree) el._renderSubtree();
    if (el._childrenContainer) el._childrenContainer.style.display = "block";
    const exp = el.querySelector(".node-expander");
    if (exp) exp.classList.add("open");
    const subNodes = el._childrenContainer ? el._childrenContainer.children : [];
    for (let i = 0; i < subNodes.length; i++) openAll(subNodes[i]);
  }
  openAll(rootElement);
}

function collapseAll() {
  function closeAll(el, isRootNode) {
    if (!isRootNode && el._childrenContainer) {
      el._childrenContainer.style.display = "none";
      const exp = el.querySelector(".node-expander");
      if (exp) exp.classList.remove("open");
    }
    const subNodes = el._childrenContainer ? el._childrenContainer.children : [];
    for (let i = 0; i < subNodes.length; i++) closeAll(subNodes[i], false);
  }
  closeAll(rootElement, true);
}

function applyFilters() {
  const gbOnly = document.getElementById("ck-gb").checked;
  const rmOnly = document.getElementById("ck-rm").checked;

  const allNodes = document.querySelectorAll(".tree-node");
  allNodes.forEach(function(node) {
    if (node === rootElement) return;
    const isGb = node.dataset.isGb === "1";
    const isRm = node.dataset.isRm === "1";
    let hide = false;
    if (gbOnly && !isGb) hide = true;
    if (rmOnly && !isRm) hide = true;
    node.classList.toggle("hidden-by-filter", hide);
  });
}

/* Search functions removed */
</script>
</body>
</html>`;
}

// ---------- 9. STREAM MARKDOWN REPORT ----------
function writeMarkdownReport(rootNode, totalGbItems) {
  return new Promise((resolve) => {
    const stream = fs.createWriteStream(OUT_MD, { encoding: "utf8" });
    stream.on("finish", resolve);

    stream.write(`# Drive Tree Report — ${rootNode.name}\n\n`);
    stream.write(`**Scanned path:** ${rootNode.name}\n\n`);
    stream.write(`**Total size:** ${formatBytes(rootNode.size)}\n\n`);
    stream.write(`**Total files:** ${rootNode.fileCount.toLocaleString()}\n\n`);
    stream.write(`**Total subfolders:** ${rootNode.folderCount.toLocaleString()}\n\n`);
    stream.write(`**Items ≥ 1 GB:** ${totalGbItems.toLocaleString()}\n\n`);
    stream.write(`## Tree\n\n`);

    function writeNode(node, depth = 0) {
      const pad  = "  ".repeat(depth);
      const isGb = typeof node.size === "number" && node.size >= GB_BYTES;
      const gbTag = isGb ? " **[GB]**" : "";
      const rmTag = node.isSelfRemovable
        ? " **[🗑️ CAN REMOVE]**"
        : ((node.removableChildCount || 0) > 0 ? ` **[🗑️ ${node.removableChildCount} inside]**` : "");

      if (node.type === "file") {
        stream.write(`${pad}- ${escapeMd(node.name)} — ${formatBytes(node.size)}${gbTag}${rmTag}\n`);
        return;
      }
      if (node.type === "error") {
        stream.write(`${pad}- ${escapeMd(node.name)} — ERROR: ${escapeMd(node.error)}\n`);
        return;
      }
      if (node.type === "skipped") {
        stream.write(`${pad}- ${escapeMd(node.name)} — skipped (${escapeMd(node.reason)})\n`);
        return;
      }

      stream.write(`${pad}- **${escapeMd(node.name)}** — ${formatBytes(node.size)}${gbTag}${rmTag} | ${node.fileCount.toLocaleString()} files | ${node.folderCount.toLocaleString()} folders\n`);
      if (node.children) {
        for (const ch of node.children) writeNode(ch, depth + 1);
      }
    }

    writeNode(rootNode);
    stream.end();
  });
}

// ---------- 10. LOCAL HTTP SERVER & API CONTROLLER ----------
const LOADING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>DiskScope — Analyzing Storage</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
:root {
  --bg: #090e0b;
  --surface: rgba(22, 33, 22, 0.65);
  --surface-sub: rgba(30, 48, 30, 0.45);
  --border: rgba(97, 140, 85, 0.28);
  --border-focus: rgba(126, 184, 110, 0.6);
  --primary: #5f8d54;
  --primary-bright: #7dc26e;
  --primary-glow: rgba(125, 194, 110, 0.25);
  --text: #f2f7f0;
  --muted: #9eb599;
  --faint: #60755b;
  --font-display: "Outfit", sans-serif;
  --font: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
  --mono: "JetBrains Mono", "Consolas", monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 20px;
  overflow-x: hidden;
  background-image: 
    radial-gradient(circle at 50% 25%, rgba(65, 107, 57, 0.16) 0%, transparent 60%),
    radial-gradient(circle at 80% 80%, rgba(35, 60, 30, 0.12) 0%, transparent 50%);
}
.glow {
  position: absolute;
  width: 480px;
  height: 480px;
  background: radial-gradient(circle, var(--primary-glow) 0%, rgba(0,0,0,0) 70%);
  filter: blur(40px);
  pointer-events: none;
  z-index: 1;
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-radius: 20px;
  padding: 36px 32px 32px;
  text-align: center;
  max-width: 540px;
  width: 100%;
  box-shadow: 0 16px 50px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  z-index: 2;
  position: relative;
}

/* Radar Scope Icon */
.radar-wrap {
  width: 64px;
  height: 64px;
  margin: 0 auto 18px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.radar-ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid var(--border-focus);
}
.radar-ring.r1 { width: 100%; height: 100%; opacity: 0.35; }
.radar-ring.r2 { width: 66%; height: 66%; opacity: 0.6; }
.radar-ring.r3 { width: 33%; height: 33%; opacity: 0.9; }
.radar-sweep {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: conic-gradient(from 0deg at 50% 50%, rgba(125, 194, 110, 0.45) 0deg, transparent 65deg, transparent 360deg);
  animation: radarRotate 2.2s linear infinite;
}
.radar-dot {
  width: 8px;
  height: 8px;
  background: var(--primary-bright);
  border-radius: 50%;
  box-shadow: 0 0 12px var(--primary-bright);
  position: relative;
  z-index: 3;
}
@keyframes radarRotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.brand-title {
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #ffffff;
  margin-bottom: 4px;
}
.scan-subtitle {
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--muted);
  margin-bottom: 12px;
}
.target-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--mono);
  font-size: 0.8rem;
  background: var(--surface-sub);
  border: 1px solid var(--border);
  color: var(--primary-bright);
  padding: 4px 14px;
  border-radius: 999px;
  margin-bottom: 24px;
}
.target-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 8px #4ade80;
  animation: pulseDot 1.4s ease-in-out infinite;
}
@keyframes pulseDot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

/* Stats Matrix */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 24px;
}
.stat-card {
  background: var(--surface-sub);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  padding: 10px 8px;
  text-align: center;
}
.stat-label {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin-bottom: 3px;
}
.stat-value {
  font-family: var(--font-display);
  font-size: 1.05rem;
  font-weight: 700;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Progress bar */
.progress-bar-wrap {
  width: 100%;
  height: 6px;
  background: rgba(255, 255, 255, 0.07);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 18px;
  position: relative;
}
.progress-bar-fill {
  height: 100%;
  width: 35%;
  background: linear-gradient(90deg, #3d5a36, var(--primary-bright), #a3e696);
  border-radius: 999px;
  animation: loading 1.6s infinite cubic-bezier(0.4, 0, 0.2, 1);
  transition: width 0.3s ease;
}
@keyframes loading {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(320%); }
}

/* Live Path Ticker */
.ticker-box {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--mono);
  font-size: 0.76rem;
  color: var(--muted);
  overflow: hidden;
  text-align: left;
}
.ticker-pulse {
  width: 6px;
  height: 6px;
  min-width: 6px;
  border-radius: 50%;
  background: var(--primary-bright);
}
.ticker-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
</style>
</head>
<body>
<div class="glow"></div>
<div class="card">
  
  <div class="radar-wrap">
    <div class="radar-ring r1"></div>
    <div class="radar-ring r2"></div>
    <div class="radar-ring r3"></div>
    <div class="radar-sweep"></div>
    <div class="radar-dot"></div>
  </div>

  <h1 class="brand-title">DiskScope</h1>
  <div class="scan-subtitle" id="scan-status-title">Scanning Storage Footprint…</div>
  
  <div class="target-chip">
    <div class="target-dot"></div>
    <span>Target:</span>
    <strong id="target-display">Detecting…</strong>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Folders</div>
      <div class="stat-value" id="val-folders">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Files</div>
      <div class="stat-value" id="val-files">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Indexed</div>
      <div class="stat-value" id="val-size">0 B</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Elapsed</div>
      <div class="stat-value" id="val-time">0s</div>
    </div>
  </div>

  <div class="progress-bar-wrap">
    <div class="progress-bar-fill" id="pb-fill"></div>
  </div>

  <div class="ticker-box">
    <div class="ticker-pulse"></div>
    <div class="ticker-text" id="val-path">Initializing filesystem scan…</div>
  </div>

</div>

<script>
(function poll() {
  fetch("status.json?_=" + Date.now())
    .then(r => r.ok ? r.json() : null)
    .then(s => {
      if (s) {
        if (s.target) {
          document.getElementById("target-display").textContent = s.target;
        }
        if (s.folders !== undefined) {
          document.getElementById("val-folders").textContent = Number(s.folders).toLocaleString();
        }
        if (s.files !== undefined) {
          document.getElementById("val-files").textContent = Number(s.files).toLocaleString();
        }
        if (s.bytesFormatted) {
          document.getElementById("val-size").textContent = s.bytesFormatted;
        }
        if (s.elapsed !== undefined) {
          document.getElementById("val-time").textContent = s.elapsed + "s";
        }
        if (s.currentPath) {
          document.getElementById("val-path").textContent = s.currentPath;
        } else if (s.message) {
          document.getElementById("val-path").textContent = s.message;
        }

        if (s.phase === "ai") {
          document.getElementById("scan-status-title").textContent = "Targeted Gemini AI Analysis…";
        }

        if (s.phase === "done") {
          document.getElementById("scan-status-title").textContent = "✨ Complete! Loading Dashboard…";
          const pb = document.getElementById("pb-fill");
          if (pb) {
            pb.style.animation = "none";
            pb.style.width = "100%";
          }
          setTimeout(() => {
            const redirectUrl = s.baseName ? ("/" + s.baseName + "-tree.html") : location.pathname;
            location.href = redirectUrl;
          }, 400);
          return;
        }
      }
      setTimeout(poll, 350);
    })
    .catch(() => {
      setTimeout(poll, 1000);
    });
})();
</script>
</body>
</html>`;

function startFileServer(dir, port = SERVER_PORT) {
  const mimeMap = {
    ".html": "text/html;charset=utf-8",
    ".json": "application/json;charset=utf-8",
  };

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // API: Reveal in OS File Explorer
    if (pathname === "/api/open") {
      const targetPath = parsedUrl.query.path;
      if (targetPath) {
        revealInOSExplorer(targetPath);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", path: targetPath }));
      }
      res.writeHead(400);
      return res.end(JSON.stringify({ error: "Missing path parameter" }));
    }

    // API: In-Browser Rescan Trigger
    if (pathname === "/api/scan" && req.method === "POST") {
      const targetPath = parsedUrl.query.path;
      if (targetPath && fs.existsSync(targetPath)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", message: "Scan initiated" }));
        
        // Asynchronously trigger scan
        setTimeout(() => runScan(targetPath), 100);
        return;
      }
      res.writeHead(400);
      return res.end(JSON.stringify({ error: "Invalid scan path" }));
    }

    // Static HTML / JSON file server
    const base = path.basename(pathname) || path.basename(OUT_HTML);
    const filePath = path.join(dir, base);
    try {
      const ext = path.extname(filePath);
      const isHtmlRequest = ext === ".html" || pathname === "/" || base === path.basename(OUT_HTML);
      if (isHtmlRequest && isScanInProgress) {
        throw new Error("Scan in progress");
      }
      const data = fs.readFileSync(filePath);
      const mime = mimeMap[ext] || "text/plain;charset=utf-8";
      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": "no-cache, no-store",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(data);
    } catch {
      // Serve LOADING_HTML if client requests the main page or any HTML page, but it's not ready yet
      const ext = path.extname(filePath);
      if (ext === ".html" || pathname === "/" || base === path.basename(OUT_HTML)) {
        res.writeHead(200, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-cache" });
        return res.end(LOADING_HTML);
      }
      res.writeHead(404);
      res.end("File not found.");
    }
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      SERVER_PORT++;
      server.listen(SERVER_PORT, "127.0.0.1");
    } else {
      console.error("  Server error:", err.message);
    }
  });

  server.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}/${path.basename(OUT_HTML)}`;
    console.log(`\n🌐  Report server  : ${url}`);
    console.log(`    Press Ctrl+C to exit when done browsing.\n`);
    openBrowser(url);
  });

  return server;
}

// ---------- 11. SCAN RUNNER ----------
async function runScan(targetPath = ROOT_DIR) {
  isScanInProgress = true;
  try {
    ROOT_DIR = targetPath;
    BASE_NAME = deriveBaseName(ROOT_DIR);
    OUT_HTML = path.join(OUT_DIR, `${BASE_NAME}-tree.html`);
    OUT_MD = path.join(OUT_DIR, `${BASE_NAME}-report.md`);

    scanTelemetry = {
      files: 0,
      folders: 0,
      bytes: 0,
      currentPath: ROOT_DIR,
      startTime: Date.now(),
      lastStatusWrite: 0
    };

    console.log(`\n🔍  Scanning ${ROOT_DIR} …`);
    writeStatus("scan", 0, 0, 0, `Scanning ${ROOT_DIR}…`);

    const startTime = Date.now();
    const root = await scanNode(ROOT_DIR, true);
    if (root.type !== "folder") {
      console.error("Root scan failed:", root);
      return;
    }
    const scanDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalGb = countGbItems(root);

    console.log(`    ✅ Scan complete in ${scanDuration}s — ${root.fileCount.toLocaleString()} files, ${root.folderCount.toLocaleString()} folders, ${formatBytes(root.size)}`);

    // Offline removables
    let removableCount = 0;
    function countRemovables(n) {
      if (n.isSelfRemovable) removableCount++;
      if (n.children) n.children.forEach(countRemovables);
    }
    countRemovables(root);
    console.log(`    🧹 Offline cleanup engine identified ${removableCount.toLocaleString()} safe removable item(s).`);

    // Targeted AI
    if (ENABLE_AI) {
      console.log("\n🤖  Checking for large unclassified folders for Gemini review…");
      const targetedNames = new Set();
      collectUnclassifiedLargeNames(root, targetedNames);
      if (targetedNames.size > 0) {
        console.log(`    Reviewing ${targetedNames.size} large item(s) with Gemini AI…`);
        const aiMap = await classifyTargetedNames(targetedNames, GEMINI_API_KEY);
        if (aiMap.size > 0) {
          applyAiPatchesToTree(root, aiMap);
          writePatchesJson(aiMap);
        }
      }
    }

    scanTelemetry.files = root.fileCount;
    scanTelemetry.folders = root.folderCount;
    scanTelemetry.bytes = root.size;
    writeStatus("done", 0, 0, removableCount, "Analysis complete.", {
      files: root.fileCount,
      folders: root.folderCount,
      bytes: root.size,
      bytesFormatted: formatBytes(root.size),
      currentPath: "Analysis complete! Loading dashboard…"
    });

    // Category statistics
    const categoryStats = calculateCategoryBreakdown(root);

    // Markdown
    if (WRITE_MD) {
      await writeMarkdownReport(root, totalGb);
    }

    // Dynamic HTML
    console.log("\n📝  Writing dynamic HTML report with Treemap & Explorer integration…");
    const compactRoot = toCompactTree(root);
    const htmlContent = generateDynamicHtml(compactRoot, {
      rootName: root.name,
      totalSizeFormatted: formatBytes(root.size),
      totalFiles: root.fileCount,
      totalFolders: root.folderCount,
      totalGbItems: totalGb,
      removableTotal: root.removableChildCount + (root.isSelfRemovable ? 1 : 0),
      generatedAt: Date.now()
    }, categoryStats);

    fs.writeFileSync(OUT_HTML, htmlContent, "utf8");
    const htmlStat = fs.statSync(OUT_HTML);
    console.log(`    ✅ HTML report updated → ${OUT_HTML} (${formatBytes(htmlStat.size)})`);
  } finally {
    isScanInProgress = false;
  }
}

// ---------- 12. MAIN ENTRY POINT ----------
(async function main() {
  console.log(`
╔══════════════════════════════════════════════════╗
║               🚀 DiskScope (Ultimate)            ║
╚══════════════════════════════════════════════════╝`);

  try {
    const stat = fs.statSync(ROOT_DIR);
    if (!stat.isDirectory()) throw new Error("Not a directory");
  } catch (err) {
    console.error(`\n❌  SCAN_PATH is invalid or inaccessible: "${ROOT_DIR}"`);
    process.exit(1);
  }

  try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch (_) {}

  console.log(`  Scan path   : ${ROOT_DIR}`);
  console.log(`  Output dir  : ${OUT_DIR}`);
  console.log(`  HTML report : ${OUT_HTML}`);
  console.log(`  Rules engine: ACTIVE (150+ offline patterns)`);
  console.log(`  Treemap     : ACTIVE (Interactive Canvas/Matrix View)`);
  console.log(`  OS Explorer : ACTIVE (Native 'Reveal in Explorer' API)`);

  startFileServer(OUT_DIR, SERVER_PORT);
  await runScan(ROOT_DIR);
})().catch(err => {
  console.error("Unexpected error:", err);
  process.exit(1);
});