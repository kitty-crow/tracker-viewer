import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';

export interface ListenerOptions {
  exeDir?: string;
  appRoot?: string;
  cwd?: string;
  environment?: Readonly<Record<string, string | undefined>>;
}

export interface ListenerConfig {
  ip: string;
  port: number;
  browserUrl: string;
}

/** Read only the server settings; the tracker directory is resolved separately. */
function readSettings(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?(IP|PORT)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const raw = (match[2] ?? '').trim();
    const quoted = raw.match(/^(['"])(.*)\1$/);
    values[match[1]!] = quoted ? quoted[2]! : raw.replace(/\s+#.*$/, '').trim();
  }
  return values;
}

/** .env beside the EXE wins, then the project root, then the working directory. */
export function listenerConfig(options: ListenerOptions = {}): ListenerConfig {
  const roots = [options.exeDir, options.appRoot, options.cwd ?? process.cwd()]
    .filter((value): value is string => Boolean(value)).map(value => resolve(value));
  const filename = [...new Set(roots)].map(root => join(root, '.env')).find(existsSync);
  const file = filename ? readSettings(filename) : {};
  const environment = options.environment ?? process.env;
  const ip = file.IP ?? environment.IP ?? '127.0.0.1';
  const port = Number(file.PORT ?? environment.PORT ?? '59413');
  if (isIP(ip) !== 4) throw new Error(`Invalid IP in .env: ${ip}. Specify an IPv4 address.`);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const browserHost = ip === '0.0.0.0' ? '127.0.0.1' : ip;
  return { ip, port, browserUrl: `http://${browserHost}:${port}/` };
}
