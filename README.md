# 🎓 Lernbuddy

Eine Lern-App fürs Studium: Du lädst Skripte, Folien (PDF), Fotos von Mitschriften oder einfach Text hoch, und **Claude** erstellt daraus Karteikarten, ein Multiple-Choice-Quiz und eine Zusammenfassung.

## Features

- **Lernsets aus Unterlagen**: PDF, Bilder, `.txt`/`.md` oder eingefügter Text, wahlweise auch nur ein Thema. Niveau wählbar (Einsteiger bis Prüfungsniveau).
- **Karteikarten mit Spaced Repetition**: Leitner-System mit 5 Boxen. Was du weißt, kommt seltener dran, was du nicht weißt, sofort wieder.
- **„Erklär mir das genauer“**: Claude erklärt eine Karte ausführlicher, mit Beispiel und Eselsbrücke.
- **Quiz**: Multiple Choice mit Erklärungen, falsch beantwortete Fragen kannst du gezielt wiederholen.
- **Tutor-Chat**: Fragen zum Stoff stellen. Der Tutor kennt deine Karten und die Zusammenfassung.
- **Mehr erzeugen**: Lernsets mit neuen Unterlagen erweitern, ohne doppelte Karten.
- **Export/Import**: Backup als JSON-Datei.

## Starten

```bash
npm install
npm run dev
```

Dann im Browser öffnen, auf ⚙︎ tippen und einen Claude API-Key eintragen ([console.anthropic.com](https://console.anthropic.com/settings/keys)).

## Wie es funktioniert

- Reine Browser-App (Vite + TypeScript), kein eigener Server.
- Claude-Aufrufe laufen über das offizielle `@anthropic-ai/sdk` direkt aus dem Browser. Das Lernset kommt per Structured Output (Zod-Schema) als garantiert gültiges JSON zurück.
- Lernsets und API-Key liegen nur im `localStorage` deines Browsers.

> ⚠️ Der API-Key liegt im Browser. Das ist für die eigene, private Nutzung okay. Hoste die App aber nicht öffentlich mit einem fest eingebauten Key.

## Projektstruktur

| Datei | Inhalt |
|---|---|
| `src/ai.ts` | Claude-Aufrufe: Lernset generieren, Tutor-Chat, Erklärungen |
| `src/store.ts` | Speicherung + Leitner-Wiederholungslogik |
| `src/main.ts` | UI und Routing |
| `src/style.css` | Styles (Hell-/Dunkelmodus, mobil optimiert) |
