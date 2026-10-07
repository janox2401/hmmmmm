// Jarvis OS – lokale Kommandozentrale. Nur Node-Bordmittel, keine npm-Abhängigkeiten.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IS_WIN = process.platform === "win32";
const HOST = "127.0.0.1"; // fest: nie aus dem Netz erreichbar

// ---------- Konfiguration ----------

function expandHome(p) {
  if (!p) return p;
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(1));
  return p.replace(/%USERPROFILE%/gi, os.homedir());
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const fileConfig = loadJson(path.join(HERE, "config.json"), {});
export const config = {
  codeRoot: path.resolve(expandHome(process.env.JARVIS_CODE_ROOT || fileConfig.codeRoot || "~/code")),
  claudeHome: path.resolve(expandHome(process.env.JARVIS_CLAUDE_HOME || fileConfig.claudeHome || "~/.claude")),
  port: Number(process.env.JARVIS_PORT || fileConfig.port || 4711),
};

// ---------- Hilfsfunktionen zum Lesen ----------

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function listFiles(dir, ext) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(ext))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function readText(file, maxBytes = 64 * 1024) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return null;
  }
}

function oneLine(s, max = 160) {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// Minimaler YAML-Frontmatter-Leser: nur einfache "key: value"-Paare und Block-Strings (> oder |).
export function parseFrontmatter(text) {
  const out = {};
  if (!text) return out;
  const m = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    if (/^[>|][-+]?$/.test(val) || val === "") {
      const block = [];
      while (i + 1 < lines.length && /^(\s+|$)/.test(lines[i + 1]) && lines[i + 1] !== "") {
        block.push(lines[++i].trim());
      }
      val = block.join(" ");
    }
    out[key] = val.replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

// Erste aussagekräftige Textzeile einer README (ohne Überschriften, Badges, HTML).
function readmeLine(dir) {
  const name = listFiles(dir, ".md").find((f) => /^readme\.md$/i.test(f));
  const text = name ? readText(path.join(dir, name), 16 * 1024) : null;
  if (!text) return "";
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith("#") || l.startsWith("<") || l.startsWith("![") || l.startsWith("[![") || l.startsWith("```") || /^[-=*_]{3,}$/.test(l)) continue;
    return oneLine(l.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"));
  }
  return "";
}

// ---------- Inventar ----------

export function scanProjects() {
  return listDirs(config.codeRoot).map((name) => {
    const dir = path.join(config.codeRoot, name);
    const pkg = loadJson(path.join(dir, "package.json"), null);
    return {
      id: name,
      name,
      path: dir,
      description: oneLine(pkg?.description) || readmeLine(dir) || "– keine Beschreibung (README fehlt) –",
      hasClaudeDir: fs.existsSync(path.join(dir, ".claude")),
    };
  });
}

function scanAgentsIn(dir, scope) {
  return listFiles(dir, ".md").map((f) => {
    const fm = parseFrontmatter(readText(path.join(dir, f)));
    return {
      name: fm.name || f.replace(/\.md$/i, ""),
      description: oneLine(fm.description) || "– keine Beschreibung –",
      scope,
      path: path.join(dir, f),
    };
  });
}

// Skills liegen als <ordner>/SKILL.md; manche Installationen schachteln eine Ebene tiefer.
function scanSkillsIn(dir, scope, depth = 0) {
  const out = [];
  for (const name of listDirs(dir)) {
    const sub = path.join(dir, name);
    const file = path.join(sub, "SKILL.md");
    if (fs.existsSync(file)) {
      const fm = parseFrontmatter(readText(file));
      out.push({ name: fm.name || name, description: oneLine(fm.description) || "– keine Beschreibung –", scope, path: file });
    } else if (depth < 2) {
      out.push(...scanSkillsIn(sub, scope, depth + 1));
    }
  }
  return out;
}

export function scanAgentsAndSkills(projects) {
  const agents = scanAgentsIn(path.join(config.claudeHome, "agents"), "global");
  const skills = scanSkillsIn(path.join(config.claudeHome, "skills"), "global");
  for (const p of projects) {
    if (!p.hasClaudeDir) continue;
    agents.push(...scanAgentsIn(path.join(p.path, ".claude", "agents"), p.name));
    skills.push(...scanSkillsIn(path.join(p.path, ".claude", "skills"), p.name));
  }
  return { agents, skills };
}

// `claude mcp list` prüft jeden Server live und ist deshalb langsam: Ergebnis 60 s cachen.
let mcpCache = { at: 0, data: null };

// Zeilenformat: "<name>: <befehl oder url> - ✓ Connected"
export function parseMcpList(text) {
  const servers = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^([^\s:][^:]*):\s+(.+?)\s+-\s+(.+)$/);
    if (!m) continue;
    const [, name, target, status] = m;
    servers.push({ name: name.trim(), target: target.trim(), status: status.trim(), ok: /✓|connected/i.test(status) && !/fail|✗/i.test(status) });
  }
  return servers;
}

