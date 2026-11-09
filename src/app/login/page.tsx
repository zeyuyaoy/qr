import {QrCode} from "lucide-react";
import {redirect} from "next/navigation";
import {auth, signIn} from "@/auth";
import {Button} from "@/components/ui/button";
import {env} from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = {title: "Sign in"};

const ERRORS: Record<string, string> = {
    AccessDenied: "That Google account is not allowed. QR Studio is a private, single-owner app.",
    Configuration: "Authentication is not configured on the server.",
    CredentialsSignin: "Sign-in failed.",
};

export default async function LoginPage({searchParams}: { searchParams: Promise<{ next?: string; error?: string }> }) {
    const {next, error} = await searchParams;
    const session = await auth();
    const dest = next && /^\/(?![/\\])/.test(next) ? next : "/";
    if (session?.user?.isOwner) redirect(dest);
    return (
        <main className="grid min-h-dvh place-items-center p-6">
            <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center">
                <span
                    className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground"><QrCode
                    className="size-6"/></span>
                <h1 className="text-xl font-semibold tracking-tight">QR Studio</h1>
                <p className="mt-1 text-sm text-muted-foreground">Private workspace. Sign in with the owner&apos;s
                    Google account.</p>
                {error ? <p role="alert"
                            className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{ERRORS[error] ?? "Sign-in failed."}</p> : null}
                <form
                    className="mt-6"
                    action={async () => {
                        "use server";
                        await signIn("google", {redirectTo: dest});
                    }}
                >
                    <Button type="submit" size="lg" className="tap w-full">Continue with Google</Button>
                </form>
                {env.testAuthEnabled() ? (
                    <form
                        className="mt-3"
                        action={async () => {
                            "use server";
                            await signIn("test", {
                                email: env.ownerEmails()[0],
                                secret: process.env.TEST_AUTH_SECRET,
                                redirectTo: dest
                            });
                        }}
                    >
                        <Button type="submit" variant="outline" className="w-full" data-testid="test-signin">Test
                            sign-in (non-production)</Button>
                    </form>
                ) : null}
                <p className="mt-6 text-xs text-muted-foreground">No account? There is no sign-up — access is limited to
                    the owner.</p>
            </div>
        </main>
    );
}
