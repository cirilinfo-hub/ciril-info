import { h } from "./deps.js";
import { PricingPage, WebHostingPage, ProductPage, siteFooterLinks } from "./site/pages.jsx";
import { AdminLayout } from "./admin/layout.jsx";
import { Dashboard } from "./admin/dashboard.jsx";
import { Customers, CustomerProfile } from "./admin/customers.jsx";
import { Hosting } from "./admin/hosting.jsx";
import { Domains } from "./admin/domains.jsx";
import { Plans } from "./admin/plans.jsx";
import { Subscriptions } from "./admin/subscriptions.jsx";
import { Billing } from "./admin/billing.jsx";
import { Support } from "./admin/support.jsx";
import { Users } from "./admin/users.jsx";
import { Reports } from "./admin/reports.jsx";
import { Settings } from "./admin/settings.jsx";

// Route elements are created with the site's own <Route> component (passed in),
// so they slot straight into the existing <Routes> tree.
export function siteRoutes(Route) {
  return [
    h(Route, { key: "pricing", path: "pricing", element: h(PricingPage) }),
    h(Route, { key: "hosting", path: "hosting", element: h(WebHostingPage) }),
    h(Route, { key: "hosting-p", path: "hosting/:slug", element: h(ProductPage) }),
  ];
}
export function adminRoute(Route) {
  const r = (path, El) => h(Route, { key: path || "index", path, index: !path ? true : undefined, element: h(El) });
  return h(Route, { key: "admin", path: "admin", element: h(AdminLayout) },
    h(Route, { index: true, element: h(Dashboard) }),
    r("customers", Customers), r("customers/:id", CustomerProfile), r("hosting", Hosting), r("domains", Domains),
    r("plans", Plans), r("subscriptions", Subscriptions), r("billing", Billing), r("support", Support),
    r("users", Users), r("reports", Reports), r("settings", Settings), r("*", Dashboard));
}
export { siteFooterLinks };
