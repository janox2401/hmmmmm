// Persistence in localStorage plus a simple Leitner spaced-repetition scheme.

export interface Card {
  id: string;
  front: string;
  back: string;
  /** Leitner box 1..5 — higher means better known. */
  box: number;
  /** Timestamp (ms) when the card is due again. */
  due: number;
}

export interface Question {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface Deck {
  id: string;
  name: string;
  subject: string;
  summary: string;
  createdAt: number;
  cards: Card[];
  questions: Question[];
}

export interface Settings {
  apiKey: string;
  studyProgram: string;
}

const DECKS_KEY = "lernbuddy.decks";
const SETTINGS_KEY = "lernbuddy.settings";

const DAY = 24 * 60 * 60 * 1000;
/** Days until a card in box n is due again. */
const BOX_INTERVALS = [0, 1, 2, 4, 8, 16];
export const MAX_BOX = 5;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    alert("Speichern fehlgeschlagen (Speicher voll?): " + String(err));
  }
}

export function uid(): string {
  return crypto.randomUUID();
}

export function loadSettings(): Settings {
  return { apiKey: "", studyProgram: "", ...read<Partial<Settings>>(SETTINGS_KEY, {}) };
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
}

export function loadDecks(): Deck[] {
  return read<Deck[]>(DECKS_KEY, []);
}

export function saveDecks(decks: Deck[]): void {
  write(DECKS_KEY, decks);
}

export function getDeck(id: string): Deck | undefined {
  return loadDecks().find((d) => d.id === id);
}

export function upsertDeck(deck: Deck): void {
  const decks = loadDecks();
  const i = decks.findIndex((d) => d.id === deck.id);
  if (i >= 0) decks[i] = deck;
  else decks.unshift(deck);
  saveDecks(decks);
}

export function deleteDeck(id: string): void {
  saveDecks(loadDecks().filter((d) => d.id !== id));
}

export function newCard(front: string, back: string): Card {
  return { id: uid(), front, back, box: 1, due: Date.now() };
}

/** Moves a card through the Leitner boxes after a review. */
export function reviewCard(card: Card, knewIt: boolean): Card {
  const box = knewIt ? Math.min(card.box + 1, MAX_BOX) : 1;
  return { ...card, box, due: Date.now() + BOX_INTERVALS[box] * DAY };
}

export function dueCards(deck: Deck, now = Date.now()): Card[] {
  return deck.cards.filter((c) => c.due <= now);
}

export function exportData(): string {
  return JSON.stringify({ version: 1, decks: loadDecks() }, null, 2);
}

export function importData(json: string): number {
  const parsed = JSON.parse(json) as { decks?: Deck[] };
  if (!Array.isArray(parsed.decks)) throw new Error("Keine gültige Lernbuddy-Datei.");
  const existing = loadDecks();
  const ids = new Set(existing.map((d) => d.id));
  const incoming = parsed.decks.filter((d) => !ids.has(d.id));
  saveDecks([...incoming, ...existing]);
  return incoming.length;
}
