import { Transform } from "../../../../components/transform.js";
import { CreateVectorFields } from "../field-controls.js";
import {
    AreDataValuesEqual,
    DegreesToRadians,
    RadiansToDegrees,
} from "../component-value-utils.js";

function CopyTransformValues(transform) {
    return {
        position: [...transform.position],
        rotation: [...transform.rotation],
        scale: [...transform.scale],
    };
}

function GetFieldAddress(fieldId) {
    const [, vectorName, axisText] = fieldId.split(".");
    return { vectorName, axis: Number(axisText) };
}

function Render(container, { component }) {
    CreateVectorFields(container, "Position", component.position, "transform.position");
    CreateVectorFields(
        container,
        "Rotation (degrees)",
        component.rotation,
        "transform.rotation",
        RadiansToDegrees,
    );
    CreateVectorFields(container, "Scale", component.scale, "transform.scale");
}

function Apply({ scene, entityId, component, input, fieldId, readNumber }) {
    const values = CopyTransformValues(component);
    const { vectorName, axis } = GetFieldAddress(fieldId);
    const value = readNumber(input);
    values[vectorName][axis] =
        vectorName === "rotation" ? DegreesToRadians(value) : value;
    scene.SetTransform(entityId, values);
}

function Restore({ scene, entityId, component, fieldId, value }) {
    const values = CopyTransformValues(component);
    const { vectorName, axis } = GetFieldAddress(fieldId);
    values[vectorName][axis] = value[vectorName][axis];
    scene.SetTransform(entityId, values);
}

function Sync({ component }) {
    const values = {};
    for (const vectorName of ["position", "rotation", "scale"]) {
        for (let axis = 0; axis < 3; axis += 1) {
            const value = component[vectorName][axis];
            values[`transform.${vectorName}.${axis}`] =
                vectorName === "rotation" ? RadiansToDegrees(value) : value;
        }
    }
    return values;
}

function GetEditLabel(fieldId) {
    const { vectorName, axis } = GetFieldAddress(fieldId);
    return `Change Transform ${vectorName} ${["X", "Y", "Z"][axis]}`;
}

export const TransformInspector = {
    title: "Transform",
    canDisable: false,
    fieldPrefix: "transform.",
    render: Render,
    apply: Apply,
    capture: ({ component }) => CopyTransformValues(component),
    restore: Restore,
    sync: Sync,
    equals: AreDataValuesEqual,
    getEditLabel: GetEditLabel,
};

TransformInspector.componentType = Transform;
