# Jarvis OS

Lokale Kommandozentrale für deine Claude-Projekte, Agents, Skills und MCP-Server. Ein Node-Skript ohne npm-Abhängigkeiten, erreichbar nur unter `http://127.0.0.1:4711`.

## Einrichtung (einmalig, Windows)

In PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS          # Node.js (danach PowerShell neu öffnen)
npm install -g @anthropic-ai/claude-code  # Claude Code CLI
claude                                     # einmal starten, mit deinem Claude-Abo einloggen, dann /exit
node --version; claude --version           # beide müssen eine Versionsnummer zeigen
```

Dann in `jarvis/config.json` prüfen, ob `codeRoot` stimmt (Standard: `%USERPROFILE%\code`). Jeder Unterordner davon gilt als Projekt.

## Starten

Doppelklick auf `jarvis\start.cmd`, oder:

```powershell
node jarvis\server.mjs --open
```

## Was die Zentrale liest

| Bereich    | Quelle |
|------------|--------|
| Projekte   | Unterordner von `codeRoot`; Beschreibung aus `package.json` oder der README |
| Agents     | `~/.claude/agents/*.md` und `<projekt>/.claude/agents/*.md` (Frontmatter `description`) |
| Skills     | `~/.claude/skills/*/SKILL.md` und `<projekt>/.claude/skills/*/SKILL.md` |
| MCP-Server | `claude mcp list` (60 s gecacht); Zweck-Zeile optional in `jarvis/descriptions.json` |

Die Zentrale speichert keine Zugangsdaten. Das Login bleibt bei der Claude CLI.

## Test

```powershell
node jarvis\test\smoke.mjs
```
