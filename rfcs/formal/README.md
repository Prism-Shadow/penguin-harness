# Module formalization

The specifications are [Module](../PRFC-0001-module.md),
[Plugin](../PRFC-0003-plugin.md) and [Module Pass](../PRFC-0025-module-pass.md).
Formal definitions and the paper refer back to their sections. The RFCs define the
mechanism independently of the proof language and proof status.

- [Lean package](module-model/README.md): definitions, external assumptions and proposed
  theorems. The theorem bodies intentionally remain `sorry` for review.
- [Paper](docs/module.typ): the complete Module mechanism, the declaration abstraction,
  decorators, pass semantics, plugin selection, proposed laws and proof obligations.

From the repository root, build the model with the version pinned in
`module-model/lean-toolchain`:

```sh
lake -d rfcs/formal/module-model build
```

The paper uses `@preview/faithful-acmart:0.2.0`, with the single-column `acmsmall`
layout and review settings used by POPL/PACMPL. It is a design draft, with no ACM
publication metadata or submission claim. The template is a Typst port of `acmart`;
venue submission rules still determine the accepted source format.

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
No proof of the TypeScript implementation follows from either build. The paper marks
proposed laws and the remaining elaboration and runtime obligations explicitly.
