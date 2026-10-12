/**
 * The brand logo's URL (public/penguin-logo.svg, also the favicon), at the base of the build that
 * serves it: `/penguin-logo.svg` for the app, which the server serves from the root. The
 * component gallery compiles this source under a subpath (`/gallery/` on the public site) and
 * ships the same file in its own public directory, so there the logo resolves inside the gallery.
 */
export const PENGUIN_LOGO_URL = `${import.meta.env.BASE_URL}penguin-logo.svg`;
