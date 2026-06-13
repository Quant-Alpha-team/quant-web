#!/bin/bash
# scripts/build.sh

set -euo pipefail

IMAGE_NAME="quant-web"
BUILDER_NAME="web-builder"
REGISTRY_GL="${REGISTRY_GL:-registry.gitlab.com/quantx-club/registry}"
REGISTRY_GH="${REGISTRY_GH:-ghcr.io/quantx-club/registry}"

MODE="local"
MODE_SET=""
LOCAL_ARCH="auto"
BUILT_TAGS=()

usage() {
  cat <<USAGE
Usage:
  ./scripts/build.sh [-l | -r] [-a <amd|arm|auto>]

Options:
  -l, --local            Build local image. (default)
  -r, --remote           Build and push multi-arch image (amd64 + arm64).
  -a, --arch             Local build arch: amd | arm | auto (default: auto)
  -h, --help             Show this help.

Examples:
  ./scripts/build.sh -l
  ./scripts/build.sh -l -a amd
  ./scripts/build.sh -l -a arm
  ./scripts/build.sh -r
USAGE
}

set_mode() {
  local next_mode="$1"
  if [[ -n "$MODE_SET" && "$MODE_SET" != "$next_mode" ]]; then
    echo "Error: mode conflict ($MODE_SET vs $next_mode)"
    usage
    exit 1
  fi
  MODE="$next_mode"
  MODE_SET="$next_mode"
}

read_version() {
  local repo_root="$1"
  local version
  version=$(awk -F'"' '/^[[:space:]]*"version"[[:space:]]*:/ {print $4; exit}' "$repo_root/package.json")
  if [[ -z "$version" ]]; then
    echo "Error: version not found in package.json"
    exit 1
  fi
  echo "$version"
}

ensure_builder() {
  docker context use default > /dev/null 2>&1
  if ! docker buildx inspect "$BUILDER_NAME" > /dev/null 2>&1; then
    echo "Info: creating buildx builder '$BUILDER_NAME'"
    docker buildx create --name "$BUILDER_NAME" --driver docker-container --use > /dev/null
  else
    docker buildx use "$BUILDER_NAME" > /dev/null
  fi
}

cleanup_builder() {
  docker buildx rm -f "$BUILDER_NAME" > /dev/null 2>&1 || true
  docker context use default > /dev/null 2>&1 || true
}

local_platform() {
  case "$LOCAL_ARCH" in
    amd)
      echo "linux/amd64"
      ;;
    arm)
      echo "linux/arm64"
      ;;
    auto)
      local arch
      arch=$(uname -m)
      if [[ "$arch" == "arm64" || "$arch" == "aarch64" ]]; then
        echo "linux/arm64"
      else
        echo "linux/amd64"
      fi
      ;;
    *)
      echo "Error: invalid local arch '$LOCAL_ARCH' (use amd|arm|auto)"
      exit 1
      ;;
  esac
}

# Backward compatibility: positional args (local/remote + optional arch)
if [[ $# -gt 0 && "$1" != -* ]]; then
  case "$1" in
    local|remote)
      set_mode "$1"
      shift
      ;;
    *)
      echo "Error: unknown mode '$1'"
      usage
      exit 1
      ;;
  esac

  if [[ $# -gt 0 && "$1" != -* ]]; then
    LOCAL_ARCH="$1"
    shift
  fi
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    -l|--local)
      set_mode "local"
      shift
      ;;
    -r|--remote)
      set_mode "remote"
      shift
      ;;
    -a|--arch)
      if [[ $# -lt 2 ]]; then
        echo "Error: $1 requires a value"
        usage
        exit 1
      fi
      LOCAL_ARCH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option '$1'"
      usage
      exit 1
      ;;
  esac
done

if [[ "$MODE" == "remote" && "$LOCAL_ARCH" != "auto" ]]; then
  echo "Error: --arch is only valid for local mode"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=$(read_version "$REPO_ROOT")
LOCAL_TAG="${IMAGE_NAME}:${VERSION}"
GL_TAG="${REGISTRY_GL}/${IMAGE_NAME}:${VERSION}"
GH_TAG="${REGISTRY_GH}/${IMAGE_NAME}:${VERSION}"

trap cleanup_builder EXIT

cd "$REPO_ROOT"

BUILD_PLATFORM="linux/amd64,linux/arm64"
if [[ "$MODE" == "local" ]]; then
  BUILD_PLATFORM=$(local_platform)
fi

echo ">>> Build start"
echo "Image   : $IMAGE_NAME"
echo "Version : $VERSION"
echo "Mode    : $MODE"
echo "Platform: $BUILD_PLATFORM"

ensure_builder

if [[ "$MODE" == "remote" ]]; then
  docker buildx build \
    --platform "$BUILD_PLATFORM" \
    --no-cache \
    -t "$GL_TAG" \
    -t "$GH_TAG" \
    --push .
  BUILT_TAGS+=("$GL_TAG")
  BUILT_TAGS+=("$GH_TAG")
else
  if [[ -n "$(docker images -q "$LOCAL_TAG" 2>/dev/null || true)" ]]; then
    docker rmi -f "$LOCAL_TAG" > /dev/null 2>&1 || true
  fi

  docker buildx build \
    --platform "$BUILD_PLATFORM" \
    --no-cache \
    -t "$LOCAL_TAG" \
    --load .
  BUILT_TAGS+=("$LOCAL_TAG")
fi

echo "---"
echo "BUILD STATUS: SUCCESS"
printf ' - %s\n' "${BUILT_TAGS[@]}"
