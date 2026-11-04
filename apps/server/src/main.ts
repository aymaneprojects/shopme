import { existsSync } from 'node:fs';
import path from 'node:path';
import { startServer } from './start';

// CLI entry: `pnpm dev` / `pnpm start` / Docker. Loads .env from the directory pnpm was invoked in.
const envFile = path.join(process.env.INIT_CWD ?? process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

try {
  const server = await startServer();
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal} received, shutting down...`);
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
