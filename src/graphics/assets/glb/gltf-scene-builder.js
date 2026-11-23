import { Material } from "../../material.js";
import { Mesh } from "../../mesh.js";
import {
    ReadColors,
    ReadIndices,
    ReadNormals,
    ReadPositions,
    ReadUvs,
} from "./gltf-accessor-reader.js";
import { RequireIndex, RequireObject } from "./glb-container-reader.js";

const SUPPORTED_EXTENSIONS = new Set([
    "KHR_materials_unlit",
    "KHR_lights_punctual",
]);
const SUPPORTED_REQUIRED_EXTENSIONS = new Set([
    "KHR_materials_unlit",
]);
const UNSUPPORTED_PRIMITIVE_MODES = new Set([0, 1, 2, 3]);

function IdentityMatrix() {
    return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]);
}

function ScaleMatrix(scale) {
    const matrix = IdentityMatrix();
    matrix[0] = scale;
    matrix[5] = scale;
    matrix[10] = scale;
    return matrix;
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
        if (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined) {
            throw new Error(`Node ${nodeIndex} must use either matrix or TRS values, not both.`);
        }
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

function ReadSampler(document, texture, textureIndex) {
    const samplers = document.samplers ?? [];
    if (!Array.isArray(samplers)) {
        throw new TypeError("GLB samplers must be an array.");
    }
    const samplerDefinition = texture.sampler === undefined
        ? {}
        : RequireObject(
            samplers[RequireIndex(
                texture.sampler,
                samplers.length,
                `Texture ${textureIndex} sampler`,
            )],
            `Texture ${textureIndex} sampler`,
        );
    const wrapModes = new Map([
        [10497, "repeat"],
        [33071, "clamp-to-edge"],
        [33648, "mirror-repeat"],
    ]);
    const wrapS = samplerDefinition.wrapS ?? 10497;
    const wrapT = samplerDefinition.wrapT ?? 10497;
    const magFilter = samplerDefinition.magFilter ?? 9729;
    const minFilter = samplerDefinition.minFilter ?? 9987;
    const minModes = new Map([
        [9728, { minFilter: "nearest", mipmapFilter: "nearest", mipmaps: false }],
        [9729, { minFilter: "linear", mipmapFilter: "nearest", mipmaps: false }],
        [9984, { minFilter: "nearest", mipmapFilter: "nearest", mipmaps: true }],
        [9985, { minFilter: "linear", mipmapFilter: "nearest", mipmaps: true }],
        [9986, { minFilter: "nearest", mipmapFilter: "linear", mipmaps: true }],
        [9987, { minFilter: "linear", mipmapFilter: "linear", mipmaps: true }],
    ]);
    if (!wrapModes.has(wrapS) || !wrapModes.has(wrapT) || ![9728, 9729].includes(magFilter) || !minModes.has(minFilter)) {
        throw new Error(`Texture ${textureIndex} uses invalid or unsupported sampler settings.`);
    }
    return Object.freeze({
        addressModeU: wrapModes.get(wrapS),
        addressModeV: wrapModes.get(wrapT),
        magFilter: magFilter === 9728 ? "nearest" : "linear",
        ...minModes.get(minFilter),
    });
}

async function ReadTexture(context, textureInfo, label, materialIndex) {
    const textureCoordinateSet = textureInfo.texCoord ?? 0;
    if (!Number.isSafeInteger(textureCoordinateSet) || textureCoordinateSet < 0 || textureCoordinateSet > 1) {
        throw new Error(`Material ${materialIndex} ${label} needs unsupported texture coordinate set ${textureCoordinateSet}.`);
    }
    const textures = context.document.textures ?? [];
    if (!Array.isArray(textures)) {
        throw new TypeError("GLB textures must be an array.");
    }
    const textureIndex = RequireIndex(
        textureInfo.index,
        textures.length,
        `Material ${materialIndex} ${label}`,
    );
    const texture = RequireObject(textures[textureIndex], `Texture ${textureIndex}`);
    if (texture.extensions?.KHR_texture_basisu && texture.source === undefined) {
        throw new Error(`Texture ${textureIndex} requires KHR_texture_basisu and has no core image fallback.`);
    }
    const images = context.document.images ?? [];
    if (!Array.isArray(images)) {
        throw new TypeError("GLB images must be an array.");
    }
    const imageIndex = RequireIndex(texture.source, images.length, `Texture ${textureIndex} image`);
    return {
        texture: await context.loadImage(imageIndex),
        sampler: ReadSampler(context.document, texture, textureIndex),
        texCoord: textureCoordinateSet,
    };
}

function ValidateMaterial(materialDefinition, materialIndex) {
    const alphaMode = materialDefinition.alphaMode ?? "OPAQUE";
    if (alphaMode === "BLEND") {
        throw new Error(`Material ${materialIndex} uses BLEND alpha, which is not supported by the static renderer.`);
    }
    if (!(["OPAQUE", "MASK"].includes(alphaMode))) {
        throw new Error(`Material ${materialIndex} uses unsupported alpha mode "${alphaMode}".`);
    }
    const alphaCutoff = materialDefinition.alphaCutoff ?? 0.5;
    if (!Number.isFinite(alphaCutoff) || alphaCutoff < 0 || alphaCutoff > 1) {
        throw new RangeError(`Material ${materialIndex} alphaCutoff must be from 0 to 1.`);
    }
    const pbr = materialDefinition.pbrMetallicRoughness ?? {};
    RequireObject(pbr, `Material ${materialIndex} PBR data`);
    const baseColorFactor = ValidateVector(pbr.baseColorFactor, 4, [1, 1, 1, 1], `Material ${materialIndex} baseColorFactor`);
    if (baseColorFactor.some((value) => value < 0 || value > 1)) {
        throw new RangeError(`Material ${materialIndex} baseColorFactor values must be from 0 to 1.`);
    }
    const metallicFactor = pbr.metallicFactor ?? 1;
    const roughnessFactor = pbr.roughnessFactor ?? 1;
    if (!Number.isFinite(metallicFactor) || metallicFactor < 0 || metallicFactor > 1) {
        throw new RangeError(`Material ${materialIndex} metallicFactor must be from 0 to 1.`);
    }
    if (!Number.isFinite(roughnessFactor) || roughnessFactor < 0 || roughnessFactor > 1) {
        throw new RangeError(`Material ${materialIndex} roughnessFactor must be from 0 to 1.`);
    }
    const extensions = materialDefinition.extensions ?? {};
    RequireObject(extensions, `Material ${materialIndex} extensions`);
    return {
        pbr,
        baseColorFactor,
        metallicFactor,
        roughnessFactor,
        alphaMode,
        alphaCutoff,
        unlit: Object.hasOwn(extensions, "KHR_materials_unlit"),
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
        const materialData = ValidateMaterial(materialDefinition, materialIndex);
        for (const property of ["normalTexture", "occlusionTexture", "emissiveTexture", "emissiveFactor"]) {
            if (materialDefinition[property] !== undefined) {
                context.onWarning(`Ignoring unsupported GLB material property "${property}".`, { materialIndex });
            }
        }
        for (const extensionName of Object.keys(materialDefinition.extensions ?? {})) {
            if (!SUPPORTED_EXTENSIONS.has(extensionName)) {
                context.onWarning(`Ignoring unsupported optional GLB material extension "${extensionName}".`, { materialIndex });
            }
        }
        const baseColor = materialData.pbr.baseColorTexture === undefined
            ? { texture: null, sampler: undefined, texCoord: 0 }
            : await ReadTexture(context, materialData.pbr.baseColorTexture, "base color texture", materialIndex);
        const metallicRoughness = materialData.pbr.metallicRoughnessTexture === undefined
            ? { texture: null, sampler: undefined, texCoord: 0 }
            : await ReadTexture(context, materialData.pbr.metallicRoughnessTexture, "metallic-roughness texture", materialIndex);
        const material = new Material(baseColor.texture, {
            baseColorFactor: materialData.baseColorFactor,
            baseColorSampler: baseColor.sampler,
            baseColorTexCoord: baseColor.texCoord,
            metallicFactor: materialData.metallicFactor,
            roughnessFactor: materialData.roughnessFactor,
            metallicRoughnessTexture: metallicRoughness.texture,
            metallicRoughnessSampler: metallicRoughness.sampler,
            metallicRoughnessTexCoord: metallicRoughness.texCoord,
            alphaMode: materialData.alphaMode,
            alphaCutoff: materialData.alphaCutoff,
            unlit: materialData.unlit,
            name: materialDefinition.name ?? `Material ${materialIndex}`,
        });
        materialsByIndex.set(materialIndex, material);
        return material;
    };
}

function ValidateMeshPrimitive(primitive, meshIndex, primitiveIndex) {
    const mode = primitive.mode ?? 4;
    if (UNSUPPORTED_PRIMITIVE_MODES.has(mode) || ![4, 5, 6].includes(mode)) {
        throw new Error(`Mesh ${meshIndex} primitive ${primitiveIndex} uses unsupported primitive mode ${mode}.`);
    }
    if (primitive.targets?.length) {
        throw new Error(`Mesh ${meshIndex} primitive ${primitiveIndex} uses morph targets, which are not supported.`);
    }
    if (primitive.attributes?.JOINTS_0 !== undefined || primitive.attributes?.JOINTS_1 !== undefined ||
        primitive.attributes?.WEIGHTS_0 !== undefined || primitive.attributes?.WEIGHTS_1 !== undefined) {
        throw new Error(`Mesh ${meshIndex} primitive ${primitiveIndex} has skinning attributes, which are not supported.`);
    }
    if (primitive.extensions?.KHR_draco_mesh_compression) {
        throw new Error(`Mesh ${meshIndex} primitive ${primitiveIndex} uses unsupported Draco compression.`);
    }
}

function BuildTriangleList(mode, sourceIndices, vertexCount) {
    const sequence = sourceIndices ?? Uint32Array.from({ length: vertexCount }, (_, index) => index);
    if (mode === 4) {
        return sourceIndices;
    }
    const triangles = [];
    if (mode === 5) {
        for (let index = 2; index < sequence.length; index += 1) {
            if (index % 2 === 0) {
                triangles.push(sequence[index - 2], sequence[index - 1], sequence[index]);
            } else {
                triangles.push(sequence[index - 1], sequence[index - 2], sequence[index]);
            }
        }
    } else {
        for (let index = 2; index < sequence.length; index += 1) {
            triangles.push(sequence[0], sequence[index - 1], sequence[index]);
        }
    }
    if (triangles.length === 0) {
        throw new RangeError("Triangle strip or fan must contain at least three vertices.");
    }
    const result = Uint32Array.from(triangles);
    return vertexCount <= 0x10000 ? Uint16Array.from(result) : result;
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
    const attributes = RequireObject(primitive.attributes, `Mesh ${meshIndex} primitive ${primitiveIndex} attributes`);
    for (const attributeName of Object.keys(attributes)) {
        const match = /^TEXCOORD_(\d+)$/.exec(attributeName);
        if (match && Number(match[1]) > 1) {
            throw new Error(
                `Mesh ${meshIndex} primitive ${primitiveIndex} uses unsupported ${attributeName}.`,
            );
        }
    }
    const positions = ReadPositions(context.document, context.buffers, attributes.POSITION);
    const vertexCount = positions.length / 3;
    const sourceIndices = ReadIndices(context.document, context.buffers, primitive.indices, vertexCount);
    const indices = BuildTriangleList(primitive.mode ?? 4, sourceIndices, vertexCount);
    const normals = ReadNormals(context.document, context.buffers, attributes.NORMAL, vertexCount);
    const uvs = ReadUvs(context.document, context.buffers, attributes.TEXCOORD_0, vertexCount, 0);
    const texCoord1 = ReadUvs(context.document, context.buffers, attributes.TEXCOORD_1, vertexCount, 1);
    const colors = ReadColors(context.document, context.buffers, attributes.COLOR_0, vertexCount);
    const mesh = new Mesh(positions, uvs, null, indices, { normals, texCoord1, colors });
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
        const primitive = RequireObject(meshDefinition.primitives[primitiveIndex], `Mesh ${definitionIndex} primitive ${primitiveIndex}`);
        ValidateMeshPrimitive(primitive, definitionIndex, primitiveIndex);
        const mesh = GetOrCreatePrimitiveMesh(context, definitionIndex, primitiveIndex, primitive);
        const material = await context.resolveMaterial(primitive.material);
        const attributes = primitive.attributes;
        if (material.BaseColorTexture !== null &&
            attributes[`TEXCOORD_${material.BaseColorTexCoord}`] === undefined) {
            throw new Error(`Mesh ${definitionIndex} primitive ${primitiveIndex} is missing TEXCOORD_${material.BaseColorTexCoord} required by material "${material.Name}".`);
        }
        if (material.MetallicRoughnessTexture !== null &&
            attributes[`TEXCOORD_${material.MetallicRoughnessTexCoord}`] === undefined) {
            throw new Error(`Mesh ${definitionIndex} primitive ${primitiveIndex} is missing TEXCOORD_${material.MetallicRoughnessTexCoord} required by material "${material.Name}".`);
        }
        context.primitives.push({ mesh, material, transform: worldTransform });
    }
}