function runClaudeMcpList() {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      // Feste Argumente ohne Nutzereingaben – shell ist unter Windows nötig, weil claude ein .cmd ist.
      child = spawn("claude", ["mcp", "list"], { shell: IS_WIN, windowsHide: true });
    } catch (e) {
      return resolve({ error: "claude CLI nicht gefunden", servers: [] });
    }
    const timer = setTimeout(() => child.kill(), 45_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ error: "claude CLI nicht gefunden – siehe jarvis/README.md, Abschnitt Einrichtung", servers: [] });
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ error: null, servers: parseMcpList(out), raw: /no mcp servers/i.test(out) ? "Keine MCP-Server konfiguriert" : null });
    });
  });
}

export async function scanMcp(force = false) {
  if (!force && mcpCache.data && Date.now() - mcpCache.at < 60_000) return mcpCache.data;
  const descriptions = loadJson(path.join(HERE, "descriptions.json"), {}).mcp || {};
  const res = await runClaudeMcpList();
  res.servers = res.servers.map((s) => ({ ...s, description: descriptions[s.name] || "" }));
  mcpCache = { at: Date.now(), data: res };
  return res;
}

export async function inventory(force = false) {
  const projects = scanProjects();
  const { agents, skills } = scanAgentsAndSkills(projects);
  const mcp = await scanMcp(force);
  return {
    codeRoot: config.codeRoot,
    codeRootExists: fs.existsSync(config.codeRoot),
    claudeHome: config.claudeHome,
    projects,
    agents,
    skills,
    mcp,
    scannedAt: new Date().toISOString(),
  };
}

// ---------- HTTP ----------

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// Schutz gegen DNS-Rebinding: nur Anfragen an 127.0.0.1/localhost annehmen.
function hostAllowed(req) {
  const host = (req.headers.host || "").toLowerCase();
  return host === `127.0.0.1:${config.port}` || host === `localhost:${config.port}`;
}

async function handle(req, res) {
  if (!hostAllowed(req)) return send(res, 403, { error: "nur lokal erreichbar" });
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    return send(res, 200, fs.readFileSync(path.join(HERE, "public", "index.html")), "text/html; charset=utf-8");
  }
  if (req.method === "GET" && url.pathname === "/api/inventory") {
    return send(res, 200, await inventory(url.searchParams.has("refresh")));
  }
  return send(res, 404, { error: "nicht gefunden" });
}

function openBrowser(url) {
  const cmd = IS_WIN ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {}
}

export function start(port = config.port) {
  config.port = port;
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => send(res, 500, { error: String(e?.message || e) }));
  });
  return new Promise((resolve) => server.listen(port, HOST, () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await start();
  const url = `http://${HOST}:${config.port}`;
  console.log(`Jarvis OS läuft auf ${url}  (Projekte aus ${config.codeRoot})`);
  console.log("Beenden mit Strg+C.");
  if (process.argv.includes("--open")) openBrowser(url);
  scanMcp(); // Cache vorwärmen
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
