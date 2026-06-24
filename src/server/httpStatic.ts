/**
 * httpStatic.ts — Minimal static-file handler for serving the built client.
 *
 * Serves the contents of the Vite build (dist/client) so the game can run from
 * a single address/port — the same HTTP server the WebSocket attaches to. Uses
 * only Node built-ins (no framework, no extra deps). Guards against path
 * traversal and falls back to index.html for extension-less routes.
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Builds a request listener that serves files from `root`. Unknown paths with
 * no file extension fall back to index.html (single-page app); missing assets
 * return 404. If `root` doesn't exist (e.g. running in dev before a build),
 * everything 404s harmlessly — the client is served by Vite in that case.
 */
export function createStaticHandler(root: string): http.RequestListener {
  const send = (res: http.ServerResponse, file: string): void => {
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
        return;
      }
      const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type });
      res.end(data);
    });
  };

  return (req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const filePath = path.join(root, rel);

    // Path-traversal guard: the resolved path must stay inside root.
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    fs.stat(filePath, (err, stat) => {
      if (!err && stat.isFile()) {
        send(res, filePath);
      } else if (!path.extname(rel)) {
        // Extension-less route → serve the SPA entry point.
        send(res, path.join(root, "index.html"));
      } else {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
      }
    });
  };
}
