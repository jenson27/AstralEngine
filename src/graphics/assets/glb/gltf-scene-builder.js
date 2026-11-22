import { Material } from "../../material.js";
import { Mesh } from "../../mesh.js";
import {
    ReadIndices,
    ReadPositions,
    ReadUvs,
} from "./gltf-accessor-reader.js";
import { RequireIndex, RequireObject } from "./glb-container-reader.js";

function IdentityMatrix() {
    return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]);
}

function MultiplyMatrices(left, right) {
    const result = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
        for (let row = 0; row < 4; row += 1) {
            result[column * 4 + row] =
                left[row] * right[column * 4] +
                left[4 + row] * right[column * 4 + 1] +
                left[8 + row] * right[column * 4 + 2] +
                left[12 + row] * right[column * 4 + 3];
        }
    }
    return result;
}

function ValidateVector(value, length, fallback, label) {
    const vector = value ?? fallback;
    if (
        !Array.isArray(vector) ||
        vector.length !== length ||
        !vector.every(Number.isFinite)
    ) {
        throw new TypeError(`${label} must contain ${length} finite numbers.`);
    }
    return vector;
}

function ReadNodeTransform(node, nodeIndex) {
    if (node.matrix !== undefined) {
        const values = ValidateVector(node.matrix, 16, null, `Node ${nodeIndex} matrix`);
        if (
            Math.abs(values[3]) > 1e-6 ||
            Math.abs(values[7]) > 1e-6 ||
            Math.abs(values[11]) > 1e-6 ||
            Math.abs(values[15] - 1) > 1e-6
        ) {
            throw new Error(`Node ${nodeIndex} matrix must be an affine transform.`);
        }
        return new Float32Array(values);
    }

    const translation = ValidateVector(node.translation, 3, [0, 0, 0], `Node ${nodeIndex} translation`);
    const rotation = ValidateVector(node.rotation, 4, [0, 0, 0, 1], `Node ${nodeIndex} rotation`);
    const scale = ValidateVector(node.scale, 3, [1, 1, 1], `Node ${nodeIndex} scale`);
    const quaternionLength = Math.hypot(...rotation);
    if (quaternionLength === 0) {
        throw new RangeError(`Node ${nodeIndex} rotation quaternion cannot be zero.`);
    }

    const [rawX, rawY, rawZ, rawW] = rotation;
    const x = rawX / quaternionLength;
    const y = rawY / quaternionLength;
    const z = rawZ / quaternionLength;
    const w = rawW / quaternionLength;
    const xx = x * x;
    const yy = y * y;
    const zz = z * z;
    const xy = x * y;
    const xz = x * z;
    const yz = y * z;
    const wx = w * x;
    const wy = w * y;
    const wz = w * z;
    const matrix = IdentityMatrix();

    matrix[0] = (1 - 2 * (yy + zz)) * scale[0];
    matrix[1] = (2 * (xy + wz)) * scale[0];
    matrix[2] = (2 * (xz - wy)) * scale[0];
    matrix[4] = (2 * (xy - wz)) * scale[1];
    matrix[5] = (1 - 2 * (xx + zz)) * scale[1];
    matrix[6] = (2 * (yz + wx)) * scale[1];
    matrix[8] = (2 * (xz + wy)) * scale[2];
    matrix[9] = (2 * (yz - wx)) * scale[2];
    matrix[10] = (1 - 2 * (xx + yy)) * scale[2];
    matrix[12] = translation[0];
    matrix[13] = translation[1];
    matrix[14] = translation[2];
    return matrix;
}

