#!/bin/bash
# scripts/build.sh for quant-web

## 1. Parameters & Configuration
# Default mode is 'local' unless specified
MODE=${1:-local} 
IMG_NAME="quant-web"
IMG_VERSION="0.3.0"
BUILDER_NAME="mybuilder"

## Define image tags for local and remote registries
LOCAL_TAG="${IMG_NAME}:${IMG_VERSION}"
GL_TAG="registry.gitlab.com/quantx-club/registry/${IMG_NAME}:${IMG_VERSION}"
GH_TAG="ghcr.io/quantx-club/registry/${IMG_NAME}:${IMG_VERSION}"

echo ">>> Starting Build Process for quant-web [Mode: ${MODE}]"

## 2. Environment Setup
# Ensure we are using the default docker context
docker context use default > /dev/null 2>&1

# Check if builder exists, create it if not
if ! docker buildx inspect $BUILDER_NAME > /dev/null 2>&1; then
    echo "Info: Creating new builder instance..."
    docker buildx create --name $BUILDER_NAME --driver docker-container --use
else
    echo "Info: Activating existing builder instance..."
    docker buildx use $BUILDER_NAME
fi

## 3. Source Code Preparation
echo "Info: Refreshing source code for quant-web..."
rm -rf /tmp/quant-web && mkdir -p /tmp/quant-web
git clone https://github.com/QuantX-Club/quant-web.git /tmp/quant-web
cd /tmp/quant-web

## 4. Build Logic
if [ "$MODE" == "remote" ]; then
    echo "Info: Executing REMOTE build & push (amd64 + arm64)..."
    # Build multi-platform images and push to both GitLab and GitHub
    docker buildx build \
        --platform linux/amd64,linux/arm64 \
        --no-cache \
        -t ${GL_TAG} \
        -t ${GH_TAG} \
        --push .
else
    echo "Info: Executing LOCAL build (Native ARM64)..."
    # Clean up existing local image if it exists
    if [ "$(docker images -q ${LOCAL_TAG} 2> /dev/null)" != "" ]; then
        echo "Info: Deleting existing local image ${LOCAL_TAG}..."
        docker rmi -f ${LOCAL_TAG}
    fi
    # Build for current host architecture and load into local image store
    docker buildx build \
        --platform linux/arm64 \
        --no-cache \
        -t ${LOCAL_TAG} \
        --load .
fi

## 5. Cleanup
# Force remove the builder instance to clean the environment and remove 'U' tag
echo "Info: Tearing down builder instance..."
docker buildx rm -f $BUILDER_NAME
docker context use default

## 6. Final Summary
echo "------------------------------------------------"
echo "BUILD STATUS: SUCCESSFUL"
echo "Mode: ${MODE}"

if [ "$MODE" == "remote" ]; then
    echo "Remote Tags Pushed:"
    echo " - GitLab: ${GL_TAG}"
    echo " - GitHub: ${GH_TAG}"
else
    echo "Local Tag Created (Cleaned):"
    echo " - Local:  ${LOCAL_TAG}"
fi
echo "------------------------------------------------"
