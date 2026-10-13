#!/usr/bin/env python3
"""Ensure the built native core embeds the exact shared UI bytes."""
from pathlib import Path
import sys

core=Path(sys.argv[1]).read_bytes()
ui=Path(__file__).resolve().parents[1]/'core/cmd/hongguotv/ui'
for path in sorted(ui.iterdir()):
    if path.is_file() and path.suffix in {'.js','.css','.html'}:
        assert path.read_bytes() in core, 'Embedded UI mismatch: '+path.name
print('Exact embedded UI verified:',len([p for p in ui.iterdir() if p.suffix in {'.js','.css','.html'}]))
