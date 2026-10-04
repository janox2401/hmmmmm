// All Claude API calls. The app runs fully in the browser, so the user's own
// API key is sent straight to the Anthropic API (dangerouslyAllowBrowser).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { Card, Deck } from "./store";

const MODEL = "claude-opus-5-5";
// Server-side fallback: if the model declines a request, Anthropic retries it
// on a suitable fallback model instead of returning a refusal.
const BETAS = ["server-side-fallback-2026-07-01"];

export interface Material {
  text: string;
  files: File[];
}

export interface GenerateOptions {
  topic: string;
  subject: string;
  studyProgram: string;
  material: Material;
  cardCount: number;
  questionCount: number;
  level: "einsteiger" | "mittel" | "pruefung";
  /** Fronts / questions that already exist, so Claude does not repeat them. */
  existing?: string[];
}

const GeneratedSchema = z.object({
  deck_name: z.string().describe("Kurzer, prägnanter Name für das Lernset"),
  summary: z.string().describe("Zusammenfassung der wichtigsten Inhalte in 3-6 Sätzen"),
  flashcards: z.array(
    z.object({
      front: z.string().describe("Frage oder Begriff auf der Vorderseite"),
      back: z.string().describe("Präzise Antwort oder Definition auf der Rückseite"),
    }),
  ),
  quiz: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()).describe("Genau 4 Antwortmöglichkeiten"),
      correct_index: z.number().int().describe("Index (0-3) der richtigen Antwort"),
      explanation: z.string().describe("Warum die richtige Antwort stimmt und die anderen nicht"),
    }),
  ),
});

export type Generated = z.infer<typeof GeneratedSchema>;

const LEVEL_TEXT: Record<GenerateOptions["level"], string> = {
  einsteiger: "Einsteiger: Grundbegriffe und Definitionen, verständlich erklärt",
  mittel: "Fortgeschritten: Zusammenhänge, Anwendung und typische Verwechslungen",
  pruefung: "Prüfungsniveau: anspruchsvolle Fragen wie in einer Uni-Klausur, inkl. Transfer und Rechnen/Analysieren wo passend",
};

function client(apiKey: string): Anthropic {
  if (!apiKey) throw new Error("Bitte zuerst in den Einstellungen einen API-Key eintragen.");
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

function tutorSystem(studyProgram: string): string {
  return [
    "Du bist ein geduldiger, präziser Tutor für Studierende und antwortest auf Deutsch.",
    studyProgram ? `Die Person studiert: ${studyProgram}.` : "",
    "Erkläre fachlich korrekt, mit Beispielen und ohne unnötiges Fülltext. Wenn du dir bei etwas unsicher bist, sag es.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function fileToBlock(file: File): Promise<BetaContentBlockParam> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  if (file.type === "application/pdf") {
    return { type: "document", title: file.name, source: { type: "base64", media_type: "application/pdf", data } };
  }
  if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)) {
    return {
      type: "image",
      source: { type: "base64", media_type: file.type as "image/png", data },
    };
  }
  // Plain-text-ish files (.txt, .md, …) are inlined as text.
  return { type: "text", text: `Datei ${file.name}:\n\n${await file.text()}` };
}

function assertNotRefused(message: BetaMessage): void {
  if (message.stop_reason === "refusal") {
    throw new Error("Claude hat diese Anfrage abgelehnt. Formuliere sie bitte etwas anders.");
  }
}

