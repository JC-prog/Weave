# ADR 004 — Retrieval-Augmented Generation for AI Chat

**Status:** Accepted
**Date:** 2026-03-27
**Author:** Engineering Team

---

## Context

The defining feature of this system — what makes it NotebookLM-like rather than just a Markdown editor — is an AI assistant that can answer questions grounded in the user's own notes. This requires that the AI's responses be:

1. **Factually accurate with respect to the notes:** The AI should not invent facts not present in the user's knowledge base.
2. **Transparent about sources:** Users should be able to see exactly which notes the AI drew from, and verify the answer.
3. **Personalized:** The AI should understand the user's specific context, terminology, and notes — not just general world knowledge.
4. **Not a data leak:** The user's notes should not be sent to an LLM in their entirety on every query. This is both a cost concern (LLM pricing is per-token) and a privacy concern.

### The Hallucination Problem

Large language models are trained on vast corpora and have extensive world knowledge. However, they have no knowledge of the user's personal notes. If we simply asked "What are the key insights from my notes on transformer architectures?" without providing the notes, the LLM would generate a plausible-sounding but entirely fabricated answer based on its training data, not the user's actual notes.

### The Context Window Problem

We cannot solve this by simply appending all user notes to every query. A typical vault might contain 500–5,000 notes totaling millions of tokens. Current LLM context windows (128K–200K tokens for Claude, 128K for GPT-4o) cannot fit all of this. Even if they could, the cost per query would be prohibitive (100K tokens at current API rates = ~$0.30 per query). And longer contexts reduce the model's ability to focus on the most relevant information.

### Alternatives Considered

**Option A: Fine-tuning**
Fine-tune an LLM on the user's notes. The model would "know" the user's content.
- Drawbacks: Fine-tuning is expensive (compute + API cost), requires periodic retraining as notes change, and still hallucinates. Fine-tuned models don't cite sources. Not practical for a self-hosted personal tool.

**Option B: Full context stuffing (small vaults only)**
For small vaults (<50 notes, ~50K tokens), include all notes in every query.
- Drawbacks: Doesn't scale, expensive, dilutes the model's attention, fails for any medium or large vault.

**Option C: Keyword search → context injection**
Use full-text search to find relevant notes, inject them as context.
- Drawback: Keyword search misses semantically related content with different vocabulary. A question phrased differently from how the note was written will miss the relevant note.

**Option D: Semantic search → context injection (pure RAG)**
Use vector similarity search to find relevant chunks, inject them as context.
- Drawback: Semantic search alone misses exact keyword matches (code, names, specific facts). See ADR 003.

**Option E: Hybrid search → context injection (selected)**
Use the hybrid search pipeline (ADR 003) to find the most relevant chunks, then build a structured prompt with those chunks as context. Stream the LLM response token by token back to the client. Include source citations in the response.

---

## Decision

We implement a **Retrieval-Augmented Generation (RAG) pipeline** in the `ai-service` using hybrid search for retrieval.

### Pipeline Steps

#### Step 1: Receive User Message

The client sends a message to `POST /api/ai/conversations/:id/messages`. The request body includes the message content and the `vaultId` to search within.

#### Step 2: Embed the Query

Call `embedding-service POST /embed` with the user's message text to get a 384-dimension query vector. This is done synchronously (10–20ms).

#### Step 3: Hybrid Retrieval

Call `search-service GET /api/search` with the query, vault, and `mode=hybrid`. The search service returns the top-k (default: 5) most relevant note chunks, ranked by RRF score. Each result includes:
- `noteId`, `noteTitle`, `tags`
- `chunkText` — the actual text excerpt
- `score` — the RRF relevance score

Why top-5? This is a balance between context richness and token cost. 5 chunks of ~512 tokens each = ~2,560 tokens of context. Added to the system prompt (~200 tokens), conversation history (~500 tokens), and the user message (~50 tokens), the total input is ~3,300 tokens — affordable and well within all provider context limits.

#### Step 4: Build Context Prompt

Construct a structured prompt from the system instructions, conversation history, retrieved chunks, and user message:

```
[System Prompt]
You are a knowledgeable assistant with access to the user's personal notes.
Your role is to answer questions accurately based on the provided note excerpts.

Rules:
- Answer ONLY based on the provided note excerpts.
- If the answer is not present in the notes, clearly state: "I don't see information about this in your notes."
- Always cite which note(s) your answer draws from using the format [Note: <title>].
- Do not use information from your training data unless it contextualizes the note content.

[Retrieved Note Excerpts]
--- [1] "Attention is All You Need — Notes" (tags: ml, transformers) ---
The transformer architecture introduced in this paper replaces recurrent layers entirely
with self-attention mechanisms...

--- [2] "Deep Learning Study Log" (tags: ml, study) ---
Key insight from reading the attention paper: the multi-head attention allows the model
to jointly attend to information from different representation subspaces...

[/Retrieved Note Excerpts]

[Conversation History]
User: What papers have I been reading about neural networks?
Assistant: Based on your notes, you've been reading about transformers and attention mechanisms. [Note: Reading List 2026]

[Current Message]
User: What do my notes say specifically about how attention works?
```

