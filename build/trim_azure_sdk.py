#!/usr/bin/env python3

# Copyright (c) Microsoft Corporation. 
# Licensed under the Apache 2.0.

"""
Trim Azure SDK to reduce bundle size.
Based on Azure CLI's trim_sdk.py script.
"""
import glob
import os
import shutil
import sys

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

def remove_aio_folders(site_packages):
    """Remove all aio (async) folders - not needed for CLI."""
    print("Removing aio folders...")
    removed = 0
    for aio_folder in glob.glob(os.path.join(site_packages, '**/aio'), recursive=True):
        print(f"  Removing: {aio_folder}")
        shutil.rmtree(aio_folder)
        removed += 1
    print(f"  Removed {removed} aio folders")

def remove_tests_folders(site_packages):
    """Remove test folders."""
    print("Removing test folders...")
    removed = 0
    for test_folder in glob.glob(os.path.join(site_packages, '**/tests'), recursive=True):
        # Skip if it's a critical test folder
        if 'azure' not in test_folder:
            continue
        print(f"  Removing: {test_folder}")
        shutil.rmtree(test_folder)
        removed += 1
    print(f"  Removed {removed} test folders")

def remove_dist_info_folders(site_packages):
    """Remove .dist-info folders - not needed at runtime."""
    print("Removing .dist-info folders...")
    removed = 0
    for dist_info in glob.glob(os.path.join(site_packages, '*.dist-info')):
        print(f"  Removing: {dist_info}")
        shutil.rmtree(dist_info)
        removed += 1
    print(f"  Removed {removed} .dist-info folders")

def remove_egg_info_folders(site_packages):
    """Remove .egg-info folders - not needed at runtime."""
    print("Removing .egg-info folders...")
    removed = 0
    for egg_info in glob.glob(os.path.join(site_packages, '*.egg-info')):
        print(f"  Removing: {egg_info}")
        shutil.rmtree(egg_info)
        removed += 1
    print(f"  Removed {removed} .egg-info folders")

def main():
    if len(sys.argv) != 2:
        print("Usage: trim_azure_sdk.py <site-packages-path>")
        sys.exit(1)

    site_packages = sys.argv[1]

    if not os.path.isdir(site_packages):
        print(f"Error: {site_packages} is not a directory")
        sys.exit(1)

    print("="*60)
    print("Azure SDK Trimming Script")
    print("="*60)
    print(f"Target: {site_packages}")
    print()

    print("Before optimization:")
    print_folder_size(site_packages)
    print()

    # Run optimizations
    remove_aio_folders(site_packages)
    print()

    remove_tests_folders(site_packages)
    print()

    remove_dist_info_folders(site_packages)
    print()

    remove_egg_info_folders(site_packages)
    print()

    print("After optimization:")
    print_folder_size(site_packages)
    print()

    print("="*60)
    print("Optimization complete!")
    print("="*60)

if __name__ == "__main__":
    main()
