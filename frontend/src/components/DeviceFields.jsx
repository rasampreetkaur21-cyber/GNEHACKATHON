import React, { useState } from "react";
import {
  catalog,
  catalogBrands,
  getCatalogItem,
} from "../../../backend/src/catalog.js";

export function selectedDevice(brand, id) {
  const device = getCatalogItem(id);
  return device?.brand === brand ? device : undefined;
}

export function BrandSelect({ value, onChange }) {
  return (
    <label>
      Brand
      <select name="brand" value={value} onChange={onChange} required>
        <option value="">Select a brand</option>
        {catalogBrands.map((brand) => (
          <option key={brand}>{brand}</option>
        ))}
      </select>
    </label>
  );
}

export function ModelFields({ brand }) {
  const [id, setId] = useState("");
  const device = selectedDevice(brand, id);
  const models = catalog.filter((item) => item.brand === brand);
  return (
    <>
      <label>
        Model
        <select
          name="catalog_id"
          value={device?.id || ""}
          onChange={(event) => setId(event.target.value)}
          disabled={!models.length}
          required
        >
          <option value="">Select a model</option>
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.model}
            </option>
          ))}
        </select>
      </label>
      <label>
        Product category
        <input value={device?.category || ""} readOnly />
      </label>
    </>
  );
}
