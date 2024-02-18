#!/usr/bin/env -S node --enable-source-maps --no-warnings
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
import(path.join(__dirname, '..', 'lib', 'ursa', 'cli.js'))
