import { MeshRenderer } from "../../../../components/graphics/mesh-renderer.js";
import { CreateAssetSelectField } from "../../../ui/asset-select-field.js";
import {
    CreateFieldError,
    CreateReadOnlyField,
} from "../field-controls.js";

const MESH_FIELD_ID = "meshRenderer.meshAssetId";
const MATERIAL_FIELD_PREFIX = "meshRenderer.material.";

function GetFieldTarget(fieldId) {
    if (fieldId === MESH_FIELD_ID) {
        return { type: "mesh", materialSlot: null };
    }
    if (!fieldId.startsWith(MATERIAL_FIELD_PREFIX)) {
        return null;
    }

    return {
        type: "material",
        materialSlot: decodeURIComponent(
            fieldId.slice(MATERIAL_FIELD_PREFIX.length),
        ),
    };
}

function GetMaterialFieldId(materialSlot) {
    return `${MATERIAL_FIELD_PREFIX}${encodeURIComponent(materialSlot)}`;
}

function Capture(component) {
    return {
        meshHandle: component.MeshHandle,
        materialHandlesBySlot: { ...component.MaterialHandlesBySlot },
    };
}

function RenderAssetField(container, label, fieldId, assetId, options) {
    if (options.length > 0) {
        const select = CreateAssetSelectField(container, label, options, {
            selectedValue: assetId,
        });
        select.dataset.inspectorField = fieldId;
        select.parentElement.append(CreateFieldError(fieldId));
        return;
    }

    CreateReadOnlyField(container, label, assetId);
}

function Render(container, { component, assetAccess }) {
    RenderAssetField(
        container,
        "Mesh asset",
        MESH_FIELD_ID,
        component.MeshHandle.AssetId,
        assetAccess.GetOptions("mesh"),
    );

    const materialOptions = assetAccess.GetOptions("material");
    for (const [slot, handle] of Object.entries(
        component.MaterialHandlesBySlot,
    )) {
        RenderAssetField(
            container,
            `Material · ${slot}`,
            GetMaterialFieldId(slot),
            handle.AssetId,
            materialOptions,
        );
    }
}

function ApplyMeshAsset(component, assetHandle) {
    const currentMaterials = component.MaterialHandlesBySlot;
    const fallbackMaterial = Object.values(currentMaterials)[0];
    const nextMaterials = Object.fromEntries(
        assetHandle.Current.Submeshes.map(({ materialSlot }) => [
            materialSlot,
            currentMaterials[materialSlot] ?? fallbackMaterial,
        ]),
    );

    component.SetAssets(assetHandle, nextMaterials);
}

function ApplyMaterialAsset(component, materialSlot, assetHandle) {
    const nextMaterials = { ...component.MaterialHandlesBySlot };
    if (!Object.hasOwn(nextMaterials, materialSlot)) {
        throw new Error(
            `Mesh Renderer has no material slot named "${materialSlot}".`,
        );
    }

    nextMaterials[materialSlot] = assetHandle;
    component.SetAssets(component.MeshHandle, nextMaterials);
}

async function PrepareApply({
    component,
    input,
    fieldId,
    assetAccess,
}) {
    const target = GetFieldTarget(fieldId);
    if (!target) {
        throw new Error("Unknown Mesh Renderer field.");
    }

    const assetType = target.type === "mesh" ? "mesh" : "material";
    assetAccess.RequireType(input.value, assetType);
    const assetHandle = await assetAccess.AcquireHandle(input.value);

    return {
        Commit() {
            if (target.type === "mesh") {
                ApplyMeshAsset(component, assetHandle);
                return;
            }

            ApplyMaterialAsset(component, target.materialSlot, assetHandle);
        },
    };
}

function RestoreInput({ component, input, fieldId }) {
    if (!input.isConnected) {
        return;
    }

    try {
        const target = GetFieldTarget(fieldId);
        if (target?.type === "mesh") {
            input.value = component.MeshHandle.AssetId;
        } else if (target?.type === "material") {
            input.value =
                component.GetMaterialHandleForSlot(target.materialSlot)?.AssetId ??
                "";
        }
    } catch {
        // The entity may have been removed while the asset was loading.
    }
}

function GetValues(component) {
    const values = new Map([[MESH_FIELD_ID, component.MeshHandle.AssetId]]);
    for (const [slot, handle] of Object.entries(
        component.MaterialHandlesBySlot,
    )) {
        values.set(GetMaterialFieldId(slot), handle.AssetId);
    }
    return values;
}

function AreStatesEqual(left, right) {
    const previousMaterials = left.materialHandlesBySlot;
    const nextMaterials = right.materialHandlesBySlot;
    const slots = Object.keys(previousMaterials);
    return (
        left.meshHandle === right.meshHandle &&
        slots.length === Object.keys(nextMaterials).length &&
        slots.every((slot) => previousMaterials[slot] === nextMaterials[slot])
    );
}

function GetEditLabel(fieldId) {
    const target = GetFieldTarget(fieldId);
    if (target?.type === "mesh") {
        return "Change mesh asset";
    }
    if (target?.type === "material") {
        return `Change material ${target.materialSlot}`;
    }
    return `Edit ${fieldId}`;
}

export const MeshRendererInspector = {
    title: "Mesh Renderer",
    fieldPrefix: "meshRenderer.",
    refreshOnChange: [MESH_FIELD_ID],
    render: Render,
    prepareApply: PrepareApply,
    capture: ({ component }) => Capture(component),
    restore: ({ component, value }) =>
        component.SetAssets(value.meshHandle, value.materialHandlesBySlot),
    restoreInput: RestoreInput,
    sync: ({ component }) => GetValues(component),
    equals: AreStatesEqual,
    getEditLabel: GetEditLabel,
};

MeshRendererInspector.componentType = MeshRenderer;
