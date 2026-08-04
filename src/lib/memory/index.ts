/**
 * Memory retrieval.
 *
 * Hybrid: vector similarity (when an embedding provider is configured) + keyword
 * match + entity-graph expansion, re-ranked by recency-decayed salience.
 *
 * A note on embeddings: the Claude API has no embeddings endpoint. Anthropic
 * recommends a dedicated provider, so `EmbeddingProvider` is pluggable and
 * defaults to Voyage AI when `VOYAGE_API_KEY` is set. Without it, retrieval
 * runs on keyword + graph signals — degraded, not broken.
 */

import { getStore } from "@/lib/store";
import type { Entity, Memory } from "@/lib/types";

export interface EmbeddingProvider {
  id: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

class VoyageEmbeddings implements EmbeddingProvider {
  id = "voyage";
  dimensions = 1536;
  constructor(private apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: "voyage-3",
        output_dimension: this.dimensions,
      }),
    });
    if (!res.ok) throw new Error(`voyage: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  const key = process.env.VOYAGE_API_KEY;
  return key ? new VoyageEmbeddings(key) : null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "to", "of", "in", "on", "for", "with", "at", "by", "from", "about",
  "what", "when", "who", "how", "why", "i", "my", "me", "we", "it", "this",
  "that", "do", "does", "did", "should", "would", "can", "will",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Fraction of query tokens present in the candidate text. */
function keywordScore(query: string, text: string): number {
  const q = tokenize(query);
  if (!q.length) return 0;
  const t = new Set(tokenize(text));
  let hits = 0;
  for (const token of q) if (t.has(token)) hits++;
  return hits / q.length;
}

/** Salience decays with a ~60-day half-life so old facts fade but persist. */
function recencyDecayedSalience(m: Memory): number {
  const ageDays = (Date.now() - new Date(m.occurredAt).getTime()) / 864e5;
  return m.salience * Math.exp(-ageDays / 60) * m.confidence;
}

/** Entities whose name or alias appears in the query. */
export function resolveEntities(query: string, entities: Entity[]): Entity[] {
  const lower = query.toLowerCase();
  return entities.filter((e) =>
    [e.name, ...e.aliases].some((n) => lower.includes(n.toLowerCase())),
  );
}

export interface RetrievedMemory extends Memory {
  score: number;
  /** Why this memory surfaced — kept for the audit trail. */
  matchedOn: string[];
}

export interface RetrieveOptions {
  limit?: number;
  /** Bias retrieval toward these entities regardless of query text. */
  entityIds?: string[];
}

/**
 * Retrieve memory relevant to a query.
 *
 * Weighting: vector 0.5 / keyword 0.3 / entity-graph 0.2, then multiplied by
 * decayed salience. When no embedding provider is configured the vector term is
 * dropped and the remaining weights are renormalised.
 */
export async function retrieveMemory(
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievedMemory[]> {
  const { limit = 10, entityIds = [] } = options;
  const store = getStore();
  const [memories, entities] = await Promise.all([
    store.memories(),
    store.entities(),
  ]);

  const mentioned = resolveEntities(query, entities).map((e) => e.id);
  const relevantEntities = new Set([...mentioned, ...entityIds]);

  const provider = getEmbeddingProvider();
  let queryVector: number[] | null = null;
  if (provider) {
    try {
      [queryVector] = await provider.embed([query]);
    } catch {
      // Embedding failure must never take retrieval down.
      queryVector = null;
    }
  }

  const useVector = Boolean(queryVector);
  const wVector = useVector ? 0.5 : 0;
  const wKeyword = useVector ? 0.3 : 0.6;
  const wEntity = useVector ? 0.2 : 0.4;

  const scored: RetrievedMemory[] = memories.map((m) => {
    const matchedOn: string[] = [];

    let vector = 0;
    if (queryVector && m.embedding) {
      vector = cosineSimilarity(queryVector, m.embedding);
      if (vector > 0.5) matchedOn.push("semantic");
    }

    const keyword = keywordScore(query, m.content);
    if (keyword > 0) matchedOn.push("keyword");

    const overlap = m.entityIds.filter((id) => relevantEntities.has(id)).length;
    const entity = relevantEntities.size
      ? Math.min(1, overlap / relevantEntities.size)
      : 0;
    if (overlap > 0) matchedOn.push("entity-graph");

    const base = wVector * vector + wKeyword * keyword + wEntity * entity;
    // Salience acts as a floor as well as a multiplier: a highly salient
    // preference or past mistake stays reachable even on a weak text match.
    const score = base * (0.5 + recencyDecayedSalience(m));

    return { ...m, score, matchedOn };
  });

  return scored
    .filter((m) => m.score > 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * The never-ask-twice check.
 *
 * Before Trajectory asks Davarn for information it calls this. Anything above
 * the confidence threshold is used silently instead of being asked for.
 */
export async function alreadyKnows(
  question: string,
  threshold = 0.35,
): Promise<RetrievedMemory | null> {
  const hits = await retrieveMemory(question, { limit: 3 });
  const best = hits[0];
  return best && best.score >= threshold && best.confidence >= 0.7 ? best : null;
}

/** Memories that should be in context for any state computation. */
export async function standingContext(limit = 8): Promise<Memory[]> {
  const memories = await getStore().memories();
  return memories
    .filter((m) => m.kind === "preference" || m.kind === "mistake" || m.kind === "decision")
    .sort((a, b) => recencyDecayedSalience(b) - recencyDecayedSalience(a))
    .slice(0, limit);
}
