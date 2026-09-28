import { exec } from 'child_process'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { promisify } from 'util'
import { FIVEM_HOME, STATE_DIR, TX_DATA, readEnvFile } from '@/lib/panel'

const execAsync = promisify(exec)
const UNIT_FILE = '/etc/systemd/system/fivem-server.service'

/** Instalações do install.sh usam systemd; a antiga roda o FXServer em `screen`. */
export function usesSystemd() {
  return existsSync(UNIT_FILE)
}

export async function isServerRunning() {
  if (usesSystemd()) {
    const { stdout } = await execAsync('systemctl is-active fivem-server || true')
    return stdout.trim() === 'active'
  }
  const { stdout } = await execAsync('pgrep -f "ld-musl-x86_64.*(FXServer|fx)" || true')
  return stdout.trim().length > 0
}

export async function stopServer() {
  if (usesSystemd()) {
    await execAsync('sudo -n systemctl stop fivem-server', { timeout: 60000 })
    return
  }
  await execAsync('screen -S fivem -X quit 2>/dev/null || true', { timeout: 5000 })
  await execAsync('pkill -f "ld-musl-x86_64.*fx" 2>/dev/null || true', { timeout: 10000 })
  await new Promise(r => setTimeout(r, 3000))
  await execAsync('pkill -9 -f "FXServer|cfx-server" 2>/dev/null || true', { timeout: 5000 })
}

export async function startServer() {
  if (usesSystemd()) {
    await execAsync('sudo -n systemctl start fivem-server', { timeout: 60000 })
    return
  }
  await execAsync(`cd ${FIVEM_HOME}/server && screen -dmS fivem bash run.sh`, { timeout: 10000 })
}

export async function restartServer() {
  if (usesSystemd()) {
    await execAsync('sudo -n systemctl restart fivem-server', { timeout: 60000 })
    return
  }
  await stopServer()
  await startServer()
}

/** server.cfg do repositório: o que o provision.sh detectou, ou os locais conhecidos. */
export async function findServerCfg(): Promise<string | null> {
  const env = await readEnvFile(`${STATE_DIR}/server.env`)
  const dataDir = process.env.DATA_DIR || `${FIVEM_HOME}/server-data`
  const candidates = [env.SERVER_CFG, `${dataDir}/server.cfg`, `${dataDir}/files/server.cfg`]
  return candidates.find(p => p && existsSync(p)) || null
}

/**
 * Pastas txData possíveis: a do install.sh e os padrões do txAdmin quando
 * TXHOST_DATA_PATH não está definido (ao lado do run.sh).
 */
const TXDATA_CANDIDATES = [TX_DATA, `${FIVEM_HOME}/server/txData`, `${FIVEM_HOME}/server/alpine/txData`]

export async function findTxData(): Promise<{ txData: string; profile: string } | null> {
  for (const txData of TXDATA_CANDIDATES) {
    if (!existsSync(txData)) continue
    // Perfil padrão primeiro; senão o primeiro que tiver banco de jogadores.
    if (existsSync(`${txData}/default/data/playersDB.json`)) return { txData, profile: 'default' }
    try {
      const { stdout } = await execAsync(`ls -1 "${txData}"`)
      const profile = stdout.split('\n').find(p => p && existsSync(`${txData}/${p}/data/playersDB.json`))
      if (profile) return { txData, profile }
    } catch { /* pasta ilegível: tenta a próxima */ }
  }
  return null
}

export async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8'))
}
