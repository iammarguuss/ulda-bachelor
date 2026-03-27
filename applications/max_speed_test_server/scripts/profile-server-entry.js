import { createServer } from "../src/server.js";

const port = Number(process.env.PORT ?? 8899);
const server = createServer({ port });

function shutdown(signal) {
  server.stop()
    .then(() => {
      console.log(`profile server stopped after ${signal}`);
      process.exit(0);
    })
    .catch(error => {
      console.error(error?.stack ?? String(error));
      process.exit(1);
    });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

server.start()
  .then(({ port: activePort }) => {
    console.log(`profile server listening on http://127.0.0.1:${activePort}`);
  })
  .catch(error => {
    console.error(error?.stack ?? String(error));
    process.exit(1);
  });
