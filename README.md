# Ursa

![logo](mascot/ursula.svg)

© 2023–2024 Reuben Thomas <rrt@sc3d.org>  
https://ursalang.github.io

Ursa is intended to be a friendly, stable general-purpose programming
language and runtime: the sort of language you can easily start writing code
in, where the code and runtime will still work decades later. For more
details, see the [rationale](https://ursalang.github.io/rationale.html).

Currently, Ursa is under development, as reflected in the version number.
The intention is that once it reaches version 1, the language will not
change or evolve further.

Ursa is free software. The Ohm grammar and the run-time (Ark, and the Ursa
prelude) are licensed under the MIT license. All other files are licensed
under the GNU GPL version 3 (or, at your option, any later version), unless
explicitly mentioned otherwise.

Please [ask questions, make comments](https://ursalang.github.io/discussions.html);
you can [open bug reports](https://github.com/ursalang/ursa/issues) on our
GitHub issue tracker. If none of the other methods work for you, do email
the author; see above for address.

## Installation

Install Ursa with npm (part of [Node](https://nodejs.org/)):

```sh
npm install -g @ursalang/ursa
```

Install the Ursa fork of Topiary (code formatter, you will need a [Rust](https://www.rust-lang.org/) toolchain):

```sh
git clone https://github.com/rrthomas/topiary ~/topiary && cd ~/topiary && cargo install --path topiary-cli
```

## Use

For the Ursa front-end:

```sh
ursa --help
```

For the language and editor support, see the [Ursalang web site](https://ursalang.github.io).

Code-counting support is available for [cloc](https://github.com/AlDanial/cloc) in the file `ursa.def`. Use as follows:

```sh
cloc --read-lang-def=/path/to/ursa.def FILE-OR-DIRECTORY
```

## Development

Check out the git repository and download dependencies with:

```sh
git clone https://github.com/ursalang/ursa
npm install
```

To run the tests:

```sh
npm test
```