function ValidateSampler(document, texture, textureIndex) {
    if (texture.sampler === undefined) {
        return "linear-mipmap-linear";
    }

    const samplers = document.samplers ?? [];
    if (!Array.isArray(samplers)) {
        throw new TypeError("GLB samplers must be an array.");
    }
    const sampler = RequireObject(
        samplers[RequireIndex(texture.sampler, samplers.length, `Texture ${textureIndex} sampler`)],
        `Texture ${textureIndex} sampler`,
    );
    const wrapS = sampler.wrapS ?? 10497;
    const wrapT = sampler.wrapT ?? 10497;
    const magFilter = sampler.magFilter ?? 9729;
    const minFilter = sampler.minFilter ?? 9987;
    if (
        wrapS !== 10497 ||
        wrapT !== 10497 ||
        magFilter !== 9729 ||
        ![9729, 9987].includes(minFilter)
    ) {
        throw new Error(
            `Texture ${textureIndex} uses sampler settings that are not supported.`,
        );
    }
    return minFilter === 9729 ? "linear" : "linear-mipmap-linear";
}

function ValidateMaterial(materialDefinition, materialIndex) {
    const alphaMode = materialDefinition.alphaMode ?? "OPAQUE";
    if (alphaMode !== "OPAQUE") {
        throw new Error(
            `Material ${materialIndex} uses unsupported alpha mode "${alphaMode}".`,
        );
    }

    const pbr = materialDefinition.pbrMetallicRoughness ?? {};
    RequireObject(pbr, `Material ${materialIndex} PBR data`);
    const baseColorFactor = ValidateVector(
        pbr.baseColorFactor,
        4,
        [1, 1, 1, 1],
        `Material ${materialIndex} baseColorFactor`,
    );
    if (baseColorFactor.some((value) => value < 0 || value > 1)) {
        throw new RangeError(
            `Material ${materialIndex} baseColorFactor values must be from 0 to 1.`,
        );
    }

    return { pbr, baseColorFactor };
}

async function ReadBaseColorTexture(context, pbr, materialIndex) {
    if (pbr.baseColorTexture === undefined) {
        return {
            texture: null,
            minFilter: "linear-mipmap-linear",
        };
    }

    const textureInfo = RequireObject(
        pbr.baseColorTexture,
        `Material ${materialIndex} baseColorTexture`,
    );
    if ((textureInfo.texCoord ?? 0) !== 0) {
        throw new Error(
            `Material ${materialIndex} uses an unsupported base color texture coordinate set.`,
        );
    }

    const textures = context.document.textures ?? [];
    if (!Array.isArray(textures)) {
        throw new TypeError("GLB textures must be an array.");
    }
    const textureIndex = RequireIndex(
        textureInfo.index,
        textures.length,
        `Material ${materialIndex} base color texture`,
    );
    const texture = RequireObject(textures[textureIndex], `Texture ${textureIndex}`);
    const minFilter = ValidateSampler(context.document, texture, textureIndex);
    const imageDefinitions = context.document.images ?? [];
    if (!Array.isArray(imageDefinitions)) {
        throw new TypeError("GLB images must be an array.");
    }
    const imageIndex = RequireIndex(
        texture.source,
        imageDefinitions.length,
        `Texture ${textureIndex} image`,
    );

    return {
        texture: await context.loadImage(imageIndex),
        minFilter,
    };
}

function CreateMaterialResolver(context) {
    const materialsByIndex = new Map();
    let defaultMaterial = null;

    return async function ResolveMaterial(materialIndex) {
        if (materialIndex === undefined) {
            if (!defaultMaterial) {
                defaultMaterial = new Material(null, { name: "Default" });
            }
            return defaultMaterial;
        }
        if (materialsByIndex.has(materialIndex)) {
            return materialsByIndex.get(materialIndex);
        }

        const materials = context.document.materials ?? [];
        if (!Array.isArray(materials)) {
            throw new TypeError("GLB materials must be an array.");
        }
        const materialDefinition = RequireObject(
            materials[RequireIndex(materialIndex, materials.length, "Material")],
            `Material ${materialIndex}`,
        );
        const { pbr, baseColorFactor } = ValidateMaterial(
            materialDefinition,
            materialIndex,
        );
        const { texture, minFilter } = await ReadBaseColorTexture(
            context,
            pbr,
            materialIndex,
        );
        const material = new Material(texture, {
            baseColorFactor,
            baseColorMinFilter: minFilter,
            name: materialDefinition.name ?? `Material ${materialIndex}`,
        });
        materialsByIndex.set(materialIndex, material);
        return material;
    };
}

