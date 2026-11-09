import {CloudOff} from "lucide-react";

export const metadata = {title: "Offline"};

export default function OfflinePage() {
    return (
        <main className="grid min-h-dvh place-items-center p-6 text-center">
            <div className="max-w-sm">
                <CloudOff className="mx-auto mb-4 size-10 text-muted-foreground"/>
                <h1 className="text-xl font-semibold">You&apos;re offline</h1>
                <p className="mt-2 text-sm text-muted-foreground">This page isn&apos;t available without a connection.
                    The generator, scanner and anything you&apos;ve already opened still work — reconnect to reach the
                    rest.</p>
                <a href="/"
                   className="mt-6 inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Open
                    generator</a>
            </div>
        </main>
    );
}
