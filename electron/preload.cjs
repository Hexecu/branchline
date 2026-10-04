/* Copyright (C) 2026 Davide Leopardi
 * SPDX-License-Identifier: GPL-3.0-only */

const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "branchline",
  Object.freeze({
    invoke: async (method, payload = {}) => {
      try {
        return await ipcRenderer.invoke("branchline:invoke", method, payload);
      } catch (error) {
        throw new Error(
          String(error.message || error).replace(
            /^Error invoking remote method 'branchline:invoke': (?:Error: )?/,
            "",
          ),
        );
      }
    },
    on: (event, callback) => {
      if (
        ![
          "terminal.data",
          "terminal.exit",
          "repo.changed",
          "app.command",
        ].includes(event)
      )
        throw new Error("Evento non valido");
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(event, listener);
      return () => ipcRenderer.removeListener(event, listener);
    },
  }),
);
