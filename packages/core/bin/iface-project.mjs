import path from "node:path";

/** Read all inputs before creating a single compiler graph for this output table. */
export function readInterfaceProject(ts, projects) {
  const configs = projects.map((project) => {
    const configPath = path.resolve(project);
    const parsed = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
          throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
        },
      },
    );
    if (parsed.errors.length) {
      throw new Error(
        ts.formatDiagnostics(parsed.errors, {
          getCanonicalFileName: (file) => file,
          getCurrentDirectory: () => process.cwd(),
          getNewLine: () => "\n",
        }),
      );
    }
    return { configPath, parsed };
  });
  const options = { ...configs[0].parsed.options, noEmit: true };
  const paths = {};
  // These options determine a type's meaning. Combining projects must not silently
  // select a different meaning according to their command-line order.
  const semanticOptions = [
    "target",
    "module",
    "moduleResolution",
    "strict",
    "strictNullChecks",
    "strictFunctionTypes",
    "exactOptionalPropertyTypes",
    "experimentalDecorators",
    "useDefineForClassFields",
    "jsx",
  ];
  for (const { configPath, parsed } of configs) {
    for (const key of semanticOptions) {
      const value = parsed.options[key];
      if (value === undefined) continue;
      if (options[key] !== undefined && options[key] !== value) {
        throw new Error(`gen-ifaces: conflicting ${key} in ${configPath}; use one target tsconfig`);
      }
      options[key] = value;
    }
    for (const [key, values] of Object.entries(parsed.options.paths ?? {})) {
      const base =
        parsed.options.baseUrl ?? parsed.options.pathsBasePath ?? path.dirname(configPath);
      const targets = values.map((value) => path.resolve(base, value));
      if (paths[key] && JSON.stringify(paths[key]) !== JSON.stringify(targets)) {
        throw new Error(
          `gen-ifaces: conflicting paths for '${key}' in ${configPath}; use one target tsconfig`,
        );
      }
      paths[key] = targets;
    }
  }
  if (Object.keys(paths).length) options.paths = paths;
  for (const key of ["lib", "types"]) {
    if (configs.some(({ parsed }) => parsed.options[key] !== undefined)) {
      options[key] = [...new Set(configs.flatMap(({ parsed }) => parsed.options[key] ?? []))];
    }
  }
  return {
    rootNames: [...new Set(configs.flatMap(({ parsed }) => parsed.fileNames))],
    options,
  };
}
