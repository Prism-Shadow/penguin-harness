// The live suite confines with the bwrap this plugin ships; the build vendors it, a bare test
// run does not. vendorBwrap() returns at once when it is already in place.
import { vendorBwrap } from "../../../scripts/vendor-bwrap.mjs";

export default async function setup(): Promise<void> {
  if (process.platform === "linux") await vendorBwrap();
}
