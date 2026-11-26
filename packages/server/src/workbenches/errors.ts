/**
 * The workbench a call names does not exist: the routes read it as a 404 (`not_found`), and the
 * plugin uninstall port tells the library's own failure apart from it. Its own module so the
 * platform ports can recognize it without importing the workbench service (and everything the
 * service pulls in) behind it.
 */
export class WorkbenchNotFound extends Error {}
