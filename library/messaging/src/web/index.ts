/**
 * The messaging domain's web half: the binding editor and the messaging panels, compiled by
 * the Web App's program from this package's `./web` entry. The module class joins the app's
 * own modules in web-root.ts; the host reads the binding modal back through this face.
 */
export { MessagingModule } from "./module";
export { MessagingBindingModal } from "./messaging-binding-modal";
