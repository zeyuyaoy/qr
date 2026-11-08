"use client";
import dynamic from "next/dynamic";
import { Skeleton } from "./ui";

const TrendChart = dynamic(() => import("./trend-chart"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });

/** Daily scan chart with a text alternative: an aria-label summary plus a visually hidden data table. */
export function DailyTrend({ data, height = 220, title = "Daily scans" }: { data: { day: string; scans: number }[]; height?: number; title?: string }) {
  const total = data.reduce((n, d) => n + d.scans, 0);
  const peak = data.reduce((p, d) => (d.scans > p.scans ? d : p), { day: "", scans: 0 });
  if (data.length === 0 || total === 0) {
    return (
      <div className="grid place-items-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground" style={{ height }}>
        No scans recorded in this period.
      </div>
    );
  }
  const summary = `${title}, ${data[0]?.day} to ${data[data.length - 1]?.day}: ${total} scans in total, busiest day ${peak.day} with ${peak.scans}.`;
  return (
    <>
      <div role="img" aria-label={summary} style={{ height }}>
        <TrendChart data={data} height={height} />
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr><th scope="col">Day (UTC)</th><th scope="col">Scans</th></tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}><th scope="row">{d.day}</th><td>{d.scans}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
