import { defineConfig } from 'vite'
import { execSync } from 'child_process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function getGitInfo() {
  try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
    const count = execSync('git rev-list --count HEAD', { encoding: 'utf-8' }).trim()
    return { hash, count }
  } catch {
    return { hash: 'dev', count: '0' }
  }
}

export default defineConfig(() => {
  const git = getGitInfo()
  return {
    base: '/mwi_combat_averagelator/',
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(`${git.count}.${git.hash}`),
    },
  }
})
