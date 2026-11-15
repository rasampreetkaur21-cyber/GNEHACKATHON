// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import VerifyDevice, {
  DeviceCheckResult,
} from "../../frontend/src/pages/VerifyDevice.jsx";
import { api } from "../../frontend/src/services/api.js";
vi.mock("../../frontend/src/services/api.js", () => ({ api: vi.fn() }));
const result = {
  id: "test-id",
  status: "HUMAN_REVIEW",
  decision: "ESCALATE",
  selected_model_id: "samsung-galaxy-a26-5g",
  observed_model_id: null,
  reason_code: "ANALYSIS_UNAVAILABLE",
  reason: "Photo ke liye human review chahiye.",
  next_action: "Retry ya reviewer check lein.",
  confidence: null,
  authenticity: "UNKNOWN",
  origin: "user_upload_unverified",
  analysis_error: "AI_NOT_CONFIGURED",
  claim_checks: [],
  claim_id: null,
  image_url: "/api/device-checks/test-id/image",
};
beforeEach(() => {
  api.mockReset();
  api.mockImplementation(async (path, options) => {
    if (path === "/device-catalog")
      return {
        products: [
          {
            model_id: result.selected_model_id,
            name: "Samsung Galaxy A26 5G",
            brand: "Samsung",
          },
          {
            model_id: "boat-rockerz-450",
            name: "boAt Rockerz 450",
            brand: "boAt",
          },
        ],
        analysis: { status: "AI_NOT_CONFIGURED" },
      };
    if (path === "/claims") return { claims: [] };
    if (path === "/device-checks" && !options) return { checks: [] };
    return result;
  });
});
afterEach(cleanup);
it.each([
  "VALID_MATCH",
  "DEVICE_MISMATCH",
  "INVALID_DEVICE",
  "UNCLEAR_IMAGE",
  "HUMAN_REVIEW",
])(
  "renders %s with reason, next action and honest null confidence",
  (status) => {
    render(
      <MemoryRouter>
        <DeviceCheckResult result={{ ...result, status }} />
      </MemoryRouter>,
    );
    expect(screen.getByText(status)).toBeTruthy();
    expect(screen.getByText(result.reason)).toBeTruthy();
    expect(screen.getByText(result.next_action)).toBeTruthy();
    expect(screen.getByText("Not calibrated / unavailable")).toBeTruthy();
    expect(screen.getByText("UNKNOWN")).toBeTruthy();
  },
);
it("one-product/one-image journey persists a review result and retries the saved photo", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <VerifyDevice />
    </MemoryRouter>,
  );
  await screen.findByLabelText("Company");
  await user.selectOptions(screen.getByLabelText("Company"), "Samsung");
  await user.selectOptions(
    screen.getByLabelText("Selected product"),
    result.selected_model_id,
  );
  const input = screen.getByLabelText(/Upload exactly one image/);
  expect(input.multiple).toBe(false);
  await user.upload(
    input,
    new File(["test-only-image"], "test.png", { type: "image/png" }),
  );
  // jsdom does not implement the native file-picker validity path; real-browser upload is checked separately.
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Check selected product" })
      .closest("form"),
  );
  await screen.findByText("HUMAN_REVIEW");
  const call = api.mock.calls.find(
    ([path, options]) =>
      path === "/device-checks" && options?.method === "POST",
  );
  expect(call[1].body.getAll("image")).toHaveLength(1);
  expect(call[1].body.get("selected_model_id")).toBe(result.selected_model_id);
  expect(call[1].body.has("origin")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Retry saved photo" }));
  expect(api).toHaveBeenCalledWith("/device-checks/test-id/retry", {
    method: "POST",
    body: {},
  });
});
it("changing company clears the selected image/model and prevents stale submission", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <VerifyDevice />
    </MemoryRouter>,
  );
  await screen.findByLabelText("Company");
  await user.selectOptions(screen.getByLabelText("Company"), "Samsung");
  await user.selectOptions(
    screen.getByLabelText("Selected product"),
    result.selected_model_id,
  );
  await user.upload(
    screen.getByLabelText(/Upload exactly one image/),
    new File(["x"], "test.png", { type: "image/png" }),
  );
  await user.selectOptions(screen.getByLabelText("Company"), "boAt");
  expect(screen.getByLabelText("Selected product").value).toBe("");
  expect(screen.getByLabelText(/Upload exactly one image/).files).toHaveLength(
    0,
  );
  expect(
    screen.getByRole("button", { name: "Check selected product" }).disabled,
  ).toBe(true);
});
it("lets the customer retry a failed saved check after reopening the page", async()=>{
 api.mockImplementation(async(path,options)=>{
  if(path==="/device-catalog")return {products:[],analysis:{status:"AI_NOT_CONFIGURED"}};
  if(path==="/claims")return {claims:[]};
  if(path==="/device-checks" && !options)return {checks:[result]};
  return {...result,analysis_error:null};
 });
 const user=userEvent.setup();render(<MemoryRouter><VerifyDevice /></MemoryRouter>);
 const summary=await screen.findByText(/samsung-galaxy-a26-5g.*HUMAN_REVIEW.*ESCALATE/);await user.click(summary);
 await user.click(screen.getByRole("button",{name:"Retry saved photo"}));
 expect(api).toHaveBeenCalledWith("/device-checks/test-id/retry",{method:"POST",body:{}});
});
