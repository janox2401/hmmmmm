import "./style.css";
import { describeError, explainCard, generateDeck, TutorChat, type GenerateOptions } from "./ai";
import {
  deleteDeck,
  dueCards,
  exportData,
  getDeck,
  importData,
  loadDecks,
  loadSettings,
  MAX_BOX,
  newCard,
  reviewCard,
  saveSettings,
  uid,
  upsertDeck,
  type Deck,
  type Question,
} from "./store";

const app = document.querySelector<HTMLDivElement>("#app")!;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function $(sel: string): HTMLElement {
  return app.querySelector<HTMLElement>(sel)!;
}

function go(hash: string): void {
  location.hash = hash;
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function layout(title: string, body: string, back?: string): void {
  app.innerHTML = `
    <header class="top">
      ${back ? `<a class="back" href="${back}" aria-label="Zurück">←</a>` : `<span class="logo">🎓</span>`}
      <h1>${esc(title)}</h1>
      <a class="icon-btn" href="#/settings" aria-label="Einstellungen">⚙︎</a>
    </header>
    <main>${body}</main>`;
}

function errorBox(err: unknown): string {
  return `<div class="error">${esc(describeError(err))}</div>`;
}

// ---------- Home ----------

function renderHome(): void {
  const settings = loadSettings();
  const decks = loadDecks();
  const list = decks
    .map((d) => {
      const due = dueCards(d).length;
      const mastered = d.cards.filter((c) => c.box >= MAX_BOX).length;
      const pct = d.cards.length ? Math.round((mastered / d.cards.length) * 100) : 0;
      return `
        <a class="deck" href="#/deck/${d.id}">
          <div class="deck-head">
            <strong>${esc(d.name)}</strong>
            ${due ? `<span class="badge">${due} fällig</span>` : `<span class="badge ok">✓</span>`}
          </div>
          <div class="muted">${esc(d.subject || "Ohne Fach")} · ${d.cards.length} Karten · ${d.questions.length} Fragen</div>
          <div class="bar"><span style="width:${pct}%"></span></div>
        </a>`;
    })
    .join("");

  layout(
    "Lernbuddy",
    `
    ${settings.apiKey ? "" : `<div class="notice">Willkommen! Trag zuerst deinen <a href="#/settings">Claude API-Key</a> ein, dann kann es losgehen.</div>`}
    <a class="btn primary block" href="#/new">＋ Neues Lernset aus Unterlagen</a>
    ${decks.length ? `<div class="decks">${list}</div>` : `<p class="empty">Noch keine Lernsets. Lade ein Skript, Folien oder Notizen hoch und Claude macht daraus Karteikarten und ein Quiz.</p>`}
  `,
  );
}

// ---------- Create / extend ----------

function generatorForm(deck?: Deck): string {
  return `
    <form id="gen" class="stack">
      ${
        deck
          ? ""
          : `<label>Thema <input name="topic" required placeholder="z. B. Lineare Regression, Vorlesung 4"></label>
             <label>Fach <input name="subject" placeholder="z. B. Statistik II"></label>`
      }
      <label>Unterlagen hochladen <span class="muted">(PDF, Bilder, .txt/.md – optional)</span>
        <input name="files" type="file" multiple accept=".pdf,.txt,.md,image/png,image/jpeg,image/webp,image/gif">
      </label>
      <label>…oder Text/Notizen einfügen
        <textarea name="text" rows="6" placeholder="Mitschrift, Folientext, Definitionen …"></textarea>
      </label>
      <div class="row">
        <label>Karteikarten <input name="cards" type="number" min="0" max="40" value="12"></label>
        <label>Quizfragen <input name="questions" type="number" min="0" max="25" value="8"></label>
      </div>
      <label>Niveau
        <select name="level">
          <option value="einsteiger">Einsteiger</option>
          <option value="mittel" selected>Fortgeschritten</option>
          <option value="pruefung">Prüfungsniveau</option>
        </select>
      </label>
      <button class="btn primary" type="submit">✨ ${deck ? "Weitere Inhalte erzeugen" : "Lernset erzeugen"}</button>
      <div id="status"></div>
    </form>`;
}

function bindGenerator(deck?: Deck): void {
  const form = $("#gen") as HTMLFormElement;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const files = (form.elements.namedItem("files") as HTMLInputElement).files;
    const settings = loadSettings();
    const opts: GenerateOptions = {
      topic: deck ? deck.name : String(fd.get("topic")).trim(),
      subject: deck ? deck.subject : String(fd.get("subject") ?? "").trim(),
      studyProgram: settings.studyProgram,
      material: { text: String(fd.get("text") ?? ""), files: files ? [...files] : [] },
      cardCount: Number(fd.get("cards")),
      questionCount: Number(fd.get("questions")),
      level: fd.get("level") as GenerateOptions["level"],
      existing: deck ? [...deck.cards.map((c) => c.front), ...deck.questions.map((q) => q.question)] : undefined,
    };
    if (opts.cardCount + opts.questionCount === 0) return;

    const button = form.querySelector("button")!;
    const status = $("#status");
    button.disabled = true;
    status.innerHTML = `<div class="loading"><span class="spinner"></span> Claude liest deine Unterlagen und erstellt Lernmaterial … (kann bis zu einer Minute dauern)</div>`;
    try {
      const out = await generateDeck(settings.apiKey, opts);
      const target: Deck = deck ?? {
        id: uid(),
        name: out.deck_name || opts.topic,
        subject: opts.subject,
        summary: out.summary,
        createdAt: Date.now(),
        cards: [],
        questions: [],
      };
      target.cards.push(...out.flashcards.map((c) => newCard(c.front, c.back)));
      target.questions.push(
        ...out.quiz.map<Question>((q) => ({
          id: uid(),
          question: q.question,
          options: q.options,
          correctIndex: q.correct_index,
          explanation: q.explanation,
        })),
      );
      if (deck && out.summary) target.summary = `${deck.summary}\n\n${out.summary}`.trim();
      upsertDeck(target);
      go(`#/deck/${target.id}`);
    } catch (err) {
      status.innerHTML = errorBox(err);
      button.disabled = false;
    }
  });
}

