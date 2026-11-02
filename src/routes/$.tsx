import { createFileRoute } from "@tanstack/react-router";
import { serveSitemap, serveSitePage } from "@/lib/site-pages";

export const Route = createFileRoute("/$")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const { pathname } = new URL(request.url);
        return pathname === "/sitemap.xml" ? serveSitemap() : serveSitePage(pathname);
      },
    },
  },
  component: () => null,
});
