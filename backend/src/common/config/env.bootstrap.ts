/**
 * Import this right after `dotenv/config`, before any module that reads
 * `process.env` while it loads (jwt, storage, email). A bad environment then
 * stops the process here with a readable list instead of failing deep inside
 * whichever module touches the missing value first.
 */
import { EnvValidationError, loadConfig } from './env';

try {
  loadConfig();
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(`[Config] ${error.message}\n[Config] Fix the values above (see backend/.env.example) and restart.`);
  } else {
    console.error('[Config] Could not read the environment:', error);
  }
  process.exit(1);
}
