// The uninstaller carries its own immutable list of program files. A later file
// in the same directory belongs to its creator and must survive uninstall.
const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = async function inventory({ electronPlatformName, appOutDir }) {
  if (electronPlatformName !== "win32") return;
  const files = [];
  async function list(directory) {
    for (const entry of await fs.readdir(path.join(appOutDir, directory), {
      withFileTypes: true,
    })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) await list(relative);
      else if (entry.isFile()) files.push(relative.split(path.sep).join("\\"));
      else throw new Error(`Unsupported Windows program file: ${relative}`);
    }
  }
  await list("");
  const cache = path.join(__dirname, "generated");
  await fs.mkdir(cache, { recursive: true });
  const inventoryFile = path.join(cache, "program-files.txt");
  await fs.writeFile(inventoryFile, files.sort().join("\n"), "utf8");
  console.info(`Wrote ${files.length} Windows program files to ${inventoryFile}`);
};
