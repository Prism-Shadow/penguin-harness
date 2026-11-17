/** A shared site component's link, routed in-app: the `render` the site components take. */
import { Link } from "react-router";
import type { SiteLinkProps } from "@prismshadow/penguin-ui/site";

export function routeLink({ href, ...props }: SiteLinkProps) {
  return <Link to={href} {...props} />;
}
