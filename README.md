# 🚀 DiskScope — Drive & Folder Size Analyzer

A high-performance, zero-dependency Node.js tool that scans any drive or folder and generates a fast, interactive HTML dashboard — featuring real-time search, visual treemaps, category breakdowns, offline cleanup detection, one-click OS Explorer reveal, and optional Gemini AI smart analysis.

---

## ✨ Features

- **⚡ Zero Dependencies** — Built purely on native Node.js standard libraries (`fs`, `http`, `https`, `path`, `child_process`). No `npm install` required.
- **🗺️ Interactive Treemap & Tree View** — Visual matrix / treemap representation and hierarchical folder tree sorted by size.
- **🧹 Dual Cleanup Engine**:
  - **Offline Rules Engine** — Instant, offline detection of 150+ common junk items (`node_modules`, `.next`, `.venv`, build outputs, cache folders, logs, temp files).
  - **Gemini AI Integration** *(Optional)* — Targeted deep analysis using Google's `gemini-2.0-flash-lite` for unknown large directories.
- **📂 Native OS Integration** — Click **"Reveal in Explorer"** to open any file or folder directly in Windows Explorer, macOS Finder, or Linux File Manager.
- **🔄 In-Browser Rescan** — Change targets and trigger scans directly from the running web interface.
- **📊 Category Breakdown** — Automatic classification into Media, Archives, Binaries, Code, Documents, Caches, and Dev files.
- **🔍 Instant Filtering & Search** — Real-time substring search, ≥1 GB quick filter, removable-only filter, and instant Expand/Collapse All.

---

## 🚀 Quick Start

```bash
# 1. Run directly with Node.js (v16+)
node index.js

# Or pass CLI arguments directly:
node index.js --path "D:\" --port 7654
```

The browser will open automatically at `http://localhost:7654/` showing live scan progress and the final interactive report.

---

## ⚙️ Usage & CLI Options

You can configure DiskScope via CLI flags or via a `.env` file in the project folder.

### CLI Flags

| Flag | Example | Description |
|------|---------|-------------|
| `--path <dir>` | `node index.js --path "D:\"` | Target drive or folder to scan *(Default: `C:\`)* |
| `--port <port>` | `node index.js --port 8080` | Local HTTP server port *(Default: `7654`)* |
| `--out <dir>` | `node index.js --out "D:\reports"` | Output directory for reports |
| `--ai` | `node index.js --ai` | Enable Gemini AI cleanup analysis |
| `--no-ai` | `node index.js --no-ai` | Disable Gemini AI *(uses offline engine only)* |
| `--md` | `node index.js --md` | Also generate a Markdown report (`*-report.md`) |

---

## 🔧 Environment Variables (`.env`)

Create or edit `.env` in the root folder:

| Variable | Default | Description |
|----------|---------|-------------|
| `SCAN_PATH` | `C:\` | Target drive or directory path to scan. |
| `OUT_DIR` | `.` *(current directory)* | Output folder for generated HTML and report files. |
| `PORT` | `7654` | Web server port. |
| `ENABLE_AI` | `false` | Enable AI-powered removable item detection. |
| `API_KEY` | *(empty)* | Google Gemini API Key *(required only if `ENABLE_AI=true`)*. |
| `WRITE_MD` | `false` | Set `true` to export a `.md` markdown summary. |

### Example `.env` (Standard)
```env
SCAN_PATH=C:\
OUT_DIR=./reports
PORT=7654
ENABLE_AI=false
```

### Example `.env` (With Gemini AI)
```env
SCAN_PATH=C:\
ENABLE_AI=true
API_KEY=your_gemini_api_key_here
```
> [!TIP]
> You can get a free Gemini API key at [aistudio.google.com](https://aistudio.google.com/).

---

## 🖥️ Web Dashboard Highlights

| Action / Feature | Description |
|------------------|-------------|
| **Search Bar** | Filters the folder tree in real-time as you type. |
| **Treemap View** | Interactive visual canvas breaking down space consumption by area. |
| **📂 Expand / 📁 Collapse** | Quickly toggle all directories at every depth. |
| **≥ 1 GB Filter** | Instantly hides items smaller than 1 GB to focus on storage hogs. |
| **🗑️ Removable Filter** | Isolates items flagged by the offline rules or Gemini AI for cleanup. |
| **Reveal in Explorer** | Opens the selected item in your native OS file manager. |
| **In-Browser Rescan** | Enter a new path and start a scan without restarting Node.js in the terminal. |

---

## 📁 Output Files

| File | Description |
|------|-------------|
| `<target>-tree.html` | Self-contained, dynamic HTML dashboard with interactive tree and treemap. |
| `status.json` | Real-time scan telemetry and progress status. |
| `patches.json` | AI and offline cleanup classifications map. |
| `<target>-report.md` | Markdown report *(only generated if `--md` or `WRITE_MD=true`)*. |

---

## 🔒 Privacy & Security

- **Offline by Default**: Works 100% locally without external network requests when `ENABLE_AI=false`.
- **Minimal AI Payload**: If AI is enabled, only **anonymized folder/file names** (e.g. `node_modules`, `cache`, `tmp`) are sent to Google Gemini for classification. **Full file paths, file contents, and personal data are never transmitted.**

---

## 📄 License

MIT — Free to use, modify, and distribute.
