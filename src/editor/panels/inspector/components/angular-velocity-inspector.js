import { AngularVelocity } from "../../../../components/angular-velocity.js";
import { CreateField } from "../field-controls.js";
import { AreDataValuesEqual } from "../component-value-utils.js";

function CopyValues(component) {
    return { x: component.x, y: component.y, z: component.z };
}

function Render(container, { component }) {
    for (const axis of ["x", "y", "z"]) {
        CreateField(
            container,
            `${axis.toUpperCase()} (radians/second)`,
            `angularVelocity.${axis}`,
            component[axis],
        );
    }
}

function Apply({ component, input, fieldId, readNumber }) {
    const values = CopyValues(component);
    values[fieldId.slice("angularVelocity.".length)] = readNumber(input);
    component.SetValues(values.x, values.y, values.z);
}

function GetEditLabel(fieldId) {
    return `Change angular velocity ${fieldId.slice(-1).toUpperCase()}`;
}

export const AngularVelocityInspector = {
    title: "Angular Velocity",
    fieldPrefix: "angularVelocity.",
    render: Render,
    apply: Apply,
    capture: ({ component }) => CopyValues(component),
    restore: ({ component, value }) =>
        component.SetValues(value.x, value.y, value.z),
    sync: ({ component }) => CopyValues(component),
    equals: AreDataValuesEqual,
    getEditLabel: GetEditLabel,
};

AngularVelocityInspector.componentType = AngularVelocity;
