/** Install the public archives into a fresh consumer and verify strict NodeNext declarations. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,mkdir,readFile,writeFile,copyFile,realpath} from 'node:fs/promises'
import {join,resolve,relative,isAbsolute,basename,delimiter} from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
import {verifyInstalledArchive} from './verify-installed.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv
assert.ok(process.env.npm_execpath,'Run through npm run test:consumer')
const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const runs=join(root,'.test-artifacts','consumer');await mkdir(runs,{recursive:true})
const resume=args.indexOf('--resume-run'),resumed=resume>=0
const area=resumed?await realpath(args[resume+1]):await mkdtemp(join(runs,'run-'))
const owned=relative(runs,area);assert.ok(!owned.startsWith('..')&&!isAbsolute(owned),'Resume target must stay in this repository consumer-test directory')
const attempt=await mkdtemp(join(area,'attempt-')),archives=[]
for(const path of[join(root,'artifacts',manifest.name+'-'+manifest.version+'.tgz')]){const target=join(attempt,basename(path));await copyFile(path,target);archives.push(target)}
if(!resumed)await writeFile(join(area,'package.json'),JSON.stringify({name:'isolated-media-consumer',private:true,type:'module',overrides:manifest.overrides},null,2)+'\n')
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD/i.test(key)&&key.toUpperCase()!=='PATH'))
Object.assign(env,{PATH:join(root,'node_modules','.bin')+delimiter+(process.env.PATH??process.env.Path??''),DSH_PRIMARY_RUNTIME:''})
await mkdir(join(attempt,'temp'),{recursive:true});Object.assign(env,{TEMP:join(attempt,'temp'),TMP:join(attempt,'temp')})
const records=[]
async function run(argv){
 const timeout=AbortSignal.timeout(300000),child=spawn(process.execPath,argv,{cwd:area,env,windowsHide:true,signal:timeout,stdio:['ignore','pipe','pipe']})
 await writeFile(join(attempt,'setup-live.json'),JSON.stringify({pid:child.pid,startedAt:new Date().toISOString()})+'\n')
 let stdout='',stderr='',failure
 child.stdout.on('data',data=>{stdout+=data});child.stderr.on('data',data=>{stderr+=data});child.once('error',error=>{failure=error})
 const [code,signal]=await new Promise(resolve=>child.once('close',(...values)=>resolve(values)))
 records.push({argv,code,signal,timedOut:timeout.aborted,stdout,stderr});await writeFile(join(attempt,'commands.json'),JSON.stringify(records,null,2)+'\n')
 if(failure)throw failure;assert.equal(code,0,stderr.slice(-1800));return stdout
}
if(!resumed||args.includes('--reinstall'))await run([process.env.npm_execpath,'install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','--cache',join(root,'.npm-cache'),archives[0],'@types/node@24.0.0'])
const installed=await verifyInstalledArchive(archives[0],join(area,'node_modules','dsh-media-kit'),join(attempt,'installed-files.json'))
const consumer=join(attempt,'consumer.ts')
await copyFile(join(root,'scripts','consumer-types.ts'),consumer)
const program=ts.createProgram([consumer],{strict:true,noEmit:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,types:['node'],typeRoots:[join(area,'node_modules','@types')],lib:['lib.es2022.d.ts','lib.dom.d.ts'],skipLibCheck:false,allowImportingTsExtensions:true})
const diagnostics=ts.getPreEmitDiagnostics(program)
await writeFile(join(attempt,'type-diagnostics.txt'),ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>area,getCanonicalFileName:file=>file,getNewLine:()=> '\n'}))
assert.equal(diagnostics.length,0,'Strict consumer declaration check failed; see local type diagnostics')
const compilerLib=resolve(root,'node_modules','typescript','lib'),inputFiles=program.getSourceFiles().map(file=>resolve(file.fileName))
for(const path of inputFiles){
 const owned=relative(area,path),compiler=relative(compilerLib,path)
 assert.ok((!owned.startsWith('..')&&!isAbsolute(owned))||(!compiler.startsWith('..')&&!isAbsolute(compiler)),'Consumer borrowed an ancestor dependency')
}
await copyFile(join(root,'scripts','root-consumer.mjs'),join(attempt,'root-runtime.mjs'))
const rootRuntime=JSON.parse((await run([join(attempt,'root-runtime.mjs')])).trim());assert.equal(rootRuntime.passed,true)
await run([process.env.npm_execpath,'install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','@deepseek-ai/dsh-attachment@0.2.2-rc.1','@deepseek-ai/dsh-attachment-local@0.2.2-rc.1','@deepseek-ai/cordis@~4.1.0'])
const nativeConsumer=join(attempt,'native-consumer.ts');await copyFile(join(root,'scripts','consumer-native-types.ts'),nativeConsumer)
const nativeProgram=ts.createProgram([consumer,nativeConsumer],program.getCompilerOptions()),nativeDiagnostics=ts.getPreEmitDiagnostics(nativeProgram)
await writeFile(join(attempt,'native-type-diagnostics.txt'),ts.formatDiagnosticsWithColorAndContext(nativeDiagnostics,{getCurrentDirectory:()=>area,getCanonicalFileName:file=>file,getNewLine:()=> '\n'}))
assert.equal(nativeDiagnostics.length,0,'Native consumer declaration check failed')
const nativeInputs=nativeProgram.getSourceFiles().map(file=>resolve(file.fileName))
for(const path of nativeInputs){const owned=relative(area,path),compiler=relative(compilerLib,path);assert.ok((!owned.startsWith('..')&&!isAbsolute(owned))||(!compiler.startsWith('..')&&!isAbsolute(compiler)),'Native consumer borrowed an ancestor dependency')}
await copyFile(join(root,'scripts','native-consumer.mjs'),join(attempt,'native-runtime.mjs'))
const runtime=JSON.parse((await run([join(attempt,'native-runtime.mjs')])).trim());assert.equal(runtime.passed,true)

const result={passed:true,installedFilesVerified:installed,declarationFiles:inputFiles.length,ancestorDependenciesBorrowed:false,strictDeclarationErrors:0,rootRuntime,nativeDeclarationFiles:nativeInputs.length,nativeStrictDeclarationErrors:0,runtimeSmoke:runtime,realModelApiRequests:0,realQqMessagesSent:0}
await writeFile(join(attempt,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({area,attempt,...result}))
