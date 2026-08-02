# syntax=docker/dockerfile:1
# ====================================================================
# STAGE 1: BUILDER (Fast Dependency Resolution with uv)
# ====================================================================
FROM docker.io/nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
        --allow-change-held-packages \
        software-properties-common \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
        --allow-change-held-packages \
        python3.12 python3.12-venv python3.12-dev build-essential ca-certificates curl gcc
        
# Install uv instantly
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Create the virtual environment
RUN python3.12 -m venv /venv
ENV PATH="/venv/bin:${PATH}"

# Copy ONLY the package manifest
COPY pyproject.toml ./

# Install only the external dependencies listed in your pyproject.toml 
# (No one-liners, no hatchling activation, completely cached by Docker)
# Install dependencies safely crossing both index pools
RUN --mount=type=cache,target=/root/.cache/uv,sharing=locked \
    uv pip install -r pyproject.toml \
    --extra-index-url https://www.paddlepaddle.org.cn/packages/stable/cu118/ \
    --index-strategy unsafe-best-match

# ====================================================================
# STAGE 2: RUNTIME (Final Image)
# ====================================================================
FROM docker.io/nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=America/Detroit \
    PADDLE_DISABLE_ONEDNN=1 \
    FLAGS_use_mkldnn=0 \
    FLAGS_enable_pir_api=0 \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    PADDLE_MODEL_CACHE_DIR=/home/appuser/.paddlex \
    LOG_FILE=/app/logs/caption-stories-reader.log \
    PERFORMANCE_LOG_LOCATION=/app/logs/performance \
    CAPTION_CONFIG_PATH=/app/config.yml \
    PATH="/venv/bin:${PATH}" \
    # Default Ollama host for containers; can be overridden with OLLAMA_HOST env var
    OLLAMA_HOST=http://host.docker.internal:11434

# Install ONLY runtime system dependencies (No gcc, no dev tools, no software-properties-common)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
        --allow-change-held-packages \
        python3.12 \
        libgomp1 libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 tzdata \
        libcudnn8 libcublas-11-8 libcurand-11-8

# Setup non-root user with dynamic UID/GID
ARG USER_UID=1000
ARG USER_GID=1000

RUN groupadd --gid $USER_GID appuser || true \
    && useradd --uid $USER_UID --gid $USER_GID -m appuser \
    && mkdir -p /app /app/logs /home/appuser/.paddlex \
    && chown -R appuser:appuser /app /home/appuser

WORKDIR /app

# Copy the pre-built virtual environment from stage 1
COPY --from=builder --chown=appuser:appuser /venv /venv

# Copy application code
COPY --chown=appuser:appuser src/ /app/src/
COPY --chown=appuser:appuser models/.paddlex/ /home/appuser/.paddlex/
COPY --chown=appuser:appuser config/config.yml /app/config.yml

# Expose a mutable model cache directory so it can be mounted from the host
VOLUME ["/home/appuser/.paddlex"]

USER appuser

EXPOSE 8765

CMD ["uvicorn", "src.main:create_app_from_env", "--host", "0.0.0.0", "--port", "8989", "--factory"]