function renderNew(): void {
  layout("Neues Lernset", generatorForm(), "#/");
  bindGenerator();
}

function renderMore(deck: Deck): void {
  layout(`Mehr zu „${deck.name}“`, `<p class="muted">Lade weitere Unterlagen hoch oder lass Claude das Thema vertiefen. Bestehende Karten werden nicht doppelt erzeugt.</p>${generatorForm(deck)}`, `#/deck/${deck.id}`);
  bindGenerator(deck);
}

// ---------- Deck overview ----------

function renderDeck(deck: Deck): void {
  const due = dueCards(deck).length;
  const boxes = Array.from({ length: MAX_BOX }, (_, i) => deck.cards.filter((c) => c.box === i + 1).length);
  layout(
    deck.name,
    `
    <p class="muted">${esc(deck.subject || "Ohne Fach")}</p>
    <div class="actions">
      <a class="btn primary" href="#/deck/${deck.id}/learn">🃏 Karteikarten lernen <small>${due ? `${due} fällig` : "alle wiederholt"}</small></a>
      <a class="btn" href="#/deck/${deck.id}/quiz">📝 Quiz <small>${deck.questions.length} ${deck.questions.length === 1 ? "Frage" : "Fragen"}</small></a>
      <a class="btn" href="#/deck/${deck.id}/tutor">💬 Tutor fragen</a>
      <a class="btn wide" href="#/deck/${deck.id}/more">✨ Mehr erzeugen</a>
    </div>
    <h2>Fortschritt</h2>
    <div class="boxes">${boxes.map((n, i) => `<div><span>${n}</span><small>Box ${i + 1}</small></div>`).join("")}</div>
    ${deck.summary ? `<h2>Zusammenfassung</h2><p class="summary">${esc(deck.summary)}</p>` : ""}
    <details><summary>Alle Karten (${deck.cards.length})</summary>
      <ul class="cardlist">${deck.cards.map((c) => `<li><strong>${esc(c.front)}</strong><br>${esc(c.back)}</li>`).join("")}</ul>
    </details>
    <button class="btn danger" id="del">Lernset löschen</button>
  `,
    "#/",
  );
  $("#del").addEventListener("click", () => {
    if (confirm(`„${deck.name}“ wirklich löschen?`)) {
      deleteDeck(deck.id);
      go("#/");
    }
  });
}

// ---------- Flashcards ----------

