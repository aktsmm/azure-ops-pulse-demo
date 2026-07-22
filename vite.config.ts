import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/azure-ops-pulse-demo/",
  build: {
    sourcemap: false,
    target: "es2022"
  }
});

