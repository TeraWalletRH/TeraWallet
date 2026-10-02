import { createFileRoute } from "@tanstack/react-router";
import { Route as DashboardRoute } from "./dashboard";

export const Route = createFileRoute("/admin/" as any)({
  component: DashboardRoute.options.component!,
});
