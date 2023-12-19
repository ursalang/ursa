#!/bin/sh
npx tsx $(dirname $(command -v -- "$0"))/../src/ursa/cli.ts "$@"
