import React from "react";
import {
  issues,
  core,
  followups,
  safeOptions,
} from "../../../shared/questionnaire.js";
export const emptyAnswers = () => ({
  version: 1,
  issue: "",
  details: {},
  actions: [],
});
function Choice({ id, title, options, value, onChange }) {
  return (
    <fieldset className="question-group">
      <legend>{title}</legend>
      <div className="answer-options">
        {options.map((option) => (
          <label
            key={option}
            className={value === option ? "answer selected" : "answer"}
          >
            <input
              type="radio"
              name={id}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              required
            />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
export default function ProblemQuestions({
  category,
  answers: a,
  onChange: set,
}) {
  const text = (
    key,
    title,
    placeholder = "Optional — leave blank if unknown",
  ) => (
    <label>
      {title}
      <input
        value={a[key] || ""}
        maxLength={1000}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  return (
    <div className="problem-questions">
      <label>
        What problem are you experiencing?
        <select
          required
          value={a.issue}
          onChange={(e) => set("issue", e.target.value)}
        >
          <option value="">Select a problem</option>
          {(issues[category] || []).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      {a.issue === "Other" &&
        text("other", "Describe the problem", "Tell us what is happening")}
      {core.map(([id, title, options]) => (
        <React.Fragment key={id}>
          <Choice
            id={id}
            title={title}
            options={options}
            value={a[id]}
            onChange={(v) => set(id, v)}
          />
          {id === "noticed" && (
            <label>
              Exact date, if known
              <input
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={a.exactDate || ""}
                onChange={(e) => set("exactDate", e.target.value || undefined)}
              />
            </label>
          )}
          {id === "repairs" && a.repairs === "Yes" && (
            <div className="conditional-questions">
              <Choice
                id="repairer"
                title="Who repaired it?"
                options={[
                  "Authorized service centre",
                  "Independent shop",
                  "Self",
                  "Not sure",
                ]}
                value={a.repairer}
                onChange={(v) => set("repairer", v)}
              />
              {text("repairWhen", "Approximately when was it repaired?")}
              <Choice
                id="serviceRecord"
                title="Do you have a service receipt or record?"
                options={["Yes", "No", "Not sure"]}
                value={a.serviceRecord}
                onChange={(v) => set("serviceRecord", v)}
              />
            </div>
          )}
          {id === "damage" && a.damage === "Yes" && (
            <div className="conditional-questions">
              {text(
                "damageWhat",
                "What happened? Describe only what you know.",
              )}
              {text("damageWhen", "Approximately when?")}
            </div>
          )}
          {id === "tried" && a.tried === "Yes" && (
            <div className="conditional-questions">
              <p>
                Select only things you have already tried. Do not open the
                device or continue using equipment that seems unsafe.
              </p>
              {safeOptions(a.issue).map((v) => (
                <label key={v} className="answer">
                  <input
                    type="checkbox"
                    checked={a.actions.includes(v)}
                    onChange={(e) =>
                      set(
                        "actions",
                        e.target.checked
                          ? [...a.actions, v]
                          : a.actions.filter((x) => x !== v),
                      )
                    }
                  />
                  {v}
                </label>
              ))}
              {a.actions.includes("Other") &&
                text("actionOther", "What else have you tried?")}
            </div>
          )}
        </React.Fragment>
      ))}
      {followups(category, a.issue).map(([id, title, options]) => (
        <Choice
          key={id}
          id={id}
          title={title}
          options={options}
          value={a.details[id]}
          onChange={(v) => set("details", { ...a.details, [id]: v })}
        />
      ))}
      {text(
        "symptoms",
        "Any additional symptoms?",
        "Optional — include anything else relevant",
      )}
    </div>
  );
}
