"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const shortDay = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;
const tick = { fill: "var(--muted-foreground)", fontSize: 11 };

/** Recharts bundle; always imported through next/dynamic (see daily-trend.tsx). Colours come from theme tokens so dark mode just works. */
export default function TrendChart({ data, height }: { data: { day: string; scans: number }[]; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="day" tickFormatter={shortDay} tick={tick} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={20} />
        <YAxis allowDecimals={false} tick={tick} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          contentStyle={{ background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "var(--foreground)" }}
          itemStyle={{ color: "var(--foreground)" }}
        />
        <Bar dataKey="scans" name="Scans" fill="var(--chart-2)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
