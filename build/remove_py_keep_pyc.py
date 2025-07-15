#!/usr/bin/env python3
"""
Copyright (c) Microsoft Corporation. 
Licensed under the Apache 2.0.

Remove .py files and keep only .pyc files (like Windows build).
Based on Azure CLI's build.cmd script.
"""
import os
import shutil
import sys
from pathlib import Path

def process_pyc_files(site_packages):
    """
    Move .pyc files from __pycache__ to parent dir and remove .py files.
    This is exactly what Microsoft does in their Windows build.
    """
    print("Moving .pyc files and removing .py source files...")

    moved_count = 0
    deleted_py_count = 0
    deleted_pycache_count = 0

    # Find all .pyc files in __pycache__ directories
    for root, dirs, files in os.walk(site_packages):
        # Skip pip directory - Microsoft keeps pip source code
        if 'pip' in root or 'setuptools' in root or 'wheel' in root:
            print(f"  SKIP: {root} (keeping installer source code)")
            continue

        # Skip extensions directory - extensions need their source files
        if 'extensions' in root or 'cliextensions' in root:
            print(f"  SKIP: {root} (keeping extension source code)")
            continue

        if '__pycache__' in root:
            parent_dir = os.path.dirname(root)

            for filename in files:
                if filename.endswith('.pyc'):
                    pyc_path = os.path.join(root, filename)

                    # Extract the base filename without .cpython-312.pyc
                    # e.g., __init__.cpython-312.pyc -> __init__.pyc
                    base_name = filename
                    if '.cpython-' in filename:
                        # Split on .cpython- and take the first part
                        parts = filename.split('.cpython-')
                        if len(parts) == 2:
                            # Get base name and add .pyc
                            base_name = parts[0] + '.pyc'

                    # Target path in parent directory
                    target_path = os.path.join(parent_dir, base_name)

                    # Copy .pyc to parent directory
                    try:
                        shutil.copy2(pyc_path, target_path)
                        moved_count += 1

                        # Now delete the corresponding .py file
                        py_filename = base_name.replace('.pyc', '.py')
                        py_path = os.path.join(parent_dir, py_filename)

                        if os.path.exists(py_path):
                            os.remove(py_path)
                            deleted_py_count += 1
                    except Exception as e:
                        print(f"  Warning: Failed to process {pyc_path}: {e}")

    print(f"  Moved {moved_count} .pyc files")
    print(f"  Deleted {deleted_py_count} .py source files")

    # Remove empty __pycache__ directories
    print("Removing empty __pycache__ directories...")
    for root, dirs, files in os.walk(site_packages, topdown=False):
        for dirname in dirs:
            if dirname == '__pycache__':
                dir_path = os.path.join(root, dirname)
                try:
                    # Only remove if empty or contains only .pyc files we moved
                    if not os.listdir(dir_path) or all(f.endswith('.pyc') for f in os.listdir(dir_path)):
                        shutil.rmtree(dir_path)
                        deleted_pycache_count += 1
                except Exception as e:
                    print(f"  Warning: Failed to remove {dir_path}: {e}")

    print(f"  Removed {deleted_pycache_count} __pycache__ directories")

def calculate_folder_size(start_path):
    """Calculate total size of a folder and file count."""
    total_size = 0
    total_count = 0
    for dirpath, dirnames, filenames in os.walk(start_path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if not os.path.islink(fp):
                total_count += 1
                total_size += os.path.getsize(fp)
    return total_size, total_count

def print_folder_size(folder):
    """Print folder size in MB."""
    size, count = calculate_folder_size(folder)
    size_in_mb = size / 1048576  # 1 MB = 1024 * 1024 B
    print(f"  Size: {size_in_mb:.2f} MB, Files: {count}")

def main():
    if len(sys.argv) != 2:
        print("Usage: remove_py_keep_pyc.py <site-packages-path>")
        sys.exit(1)

    site_packages = sys.argv[1]

    if not os.path.isdir(site_packages):
        print(f"Error: {site_packages} is not a directory")
        sys.exit(1)

    print("="*60)
    print("Remove .py and Keep .pyc (Windows-style optimization)")
    print("="*60)
    print(f"Target: {site_packages}")
    print()

    print("Before removing .py files:")
    print_folder_size(site_packages)
    print()

    # Process .pyc files
    process_pyc_files(site_packages)
    print()

    print("After removing .py files:")
    print_folder_size(site_packages)
    print()

    print("="*60)
    print("Optimization complete!")
    print("="*60)

if __name__ == "__main__":
    main()
