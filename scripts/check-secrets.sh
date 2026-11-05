#!/bin/sh
# Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
set -eu

# Pinned upstream Linux x64 release, verified before execution.
version=8.30.1
sha=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
curl --fail --silent --show-error --location --max-time 120 \
  "https://github.com/gitleaks/gitleaks/releases/download/v$version/gitleaks_${version}_linux_x64.tar.gz" \
  -o "$tmp/gitleaks.tar.gz"
printf '%s  %s\n' "$sha" "$tmp/gitleaks.tar.gz" | sha256sum --check --status
tar -xzf "$tmp/gitleaks.tar.gz" -C "$tmp" gitleaks
"$tmp/gitleaks" git --redact --no-banner --log-opts=--all .
