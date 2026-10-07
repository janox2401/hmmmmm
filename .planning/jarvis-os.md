# Jarvis OS: Plan (freigegeben am 2026-10-07)

## Kontext
Der Nutzer möchte eine lokale Kommandozentrale, die drei Dinge zusammenbringt: das Inventar (Projekte, Agents, Skills, MCP-Server), den Start von Aufträgen per `claude -p` in einem Projektordner und den Verlauf dieser Läufe. Ziel ist ein MVP bis Sonntagabend.
Rahmen laut Antworten: **Windows**, bisher nur die **Claude-Desktop-App** (CLI und Node vermutlich noch nicht installiert), Bedienung als **lokale Webseite**, **Claude-Abo** ohne Tageslimit, Projekte = **alle Unterordner von `C:\Users\<ich>\code`**. Die Wochen-Routinen sind Code-Review, Wochenplanung und Lernmaterial. Täglich genutzte Tools: Kalender, Notion, GitHub, Drive/Gmail (lokal ist noch kein MCP-Server angebunden).
Gebaut wird im Cloud-Container (Linux) im Repo `janox2401/hmmmmm` unter `jarvis/` und auf Branch `claude/wonderful-clarke-mmliaq` gepusht. Laufen soll es auf dem Windows-Rechner des Nutzers.

## 0. Einmalige Einrichtung auf Windows (Schritt für den Nutzer, ich schreibe die Anleitung)
1. Node LTS installieren: `winget install OpenJS.NodeJS.LTS`
2. Claude CLI installieren: `npm install -g @anthropic-ai/claude-code`, danach einmal `claude` starten und mit dem Abo einloggen
3. Prüfen: `node --version`, `claude --version`, `claude -p "sag hallo"`

## 1. Architektur (≤ 10 Sätze)
1. Ein einzelnes Node-Skript `jarvis/server.mjs` nutzt nur eingebaute Module (`http`, `fs`, `child_process`) und braucht **keine npm-Abhängigkeit**.
2. Der Server lauscht ausschließlich auf `127.0.0.1:4711` und ist damit aus dem Netz nicht erreichbar. Er liefert eine einzelne Seite `jarvis/public/index.html` (Vanilla-JS).
3. Projekte sind die Unterordner von `codeRoot` aus `jarvis/config.json` (Standard: `%USERPROFILE%\code`). Die Beschreibungszeile kommt aus `package.json → description` oder aus der ersten Textzeile der README.
4. Agents liest der Server aus `~/.claude/agents/*.md` und `<projekt>/.claude/agents/*.md`, Skills aus `~/.claude/skills/*/SKILL.md` und `<projekt>/.claude/skills/*/SKILL.md`, jeweils mit `description` aus dem Frontmatter.
5. Die MCP-Server liefert die geparste Ausgabe von `claude mcp list` (60 s gecacht). Ihre Zwecks-Zeile kommt aus der optionalen Datei `jarvis/descriptions.json`, weil MCP selbst keine Beschreibung liefert.
6. Ein Auftrag startet über `POST /api/runs` mit `{projectId, prompt}`. Der Server akzeptiert nur Projekt-IDs aus dem Inventar und nie freie Pfade.
7. Der Server ruft `claude -p --output-format json` mit festen Argumenten und `cwd` = Projektordner auf. Der Prompt geht über **stdin** hinein, sodass Nutzertext nie in einer Shell-Zeile landet. Das ist wichtig, weil `claude` unter Windows ein `.cmd` ist.
8. Pro Lauf entsteht ein Ordner `jarvis/data/runs/<id>/` mit `job.json`, `output.json`, `stderr.log` und `result.md`. `jarvis/data/` steht in `.gitignore`.
9. Der Verlauf ist schlicht die Liste dieser Ordner. Die Seite fragt sie alle 3 s über `GET /api/runs` ab.
10. Höchstens 2 Läufe arbeiten parallel, weitere warten in der Warteschlange. Nach 15 min wird ein Lauf abgebrochen, und beim Serverstart werden verwaiste „läuft“-Einträge auf „Fehler“ gesetzt.

## 2. Datenformat (JSON-Dateien, keine Datenbank)
`jarvis/data/runs/20261010-143012-a1b2/job.json`
```json
{
  "id": "20261010-143012-a1b2",
  "projectId": "lernbuddy",
  "projectPath": "C:\\Users\\ich\\code\\lernbuddy",
  "prompt": "Fasse die README dieses Projekts in drei Sätzen zusammen",
  "status": "wartet | läuft | fertig | Fehler",
  "createdAt": "…", "startedAt": "…", "finishedAt": "…",
  "exitCode": 0, "durationMs": 41230, "costUsd": 0.04,
  "error": null,
  "resultFile": "result.md"
}
```
- In `output.json` steht die rohe JSON-Antwort von `claude -p`. Aus deren Feld `result` wird `result.md`, außerdem werden `is_error`, `duration_ms` und `total_cost_usd` übernommen.
- `stderr.log` enthält die Fehlerausgabe. Umgebungsvariablen und Tokens werden nie geloggt.
- `jarvis/config.json` enthält `codeRoot`, `port`, `maxParallel`, `timeoutMin` und `allowedTools`, aber keine Secrets.

