#!/bin/bash
# scripts/build.sh for quant-web

set -euo pipefail

## 1. Parameters & Configuration
# Usage:
#   bash scripts/build.sh [local|remote] [branch]
MODE=${1:-local}
SOURCE_BRANCH=${2:-dev}
SOURCE_REPO="https://github.com/QuantX-Club/quant-web.git"
IMG_NAME="quant-web"
IMG_VERSION="0.3.0"
BUILDER_NAME="mybuilder"
BUILD_SUCCESS=0

## Define image tags for local and remote registries
LOCAL_TAG="${IMG_NAME}:${IMG_VERSION}"
GL_TAG="registry.gitlab.com/quantx-club/registry/${IMG_NAME}:${IMG_VERSION}"
GH_TAG="ghcr.io/quantx-club/registry/${IMG_NAME}:${IMG_VERSION}"

cleanup() {
    echo "Info: Tearing down builder instance..."
    docker buildx rm -f "$BUILDER_NAME" > /dev/null 2>&1 || true
    docker context use default > /dev/null 2>&1 || true

    echo "------------------------------------------------"
    if [ "$BUILD_SUCCESS" -eq 1 ]; then
        echo "BUILD STATUS: SUCCESSFUL"
        echo "Mode: ${MODE}"
        echo "Source Branch: ${SOURCE_BRANCH}"
        if [ "$MODE" == "remote" ]; then
            echo "Remote Tags Pushed:"
            echo " - GitLab: ${GL_TAG}"
            echo " - GitHub: ${GH_TAG}"
        else
            echo "Local Tag Created (Cleaned):"
            echo " - Local:  ${LOCAL_TAG}"
        fi
    else
        echo "BUILD STATUS: FAILED"
        echo "Mode: ${MODE}"
        echo "Source Branch: ${SOURCE_BRANCH}"
    fi
    echo "------------------------------------------------"
}
trap cleanup EXIT

echo ">>> Starting Build Process for quant-web [Mode: ${MODE}]"

if [ "$MODE" != "local" ] && [ "$MODE" != "remote" ]; then
    echo "Error: Invalid mode '${MODE}'. Use 'local' or 'remote'."
    exit 1
fi

## 2. Environment Setup
# Ensure we are using the default docker context
docker context use default > /dev/null 2>&1

# Check if builder exists, create it if not
if ! docker buildx inspect "$BUILDER_NAME" > /dev/null 2>&1; then
    echo "Info: Creating new builder instance..."
    docker buildx create --name "$BUILDER_NAME" --driver docker-container --use > /dev/null
else
    echo "Info: Activating existing builder instance..."
    docker buildx use "$BUILDER_NAME"
fi

## 3. Source Code Preparation
echo "Info: Refreshing source code for quant-web (branch: ${SOURCE_BRANCH})..."
rm -rf /tmp/quant-web && mkdir -p /tmp/quant-web
git clone --branch "${SOURCE_BRANCH}" --single-branch "${SOURCE_REPO}" /tmp/quant-web
cd /tmp/quant-web

## 4. Build Logic
if [ "$MODE" == "remote" ]; then
    echo "Info: Executing REMOTE build & push (amd64 + arm64)..."
    docker buildx build \
        --platform linux/amd64,linux/arm64 \
        --no-cache \
        -t "${GL_TAG}" \
        -t "${GH_TAG}" \
        --push .
else
    echo "Info: Executing LOCAL build (Native ARM64)..."
    if [ "$(docker images -q "${LOCAL_TAG}" 2> /dev/null)" != "" ]; then
        echo "Info: Deleting existing local image ${LOCAL_TAG}..."
        docker rmi -f "${LOCAL_TAG}"
    fi
    docker buildx build \
        --platform linux/arm64 \
        --no-cache \
        -t "${LOCAL_TAG}" \
        --load .
fi

BUILD_SUCCESS=1
