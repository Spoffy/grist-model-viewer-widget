#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$root/demo/fixtures/lamp/AnisotropyBarnLamp.glb"
url="https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/AnisotropyBarnLamp/glTF-Binary/AnisotropyBarnLamp.glb"

mkdir -p "$(dirname "$dest")"

if [[ -s "$dest" ]]; then
  echo "Already present: $dest"
  exit 0
fi

curl -L --fail -o "$dest" "$url"
echo "Fetched: $dest"