## 3. Ablauf eines Auftrags
1. In der Oberfläche Projekt wählen, Aufgabe tippen, „Starten“ klicken.
2. Der Server legt `job.json` mit dem Status `wartet` an und startet den Lauf, sobald ein Slot frei ist.
3. Der Lauf wird ausgeführt als `spawn("claude", ["-p","--output-format","json","--allowedTools",<liste>,"--disallowedTools",<liste>], {cwd: projektPath, shell: win32})`, der Prompt geht per stdin hinein. Der Status springt auf `läuft`.
4. Endet der Prozess mit Exit 0 und `is_error=false`, wird der Status `fertig` und `result.md` wird geschrieben. In allen anderen Fällen (oder bei Timeout) wird er `Fehler` mit einer Kurzmeldung.
5. Im Verlauf zeigt jede Zeile Projekt, Aufgabe, Status, Dauer und einen Link „Ergebnis öffnen“, der `result.md` gerendert anzeigt, dazu den Pfad zur Datei.

## 4. Rechte
- **Arbeitsordner:** nur der Ordner des gewählten Projekts unter `codeRoot` (cwd). Das wird serverseitig gegen das Inventar geprüft.
- **Ohne Nachfrage erlaubt (`--allowedTools`):** `Read`, `Glob`, `Grep`, also nur Lesen.
- **Explizit verboten (`--disallowedTools`):** `Bash`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch` und alle `mcp__*`-Tools. Ein `-p`-Lauf kann nicht nachfragen, alles nicht Erlaubte wird also abgelehnt.
- **Braucht immer deine Freigabe (im MVP nicht freigeschaltet):** Dateien ändern oder löschen, Shell-Befehle, `git push`, Mails, Kalender, Notion und alles mit Außenwirkung. Ein späteres Profil „darf schreiben“ wäre ein eigener, ausdrücklich bestätigter Schritt.
- Keine Zugangsdaten in Dateien: Das Abo-Login bleibt bei der Claude CLI. Die Zentrale liest keine Keys, und `.env` sowie `jarvis/data/` stehen in `.gitignore`.

## 5. Meilensteine und Abnahme
**M1 Inventar.** `jarvis\start.cmd` startet den Server und öffnet den Browser auf `http://127.0.0.1:4711`.
- Abnahme: Die Seite zeigt vier Bereiche: Projekte (alle Unterordner von `C:\Users\<ich>\code`), Agents, Skills und MCP-Server, jeweils mit Name und Zeile. Ein neuer Ordner unter `code\` erscheint nach einem Reload. `netstat -an | findstr 4711` zeigt nur `127.0.0.1`.

**M2 Aufträge.** Projekt wählen, „Fasse die README dieses Projekts in drei Sätzen zusammen“ starten.
- Abnahme: Der Status wechselt im Verlauf von „läuft“ zu „fertig“, die drei Sätze erscheinen, und `jarvis\data\runs\<id>\result.md` existiert. Ein Auftrag wie „lösche die README“ endet ohne Änderung im Projekt (`git status` bleibt sauber).

**M3 Alltag.** Zwei Aufträge in verschiedenen Projekten kurz hintereinander starten.
- Abnahme: Beide zeigen gleichzeitig „läuft“, ein dritter zeigt „wartet“. Der Projektfilter blendet fremde Läufe aus. Ein Klick auf „Ergebnis öffnen“ zeigt das Ergebnis, „Ordner öffnen“ öffnet den Run-Ordner im Explorer.

Nach jedem Meilenstein: selbst testen (Linux-Container mit echtem `claude -p` sowie ein Node-Skript `jarvis/test/smoke.mjs` gegen die API), die Ausgabe zeigen, einen Commit machen, pushen und auf „weiter“ warten.

## 6. Nicht-Ziele
Login, mehrere Nutzer, Cloud-Hosting, Zugriff aus dem Netz, Datenbank, Frameworks oder Build-Schritt (React/Vite), Schreib- oder Shell-Rechte für Läufe, Bearbeiten von Agents, Skills oder MCP-Servern aus der Oberfläche, Streaming der Zwischenausgabe, Kalender-, Notion- oder Gmail-Anbindung und automatisch geplante Läufe.

## 7. Empfehlung zu deinen Wochen-Routinen (nach M3, optional)
- **Code-Review → Agent** `code-reviewer` (lohnt sich): eigener Kontext, nur Lese-Tools, gleiche Checkliste bei jedem Lauf.
- **Lernmaterial → Skill** `lernkarten` (lohnt sich): ein festes Ausgabeformat für Karteikarten und Zusammenfassung, passend zu Lernbuddy.
- **Wochenplanung → Skill, aber erst später**: Dafür müssen Kalender, Notion und Gmail lokal als MCP angebunden sein, und das hat Außenwirkung.

## Kritische Dateien
`jarvis/server.mjs`, `jarvis/public/index.html`, `jarvis/config.json`, `jarvis/descriptions.json`, `jarvis/start.cmd`, `jarvis/test/smoke.mjs`, `jarvis/README.md`, `.gitignore` (Einträge `jarvis/data/` und `.env`) und `.planning/jarvis-os.md`.

## Verifikation
- Pro Meilenstein `node jarvis/test/smoke.mjs`: startet den Server auf einem Testport, prüft `/api/inventory`, startet bei M2 und M3 echte Läufe mit `claude -p` auf einem Testprojekt und pollt bis `fertig`.
- Manuell im Browser (Playwright-Screenshot im Container) und anschließend durch den Nutzer auf Windows nach der Abnahme-Checkliste oben.
