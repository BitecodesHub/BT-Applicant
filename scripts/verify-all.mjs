/**
 * One command, every platform: runs the local verification chain in order and
 * prints what each step cost. Shell `&&` chains are avoided because Windows
 * PowerShell 5.1 does not support them.
 */
import { spawnSync } from 'node:child_process'
import { platform, arch, tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'

const isWindows = platform === 'win32'

const steps = [
  { name: 'Typecheck', script: 'typecheck' },
  { name: 'Unit and integration tests', script: 'test' },
  { name: 'UI walkthrough and screenshots', script: 'test:e2e' },
  { name: 'Release build for this platform', script: 'dist' },
  { name: 'Packaged first-run smoke test', script: 'verify:packaged' }
]

const electronVersion = JSON.parse(readFileSync('node_modules/electron/package.json', 'utf8')).version
console.log(`Host: ${platform}/${arch} · node ${process.version} · electron ${electronVersion}`)
console.log(`Temp: ${tmpdir()}\n`)

const results = []
let failed = false

for (const step of steps) {
  const started = Date.now()
  console.log(`\n──────── ${step.name} (npm run ${step.script}) ────────`)
  const run = spawnSync('npm', ['run', step.script], { stdio: 'inherit', shell: isWindows })
  const seconds = (Date.now() - started) / 1000
  const status = run.status === 0 ? 'pass' : 'fail'
  if (run.status !== 0) failed = true
  results.push({ name: step.name, seconds, status })
  console.log(`──────── ${step.name}: ${status} in ${seconds.toFixed(1)}s ────────`)
  if (failed) break
}

console.log('\nVerification summary')
for (const result of results) {
  console.log(`  ${result.status === 'pass' ? 'PASS' : 'FAIL'}  ${result.name.padEnd(34)} ${result.seconds.toFixed(1)}s`)
}
const skipped = steps.length - results.length
if (skipped > 0) console.log(`  SKIP  ${`${skipped} later step(s) not run`.padEnd(34)}`)

process.exit(failed ? 1 : 0)
