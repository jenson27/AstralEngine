import { Parent } from "../../../../components/parent.js";
import { CreateReadOnlyField } from "../field-controls.js";

function Render(container, { component }) {
    CreateReadOnlyField(container, "Parent entity", component.ParentEntityId);
}

export const ParentInspector = {
    title: "Parent",
    canDisable: false,
    render: Render,
};

ParentInspector.componentType = Parent;
