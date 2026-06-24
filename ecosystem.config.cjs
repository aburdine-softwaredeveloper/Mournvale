/**
 * ecosystem.config.cjs — PM2 process config for self-hosting Mournvale.
 *
 * PM2 keeps the server running across crashes and machine reboots, and reloads
 * it on deploy WITHOUT touching player saves (those live on disk in ./saves and
 * are never rebuilt or cleared). Use scripts/deploy.sh to build + (re)start.
 *
 *   one-time:  npm install -g pm2  &&  pm2 startup   (then run the line it prints)
 *   deploy:    ./scripts/deploy.sh
 *   update:    git pull && ./scripts/deploy.sh
 */

module.exports = {
  apps: [
    {
      name: "mournvale",
      cwd: __dirname,
      script: "npm",
      args: "start", // → tsx src/server/index.ts, serving the built client
      autorestart: true,
      max_restarts: 10,
      env: {
        PORT: process.env.PORT || "3000",
        // NPC dialogue LLM (free, local). Point at a remote Ollama box if you
        // host the game and the GPU machine separately.
        OLLAMA_URL: process.env.OLLAMA_URL || "http://localhost:11434",
        OLLAMA_MODEL: process.env.OLLAMA_MODEL || "llama3.2:3b",
      },
    },
  ],
};
