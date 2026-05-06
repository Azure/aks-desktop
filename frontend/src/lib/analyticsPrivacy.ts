/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ITelemetryItem } from '@microsoft/applicationinsights-web';

/**
 * Strip identifying tags and URL fields from every outgoing telemetry envelope.
 *
 * This runs on the SDK's send pipeline and is the catch-all that protects us
 * if a future SDK upgrade re-enables auto-collection or if a new call site
 * forgets the "no identifiers" rule. It is intentionally aggressive.
 *
 * Mutates the provided `envelope` in place (as required by the
 * `ITelemetryItem` initializer contract). Deterministic and free of external
 * side effects — it touches only the envelope it is given, so it can be
 * unit-tested without dragging the AppInsights bootstrap into the test's
 * module graph.
 */
export function privacyTelemetryInitializer(envelope: ITelemetryItem): void {
  envelope.tags = envelope.tags ?? {};
  delete envelope.tags['ai.user.id'];
  delete envelope.tags['ai.user.authUserId'];
  delete envelope.tags['ai.user.accountId'];
  delete envelope.tags['ai.session.id'];
  delete envelope.tags['ai.location.ip'];

  const baseData = envelope.data?.baseData as Record<string, unknown> | undefined;
  if (baseData) {
    if ('uri' in baseData) baseData.uri = '';
    if ('refUri' in baseData) baseData.refUri = '';
    if ('url' in baseData) baseData.url = '';
  }
}
