export async function api(path, options = {}) {
  const form = options.body instanceof FormData;
  const response = await fetch("/api" + path, {
    credentials: "include",
    ...options,
    headers: {
      "X-ClaimShield": "1",
      ...(!form && options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body
      ? form
        ? options.body
        : JSON.stringify(options.body)
      : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.details
        ?.map((d) => `${d.field || "Form"}: ${d.message}`)
        .join(" ") ||
        data.error?.message ||
        "Request failed.",
    );
  return data;
}

// XMLHttpRequest exposes actual transmitted-byte progress, unlike Fetch.
export function uploadEvidence(claimId, form, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/claims/${claimId}/evidence`);
    xhr.withCredentials = true;
    xhr.timeout = 60000;
    xhr.setRequestHeader("X-ClaimShield", "1");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        return reject(new Error("The upload returned an invalid response."));
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error?.message || "Upload failed."));
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "Upload connection failed. Your claim is saved; retry the file upload.",
        ),
      );
    xhr.ontimeout = () =>
      reject(
        new Error(
          "Upload timed out. Your claim is saved; retry the file upload.",
        ),
      );
    xhr.send(form);
  });
}
