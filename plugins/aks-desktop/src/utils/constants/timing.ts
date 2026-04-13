// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** How often to poll for Azure account label changes (ms). */
export const AZURE_ACCOUNT_POLL_INTERVAL_MS = 30_000;

/** How often to refresh Prometheus metrics (ms). */
export const METRICS_REFRESH_INTERVAL_MS = 30_000;

/** Default Prometheus query range (seconds). */
export const PROMETHEUS_QUERY_RANGE_SECONDS = 300;

/** Extended Prometheus query range for chart views (seconds, 2 hours). */
export const PROMETHEUS_CHART_RANGE_SECONDS = 7_200;

/** Default Prometheus query step (seconds). */
export const PROMETHEUS_STEP_SECONDS = 60;

/** How often to poll for login completion (ms). */
export const LOGIN_POLL_INTERVAL_MS = 5_000;

/** Delay before redirecting after successful login (ms). */
export const LOGIN_REDIRECT_DELAY_MS = 1_000;

/** Delay before redirecting after profile load (ms). */
export const PROFILE_REDIRECT_DELAY_MS = 500;

/** Default timeout for Azure CLI login flow (ms). */
export const LOGIN_TIMEOUT_MS = 300_000;
