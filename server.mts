import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const runtime = require('./scripts/runtime-tracker.cjs') as { handleRequest: (req: unknown, res: unknown, options: { root: string }) => boolean };
const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 59413);
const dist = fileURLToPath(new URL('./dist/', import.meta.url));
const appRoot = fileURLToPath(new URL('./', import.meta.url));
const types: Record<string, string> = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
if (!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid PORT: use a value from 1 to 65535.');
const server=createServer(async(req,res)=>{
  if (runtime.handleRequest(req,res,{root:appRoot})) return;
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
  let pathname:string;
  try{pathname=decodeURIComponent(new URL(req.url??'/',`http://${host}`).pathname);}catch{res.writeHead(400).end();return;}
  const root=resolve(dist);
  const name=resolve(root,`.${pathname.endsWith('/')?`${pathname}index.html`:pathname}`);
  if(name!==root&&!name.startsWith(`${root}${sep}`)){res.writeHead(403).end();return;}
  try{const file=await stat(name);if(!file.isFile())throw new Error('Not a file');res.writeHead(200,{'Content-Type':types[extname(name).toLowerCase()]??'application/octet-stream','Content-Length':file.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')res.end();else createReadStream(name).pipe(res);}
  catch{res.writeHead(404).end('Not found. Run npm run build first.');}
});
server.listen(port,host,()=>console.log(`Tracker Viewer: http://${host}:${port}/`));
server.on('error',e=>{console.error(e);process.exitCode=1;});
