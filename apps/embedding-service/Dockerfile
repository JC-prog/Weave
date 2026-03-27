# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --prefix=/install --no-cache-dir -r requirements.txt

# ─── Stage 2: Runner ─────────────────────────────────────────────────────────
FROM python:3.12-slim AS runner

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# fastembed downloads model files on first use; persist them in a volume
ENV FASTEMBED_CACHE_DIR=/app/.fastembed_cache

# Copy application source
COPY src/ ./src/

ENV PYTHONPATH=/app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

EXPOSE 3006

RUN useradd -m -u 1001 appuser && mkdir -p /app/.fastembed_cache && chown -R appuser:appuser /app
USER appuser

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "3006"]
