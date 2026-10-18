#!/usr/bin/env python3
"""Archive a macOS bundle with UTF-8 ZIP paths and Unix executable permissions."""
from pathlib import Path
import sys
import zipfile


def package(app, target):
    app, target = Path(app), Path(target)
    if not app.is_dir() or app.suffix != '.app':
        raise ValueError('Expected an application bundle')
    paths = [app] + sorted(app.rglob('*'))
    if any(path.is_symlink() for path in paths):
        raise ValueError('ZIP updater does not accept symlinks')
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in paths:
            archive.write(path, path.relative_to(app.parent).as_posix())


if __name__ == '__main__':
    package(sys.argv[1], sys.argv[2])
