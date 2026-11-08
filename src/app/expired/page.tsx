import { Hourglass } from "lucide-react";

export const metadata = { title: "Link expired", robots: { index: false, follow: false } };

/** Generic public expired page. Owner-branded variants are rendered inline by the /r/[slug] resolver. */
export default function ExpiredPage() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-muted"><Hourglass className="size-6 text-muted-foreground" /></span>
        <h1 className="text-xl font-semibold tracking-tight">This link has expired</h1>
        <p className="mt-2 text-sm text-muted-foreground">The owner of this QR code has retired this link. If you think this is a mistake, contact the person who shared it.</p>
      </div>
    </main>
  );
}
