# Module formalization

The specifications are [Module](../PRFC-0001-module.md),
[Plugin](../PRFC-0003-plugin.md), [Module Pass](../PRFC-0025-module-pass.md),
[HMR](../PRFC-0002-hmr.md), and [Agent State](../PRFC-0015-agent-state.md).
Formal definitions and the paper refer back to their sections. The RFCs define the
mechanism independently of the proof language and proof status.

- [Lean package](module-model/README.md): definitions, explicit external assumptions,
  and complete proofs. `Basics.lean` contains the elementary laws;
  `Proofs/Normalization.lean`, `Proofs/Plugin.lean`, and `Proofs/HMR.lean` contain
  the main results.
- [Paper](docs/module.typ): shared syntax and semantics in Chapters 2–3, deferred
  operator normalization, plugin replay, and HMR safety in Chapter 4, with basic
  proofs in the appendix. Section 4.2 compares replay with Cordis 2026, including
  the information retained by its per-state inverses.

Declaration transformations are Operators. The paper uses direct operator application,
big-step Pass evaluation and a separate judgment for final Module validity. Operation
counts refine evaluation in the cost discussion. Named operations use upright sans-serif;
complete calls use parentheses, and subscripts mark fixed parameters in partial applications.

From the repository root, build the model with the version pinned in
`module-model/lean-toolchain`:

```sh
lake -d rfcs/formal/module-model build
```

The paper uses `@preview/faithful-acmart:0.2.0`, with the single-column `acmsmall`
layout and review settings used by POPL/PACMPL. It is a design draft, with no ACM
publication metadata or submission claim. The template is Fabian Zaiser's
[third-party Typst port of `acmart`](https://github.com/fzaiser/faithful-acmart/tree/v0.2.0),
not an official POPL template; venue rules determine the accepted submission format.

Use Typst 0.15.1 or later. Install the template's Libertinus Serif, Sans and Math fonts
and Inconsolatazi4, or download its pinned
[font directory](https://github.com/fzaiser/faithful-acmart/tree/v0.2.0/fonts)
and pass that directory as `--font-path`. Typst downloads the pinned template on the
first build. With the fonts installed:

```sh
mkdir -p rfcs/formal/docs/build
typst compile --root rfcs/formal rfcs/formal/docs/module.typ rfcs/formal/docs/build/module.pdf
```

Generated PDFs and page previews belong in the ignored `docs/build/` directory.
The proof scope includes an abstract local Module/Plugin update protocol, with
running Task roots, recovery after boot failure, retained repair state after recovery
failure, and token-guarded resource cleanup. It excludes package transport and the
semantics of parked data. No proof of the TypeScript implementation follows from
either build: source elaboration, callback behavior, actual reference tracking, and
the implementation's preparation order still require a refinement argument.
