#!/bin/sh
npx tsx --enable-source-maps $(dirname $(command -v -- "$0"))/../src/ursa/cli.ts "$@"
