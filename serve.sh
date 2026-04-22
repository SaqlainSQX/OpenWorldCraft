#!/bin/bash
cd "$(dirname "$0")"
echo "OpenWorldCraft dev server: http://localhost:8000"
python3 -m http.server 8000