/** Turns SDK errors into short German messages for the UI. */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Der API-Key ist ungültig. Bitte in den Einstellungen prüfen.";
  if (err instanceof Anthropic.PermissionDeniedError) return "Dein API-Key hat keinen Zugriff auf dieses Modell.";
  if (err instanceof Anthropic.RateLimitError) return "Zu viele Anfragen – bitte kurz warten und erneut versuchen.";
  if (err instanceof Anthropic.BadRequestError) return `Anfrage abgelehnt: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Keine Verbindung zur Claude API. Bist du online?";
  if (err instanceof Anthropic.APIError) return `API-Fehler (${err.status ?? "?"}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export async function generateDeck(apiKey: string, opts: GenerateOptions): Promise<Generated> {
  const blocks: BetaContentBlockParam[] = [];
  for (const file of opts.material.files) blocks.push(await fileToBlock(file));
  if (opts.material.text.trim()) {
    blocks.push({ type: "text", text: `Meine Unterlagen/Notizen:\n\n${opts.material.text.trim()}` });
  }

  const hasMaterial = blocks.length > 0;
  const instructions = [
    `Erstelle Lernmaterial zum Thema „${opts.topic}“${opts.subject ? ` im Fach ${opts.subject}` : ""}.`,
    hasMaterial
      ? "Stütze dich vor allem auf die mitgeschickten Unterlagen. Erfinde keine Inhalte, die dort nicht vorkommen oder fachlich nicht gesichert sind."
      : "Es gibt keine Unterlagen – nutze gesichertes Lehrbuchwissen auf Uni-Niveau.",
    `Niveau: ${LEVEL_TEXT[opts.level]}.`,
    `Erzeuge genau ${opts.cardCount} Karteikarten und ${opts.questionCount} Multiple-Choice-Fragen mit je genau 4 Antworten, von denen genau eine richtig ist.`,
    "Karteikarten: eine Idee pro Karte, Vorderseite kurz, Rückseite präzise (max. ~3 Sätze). Formeln in einfacher Textschreibweise.",
    "Quiz: plausible Distraktoren, die richtige Antwort an zufälligen Positionen, Erklärung geht kurz auf die falschen Optionen ein.",
    opts.existing?.length
      ? `Diese Inhalte gibt es schon – wiederhole sie nicht, sondern ergänze neue Aspekte:\n- ${opts.existing.join("\n- ")}`
      : "",
    "Schreibe alles auf Deutsch (Fachbegriffe dürfen englisch bleiben, wenn das im Fach üblich ist).",
  ]
    .filter(Boolean)
    .join("\n\n");
  blocks.push({ type: "text", text: instructions });

  const response = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: BETAS,
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(GeneratedSchema) },
    system: tutorSystem(opts.studyProgram),
    messages: [{ role: "user", content: blocks }],
  });
  assertNotRefused(response);
  if (response.stop_reason === "max_tokens") {
    throw new Error("Die Antwort war zu lang. Bitte weniger Karten/Fragen auf einmal erzeugen.");
  }
  const out = response.parsed_output;
  if (!out) throw new Error("Claude hat kein gültiges Lernset zurückgegeben. Bitte nochmal versuchen.");

  // Guard against malformed questions instead of trusting the model blindly.
  out.quiz = out.quiz.filter(
    (q) => q.options.length >= 2 && q.correct_index >= 0 && q.correct_index < q.options.length,
  );
  return out;
}

/** A multi-turn tutor conversation about one deck, streamed into the UI. */
export class TutorChat {
  private history: BetaMessageParam[] = [];

  constructor(
    private apiKey: string,
    private deck: Deck,
    private studyProgram: string,
  ) {}

  private system(): string {
    const cards = this.deck.cards.map((c) => `- ${c.front}: ${c.back}`).join("\n");
    return [
      tutorSystem(this.studyProgram),
      `Wir lernen gerade „${this.deck.name}“${this.deck.subject ? ` (${this.deck.subject})` : ""}.`,
      this.deck.summary ? `Zusammenfassung des Stoffs: ${this.deck.summary}` : "",
      cards ? `Karteikarten des Lernsets:\n${cards}` : "",
      "Antworte kompakt in Markdown-freiem Fließtext oder einfachen Aufzählungen mit „-“.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  async send(text: string, onText: (snapshot: string) => void): Promise<string> {
    this.history.push({ role: "user", content: text });
    try {
      const stream = client(this.apiKey).beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        betas: BETAS,
        fallbacks: "default",
        output_config: { effort: "low" },
        system: this.system(),
        messages: this.history,
      });
      stream.on("text", (_delta, snapshot) => onText(snapshot));
      const message = await stream.finalMessage();
      assertNotRefused(message);
      // Keep the full content (thinking/fallback blocks included) for the next turn.
      this.history.push({ role: "assistant", content: message.content });
      return message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    } catch (err) {
      this.history.pop();
      throw err;
    }
  }
}

/** One-off deeper explanation for a flashcard. */
export async function explainCard(
  apiKey: string,
  deck: Deck,
  card: Card,
  studyProgram: string,
  onText: (snapshot: string) => void,
): Promise<string> {
  const chat = new TutorChat(apiKey, deck, studyProgram);
  return chat.send(
    `Erkläre mir diese Karteikarte genauer, mit einem anschaulichen Beispiel und einer Eselsbrücke, falls sinnvoll.\n\nVorderseite: ${card.front}\nRückseite: ${card.back}`,
    onText,
  );
}
