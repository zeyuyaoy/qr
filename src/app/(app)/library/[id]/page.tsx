"use client";
import {useParams} from "next/navigation";
import {Suspense} from "react";
import {DetailView} from "@/components/library/detail-view";

export default function CodeDetailPage() {
    const {id} = useParams<{ id: string }>();
    return (
        <Suspense>
            <DetailView id={id}/>
        </Suspense>
    );
}
