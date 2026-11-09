import type { Store } from "../model/store";
import type { Card } from "../types";
import { uid } from "../utils/id";
import { lookupVocabulary } from "../vocabulary/dictionary";
import type { VocabularyEntry } from "../vocabulary/dictionary";

export function saveVocabularySense(store: Store, entry: VocabularyEntry, sense: string, options: { docPath?: string; example?: string }): Card {
  const canonical = lookupVocabulary(entry.word);
  if (!canonical || canonical.lemma !== entry.lemma || !canonical.senses.includes(sense)) throw new Error("请选择词典中的释义");
  const studySetId = store.activeStudySetId;
  const existing = store.cards.find(card => card.vocabulary?.lemma === canonical.lemma && card.vocabulary.sense === sense && card.vocabulary.studySetId === studySetId);
  if (existing) return existing;
  let id: string;
  do { id = uid("card"); } while (store.getCard(id));
  const card: Card = { id, docPath: options.docPath ?? "", type: "flashcard", front: `词：${canonical.word}`,
    back: `原形：${canonical.lemma}\n音标：/${canonical.phonetic}/\n释义：${sense}\n例句：${options.example?.trim() ?? ""}`,
    templateId: "foreign-vocabulary", vocabulary: { lemma: canonical.lemma, sense, ...(studySetId ? { studySetId } : {}) },
    links: [], tags: [], createdAt: new Date().toISOString() };
  store.addCard(card);
  return card;
}