function renderLearn(deck: Deck, practiceAll = false): void {
  const queue = shuffle(practiceAll ? deck.cards : dueCards(deck));
  const total = queue.length;
  const missed = new Set<string>();

  if (!queue.length) {
    layout(
      "Karteikarten",
      `<div class="done"><div class="big">🎉</div><p>Für heute ist nichts mehr fällig.</p>
       <button class="btn" id="all">Trotzdem alle üben</button>
       <a class="btn primary" href="#/deck/${deck.id}/quiz">Quiz machen</a></div>`,
      `#/deck/${deck.id}`,
    );
    $("#all").addEventListener("click", () => renderLearn(deck, true));
    return;
  }

  const show = () => {
    const card = queue[0];
    if (!card) {
      layout(
        "Geschafft!",
        `<div class="done"><div class="big">✅</div><p>${total - missed.size} von ${total} auf Anhieb gewusst.</p>
         <a class="btn primary" href="#/deck/${deck.id}">Zur Übersicht</a></div>`,
        `#/deck/${deck.id}`,
      );
      return;
    }
    layout(
      `Karteikarten · noch ${queue.length}`,
      `
      <div class="flashcard" id="card" tabindex="0">
        <div class="side front">${esc(card.front)}</div>
        <div class="side back hidden">${esc(card.back)}</div>
        <div class="hint">Tippen zum Umdrehen</div>
      </div>
      <div class="answer hidden" id="answer">
        <button class="btn no" id="no">✗ Nicht gewusst</button>
        <button class="btn yes" id="yes">✓ Gewusst</button>
      </div>
      <button class="btn ghost hidden" id="explain">💡 Erklär mir das genauer</button>
      <div id="explanation"></div>
    `,
      `#/deck/${deck.id}`,
    );
    const flip = () => {
      app.querySelector("#card .back")!.classList.remove("hidden");
      app.querySelector("#card .hint")!.classList.add("hidden");
      $("#answer").classList.remove("hidden");
      $("#explain").classList.remove("hidden");
    };
    $("#card").addEventListener("click", flip);
    $("#card").addEventListener("keydown", (e) => (e.key === " " || e.key === "Enter") && flip());

    const answer = (knewIt: boolean) => {
      const fresh = getDeck(deck.id) ?? deck;
      fresh.cards = fresh.cards.map((c) => (c.id === card.id ? reviewCard(c, knewIt) : c));
      upsertDeck(fresh);
      deck = fresh;
      queue.shift();
      if (!knewIt) {
        missed.add(card.id);
        queue.push(card); // repeat at the end of this session
      }
      show();
    };
    $("#yes").addEventListener("click", () => answer(true));
    $("#no").addEventListener("click", () => answer(false));

    $("#explain").addEventListener("click", async () => {
      const btn = $("#explain") as HTMLButtonElement;
      const out = $("#explanation");
      btn.disabled = true;
      out.innerHTML = `<div class="tutor-msg"><span class="spinner"></span></div>`;
      try {
        await explainCard(loadSettings().apiKey, deck, card, loadSettings().studyProgram, (text) => {
          out.innerHTML = `<div class="tutor-msg">${esc(text)}</div>`;
        });
      } catch (err) {
        out.innerHTML = errorBox(err);
        btn.disabled = false;
      }
    });
  };
  show();
}

// ---------- Quiz ----------

function renderQuiz(deck: Deck, subset?: Question[]): void {
  const questions = shuffle(subset ?? deck.questions).slice(0, 10);
  const wrong: Question[] = [];
  let index = 0;
  let score = 0;

  if (!questions.length) {
    layout("Quiz", `<p class="empty">Noch keine Quizfragen.</p><a class="btn primary" href="#/deck/${deck.id}/more">✨ Fragen erzeugen</a>`, `#/deck/${deck.id}`);
    return;
  }

  const show = () => {
    const q = questions[index];
    if (!q) {
      layout(
        "Quiz-Ergebnis",
        `<div class="done"><div class="big">${score === questions.length ? "🏆" : score / questions.length >= 0.6 ? "👍" : "📚"}</div>
         <p><strong>${score} von ${questions.length}</strong> richtig.</p>
         ${wrong.length ? `<button class="btn primary" id="retry">Falsche nochmal (${wrong.length})</button>` : ""}
         <button class="btn" id="again">Neue Runde</button>
         <a class="btn ghost" href="#/deck/${deck.id}">Zur Übersicht</a></div>`,
        `#/deck/${deck.id}`,
      );
      app.querySelector("#retry")?.addEventListener("click", () => renderQuiz(deck, wrong));
      $("#again").addEventListener("click", () => renderQuiz(deck));
      return;
    }
    // Shuffle option order but remember which one is right.
    const order = shuffle(q.options.map((_, i) => i));
    layout(
      `Quiz · ${index + 1}/${questions.length}`,
      `
      <p class="question">${esc(q.question)}</p>
      <div class="options">${order.map((i) => `<button class="option" data-i="${i}">${esc(q.options[i])}</button>`).join("")}</div>
      <div id="feedback"></div>
    `,
      `#/deck/${deck.id}`,
    );
    app.querySelectorAll<HTMLButtonElement>(".option").forEach((btn) =>
      btn.addEventListener("click", () => {
        const chosen = Number(btn.dataset.i);
        const correct = chosen === q.correctIndex;
        if (correct) score++;
        else wrong.push(q);
        app.querySelectorAll<HTMLButtonElement>(".option").forEach((b) => {
          b.disabled = true;
          const i = Number(b.dataset.i);
          if (i === q.correctIndex) b.classList.add("right");
          else if (i === chosen) b.classList.add("wrong");
        });
        $("#feedback").innerHTML = `
          <div class="feedback ${correct ? "right" : "wrong"}">
            <strong>${correct ? "Richtig!" : "Leider falsch."}</strong>
            <p>${esc(q.explanation)}</p>
          </div>
          <button class="btn primary block" id="next">${index + 1 < questions.length ? "Weiter" : "Ergebnis"}</button>`;
        $("#next").addEventListener("click", () => {
          index++;
          show();
        });
      }),
    );
  };
  show();
}

