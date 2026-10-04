/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

"use strict";

// Inputs are validated by the IPC handler. Persist synchronously before any
// menu/UI side effects, restoring the exact previous object if storage fails.
function saveSettings(store, patch, allowedKeys, persist) {
  const previous = store.settings;
  const next = { ...previous };
  for (const key of allowedKeys)
    if (patch[key] !== undefined) next[key] = patch[key];
  store.settings = next;
  try {
    persist();
  } catch (error) {
    store.settings = previous;
    throw error;
  }
  return next;
}

module.exports = { saveSettings };