function ValidateMeshPrimitive(primitive, meshIndex, primitiveIndex) {
    if ((primitive.mode ?? 4) !== 4) {
        throw new Error(
            `Mesh ${meshIndex} primitive ${primitiveIndex} is not a triangle list.`,
        );
    }
    if (primitive.targets?.length) {
        throw new Error(
            `Mesh ${meshIndex} primitive ${primitiveIndex} uses morph targets, which are not supported.`,
        );
    }
    if (primitive.extensions?.KHR_draco_mesh_compression) {
        throw new Error(
            `Mesh ${meshIndex} primitive ${primitiveIndex} uses unsupported Draco compression.`,
        );
    }
}

function GetOrCreatePrimitiveMesh(context, meshIndex, primitiveIndex, primitive) {
    let cachedMeshes = context.meshesByIndex.get(meshIndex);
    if (!cachedMeshes) {
        cachedMeshes = [];
        context.meshesByIndex.set(meshIndex, cachedMeshes);
    }
    if (cachedMeshes[primitiveIndex]) {
        return cachedMeshes[primitiveIndex];
    }

    const attributes = RequireObject(
        primitive.attributes,
        `Mesh ${meshIndex} primitive ${primitiveIndex} attributes`,
    );
    if (attributes.COLOR_0 !== undefined) {
        throw new Error(
            `Mesh ${meshIndex} primitive ${primitiveIndex} uses unsupported vertex colors.`,
        );
    }
    const positions = ReadPositions(
        context.document,
        context.buffers,
        attributes.POSITION,
    );
    const vertexCount = positions.length / 3;
    const uvs = ReadUvs(
        context.document,
        context.buffers,
        attributes.TEXCOORD_0,
        vertexCount,
    );
    const indices = ReadIndices(
        context.document,
        context.buffers,
        primitive.indices,
        vertexCount,
    );
    const mesh = new Mesh(positions, uvs, null, indices);
    cachedMeshes[primitiveIndex] = mesh;
    return mesh;
}

async function AppendMeshPrimitives(context, nodeIndex, meshIndex, worldTransform) {
    const meshes = context.document.meshes ?? [];
    if (!Array.isArray(meshes)) {
        throw new TypeError("GLB meshes must be an array.");
    }
    const definitionIndex = RequireIndex(meshIndex, meshes.length, `Node ${nodeIndex} mesh`);
    const meshDefinition = RequireObject(meshes[definitionIndex], `Mesh ${definitionIndex}`);
    if (meshDefinition.weights !== undefined) {
        throw new Error(`Mesh ${definitionIndex} morph weights are not supported.`);
    }
    if (!Array.isArray(meshDefinition.primitives) || meshDefinition.primitives.length === 0) {
        throw new Error(`Mesh ${definitionIndex} must contain at least one primitive.`);
    }

    for (let primitiveIndex = 0; primitiveIndex < meshDefinition.primitives.length; primitiveIndex += 1) {
        const primitive = RequireObject(
            meshDefinition.primitives[primitiveIndex],
            `Mesh ${definitionIndex} primitive ${primitiveIndex}`,
        );
        ValidateMeshPrimitive(primitive, definitionIndex, primitiveIndex);
        const mesh = GetOrCreatePrimitiveMesh(
            context,
            definitionIndex,
            primitiveIndex,
            primitive,
        );
        const material = await context.resolveMaterial(primitive.material);
        context.primitives.push({
            mesh,
            material,
            transform: worldTransform,
        });
    }
}

