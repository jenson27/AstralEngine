import { CreateElement } from "../../ui/dom-utils.js";

export function CreateFieldError(fieldId) {
    const error = CreateElement("span", "inspector-field-error");
    error.dataset.errorFor = fieldId;
    error.setAttribute("aria-live", "polite");
    return error;
}

function CreateLabeledControl(container, labelText, fieldId, control) {
    const label = CreateElement("label", "inspector-field");
    const caption = CreateElement("span", "inspector-field-label");
    caption.textContent = labelText;
    label.append(caption, control, CreateFieldError(fieldId));
    container.append(label);
    return control;
}

export function CreateField(
    container,
    labelText,
    fieldId,
    value,
    type = "number",
) {
    const input = document.createElement("input");
    input.type = type;
    input.dataset.inspectorField = fieldId;
    if (type === "number") {
        input.step = "any";
        input.value = String(value);
    } else if (type === "text") {
        input.value = value;
    }

    return CreateLabeledControl(container, labelText, fieldId, input);
}

export function CreateSelect(container, labelText, fieldId, value, options) {
    const select = document.createElement("select");
    select.dataset.inspectorField = fieldId;
    for (const [optionValue, optionLabel] of options) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionLabel;
        select.append(option);
    }
    select.value = value;

    return CreateLabeledControl(container, labelText, fieldId, select);
}

export function CreateVectorFields(
    container,
    title,
    vector,
    fieldName,
    formatValue = (value) => value,
) {
    const group = CreateElement("fieldset", "inspector-vector");
    const legend = document.createElement("legend");
    legend.textContent = title;
    group.append(legend);

    for (let axis = 0; axis < 3; axis += 1) {
        CreateField(
            group,
            ["X", "Y", "Z"][axis],
            `${fieldName}.${axis}`,
            formatValue(vector[axis]),
        );
    }

    container.append(group);
}

export function CreateReadOnlyField(container, labelText, value) {
    const row = CreateElement("div", "inspector-readonly-field");
    const label = CreateElement("span", "inspector-field-label");
    label.textContent = labelText;
    const output = document.createElement("output");
    output.textContent = value;
    row.append(label, output);
    container.append(row);
}

export function CreateConditionalGroup(
    container,
    fieldId,
    expectedValue,
) {
    const group = CreateElement("div", "inspector-projection-fields");
    group.dataset.inspectorConditionField = fieldId;
    group.dataset.inspectorConditionValue = expectedValue;
    container.append(group);
    return group;
}
