#!/usr/bin/env bash
set -euo pipefail

# Usage: ./builder.sh [tag]
# Example: ./builder.sh latest

TAG=${1:-latest}
IMAGE="docker.io/amitkshirsagar13/caption-stories-reader"

# Create build dir
BUILD_DIR="build"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Configure CMake with image tag
cmake -DDOCKER_IMAGE="$IMAGE" -DDOCKER_TAG="$TAG" ..

# Build the docker image using CMake target
cmake --build . --target build-image

# Print image name
echo "Built image: ${IMAGE}:${TAG}"
