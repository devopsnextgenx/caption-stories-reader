# Caption Stories Reader

A python modular platform for processing caption images, OCR text extraction, visual scene analysis, translation, YAML metadata creation, and vector indexation.

## Architecture

The project is structured into distinct Python modules:

- **`src/admin`**: Manages configuration (`config.yml`), system status diagnostics, and administrative tasks.
- **`src/ai`**: Unified model provider interfacing with Ollama / LM-Studio for Visual LLM (image analysis), Text LLM (OCR text repair), Translator LLM, and Embedding generation.
- **`src/captions`**: Pipeline image processor combining PaddleOCR, Visual LLM, Text correction, Translation, YAML metadata output, and Qdrant vector database indexing. Supports assembly-line parallel batch processing.
- **`src/web`**: FastAPI web application serving a glassmorphic UI, REST API endpoints, static assets, and background job status tracking.
- **`src/stories`**: *(Planned)* Story processing and editing module.
- **`src/search`**: *(Planned)* Qdrant vector & keyword search reader.

## Quick Start

### Run Web API Server
```bash
./start.sh --mode api
# or
python main.py --mode api
```
Access the Web UI at: `http://localhost:8989`

### Run Batch Processing
```bash
./start.sh --mode batch
# or
python main.py --mode batch --input-folder data/
```

## Features

- **Dashboard**: System health, active model indicators, recent captions overview.
- **Captions Studio**: Upload single images or run batch parallel assembly-line image captioning.
- **Admin Panel**: Manage `config.yml` settings live, monitor logs, and test model/database connectivity.
- **Qdrant Vector Database**: Stores vector embeddings of caption content for semantic search.
