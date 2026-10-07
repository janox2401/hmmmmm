// Smoke-Test für Jarvis OS: baut Testordner, startet den Server auf einem Testport und prüft die API.
// Aufruf: node jarvis/test/smoke.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-smoke-"));
const codeRoot = path.join(tmp, "code");
const claudeHome = path.join(tmp, "claude-home");
const write = (p, s) => (fs.mkdirSync(path.dirname(p), { recursive: true }), fs.writeFileSync(p, s));

write(path.join(codeRoot, "alpha", "package.json"), JSON.stringify({ name: "alpha", description: "Alpha-Projekt aus package.json" }));
write(path.join(codeRoot, "beta", "README.md"), "# Beta\n\n![badge](x.svg)\n\nBeta ist ein **Testprojekt** mit [Link](http://x).\n");
write(path.join(codeRoot, "beta", ".claude", "agents", "reviewer.md"), "---\nname: beta-reviewer\ndescription: Prüft Beta-Code\n---\nText");
write(path.join(codeRoot, "beta", ".claude", "skills", "notes", "SKILL.md"), "---\nname: beta-notes\ndescription: >\n  Mehrzeilige\n  Beschreibung\n---\n");
fs.mkdirSync(path.join(codeRoot, ".versteckt"), { recursive: true });
write(path.join(claudeHome, "agents", "code-reviewer.md"), '---\nname: code-reviewer\ndescription: "Reviewt Änderungen"\ntools: Read, Grep\n---\n');
write(path.join(claudeHome, "skills", "synced", "x", "lernkarten", "SKILL.md"), "---\nname: lernkarten\ndescription: Macht Karteikarten\n---\n");

process.env.JARVIS_CODE_ROOT = codeRoot;
process.env.JARVIS_CLAUDE_HOME = claudeHome;
const port = 47110 + Math.floor(Math.random() * 500);
process.env.JARVIS_PORT = String(port);

const { start, parseMcpList, parseFrontmatter } = await import("../server.mjs");

let failed = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? "  → " + extra : ""}`);
  if (!cond) failed++;
};

function get(p, host = `127.0.0.1:${port}`) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: p, headers: { Host: host } }, (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      })
      .on("error", reject);
  });
}

// --- Parser-Einheiten ---
const mcp = parseMcpList("Checking MCP server health...\n\nnotion: https://mcp.notion.com/mcp (HTTP) - ✓ Connected\ngithub: npx -y @mcp/github - ✗ Failed to connect\n");
check("parseMcpList erkennt 2 Server", mcp.length === 2, mcp.map((m) => `${m.name}:${m.ok}`).join(", "));
check("parseMcpList Status ok/fehler", mcp[0].ok === true && mcp[1].ok === false);
check("Frontmatter Block-String", parseFrontmatter("---\ndescription: |\n  a\n  b\nname: n\n---").description === "a b");

// --- Server ---
const server = await start(port);
const addr = server.address();
check("Server bindet nur an 127.0.0.1", addr.address === "127.0.0.1", `${addr.address}:${addr.port}`);

const page = await get("/");
check("GET / liefert HTML", page.status === 200 && page.body.includes("Jarvis OS"));

const rebind = await get("/api/inventory", `evil.example:${port}`);
check("Fremder Host-Header wird abgelehnt", rebind.status === 403);

const t0 = Date.now();
const inv = JSON.parse((await get("/api/inventory")).body);
check("Inventar antwortet", !!inv.projects, `${Date.now() - t0} ms`);
check("Projekte: alpha, beta (ohne versteckte Ordner)", inv.projects.map((p) => p.name).join(",") === "alpha,beta");
check("Projektbeschreibung aus package.json", inv.projects[0].description === "Alpha-Projekt aus package.json");
check("Projektbeschreibung aus README", inv.projects[1].description === "Beta ist ein Testprojekt mit Link.", inv.projects[1].description);
check("Agents global + Projekt", inv.agents.map((a) => `${a.name}@${a.scope}`).join(",") === "code-reviewer@global,beta-reviewer@beta");
check("Skills verschachtelt + Projekt", inv.skills.map((s) => `${s.name}@${s.scope}`).join(",") === "lernkarten@global,beta-notes@beta");
check("Skill-Beschreibung mehrzeilig", inv.skills[1].description === "Mehrzeilige Beschreibung");
check("MCP-Abfrage ohne Fehler", inv.mcp && inv.mcp.error === null, inv.mcp.raw || `${inv.mcp.servers.length} Server`);

console.log("\nInventar-Auszug:");
for (const p of inv.projects) console.log(`  Projekt  ${p.name.padEnd(14)} ${p.description}`);
for (const a of inv.agents) console.log(`  Agent    ${a.name.padEnd(14)} ${a.description}`);
for (const s of inv.skills) console.log(`  Skill    ${s.name.padEnd(14)} ${s.description}`);
console.log(`  MCP      ${inv.mcp.raw || inv.mcp.servers.map((m) => m.name).join(", ")}`);

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : "\nAlle Prüfungen bestanden");
process.exit(failed ? 1 : 0);
