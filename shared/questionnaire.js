// Shared customer questionnaire. Answers are assertions, never verification.
export const issues = {
  "Mobile phone": [
    "Not turning on",
    "Battery or charging problems",
    "Screen or touch problems",
    "Overheating",
    "Camera or speaker problems",
    "Connectivity problems",
    "Other",
  ],
  Headphones: [
    "One side not working",
    "Battery or charging problems",
    "Audio or microphone problems",
    "Bluetooth connection problems",
    "Physical damage",
    "Other",
  ],
};
export const core = [
  [
    "noticed",
    "When did you first notice the problem?",
    ["Today", "Past 7 days", "More than 7 days ago", "Don't remember"],
  ],
  [
    "frequency",
    "Does the problem happen every time?",
    ["Every time", "Sometimes", "Happened once", "Not sure"],
  ],
  [
    "usability",
    "Can you still use the product?",
    ["Not working", "Partially working", "Mostly working", "Not sure"],
  ],
  [
    "repairs",
    "Has this product been repaired before?",
    ["Yes", "No", "Not sure"],
  ],
  [
    "damage",
    "Are you aware of any accidental damage, such as drops or liquid exposure?",
    ["Yes", "No known damage", "Not sure"],
  ],
  [
    "tried",
    "Have you already tried anything to resolve the issue?",
    ["Yes", "No", "Not sure"],
  ],
];
export function followups(category, issue) {
  if (!issues[category]?.includes(issue)) return [];
  if (issue === "Battery or charging problems")
    return [
      [
        "charging",
        "Does the device indicate that it is charging?",
        ["Yes", "No", "Not sure"],
      ],
      [
        "charger",
        "Does this happen with every compatible charger you have tried?",
        ["Yes", "No", "Not tried", "Not sure"],
      ],
    ];
  if (issue === "Screen or touch problems")
    return [
      [
        "screen",
        "What do you see on the screen?",
        [
          "Completely black",
          "Flickering",
          "Cracks",
          "Lines",
          "Touch not responding",
          "Not sure",
        ],
      ],
      [
        "power",
        "Does the device otherwise appear to turn on?",
        ["Yes", "No", "Not sure"],
      ],
    ];
  if (
    category === "Headphones" &&
    ["One side not working", "Audio or microphone problems"].includes(issue)
  )
    return [
      [
        "side",
        "Which side is affected?",
        ["Left", "Right", "Both", "Microphone only", "Not sure"],
      ],
    ];
  if (issue === "Not turning on")
    return [
      [
        "power",
        "Does any light, sound or vibration appear?",
        ["Yes", "No", "Not sure"],
      ],
    ];
  return [];
}
export function safeOptions(issue) {
  if (["Overheating", "Physical damage"].includes(issue))
    return ["Stopped using the product", "Contacted support", "Other"];
  return [
    "Restarted the product",
    ...(issue === "Battery or charging problems"
      ? ["Checked a compatible charger"]
      : []),
    ...(["Bluetooth connection problems", "Connectivity problems"].includes(
      issue,
    )
      ? ["Checked connection settings"]
      : []),
    "Contacted support",
    "Other",
  ];
}
export function changeAnswer(a, key, value) {
  const next = { ...a, [key]: value };
  if (key === "issue") {
    next.details = {};
    next.actions = [];
    delete next.actionOther;
    delete next.other;
  }
  if (key === "actions" && !value.includes("Other")) delete next.actionOther;
  if (key === "repairs" && value !== "Yes")
    for (const k of ["repairer", "repairWhen", "serviceRecord"]) delete next[k];
  if (key === "damage" && value !== "Yes")
    for (const k of ["damageWhat", "damageWhen"]) delete next[k];
  if (key === "tried" && value !== "Yes") {
    next.actions = [];
    delete next.actionOther;
  }
  return next;
}
export function summarize(category, a) {
  const parts = [
    `Customer reports ${a.issue === "Other" ? a.other || "an unspecified issue" : a.issue || "an unspecified issue"} with their ${category.toLowerCase()}.`,
  ];
  if (a.noticed)
    parts.push(
      a.noticed === "Don't remember"
        ? "The first occurrence date is unknown."
        : `First noticed: ${a.noticed.toLowerCase()}.`,
    );
  if (a.exactDate)
    parts.push(`Customer-reported first occurrence: ${a.exactDate}.`);
  if (a.frequency) parts.push(`Frequency: ${a.frequency.toLowerCase()}.`);
  if (a.usability) parts.push(`Usability: ${a.usability.toLowerCase()}.`);
  if (a.repairs)
    parts.push(
      a.repairs === "No"
        ? "Customer reports no previous repairs."
        : a.repairs === "Not sure"
          ? "Previous repair history is unknown."
          : `Customer reports previous repair; provider: ${a.repairer || "unknown"}; timing: ${a.repairWhen || "unknown"}; service record: ${a.serviceRecord || "unknown"}.`,
    );
  if (a.damage)
    parts.push(
      `Accidental damage: ${a.damage.toLowerCase()}${a.damage === "Yes" ? `; ${a.damageWhat || "details unknown"}; timing: ${a.damageWhen || "unknown"}` : ""}.`,
    );
  if (a.tried)
    parts.push(
      `Troubleshooting: ${a.tried === "Yes" ? [...(a.actions || []), a.actionOther].filter(Boolean).join(", ") || "details unknown" : a.tried.toLowerCase()}.`,
    );
  for (const [key, question] of followups(category, a.issue))
    if (a.details?.[key])
      parts.push(`${question} Customer response: ${a.details[key]}.`);
  if (a.symptoms)
    parts.push(`Additional customer-reported symptoms: ${a.symptoms}.`);
  return parts.join(" ");
}
export function evidenceRequests(a) {
  return [
    [
      "invoice",
      "Purchase invoice",
      "Helps establish the purchase date and seller.",
    ],
    [
      "photo",
      "Product serial/model label",
      "Helps the reviewer check the product identity.",
    ],
    ...(["Screen or touch problems", "Physical damage"].includes(a.issue) ||
    a.damage === "Yes"
      ? [
          [
            "photo",
            "Visible issue photo",
            "Provides visual context; a photo alone cannot verify the cause or operation.",
          ],
        ]
      : []),
    ...(a.repairs === "Yes" && a.serviceRecord !== "No"
      ? [
          [
            "service_record",
            "Previous service receipt",
            "Helps clarify the reported repair history.",
          ],
        ]
      : []),
  ];
}
export function questionnaireErrors(category, a) {
  const errors = [];
  if (!issues[category]?.includes(a.issue))
    errors.push("Choose an issue supported by this product.");
  for (const [key, , options] of core)
    if (!options.includes(a[key]))
      errors.push(
        `Choose an answer for ${key}; unknown answers are available.`,
      );
  if (a.issue === "Other" && !a.other?.trim())
    errors.push("Describe the other issue.");
  if (
    a.repairs === "Yes" &&
    ![
      "Authorized service centre",
      "Independent shop",
      "Self",
      "Not sure",
    ].includes(a.repairer)
  )
    errors.push("Choose who repaired the product.");
  if (
    a.repairs === "Yes" &&
    !["Yes", "No", "Not sure"].includes(a.serviceRecord)
  )
    errors.push("Choose whether a service record is available.");
  for (const [key, , options] of followups(category, a.issue))
    if (!options.includes(a.details?.[key]))
      errors.push(`Choose an answer for ${key}.`);
  const allowed = new Set(followups(category, a.issue).map((q) => q[0]));
  if (Object.keys(a.details || {}).some((k) => !allowed.has(k)))
    errors.push("Remove answers from a different issue.");
  if ((a.actions || []).some((v) => !safeOptions(a.issue).includes(v)))
    errors.push("Choose relevant troubleshooting options.");
  if (a.issue !== "Other" && a.other)
    errors.push("Remove the description from the previous issue.");
  if (
    a.repairs !== "Yes" &&
    ["repairer", "repairWhen", "serviceRecord"].some((k) => a[k])
  )
    errors.push("Remove stale repair answers.");
  if (a.damage !== "Yes" && ["damageWhat", "damageWhen"].some((k) => a[k]))
    errors.push("Remove stale damage answers.");
  if (a.tried !== "Yes" && ((a.actions || []).length || a.actionOther))
    errors.push("Remove stale troubleshooting answers.");
  return errors;
}
