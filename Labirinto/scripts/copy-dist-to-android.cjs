const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(projectRoot, '..')
const distDir = path.join(projectRoot, 'dist')
const androidAssetsDir = path.join(workspaceRoot, 'app', 'src', 'main', 'assets', 'www')

if (!fs.existsSync(distDir)) {
  console.error('Build folder not found:', distDir)
  process.exit(1)
}

fs.rmSync(androidAssetsDir, { recursive: true, force: true })
fs.mkdirSync(androidAssetsDir, { recursive: true })
fs.cpSync(distDir, androidAssetsDir, { recursive: true })

console.log('Android assets updated at:', androidAssetsDir)
