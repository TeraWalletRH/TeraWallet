import { createFileRoute } from "@tanstack/react-router";
import { Route as DashboardRoute } from "./dashboard";

const AdminIndexComponent = () => {
  const Component = DashboardRoute.options.component;
  return Component ? <Component /> : null;
};

export const Route = createFileRoute("/admin/")({
  component: AdminIndexComponent,
});
