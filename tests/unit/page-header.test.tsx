// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";

afterEach(cleanup);

describe("PageHeader", () => {
  it("renders the title as the page's h1", () => {
    render(<PageHeader title="Library" />);
    expect(screen.getByRole("heading", { level: 1, name: "Library" })).toBeInTheDocument();
  });
  it("omits description and actions when absent", () => {
    const { container } = render(<PageHeader title="Library" />);
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.firstElementChild!.children).toHaveLength(1);
  });
  it("renders a description and actions", () => {
    render(<PageHeader title="Library" description="All your codes" actions={<button>New</button>} />);
    expect(screen.getByText("All your codes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });
  it("merges a custom className and escapes text content", () => {
    const { container } = render(<PageHeader title={"<b>x</b>"} className="custom-class" />);
    expect(container.firstElementChild).toHaveClass("custom-class", "mb-5");
    expect(screen.getByRole("heading")).toHaveTextContent("<b>x</b>");
    expect(container.querySelector("b")).toBeNull();
  });
});

describe("Badge", () => {
  it("renders children as a span with variant classes", () => {
    render(<Badge variant="destructive">Expired</Badge>);
    const el = screen.getByText("Expired");
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toMatch(/destructive/);
  });
  it("defaults to the primary variant", () => {
    render(<Badge>Live</Badge>);
    expect(screen.getByText("Live").className).toMatch(/bg-primary/);
  });
});
