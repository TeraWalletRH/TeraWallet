import { createFileRoute } from "@tanstack/react-router";
import { serveSitePage } from "@/lib/site-pages";

export const Route = createFileRoute("/$")({
  server: {
    handlers: {
      GET: ({ request }) => serveSitePage(new URL(request.url).pathname),
    },
  },
  component: () => null,
});
