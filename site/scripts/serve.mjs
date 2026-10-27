import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
spawnSync(process.execPath,['scripts/build-data.mjs'],{cwd:resolve('.'),stdio:'inherit'});
const root=resolve('dist');
const base=YAML.parse(readFileSync('data/club.yaml','utf8')).base_path||'';
createServer((req,res)=>{const url=new URL(req.url,'http://localhost');let pathname=decodeURIComponent(url.pathname);if(base&&pathname.startsWith(`${base}/`))pathname=pathname.slice(base.length);let file=join(root,pathname);if(!file.startsWith(root)){res.writeHead(403).end();return;}if(existsSync(file)&&statSync(file).isDirectory())file=join(file,'index.html');if(!existsSync(file)){res.writeHead(404).end('Not found');return;}const type=file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.xml')?'application/xml':'text/html';res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`}).end(readFileSync(file));}).listen(4173,()=>console.log('WebMAKER preview: http://localhost:4173'));

