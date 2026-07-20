import { spawn } from 'node:child_process'

const project = process.argv[2]
const playwrightArguments = process.argv.slice(3)
if (project !== 'e2e' && project !== 'a11y') {
  throw new TypeError('Browser gate project must be e2e or a11y.')
}

await run('pnpm', ['build'])
await run('pnpm', ['exec', 'playwright', 'test', `--project=${project}`, ...playwrightArguments])

function run(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new TypeError(`${command} failed (${signal ?? String(code)}).`))
    })
  })
}
