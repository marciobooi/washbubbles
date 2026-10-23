/**
 * The file the customer receives: ONE .bat that is also the whole installer. Double-click, accept the administrator prompt, wait.
 * The text between the markers is plain PowerShell (installer/bootstrap.ps1), preceded by this shop's settings.
 * The batch part (everything cmd.exe reads, up to `exit /b`) is plain ASCII; the PowerShell after it is UTF-8 (read by PowerShell
 * itself, never parsed by cmd.exe), so the Portuguese messages keep their accents. The shop's name travels inside the base64 settings.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const bootstrapPath = path.join(here, '..', 'installer', 'bootstrap.ps1')

const safeName = (s) => String(s || 'loja').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'loja'
export const installerFileName = (slug) => `Instalar-${safeName(slug)}.bat`

/** @param cfg { shopName, slug, serverUrl, key, supportEmail, hardware: { pcIp, controllerHost, controllerPort } } */
export function buildInstaller(cfg) {
  const ps = fs.readFileSync(bootstrapPath, 'utf8').replace(/\r\n/g, '\n')
  const b64 = Buffer.from(JSON.stringify(cfg), 'utf8').toString('base64')
  const bat = [
    '@echo off',
    'setlocal',
    `title Instalar ${safeName(cfg.slug)}`,
    'set "BAT=%~f0"',
    // read this very file, take everything after the marker line and run it as PowerShell
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$BatPath=$env:BAT; $t=[IO.File]::ReadAllText($env:BAT,[Text.Encoding]::UTF8); $i=$t.IndexOf('#PS'+'-START'); Invoke-Expression $t.Substring($i)"`,
    'if %errorlevel%==10 exit /b 0',
    'echo.',
    'pause',
    'exit /b',
    '#PS-START',
    `$ConfigB64 = '${b64}'`,
    ps,
  ].join('\r\n')
  return bat
}
