#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lamp="$root/demo/fixtures/lamp"
base_url="https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/AnisotropyBarnLamp"

# Pinned so the generated low.glb is reproducible across machines.
gltf_transform="@gltf-transform/cli@4.5.1"

mkdir -p "$lamp"

glb="$lamp/AnisotropyBarnLamp.glb"
if [[ -s "$glb" ]]; then
  echo "Already present: $glb"
else
  curl -L --fail -o "$glb" "$base_url/glTF-Binary/AnisotropyBarnLamp.glb"
  echo "Fetched: $glb"
fi

low="$lamp/low.glb"
if [[ -s "$low" ]]; then
  echo "Already present: $low"
else
  # resize and webp are separate subcommands, so the first writes a temporary model for the second.
  tmp="$(mktemp -t low-resized-XXXXXX.glb)"
  trap 'rm -f "$tmp"' EXIT
  npx -y "$gltf_transform" resize "$glb" "$tmp" --width 512 --height 512
  npx -y "$gltf_transform" webp "$tmp" "$low"
  rm -f "$tmp"
  trap - EXIT
  echo "Generated: $low"
fi

for texture in \
  AnisotropyBarnLamp_basecolor.ktx2 \
  AnisotropyBarnLamp_normalbump.ktx2 \
  AnisotropyBarnLamp_occlusionroughnessmetal.ktx2
do
  dest="$lamp/$texture"
  if [[ -s "$dest" ]]; then
    echo "Already present: $dest"
  else
    curl -L --fail -o "$dest" "$base_url/glTF-KTX-BasisU/$texture"
    echo "Fetched: $dest"
  fi
done

# The manifests are rewritten every run so this script stays their single source of truth.
cat > "$lamp/manifest.json" <<'EOF'
{
  "mesh": "low.glb",
  "materials": {
    "Lamp Metal": {
      "baseColor": "AnisotropyBarnLamp_basecolor.ktx2",
      "normal": "AnisotropyBarnLamp_normalbump.ktx2",
      "metallicRoughness": "AnisotropyBarnLamp_occlusionroughnessmetal.ktx2",
      "occlusion": "AnisotropyBarnLamp_occlusionroughnessmetal.ktx2"
    }
  },
  "annotations": [
    { "id": "a1", "position": [0.0, 0.0569, 0.0008],
      "normal": [0.0, 0.576, -0.817], "text": "Sample annotation: top" },
    { "id": "a2", "position": [-0.0092, -0.0252, 0.1406],
      "normal": [0.0, 0.015, 1.0], "text": "Sample annotation: front" },
    { "id": "a3", "position": [0.0862, -0.1315, 0.1323],
      "normal": [0.999, 0.038, 0.0], "text": "Sample annotation: side" }
  ]
}
EOF

# Points at a missing texture so the widget's load-failure path can be exercised.
cat > "$lamp/manifest-broken.json" <<'EOF'
{
  "mesh": "low.glb",
  "materials": {
    "Lamp Metal": {
      "baseColor": "AnisotropyBarnLamp_basecolor.ktx2",
      "normal": "DOES_NOT_EXIST.ktx2",
      "metallicRoughness": "AnisotropyBarnLamp_occlusionroughnessmetal.ktx2",
      "occlusion": "AnisotropyBarnLamp_occlusionroughnessmetal.ktx2"
    }
  },
  "annotations": [
    { "id": "a1", "position": [0.0, 0.0569, 0.0008],
      "normal": [0.0, 0.576, -0.817], "text": "Sample annotation: top" },
    { "id": "a2", "position": [-0.0092, -0.0252, 0.1406],
      "normal": [0.0, 0.015, 1.0], "text": "Sample annotation: front" },
    { "id": "a3", "position": [0.0862, -0.1315, 0.1323],
      "normal": [0.999, 0.038, 0.0], "text": "Sample annotation: side" }
  ]
}
EOF

echo "Wrote: $lamp/manifest.json, $lamp/manifest-broken.json"
