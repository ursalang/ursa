# Ursa

![logo](mascot/ursula.svg)

© 2023 Reuben Thomas <rrt@sc3d.org>  
https://ursalang.github.io  

Ursa is intended to be a friendly, stable general-purpose programming
language and runtime: the sort of language you can easily start writing code
in, where the code and runtime will still work decades later. For more
details, see the [rationale](https://ursalang.github.io/rationale.html).

Currently, Ursa is under development, as reflected in the version number.
The intention is that once it reaches version 1, the language will not
change or evolve further.

Ursa is free software, licensed under the GNU GPL version 3 (or, at your
option, any later version), and written in TypeScript.

Please [ask questions, make comments](https://ursalang.github.io/discussions.html);
you can [open bug reports](https://github.com/ursalang/ursa/issues) on our GitHub issue tracker.
If none of the other methods work for you, do email the author; see above for address.

## Installation

Install Ursa with npm (part of [Node](https://nodejs.org/)):

```
$ npm install -g @sc3d/ursa
```

## Use

There’s very little documentation as yet, sorry! See the
[web site](https://ursalang.github.io) and:

```sh
$ ursa --help
src/ursa/ursa.ohm # Language grammar
src/ark/interp.ts # the guts of the semantics
test/*.ursa # test/example programs
```

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
