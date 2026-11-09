import {Suspense} from "react";
import {PageHeader} from "@/components/page-header";
import {QrEditor} from "@/components/qr/qr-editor";

export const metadata = {title: "Create"};

export default function CreatePage() {
    return (
        <>
            <PageHeader title="Create a QR code"/>
            <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-muted"/>}>
                <QrEditor mode="create"/>
            </Suspense>
        </>
    );
}
