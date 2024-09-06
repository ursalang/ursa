// Ursa source code formatter.
// © Reuben Thomas 2023-2024
// Released under the GPL version 3, or (at your option) any later version.

import fs from 'fs'
import path from 'path'
import {fileURLToPath} from 'url'

import {execaSync} from 'execa'
import tmp from 'tmp'

// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = fileURLToPath(new URL('.', import.meta.url))

export function format(
  expr: string,
  indentString: string = '    ',
): string {
  const tmpConfigFile = tmp.fileSync({keep: true})
  fs.writeFileSync(tmpConfigFile.fd, `\
{
  languages = {
    ursa = {
      extensions = ["ursa"],
      indent | priority 1 = "${indentString}",
    },
  },
}`)
  process.env.TOPIARY_LANGUAGE_DIR = path.join(__dirname, '../../lib/topiary')
  const result = execaSync(
    'topiary',
    ['format', '--language', 'ursa', '--configuration', tmpConfigFile.name],
    {input: expr, stripFinalNewline: false},
  )
  tmpConfigFile.removeCallback()
  delete process.env.TOPIARY_LANGUAGE_DIR
  return result.stdout
}
