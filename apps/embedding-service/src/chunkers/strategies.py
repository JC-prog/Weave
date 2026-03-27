"""
Text chunking strategies for the embedding pipeline.

Each strategy returns a list of non-empty string chunks suitable for embedding.
"""

import re
from typing import Literal


# ─── Paragraph Chunking ───────────────────────────────────────────────────────


def chunk_by_paragraph(text: str, max_size: int = 512) -> list[str]:
    """
    Split text on blank lines (double newlines) and merge small paragraphs
    until each chunk approaches `max_size` words.

    Args:
        text:     Source text to chunk.
        max_size: Approximate maximum word count per chunk.

    Returns:
        List of non-empty chunk strings.
    """
    # Split on one or more blank lines
    raw_paragraphs = re.split(r"\n{2,}", text.strip())
    paragraphs = [p.strip() for p in raw_paragraphs if p.strip()]

    if not paragraphs:
        return []

    chunks: list[str] = []
    current_parts: list[str] = []
    current_word_count = 0

    for para in paragraphs:
        word_count = len(para.split())

        if current_word_count + word_count > max_size and current_parts:
            # Flush current buffer
            chunks.append("\n\n".join(current_parts))
            current_parts = [para]
            current_word_count = word_count
        else:
            current_parts.append(para)
            current_word_count += word_count

    # Flush remaining
    if current_parts:
        chunks.append("\n\n".join(current_parts))

    return [c for c in chunks if c.strip()]


# ─── Heading-Based Chunking ───────────────────────────────────────────────────


def chunk_by_heading(text: str) -> list[str]:
    """
    Split markdown text at heading boundaries (## and ###).

    Each section from one heading to the next becomes a chunk.  Content before
    the first heading is included as an introductory chunk if non-empty.

    Args:
        text: Markdown source text.

    Returns:
        List of section strings (heading + body).
    """
    # Match lines starting with ## or ### (but not ####+ to avoid over-splitting)
    heading_pattern = re.compile(r"^(#{2,3})\s+.+", re.MULTILINE)

    matches = list(heading_pattern.finditer(text))

    if not matches:
        # No headings found — return the whole text as one chunk
        stripped = text.strip()
        return [stripped] if stripped else []

    chunks: list[str] = []

    # Text before the first heading
    preamble = text[: matches[0].start()].strip()
    if preamble:
        chunks.append(preamble)

    for i, match in enumerate(matches):
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        section = text[start:end].strip()
        if section:
            chunks.append(section)

    return chunks


# ─── Fixed-Size Chunking ──────────────────────────────────────────────────────


def chunk_fixed(text: str, size: int = 512, overlap: int = 50) -> list[str]:
    """
    Split text into fixed-size chunks (measured in words) with word-level
    overlap between consecutive chunks.

    Args:
        text:    Source text.
        size:    Target chunk size in words.
        overlap: Number of words shared between adjacent chunks.

    Returns:
        List of chunk strings.
    """
    words = text.split()
    if not words:
        return []

    chunks: list[str] = []
    start = 0
    step = max(1, size - overlap)

    while start < len(words):
        end = min(start + size, len(words))
        chunk = " ".join(words[start:end])
        if chunk.strip():
            chunks.append(chunk)
        if end >= len(words):
            break
        start += step

    return chunks


# ─── Strategy Dispatcher ─────────────────────────────────────────────────────

ChunkStrategy = Literal["paragraph", "heading", "fixed"]


def chunk_note(
    content: str,
    strategy: ChunkStrategy = "paragraph",
    config: dict | None = None,
) -> list[str]:
    """
    Chunk note content using the specified strategy.

    Args:
        content:  Raw note text (plain text or markdown).
        strategy: One of 'paragraph' | 'heading' | 'fixed'.
        config:   Optional dict of strategy-specific overrides:
                  - paragraph: {'max_size': int}
                  - fixed:     {'size': int, 'overlap': int}

    Returns:
        List of non-empty chunk strings.
    """
    cfg = config or {}

    if not content or not content.strip():
        return []

    if strategy == "paragraph":
        max_size: int = cfg.get("max_size", 512)
        return chunk_by_paragraph(content, max_size=max_size)

    if strategy == "heading":
        return chunk_by_heading(content)

    if strategy == "fixed":
        size: int = cfg.get("size", 512)
        overlap: int = cfg.get("overlap", 50)
        return chunk_fixed(content, size=size, overlap=overlap)

    raise ValueError(f"Unknown chunking strategy: '{strategy}'")
