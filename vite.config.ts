import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "src/client",
  // Serve runtime assets (SVGs, etc.) from the project-root /public folder.
  // These are copied as-is and never bundled — satisfying the asset
  // pipeline rule that SVGs load at runtime via the AssetRegistry.
  // A file at /public/assets/characters/knight.svg is served at
  //   /assets/characters/knight.svg
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});
