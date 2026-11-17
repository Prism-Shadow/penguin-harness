import { Component } from "@prismshadow/penguin-core/plugin";

/**
 * The sample plugin's TestUnit: the smallest unit the driver can collect and run
 * inside the real shell. Its slot and execution contract are settled with the
 * driver's implementation (see src/driver.ts).
 */
@Component()
export class TestUnit {}
