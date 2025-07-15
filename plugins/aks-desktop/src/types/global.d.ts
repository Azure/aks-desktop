// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

declare module 'child_process' {
  export function spawn(command: string, args?: string[], options?: any): any;
}

declare global {
  interface Window {
    fetch: typeof fetch;
  }
}