// ---------- Tutor chat ----------

function renderTutor(deck: Deck): void {
  const settings = loadSettings();
  const chat = new TutorChat(settings.apiKey, deck, settings.studyProgram);
  layout(
    "Tutor",
    `
    <div class="chat" id="log">
      <div class="tutor-msg">Hi! Frag mich alles zu „${esc(deck.name)}“ – z. B. „Erklär mir das nochmal einfacher“ oder „Mach mir eine Übungsaufgabe“.</div>
    </div>
    <form id="ask" class="chat-form">
      <textarea name="q" rows="2" placeholder="Deine Frage …" required></textarea>
      <button class="btn primary" type="submit">Senden</button>
    </form>
  `,
    `#/deck/${deck.id}`,
  );
  const log = $("#log");
  const form = $("#ask") as HTMLFormElement;
  const input = form.elements.namedItem("q") as HTMLTextAreaElement;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    const button = form.querySelector("button")!;
    button.disabled = true;
    log.insertAdjacentHTML("beforeend", `<div class="user-msg">${esc(q)}</div>`);
    const reply = document.createElement("div");
    reply.className = "tutor-msg";
    reply.innerHTML = `<span class="spinner"></span>`;
    log.appendChild(reply);
    reply.scrollIntoView({ block: "end" });
    try {
      await chat.send(q, (text) => {
        reply.textContent = text;
        reply.scrollIntoView({ block: "end" });
      });
    } catch (err) {
      reply.outerHTML = errorBox(err);
    }
    button.disabled = false;
    input.focus();
  });
}

// ---------- Settings ----------

function renderSettings(): void {
  const s = loadSettings();
  layout(
    "Einstellungen",
    `
    <form id="settings" class="stack">
      <label>Claude API-Key
        <input name="apiKey" type="password" autocomplete="off" value="${esc(s.apiKey)}" placeholder="sk-ant-…">
      </label>
      <p class="muted small">Den Key bekommst du in der <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Claude Console</a>. Er wird nur lokal in diesem Browser gespeichert und direkt an die Claude API geschickt.</p>
      <label>Was studierst du? <span class="muted">(optional, hilft beim Erklären)</span>
        <input name="studyProgram" value="${esc(s.studyProgram)}" placeholder="z. B. BWL, 3. Semester">
      </label>
      <button class="btn primary" type="submit">Speichern</button>
    </form>
    <h2>Daten</h2>
    <p class="muted small">Alle Lernsets liegen nur in diesem Browser. Exportiere sie als Backup oder um sie auf ein anderes Gerät zu übertragen.</p>
    <div class="row">
      <button class="btn" id="export">⬇ Exportieren</button>
      <label class="btn">⬆ Importieren<input id="import" type="file" accept="application/json" hidden></label>
    </div>
  `,
    "#/",
  );
  ($("#settings") as HTMLFormElement).addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    saveSettings({ apiKey: String(fd.get("apiKey")).trim(), studyProgram: String(fd.get("studyProgram")).trim() });
    go("#/");
  });
  $("#export").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([exportData()], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "lernbuddy-backup.json" });
    a.click();
    URL.revokeObjectURL(url);
  });
  $("#import").addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      alert(`${importData(await file.text())} Lernset(s) importiert.`);
      go("#/");
    } catch (err) {
      alert(describeError(err));
    }
  });
}

// ---------- Router ----------

function route(): void {
  const [, page, id, sub] = location.hash.split("/");
  window.scrollTo(0, 0);
  if (page === "settings") return renderSettings();
  if (page === "new") return renderNew();
  if (page === "deck" && id) {
    const deck = getDeck(id);
    if (!deck) return go("#/");
    if (sub === "learn") return renderLearn(deck);
    if (sub === "quiz") return renderQuiz(deck);
    if (sub === "tutor") return renderTutor(deck);
    if (sub === "more") return renderMore(deck);
    return renderDeck(deck);
  }
  renderHome();
}

window.addEventListener("hashchange", route);
route();
