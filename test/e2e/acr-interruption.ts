// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

export const INTERRUPTION_MESSAGE = 'aksd-live-interrupt';
export const INTERRUPTION_READY = 'aksd-live-ready';
export const NORMAL_WORK_BUDGET_MS = 60 * 60_000;
// Recovery has two one-minute discovery/poll budgets, up to 20 run-history pages,
// cancellation verification and digest-safe image deletion. Each CLI call is bounded
// independently (60s plus up to 5s for Windows tree termination).
export const RECOVERY_BUDGET_MS = 30 * 60_000;
// Allow an active normal command to settle, the recovery budget, its last command,
// and both services' polling windows before forcibly terminating the owned child.
export const INTERRUPTION_GRACE_MS = RECOVERY_BUDGET_MS + 2 * 65_000 + 2 * 60_000;

/** Stop new work on either OS, without interrupting an in-flight write or final recovery. */
export function liveInterruption(source: NodeJS.Process = process) {
  const controller = new AbortController();
  const interrupt = (signal: string) => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(`Live suite interrupted by ${signal}`));
    }
  };
  const onInt = () => interrupt('SIGINT');
  const onTerm = () => interrupt('SIGTERM');
  const onHup = () => interrupt('SIGHUP');
  const onMessage = (message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === INTERRUPTION_MESSAGE
    ) {
      interrupt('signal' in message ? String(message.signal) : 'controller');
    }
  };
  source.on('SIGINT', onInt);
  source.on('SIGTERM', onTerm);
  source.on('SIGHUP', onHup);
  source.on('message', onMessage);
  if (source.connected) source.send?.({ type: INTERRUPTION_READY }, () => {});
  // An IPC channel must not keep an otherwise completed suite alive.
  source.channel?.unref();
  return {
    signal: controller.signal,
    dispose() {
      source.removeListener('SIGINT', onInt);
      source.removeListener('SIGTERM', onTerm);
      source.removeListener('SIGHUP', onHup);
      source.removeListener('message', onMessage);
    },
  };
}

/** A fresh fetch-compatible deadline for every request, preserving caller cancellation. */
export function requestDeadline(
  options: { request: { signal?: AbortSignal } },
  timeoutMs = 60_000
): void {
  const timeout = AbortSignal.timeout(timeoutMs);
  options.request = {
    ...options.request,
    signal: options.request.signal ? AbortSignal.any([options.request.signal, timeout]) : timeout,
  };
}
