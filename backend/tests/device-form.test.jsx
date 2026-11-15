import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BrandSelect,
  ModelFields,
  selectedDevice,
} from "../../frontend/src/components/DeviceFields.jsx";

describe("Public device fields", () => {
  it("offers Samsung and boAt and requires a model of the chosen brand", () => {
    const brands = renderToStaticMarkup(
      <BrandSelect value="" onChange={() => {}} />,
    );
    expect(brands).toContain("<option>Samsung</option>");
    expect(brands).toContain("<option>boAt</option>");
    expect(brands.match(/<option/g)).toHaveLength(3);

    const samsung = renderToStaticMarkup(<ModelFields brand="Samsung" />);
    expect(samsung).toContain('name="catalog_id" required=""');
    expect(samsung).toContain('value="samsung-galaxy-a26-5g"');
    expect(samsung).toContain('value="samsung-galaxy-a36-5g"');
    expect(samsung).toContain('value="samsung-galaxy-a56-5g"');
    expect(samsung).toContain('readonly=""');
    expect(samsung.match(/<option/g)).toHaveLength(4);

    const boat = renderToStaticMarkup(<ModelFields brand="boAt" />);
    expect(boat).toContain('value="boat-rockerz-450"');
    expect(boat).toContain('value="boat-rockerz-550"');
    expect(boat).toContain('value="boat-rockerz-650"');
    expect(boat.match(/<option/g)).toHaveLength(4);
  });

  it("rejects tampered and cross-brand IDs at the form's submission guard", () => {
    expect(selectedDevice("Samsung", "samsung-galaxy-a25-5g")).toBeUndefined();
    expect(selectedDevice("Samsung", "boat-rockerz-450")).toBeUndefined();
    expect(selectedDevice("Samsung", null)).toBeUndefined();
    expect(selectedDevice("boAt", "boat-rockerz-450").category).toBe(
      "Headphones",
    );
  });
});
