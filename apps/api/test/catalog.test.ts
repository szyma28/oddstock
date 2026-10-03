import { describe, expect, it } from "vitest";
import { products } from "../src/catalog.js";

describe("demo catalogue", () => {
  it("includes a few deliberately odd listings among the everyday stock", () => {
    const names = products.map((product) => product.name);

    expect(names).toContain("Spoon, allegedly 1,000 years old");
    expect(names).toContain("A pebble with big plans");
    expect(names).toContain("Mug of mild suspicion");
    expect(names).toContain("Notebook of unfinished business");
  });

  it("keeps every listing ID and name unique", () => {
    expect(new Set(products.map((product) => product.id)).size).toBe(products.length);
    expect(new Set(products.map((product) => product.name)).size).toBe(products.length);
  });
});
