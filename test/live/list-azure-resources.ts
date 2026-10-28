// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  getLiveAzureContext,
  listAzureTestResources,
} from "../../plugins/aks-desktop/src/utils/test/azureLiveTestUtils";

/**
 * Lists run-owned Azure groups/resources as JSON without modifying them.
 * @returns After inventory is printed to stdout; the entrypoint reports failures
 * on stderr with exit code 1. Uses the shared subscription override/login contract.
 */
async function main() {
  const context = getLiveAzureContext();
  console.log(
    JSON.stringify(
      {
        subscriptionId: context.subscriptionId,
        groups: await listAzureTestResources(context),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Unable to list Azure REST E2E resources:", error);
  process.exitCode = 1;
});
