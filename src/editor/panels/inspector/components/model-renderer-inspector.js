import { ModelRenderer } from "../../../../components/graphics/model-renderer.js";
import { CreateAssetSelectField } from "../../../ui/asset-select-field.js";
import {
    CreateFieldError,
    CreateReadOnlyField,
} from "../field-controls.js";

const MODEL_FIELD_ID = "modelRenderer.modelAssetId";

function Render(container, { component, assetAccess }) {
    const options = assetAccess.GetOptions("model");
    if (options.length > 0) {
        const select = CreateAssetSelectField(
            container,
            "Model asset",
            options,
            { selectedValue: component.ModelHandle.AssetId },
        );
        select.dataset.inspectorField = MODEL_FIELD_ID;
        select.parentElement.append(CreateFieldError(MODEL_FIELD_ID));
        return;
    }

    CreateReadOnlyField(
        container,
        "Model asset",
        component.ModelHandle.AssetId,
    );
}

async function PrepareApply({ component, input, assetAccess }) {
    assetAccess.RequireType(input.value, "model");
    const modelHandle = await assetAccess.AcquireHandle(input.value);
    return {
        Commit() {
            component.SetModelHandle(modelHandle);
        },
    };
}

function RestoreInput({ component, input }) {
    if (input.isConnected) {
        input.value = component.ModelHandle.AssetId;
    }
}

export const ModelRendererInspector = {
    title: "Model Renderer",
    fieldPrefix: "modelRenderer.",
    render: Render,
    prepareApply: PrepareApply,
    capture: ({ component }) => component.ModelHandle,
    restore: ({ component, value }) => component.SetModelHandle(value),
    restoreInput: RestoreInput,
    sync: ({ component }) => ({
        [MODEL_FIELD_ID]: component.ModelHandle.AssetId,
    }),
    equals: (left, right) => left === right,
    getEditLabel: () => "Change model asset",
};

ModelRendererInspector.componentType = ModelRenderer;
