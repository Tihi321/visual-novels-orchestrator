const { app, utilityProcess } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const logFile = process.env.DIAG_LOG
const log = (m) => fs.appendFileSync(logFile, m + "\n")
app.whenReady().then(async () => {
  const child = utilityProcess.fork(path.join(__dirname, 'child.js'), [], { stdio: 'pipe' })
  let exited = false
  child.on('exit', (code) => { exited = true; log('child exit code ' + code) })
  await new Promise((r) => setTimeout(r, 1500))
  log('exited before postMessage: ' + exited)
  for (const cmd of [{ type: 'ping', id: 'startup' }, { type: 'snapshot' }]) {
    try { child.postMessage(cmd); log('postMessage ' + cmd.type + ' ok') } catch (e) { log('postMessage ' + cmd.type + ' THREW: ' + (e && e.message)) }
  }
  log('still alive after attempts')
  app.exit(0)
})
