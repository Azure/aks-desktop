// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Where "Contact us" sends people: an aka.ms redirect pointing at the AKS
 * Desktop feedback form.
 *
 * Deliberately a redirect rather than a hardcoded destination URL — the target
 * can be retargeted without shipping a new build, and older builds keep working.
 */
export const CONTACT_US_URL = 'https://aka.ms/aks-desktop/feedback';
