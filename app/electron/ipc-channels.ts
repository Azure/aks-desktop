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

// Portions (c) Microsoft Corp.

/** IPC channel names shared between main and preload. */

// Secure storage
export const SECURE_STORAGE_SAVE = 'secure-storage-save';
export const SECURE_STORAGE_LOAD = 'secure-storage-load';
export const SECURE_STORAGE_DELETE = 'secure-storage-delete';

// GitHub OAuth
export const GITHUB_OAUTH_START = 'github-oauth-start';
export const GITHUB_OAUTH_REFRESH = 'github-oauth-refresh';
export const GITHUB_OAUTH_CALLBACK = 'github-oauth-callback';
