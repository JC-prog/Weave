# ADR 002 — Use Redis Streams for Event-Driven Communication

**Status:** Accepted
**Date:** 2026-03-27
**Author:** Engineering Team

---

## Context

When a user creates or updates a note in the vault service, several other services need to react asynchronously:

- **graph-service** must update the knowledge graph with new or changed wikilinks
- **embedding-service** must re-chunk the note, recompute embeddings, and update Qdrant
- **search-service** must ensure the full-text search index reflects the change

These operations must not block the user's save action. A note save should return to the client in milliseconds; embedding a note can take hundreds of milliseconds to seconds depending on length. We need an **asynchronous, reliable event propagation mechanism**.

### Requirements

1. **At-least-once delivery:** Events must not be lost if a consumer crashes mid-processing.
2. **Consumer groups:** Multiple services must be able to consume the same event independently (fan-out), each maintaining their own position in the stream.
3. **Replay / backfill:** When a service is restarted after downtime, it should be able to pick up events it missed.
4. **Persistence:** Events should be retained for at least 7 days.
5. **Low operational overhead:** We don't want to introduce a new piece of infrastructure if we can avoid it.
6. **Throughput:** At this scale (personal knowledge base, single user to small team), throughput is not a critical requirement — we expect tens to low hundreds of events per minute at peak.

### Alternatives Considered

**Option A: Apache Kafka**
Kafka is the industry standard for high-throughput event streaming. It provides exactly-once semantics, long retention, replay, and consumer groups. However:
- Kafka requires a Zookeeper instance (or KRaft mode) plus Kafka brokers — minimum 2–3 containers just for the message broker
- Kafka's operational complexity (partition management, offset management, schema registry for Avro) is substantial
- At our scale (<1000 events/minute), Kafka is significant over-engineering
- It introduces a new technology that contributors and self-hosters need to understand

**Option B: PostgreSQL LISTEN/NOTIFY**
PostgreSQL's built-in pub/sub mechanism via `NOTIFY`/`LISTEN`. No extra infrastructure (we already have Postgres). However:
- No persistence: if a consumer is offline when an event fires, the event is lost
- No consumer groups: all listeners receive every notification (no independent offset tracking)
- Limited payload size (~8KB per notification)
- Not suitable for the at-least-once delivery requirement

**Option C: RabbitMQ**
A mature message broker with routing, consumer acknowledgement, and fanout exchanges. Better operational story than Kafka for small deployments. However:
- Still an additional piece of infrastructure to run and maintain
- AMQP protocol requires a client library in each service
- Less familiar to most JavaScript/TypeScript developers compared to Redis

**Option D: Redis Streams (XADD / XREADGROUP)**
Redis Streams (introduced in Redis 5.0) provide:
- Persistent, append-only log with configurable retention
- Consumer groups with independent offsets per group
- Pending Entry List (PEL) for at-least-once delivery — unacknowledged entries are re-deliverable
- XAUTOCLAIM for rebalancing after consumer failure
- Native support in `ioredis` (Node.js) and `redis-py` (Python)
- **We already use Redis** for caching and rate limiting — no new infrastructure required

---

## Decision

We use **Redis Streams** for all asynchronous event propagation between services.

### Stream Design

**Stream: `notes.events`**

Produced by: `vault-service`
Consumed by:
- Consumer group `graph-workers` → `graph-service`
- Consumer group `embedding-workers` → `embedding-service`
- Consumer group `search-workers` → `search-service`

Message fields:
```
eventType  : "note.created" | "note.updated" | "note.deleted"
vaultId    : uuid
noteId     : uuid
userId     : uuid
timestamp  : ISO8601
```

**Stream: `media.events`**

Produced by: `media-service`
Consumed by:
- Consumer group `embedding-workers` → `embedding-service` (index extracted PDF text)

Message fields:
```
eventType  : "media.uploaded" | "media.deleted"
vaultId    : uuid
assetId    : uuid
mimeType   : string
userId     : uuid
timestamp  : ISO8601
```

### Consumer Group Configuration

Each consumer group is created with `XGROUP CREATE <stream> <group> $ MKSTREAM` on service startup. Consumers read with:

```
XREADGROUP GROUP <group> <consumer-id> COUNT 10 BLOCK 5000 STREAMS notes.events >
```

After successful processing:
```
XACK notes.events <group> <message-id>
```

For re-delivery after consumer crash, use `XAUTOCLAIM` after a 30-second idle threshold.

### Stream Retention

Streams are capped at ~10,000 entries using `MAXLEN ~ 10000` (approximate trimming for performance). Given typical event rates, this covers well over 7 days of history. Adjust based on your note creation frequency.

### Idempotency

All consumers implement idempotent processing (upsert semantics). This is required because at-least-once delivery means an event may be processed more than once (e.g., after a consumer crash before `XACK`). Specifically:
- `graph-service`: uses `INSERT ... ON CONFLICT DO UPDATE` for edges
- `embedding-service`: deletes all existing Qdrant points for a noteId before upserting new ones
- `search-service`: PostgreSQL `fts_vector` is updated by a trigger on the notes table, so a duplicate event from search-workers requires no additional action

---

## Consequences

### Positive

**No new infrastructure:** Redis is already required for caching and rate limiting. Redis Streams add no operational overhead — same connection, same container, same backup strategy.

**Sufficient reliability:** The PEL + XAUTOCLAIM pattern provides at-least-once delivery with automatic redelivery after consumer failure, which meets our consistency requirements for eventual graph, search, and embedding updates.

**Simple mental model:** Redis Streams are easier to reason about than Kafka for most developers. The XREADGROUP / XACK pattern maps directly to the "fetch work, do work, acknowledge" pattern.

**Replay capability:** Consumer groups track their own position in the stream. When the embedding service is brought back after downtime, it resumes from where it left off, processing any events that arrived while it was offline.

**Language agnostic:** Both `ioredis` (TypeScript) and `redis-py` (Python) have full Redis Streams support, so all services in the monorepo can participate.

### Negative

**Not Kafka:** At larger scale (millions of events/day, many services), Kafka's superior throughput, partition-based parallelism, and ecosystem (Kafka Connect, KSQL) would be compelling. Redis Streams have lower maximum throughput and lack partition-level parallelism. If this system grows significantly beyond its current scope, migrating to Kafka is a viable upgrade path — the event schema is service-agnostic, so consumers can be rewired without changing business logic.

**Single Redis instance is a SPOF:** In the current design, Redis going down halts event delivery. For the self-hosted personal use case this is acceptable. For a higher-availability deployment, Redis Cluster or Redis Sentinel would be required.

**Stream backpressure:** If a consumer falls far behind (e.g., embedding service is slow during a large import), the stream will grow large. The `MAXLEN` cap prevents unbounded growth but means very old events may be trimmed before a slow consumer processes them. We mitigate this with a separate bulk re-index endpoint (`POST /api/embed/note/:noteId`) for recovery.

### Upgrade Path

If throughput or reliability requirements grow beyond what Redis Streams can provide:
1. Replace `XADD` calls in vault-service with Kafka `producer.send()`
2. Replace `XREADGROUP` loops in consumers with Kafka consumer groups
3. The event message schema remains unchanged — only the transport layer changes