async function VisitNode(context, nodeIndex, parentTransform) {
    const index = RequireIndex(nodeIndex, context.nodes.length, "Node");
    if (context.activeNodes.has(index)) {
        throw new Error(`GLB node hierarchy contains a cycle at node ${index}.`);
    }
    if (context.visitedNodes.has(index)) {
        throw new Error(`GLB node ${index} is referenced more than once in the default scene.`);
    }
    context.activeNodes.add(index);
    context.visitedNodes.add(index);

    const node = RequireObject(context.nodes[index], `Node ${index}`);
    const worldTransform = MultiplyMatrices(
        parentTransform,
        ReadNodeTransform(node, index),
    );
    if (node.skin !== undefined) {
        throw new Error(`Node ${index} uses skinning, which is not supported.`);
    }

    if (node.camera !== undefined) {
        context.onWarning("Skipping unsupported GLB camera node.", {
            nodeIndex: index,
        });
    }
    if (node.extensions?.KHR_lights_punctual !== undefined) {
        context.onWarning("Skipping unsupported GLB light node.", {
            nodeIndex: index,
        });
    }

    if (node.mesh !== undefined) {
        await AppendMeshPrimitives(context, index, node.mesh, worldTransform);
    }

    if (node.children !== undefined && !Array.isArray(node.children)) {
        throw new TypeError(`Node ${index} children must be an array.`);
    }
    for (const childIndex of node.children ?? []) {
        await VisitNode(context, childIndex, worldTransform);
    }

    context.activeNodes.delete(index);
}

export function ValidateGlbDocument(document) {
    if (
        document.animations !== undefined &&
        !Array.isArray(document.animations)
    ) {
        throw new TypeError("GLB animations must be an array.");
    }
    if (document.animations?.length > 0) {
        throw new Error("GLB animations are not supported by the static model loader.");
    }

    const requiredExtensions = document.extensionsRequired ?? [];
    if (!Array.isArray(requiredExtensions)) {
        throw new TypeError("GLB extensionsRequired must be an array.");
    }
    const unsupportedRequiredExtensions = requiredExtensions.filter(
        (extension) => extension !== "KHR_materials_unlit",
    );
    if (unsupportedRequiredExtensions.length > 0) {
        throw new Error(
            "GLB requires unsupported extensions: " +
                unsupportedRequiredExtensions.join(", ") + ".",
        );
    }

    if (!Array.isArray(document.scenes) || document.scenes.length === 0) {
        throw new Error("GLB must define at least one scene.");
    }
    if (!Array.isArray(document.nodes) || document.nodes.length === 0) {
        throw new Error("GLB scene must define at least one node.");
    }
}

export async function BuildGlbScene({
    document,
    buffers,
    loadImage,
    onWarning = () => {},
}) {
    if (typeof loadImage !== "function") {
        throw new TypeError("GLB scene builder requires an image loader function.");
    }

    const sceneIndex = document.scene ?? 0;
    const scenes = document.scenes;
    const scene = RequireObject(
        scenes[RequireIndex(sceneIndex, scenes.length, "Default scene")],
        "Default scene",
    );
    if (!Array.isArray(scene.nodes) || scene.nodes.length === 0) {
        throw new Error("GLB default scene has no root nodes.");
    }

    const context = {
        document,
        buffers,
        loadImage,
        onWarning,
        nodes: document.nodes,
        primitives: [],
        meshesByIndex: new Map(),
        visitedNodes: new Set(),
        activeNodes: new Set(),
        resolveMaterial: null,
    };
    context.resolveMaterial = CreateMaterialResolver(context);

    for (const rootNodeIndex of scene.nodes) {
        await VisitNode(context, rootNodeIndex, IdentityMatrix());
    }

    if (context.primitives.length === 0) {
        throw new Error("GLB default scene contains no supported static mesh primitives.");
    }
    return context.primitives;
}
