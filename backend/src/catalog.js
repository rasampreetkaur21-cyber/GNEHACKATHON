// Aliases document label and invoice names. Claim submissions use the canonical IDs.
export const catalog = [
  {
    id: "samsung-galaxy-a26-5g",
    brand: "Samsung",
    model: "Galaxy A26 5G",
    category: "Mobile phone",
    aliases: [
      // Informal short names; manufacturer usage unverified.
      "A26",
      "A26 5G",
      // https://www.samsung.com/in/support/model.SM-A266BLGMINS/
      "SM-A266B",
      "SM-A266B/DS",
    ],
  },
  {
    id: "samsung-galaxy-a36-5g",
    brand: "Samsung",
    model: "Galaxy A36 5G",
    category: "Mobile phone",
    aliases: [
      // Informal short names; manufacturer usage unverified.
      "A36",
      "A36 5G",
      // https://www.samsung.com/in/support/model.SM-A366EZKNINS/
      "SM-A366E",
      "SM-A366E/DS",
      // https://www.samsung.com/global/sustainability/policy-file/AYVhR1k6BicAIx95/LCA_Results_for_Smartphones.pdf
      "SM-A366B",
    ],
  },
  {
    id: "samsung-galaxy-a56-5g",
    brand: "Samsung",
    model: "Galaxy A56 5G",
    category: "Mobile phone",
    aliases: [
      // Informal short names; manufacturer usage unverified.
      "A56",
      "A56 5G",
      // https://www.samsung.com/in/support/model/SM-A566EZADNPB/
      "SM-A566E",
      "SM-A566E/DS",
      // https://www.samsung.com/global/sustainability/policy-file/AYVhR1k6BicAIx95/LCA_Results_for_Smartphones.pdf
      "SM-A566B",
    ],
  },
  {
    id: "boat-rockerz-450",
    brand: "boAt",
    model: "Rockerz 450",
    category: "Headphones",
    aliases: [
      "boAt Rockerz 450", // https://www.boat-lifestyle.com/products/rockerz-450
      "R450", // Informal short name; manufacturer usage unverified.
    ],
  },
  {
    id: "boat-rockerz-550",
    brand: "boAt",
    model: "Rockerz 550",
    category: "Headphones",
    aliases: [
      // https://support.boat-lifestyle.com/articles/rockerz-wireless/rockerz-550/621cdae02b115f64864d7eea
      "boAt Rockerz 550",
      "R550", // Informal short name; manufacturer usage unverified.
    ],
  },
  {
    id: "boat-rockerz-650",
    brand: "boAt",
    model: "Rockerz 650",
    category: "Headphones",
    aliases: [
      "boAt Rockerz 650", // https://www.boat-lifestyle.com/products/rockerz-650-wireless-headphone
      "R650", // Informal short name; manufacturer usage unverified.
    ],
  },
];

export const catalogIds = catalog.map(({ id }) => id);
export const catalogBrands = [...new Set(catalog.map(({ brand }) => brand))];

export function getCatalogItem(id) {
  return catalog.find((item) => item.id === id);
}

const modelNameKey = (name) =>
  name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{Pd}]+/gu, "");
const modelsByName = new Map(
  catalog.flatMap((device) =>
    [
      device.id,
      device.model,
      `${device.brand} ${device.model}`,
      ...device.aliases,
    ].map((name) => [modelNameKey(name), device]),
  ),
);

export function findCatalogModel(name) {
  if (typeof name === "string") return modelsByName.get(modelNameKey(name));
}
