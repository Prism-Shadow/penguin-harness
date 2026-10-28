# Source-built runtime

Method instructions and learned Skills travel in Agent State archives. Editing this toolkit does not require rebuilding the executable. Use the benchmark's documented published runtime unless the experiment requests a source build or supplies a prepared bundle.

For a source experiment, use the same executable build for training and testing. Prefer the supplied installation bundle. Otherwise build the CLI and its workspace dependencies using the repository's package manager and stage their production dependency graph using its deployment tooling. Include built plugin resources, Benchmark packages and a Node runtime compatible with the task container. Installing only the CLI from npm may resolve registry dependencies instead of the requested source build.

Check the current adapter's archive layout and launcher contract. Keep symlinks within the bundle and verify its CLI without relying on host dependencies. Record the source commit, local changes, runtime versions and bundle digest. Credentials and Agent States remain separate.

Pass the archive through the adapter's documented `install_bundle` option and reuse it for every trial. Candidate Skill edits change the State archive, not the executable bundle.
