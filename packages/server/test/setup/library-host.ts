/**
 * Runs before every test file: names the server's own package as the plugin library's host, as
 * the platform does at boot (hmr/platform.ts) — so a test that reads the library without booting
 * an App reads the one the server ships, and one that pointed the library elsewhere does not
 * leave the next file reading a fixture (this suite does not isolate modules between files).
 */
import {
  useInstalledPluginPrefix,
  useLibraryHost,
  usePushedPluginLibrary,
} from "@prismshadow/penguin-core";
import { serverPackageDir } from "../../src/plugin/library-host.js";

usePushedPluginLibrary(null);
useInstalledPluginPrefix(null);
useLibraryHost(serverPackageDir());
