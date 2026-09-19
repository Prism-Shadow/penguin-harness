import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { bookReaderTemplate } from "../src/activities/book-reader-template.js";
import { bookReaderControllerTemplate } from "../src/activities/book-reader-controller-template.js";

it("typechecks the generated reader model and controller together with strict TypeScript", () => {
  const sources = new Map([
    [path.resolve("model.ts"), bookReaderTemplate],
    [path.resolve("controller.ts"), bookReaderControllerTemplate],
  ]);
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => sources.has(path.resolve(name)) || fileExists(name);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    sources.has(path.resolve(name))
      ? ts.createSourceFile(name, sources.get(path.resolve(name))!, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([...sources.keys()], options, host);
  const errors = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  expect(errors).toEqual([]);
});
