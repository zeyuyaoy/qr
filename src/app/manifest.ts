import type {MetadataRoute} from "next";

export default function manifest(): MetadataRoute.Manifest {
    return {
        id: "/",
        name: "QR Studio",
        short_name: "QR Studio",
        description: "Create, scan and manage QR codes, including dynamic links and offline drafts.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#d8dfcf",
        theme_color: "#315546",
        categories: ["utilities", "productivity"],
        icons: [
            {src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any"},
            {src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any"},
            {src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable"},
            {src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any"},
        ],
        shortcuts: [
            {name: "Scan a QR code", url: "/scan", icons: [{src: "/icons/icon-192.png", sizes: "192x192"}]},
            {name: "Library", url: "/library", icons: [{src: "/icons/icon-192.png", sizes: "192x192"}]},
        ],
        share_target: {action: "/", method: "GET", params: {title: "title", text: "text", url: "url"}},
    } as MetadataRoute.Manifest;
}
