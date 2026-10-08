import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Photo Op Planner",
    short_name: "Photo Trips",
    description: "Plan photo ops: scenic stops, the best light, and the route between them.",
    start_url: "/trips",
    scope: "/",
    display: "standalone",
    background_color: "#f4f3f0",
    theme_color: "#d9c7a3",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
