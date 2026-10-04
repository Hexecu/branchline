/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1", port: 5176, strictPort: true },
  build: { outDir: "dist" },
});
