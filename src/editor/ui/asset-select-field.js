import { CreateElement } from "./dom-utils.js";

export function CreateAssetSelectField(
    container,
    labelText,
    options,
    { selectedValue = "", placeholderText = null } = {},
) {
    const label = CreateElement("label", "editor-asset-select-field");
    const caption = CreateElement("span", "editor-asset-select-label");
    caption.textContent = labelText;

    const select = document.createElement("select");
    if (placeholderText !== null) {
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = placeholderText;
        placeholder.selected = selectedValue === "";
        select.append(placeholder);
    }

    for (const [optionValue, optionLabel] of options) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = optionLabel;
        select.append(option);
    }

    select.value = selectedValue;
    label.append(caption, select);
    container.append(label);
    return select;
}
