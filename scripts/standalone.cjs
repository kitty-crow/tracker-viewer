'use strict';
const http = require('node:http');
const sea = require('node:sea');
const { extname, posix } = require('node:path');
const { spawn } = require('node:child_process');
const port = Number(process.env.PORT || 59413);
const host = '127.0.0.1';
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpeg':'image/jpeg','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be between 1 and 65535');
const assets = new Set(JSON.parse(sea.getAsset('__asset-index.json', 'utf8')));
const server = http.createServer((request,response)=>{
  if(request.method!=='GET'&&request.method!=='HEAD'){response.writeHead(405).end();return;}
  let key;
  try {
    const url = new URL(request.url||'/',`http://${host}`);
    const path=decodeURIComponent(url.pathname);
    if(path.split('/').includes('..')){response.writeHead(403).end();return;}
    key=posix.normalize(path).replace(/^\/+/, '');
    if(!key||key.endsWith('/'))key+='index.html';
  } catch {response.writeHead(400).end();return;}
  if(!assets.has(key)){response.writeHead(404).end('Not found');return;}
  const buffer=Buffer.from(sea.getAsset(key));
  response.writeHead(200,{'Content-Type':mime[extname(key)]||'application/octet-stream','Content-Length':buffer.length,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
  if(request.method==='HEAD')response.end();else response.end(buffer);
});
server.on('error',error=>{console.error('Could not start Tracker Viewer:',error.message);process.exitCode=1;});
server.listen(port,host,()=>{
  const url=`http://${host}:${port}/`;
  console.log(`Tracker Viewer: ${url}`);
  if(process.platform==='win32'){
    const child=spawn('cmd.exe',['/d','/s','/c',`start "" "${url}"`],{windowsHide:true,stdio:'ignore'});
    child.on('error',error=>console.warn('Browser could not open automatically:',error.message));
    child.unref();
  }
});
