// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import GuidedClaim from "../../frontend/src/components/GuidedClaim.jsx";
import { api } from "../../frontend/src/services/api.js";
vi.mock("../../frontend/src/services/api.js", () => ({
  api: vi.fn().mockResolvedValue({ id: "saved-claim" }),
  uploadEvidence: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
async function product(user) {
  render(
    <MemoryRouter>
      <GuidedClaim />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText("Product model").disabled).toBe(true);
  await user.selectOptions(screen.getByLabelText("Company"), "Samsung");
  expect(screen.queryByRole("option", {name:/Rockerz/})).toBeNull();
  await user.selectOptions(
    screen.getByLabelText("Product model"),
    "samsung-galaxy-a26-5g",
  );
  await user.click(screen.getByText("Serial is unreadable or unknown"));
  await user.click(screen.getByText("I don’t know the purchase date"));
  await user.click(screen.getByRole("button", { name: "Continue →" }));
}
async function choose(user, group, answer) {
  await user.click(
    within(screen.getByRole("group", { name: group })).getByLabelText(answer),
  );
}
async function problem(user) {
  await user.selectOptions(
    screen.getByLabelText("What problem are you experiencing?"),
    "Battery or charging problems",
  );
  for (const [q, a] of [
    ["When did you first notice the problem?", "Don't remember"],
    ["Does the problem happen every time?", "Sometimes"],
    ["Can you still use the product?", "Partially working"],
    ["Has this product been repaired before?", "Not sure"],
    [
      "Are you aware of any accidental damage, such as drops or liquid exposure?",
      "Not sure",
    ],
    ["Have you already tried anything to resolve the issue?", "No"],
    ["Does the device indicate that it is charging?", "Not sure"],
    [
      "Does this happen with every compatible charger you have tried?",
      "Not tried",
    ],
  ])
    await choose(user, q, a);
}
it("customer submits with minimal typing, unknown details and no invoice; back navigation preserves summary edits", async () => {
  const user = userEvent.setup();
  await product(user);
  await problem(user);
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  expect(screen.queryByText("Previous service receipt")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  const summary = screen.getByLabelText(
    "Incident summary · edit before submitting",
  );
  await user.clear(summary);
  await user.type(summary, "My edited account: charging works only sometimes.");
  await user.click(screen.getByRole("button", { name: "← Back" }));
  await user.click(screen.getByRole("button", { name: "← Back" }));
  await choose(user, "Does the problem happen every time?", "Every time");
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  expect(
    screen.getByLabelText("Incident summary · edit before submitting").value,
  ).toBe("My edited account: charging works only sometimes.");
  await user.click(
    screen.getByText(
      "I have reviewed the details and want to submit this claim.",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Submit claim" }));
  expect(api).toHaveBeenCalledWith(
    "/claims",
    expect.objectContaining({
      body: expect.objectContaining({
        serial: "UNKNOWN",
        purchase_date: "UNKNOWN",
        incident_date: "UNKNOWN",
        questionnaire: expect.objectContaining({
          frequency: "Every time",
          repairs: "Not sure",
        }),
        statement: "My edited account: charging works only sometimes.",
      }),
    }),
  );
}, 20000);
it("changing product clears incompatible issue answers and selections", async () => {
  const user = userEvent.setup();
  await product(user);
  await problem(user);
  await user.click(screen.getByRole("button", { name: "← Back" }));
  await user.selectOptions(screen.getByLabelText("Company"), "boAt");
  expect(screen.getByLabelText("Product model").value).toBe("");
  expect(screen.queryByRole("option", {name:/Galaxy/})).toBeNull();
  await user.selectOptions(
    screen.getByLabelText("Product model"),
    "boat-rockerz-450",
  );
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  expect(
    screen.getByLabelText("What problem are you experiencing?").value,
  ).toBe("");
  expect(screen.queryByText("Screen or touch problems")).toBeNull();
  expect(
    screen.queryByText("Does the device indicate that it is charging?"),
  ).toBeNull();
}, 20000);
