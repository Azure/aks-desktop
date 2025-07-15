#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation.
# Licensed under the Apache 2.0.
"""
Azure Kubernetes Authentication Script

This script replaces the kubelogin exec plugin in kubeconfig files.
It retrieves an access token from Azure CLI and outputs it in the
Kubernetes ExecCredential format.

This script is bundled with AKS desktop and automatically uses the
bundled Azure CLI installation.

Usage:
    python az-kubelogin.py --server-id <server-id> [--resource <resource>]

Arguments:
    --server-id: The Azure AD server ID (default: 6dae42f8-4368-4678-94ff-3960e28e3630)
    --resource: The Kubernetes API server resource (optional)

Environment Variables:
    AZ_CLI_PATH: Path to the az CLI command (defaults to 'az' in PATH)

Example kubeconfig user section:
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1beta1
        args:
        - --server-id
        - 6dae42f8-4368-4678-94ff-3960e28e3630
        command: python
        - /path/to/az-kubelogin.py
        env:
        - name: AZ_CLI_PATH
          value: /path/to/az
        provideClusterInfo: false
"""

import json
import subprocess
import sys
import argparse
import os
from datetime import datetime, timezone
from typing import Dict


def get_azure_token(server_id: str, resource: str = None) -> Dict:
    """
    Get an access token from Azure CLI.

    Args:
        server_id: The Azure AD server ID
        resource: Optional Kubernetes API server resource

    Returns:
        Dictionary containing the Azure CLI token response

    Raises:
        subprocess.CalledProcessError: If the az command fails
        json.JSONDecodeError: If the response is not valid JSON
    """
    # Use 'az' from AZ_CLI_PATH environment variable, or default to 'az' in PATH
    az_cmd = os.environ.get('AZ_CLI_PATH', 'az')

    # Build the scope from the server ID
    scope = f"{server_id}/.default"

    # Build the az command
    cmd = [az_cmd, "account", "get-access-token", "--scope", scope]

    # Add resource parameter if provided
    if resource:
        cmd.extend(["--resource", resource])

    try:
        # Run the az command
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True
        )

        # Parse the JSON output
        token_data = json.loads(result.stdout)
        return token_data

    except subprocess.CalledProcessError as e:
        print(f"Error running az command: {e.stderr}", file=sys.stderr)
        raise
    except json.JSONDecodeError as e:
        print(f"Error parsing az command output: {e}", file=sys.stderr)
        raise


def convert_to_exec_credential(az_token: Dict) -> Dict:
    """
    Convert Azure CLI token format to Kubernetes ExecCredential format.

    Args:
        az_token: Token data from Azure CLI

    Returns:
        Dictionary in ExecCredential format
    """
    # Extract the access token
    access_token = az_token.get('accessToken', '')

    # Convert expiresOn to ISO 8601 format
    expires_on = az_token.get('expiresOn', '')

    if expires_on:
        # Parse the datetime string (format: "2025-10-22 11:11:02.000000")
        dt = datetime.strptime(expires_on, "%Y-%m-%d %H:%M:%S.%f")
        local_tz = datetime.now().astimezone().tzinfo
        local_dt = dt.replace(tzinfo=local_tz)
        dt = local_dt.astimezone(timezone.utc)

        # Format as ISO 8601 with 'Z' suffix
        expiration_timestamp = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    else:
        expiration_timestamp = ""

    # Create the ExecCredential structure
    exec_credential = {
        "kind": "ExecCredential",
        "apiVersion": "client.authentication.k8s.io/v1beta1",
        "spec": {
            "interactive": False
        },
        "status": {
            "expirationTimestamp": expiration_timestamp,
            "token": access_token
        }
    }

    return exec_credential


def main():
    """Main entry point for the script."""
    # Set up argument parser
    parser = argparse.ArgumentParser(
        description="Azure Kubernetes authentication using Azure CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    parser.add_argument(
        "--server-id",
        default="6dae42f8-4368-4678-94ff-3960e28e3630",
        help="Azure AD server ID (default: 6dae42f8-4368-4678-94ff-3960e28e3630)"
    )

    parser.add_argument(
        "--resource",
        help="Kubernetes API server resource (optional)"
    )

    args = parser.parse_args()

    try:
        # Get the token from Azure CLI
        az_token = get_azure_token(args.server_id, args.resource)

        # Convert to ExecCredential format
        exec_credential = convert_to_exec_credential(az_token)

        # Output as JSON to stdout
        print(json.dumps(exec_credential, indent=2))

    except subprocess.CalledProcessError:
        print("Failed to get access token from Azure CLI", file=sys.stderr)
        print("Make sure you are logged in: az login", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
