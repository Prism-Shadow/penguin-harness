// electron-builder takes one afterPack hook; each step here decides by platform whether it runs.
const macNativeGit = require("./mac-native-git.cjs");
const windowsProgramInventory = require("./windows-program-inventory.cjs");

module.exports = async function afterPack(context) {
  await macNativeGit(context);
  await windowsProgramInventory(context);
};