async function VisitNode(context, nodeIndex, parentTransform) {
    const index = RequireIndex(nodeIndex, context.nodes.length, "Node");
    if (context.activeNodes.has(index)) {
        throw new Error(`GLB node hierarchy contains a cycle at node ${index}.`);
    }
    if (context.visitedNodes.has(index)) {
        throw new Error(`GLB node ${index} is referenced more than once in the selected scene.`);
    }
    context.activeNodes.add(index);
    context.visitedNodes.add(index);
    const node = RequireObject(context.nodes[index], `Node ${index}`);
    const worldTransform = MultiplyMatrices(parentTransform, ReadNodeTransform(node, index));
    if (node.skin !== undefined) {
        throw new Error(`Node ${index} uses skinning, which is not supported.`);
    }
    if (node.camera !== undefined) {
        context.onWarning("Skipping GLB camera node.", { nodeIndex: index });
    }
    if (node.extensions?.KHR_lights_punctual !== undefined) {
        context.onWarning("Skipping GLB punctual light node; use scene-owned lights instead.", { nodeIndex: index });
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

export function ValidateGlbDocument(document, onWarning = () => {}) {
    if (document.animations !== undefined && !Array.isArray(document.animations)) {
        throw new TypeError("GLB animations must be an array.");
    }
    if (document.animations?.length) {
        onWarning("Skipping GLB animations; this loader creates static meshes only.", {
            animationCount: document.animations.length,
        });
    }
    const requiredExtensions = document.extensionsRequired ?? [];
    if (!Array.isArray(requiredExtensions)) {
        throw new TypeError("GLB extensionsRequired must be an array.");
    }
    const unsupportedRequiredExtensions = requiredExtensions.filter(
        (extension) => !SUPPORTED_REQUIRED_EXTENSIONS.has(extension),
    );
    if (unsupportedRequiredExtensions.length) {
        throw new Error(`GLB requires unsupported extensions: ${unsupportedRequiredExtensions.join(", ")}.`);
    }
    const usedExtensions = document.extensionsUsed ?? [];
    if (!Array.isArray(usedExtensions)) {
        throw new TypeError("GLB extensionsUsed must be an array.");
    }
    for (const extension of usedExtensions) {
        if (!SUPPORTED_EXTENSIONS.has(extension)) {
            onWarning(`Ignoring unsupported optional GLB extension "${extension}".`, { extension });
        }
    }
    if (!Array.isArray(document.scenes) || document.scenes.length === 0) {
        throw new Error("GLB must define at least one scene.");
    }
    if (!Array.isArray(document.nodes) || document.nodes.length === 0) {
        throw new Error("GLB scene must define at least one node.");
    }
}

export async function BuildGlbScene({ document, buffers, loadImage, onWarning = () => {}, importScale = 1 }) {
    if (typeof loadImage !== "function") {
        throw new TypeError("GLB scene builder requires an image loader function.");
    }
    if (!Number.isFinite(importScale) || importScale <= 0) {
        throw new RangeError("GLB importScale must be a positive finite number.");
    }
    const scenes = document.scenes;
    const sceneIndex = document.scene === undefined ? 0 : document.scene;
    const scene = RequireObject(scenes[RequireIndex(sceneIndex, scenes.length, "Default scene")], "Default scene");
    if (!Array.isArray(scene.nodes)) {
        throw new TypeError("GLB scene nodes must be an array.");
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
    const importRoot = ScaleMatrix(importScale);
    for (const rootNodeIndex of scene.nodes) {
        await VisitNode(context, rootNodeIndex, importRoot);
    }
    if (context.primitives.length === 0) {
        throw new Error("GLB selected scene contains no renderable mesh primitives.");
    }
    return context.primitives;
}
