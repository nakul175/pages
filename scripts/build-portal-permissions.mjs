import {build} from 'esbuild';
import {mkdir,chmod,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out='artifacts/portal-permissions';await mkdir(out,{recursive:true});
await build({entryPoints:['scripts/portal-workspace-permissions.ts'],outfile:out+'/connector.mjs',
 bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',banner:{js:'#!/usr/bin/env node'}});
await chmod(out+'/connector.mjs',0o700);
await writeFile(out+'/provenance.json',JSON.stringify({sha256:createHash('sha256').update(await readFile(out+'/connector.mjs')).digest('hex'),productionActivation:false},null,2)+'\n');