#### Step 5: Stream LLM Response

Send the prompt to the configured LLM provider and stream the response:

- **Anthropic:** `anthropic.messages.stream()` → yields `text_delta` events
- **OpenAI:** `openai.chat.completions.create({ stream: true })` → yields `choices[0].delta.content`
- **Ollama:** `ollama.chat({ stream: true })` → yields `message.content`

Each token is immediately forwarded to the client as an SSE event:
```
data: {"type": "token", "delta": "The "}
data: {"type": "token", "delta": "transformer "}
```

Before the first token, send the sources:
```
data: {"type": "sources", "sources": [{"noteId": "...", "title": "...", "excerpt": "..."}]}
```

On completion:
```
data: {"type": "done", "messageId": "msg-uuid"}
data: [DONE]
```

#### Step 6: Persist and Return

After the stream completes, persist the complete message to the database:
```sql
INSERT INTO ai.messages (conversation_id, role, content, sources)
VALUES ($1, 'assistant', $2, $3::jsonb)
```

`sources` is a JSONB array of `{ noteId, title, excerpt }` objects. This allows the UI to render clickable source citations after the stream completes, and allows future "explain your sources" queries.

### Conversation History Management

To support multi-turn conversations, the last N messages are included in the prompt:
- Default: last 6 messages (3 user/assistant pairs)
- This provides conversational context without excessive token usage
- Older messages are truncated from the context (but remain in the database for display)

### Provider Abstraction

The AI service abstracts over LLM providers using a unified interface:

```typescript
interface LLMProvider {
  streamChat(prompt: PromptMessages, options: ChatOptions): AsyncIterable<string>
}

class AnthropicProvider implements LLMProvider { ... }
class OpenAIProvider implements LLMProvider { ... }
class OllamaProvider implements LLMProvider { ... }
```

The active provider is selected by the `AI_PROVIDER` environment variable. Switching providers requires only an environment change and service restart — no code changes.

---

## Consequences

### Positive

**No hallucination about notes:** The system prompt explicitly instructs the LLM to answer only from provided excerpts and to say so if the answer isn't there. In practice, modern LLMs (Claude, GPT-4o) follow this instruction reliably. The grounded context makes hallucination far less likely than open-ended prompting.

**Source transparency:** Every AI response is accompanied by the exact note excerpts that informed it. Users can click a source citation to jump directly to the relevant note. This builds trust and allows verification.

**Token efficiency:** Retrieving 5 relevant chunks (~2,500 tokens) costs dramatically less than sending an entire vault as context. A typical AI chat message costs ~$0.005 with Claude Haiku or GPT-4o-mini — affordable for personal use.

**Streaming UX:** Token streaming means the user sees the first word of the response within ~500ms of sending their message, rather than waiting 5–10 seconds for a complete response. This dramatically improves the perceived responsiveness of the AI.

**Provider flexibility:** The LLM provider is abstracted and configurable. Users can switch between Anthropic Claude, OpenAI GPT-4o, or local Ollama without changing anything except an environment variable.

**Works offline (with Ollama):** With `AI_PROVIDER=ollama` and a local Ollama instance, the entire RAG pipeline runs locally — no API keys or internet connection required. This is valuable for privacy-sensitive use cases.

### Negative

**Retrieval quality gates answer quality:** The RAG pipeline is only as good as the retrieval step. If the hybrid search fails to retrieve the relevant chunks (e.g., the query is too vague, or the relevant content has not been indexed yet), the LLM will correctly say "I don't see this in your notes" even if the information exists. Improving retrieval quality (better chunking, re-ranking) directly improves AI answer quality.

**Eventual consistency lag:** As established in ADR 003, new notes take ~100–500ms to appear in the semantic search index. During this window, a newly created note won't be retrievable by the AI. This is generally acceptable (users rarely ask about a note they just created), but worth noting.

**LLM instruction following is not 100% reliable:** Very occasionally, LLMs break the "answer only from provided context" instruction and inject training data knowledge. This is more likely with smaller/less capable models (e.g., smaller Ollama models). Anthropic Claude and OpenAI GPT-4o follow the instruction reliably.

**Context window is fixed at 5 chunks:** For questions that span many notes, the top-5 retrieval limit may miss relevant material. A future improvement is dynamic chunk count based on query complexity, or multi-turn retrieval (ask the model if it needs more context).

### Upgrade Path

- **Re-ranking:** Add a cross-encoder re-ranker between retrieval and context building to improve chunk selection quality.
- **HyDE (Hypothetical Document Embeddings):** Generate a hypothetical answer to the query, embed it, and use that for retrieval. Improves semantic search for questions phrased very differently from the stored content.
- **Multi-hop RAG:** After the first retrieval, analyze the retrieved chunks and issue a second search query for follow-up information. Enables answering questions that require synthesizing information across multiple retrieval steps.
- **Note graph context:** Augment retrieved chunks with backlink/forward-link context — if note A is retrieved, also include excerpts from notes that A links to. Leverages the knowledge graph for richer context.
