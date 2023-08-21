# Ursa

![logo](mascot/ursula.svg)

© 2023 Reuben Thomas <rrt@sc3d.org>  
https://github.com/ursalang/ursa  

Ursa is intended to be a friendly, stable general-purpose programming
language and runtime: the sort of language you can easily start writing code
in, where the code and runtime will still work decades later. For more
details, see [Why Ursa?](/doc/why-ursa.md)

Currently, Ursa is under development, as reflected in the version number.
The intention is that once it reaches version 1, the language will not
change or evolve further.

Ursa is free software, licensed under the GNU GPL version 3 (or, at your
option, any later version), and written in TypeScript.

The image of Ursula the mascot is from <a href="https://www.vectorportal.com">Vectorportal.com</a>,
and is licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.

Please ask questions, make comments, and open bug reports on the project’s
web page, or report them to the maintainer (see above for addresses).

## Installation

Install Ursa with npm (part of [Node](https://nodejs.org/)):

```
$ npm install -g @sc3d/ursa
```

## Use

There’s very little documentation as yet, sorry! See:

```sh
$ ursa --help
src/ursa/ursa.ohm # Language grammar
src/ark/interp.ts # the guts of the semantics
test/*.ursa # test/example programs
```

## Editor support

* [Tree-sitter grammar](https://github.com/ursalang/tree-sitter-ursa)
* [Emacs mode](https://github.com/ursalang/ursa-ts-mode) (needs
  tree-sitter, which is built in to Emacs ≥ 29)

## Development

Check out the git repository and download dependencies with:

```
git clone https://github.com/ursalang/ursa
npm install
```

To run the tests:

```
npm test
```
