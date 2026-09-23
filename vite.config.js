import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // The service worker uses this to precache lazy chunks as well as the
    // entry bundle, preserving first-load offline behavior after code split.
    manifest: "manifest.json",
  },
});
