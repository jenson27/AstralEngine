import { Material } from "./material.js";
import { Mesh } from "./mesh.js";

export class WebGpuResourceCache {
    constructor({
        device,
        materialBindGroupLayout,
        textureSampler,
        trackGpuResource,
        destroyGpuResource,
    }) {
        if (!device) {
            throw new TypeError("WebGpuResourceCache requires a device.");
        }

        if (typeof trackGpuResource !== "function") {
            throw new TypeError(
                "WebGpuResourceCache requires a resource tracking function.",
            );
        }

        if (typeof destroyGpuResource !== "function") {
            throw new TypeError(
                "WebGpuResourceCache requires a resource destruction function.",
            );
        }

        this._device = device;
        this._materialBindGroupLayout = materialBindGroupLayout;
        this._textureSampler = textureSampler;
        this._trackGpuResource = trackGpuResource;
        this._destroyGpuResource = destroyGpuResource;
        this._meshResources = new Map();
        this._textureResources = new Map();
        this._materialBindGroups = new Map();
    }

    GetMeshResource(mesh) {
        if (!(mesh instanceof Mesh)) {
            throw new TypeError("Render item requires a Mesh.");
        }

        let meshResource = this._meshResources.get(mesh);

        if (!meshResource) {
            meshResource = this._CreateMeshResource(mesh);
            this._meshResources.set(mesh, meshResource);
        }

        return meshResource;
    }

    _CreateMeshResource(mesh) {
        const positions = mesh.GetPositions();
        const uvs = mesh.GetUVs();
        const vertexData = new Float32Array(mesh.VertexCount * 5);

        for (let index = 0; index < mesh.VertexCount; index += 1) {
            vertexData.set(
                positions.subarray(index * 3, index * 3 + 3),
                index * 5,
            );
            vertexData.set(
                uvs.subarray(index * 2, index * 2 + 2),
                index * 5 + 3,
            );
        }

        const vertexBuffer = this._device.createBuffer({
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        try {
            this._device.queue.writeBuffer(vertexBuffer, 0, vertexData);
        } catch (error) {
            vertexBuffer.destroy();
            throw error;
        }

        return {
            vertexBuffer,
            memoryToken: this._trackGpuResource(
                "Mesh vertex buffer",
                "GPUBuffer",
                vertexData.byteLength,
            ),
            vertexCount: mesh.VertexCount,
            submeshes: mesh.Submeshes,
        };
    }

    GetTextureResource(imageAsset) {
        let textureResource = this._textureResources.get(imageAsset);

        if (textureResource) {
            return textureResource;
        }

        if (
            !imageAsset?.bitmap ||
            !Number.isSafeInteger(imageAsset.width) ||
            imageAsset.width <= 0 ||
            !Number.isSafeInteger(imageAsset.height) ||
            imageAsset.height <= 0
        ) {
            throw new TypeError("Material has an invalid image asset.");
        }

        const texture = this._device.createTexture({
            size: [imageAsset.width, imageAsset.height, 1],
            format: "rgba8unorm-srgb",
            usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });

        try {
            this._device.queue.copyExternalImageToTexture(
                { source: imageAsset.bitmap },
                { texture },
                [imageAsset.width, imageAsset.height, 1],
            );
        } catch (error) {
            texture.destroy();
            throw error;
        }

        textureResource = {
            texture,
            view: texture.createView(),
            memoryToken: this._trackGpuResource(
                "Material base-color texture",
                "GPUTexture",
                imageAsset.width * imageAsset.height * 4,
            ),
        };
        this._textureResources.set(imageAsset, textureResource);

        return textureResource;
    }

    GetMaterialBindGroup(material) {
        if (!(material instanceof Material)) {
            throw new TypeError("Render item requires a Material.");
        }

        let bindGroup = this._materialBindGroups.get(material);

        if (bindGroup) {
            return bindGroup;
        }

        const textureResource = this.GetTextureResource(
            material.BaseColorTexture,
        );

        bindGroup = this._device.createBindGroup({
            layout: this._materialBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: textureResource.view,
                },
                {
                    binding: 1,
                    resource: this._textureSampler,
                },
            ],
        });

        this._materialBindGroups.set(material, bindGroup);
        return bindGroup;
    }

    Prune(activeMeshes, activeMaterials) {
        for (const [mesh, meshResource] of this._meshResources) {
            if (!activeMeshes.has(mesh)) {
                this._destroyGpuResource(
                    meshResource.vertexBuffer,
                    meshResource.memoryToken,
                );
                this._meshResources.delete(mesh);
            }
        }

        const activeTextures = new Set();

        for (const material of activeMaterials) {
            activeTextures.add(material.BaseColorTexture);
        }

        for (const material of this._materialBindGroups.keys()) {
            if (!activeMaterials.has(material)) {
                this._materialBindGroups.delete(material);
            }
        }

        for (const [imageAsset, textureResource] of this._textureResources) {
            if (!activeTextures.has(imageAsset)) {
                this._destroyGpuResource(
                    textureResource.texture,
                    textureResource.memoryToken,
                );
                this._textureResources.delete(imageAsset);
            }
        }
    }

    Dispose() {
        for (const meshResource of this._meshResources.values()) {
            this._destroyGpuResource(
                meshResource.vertexBuffer,
                meshResource.memoryToken,
            );
        }

        for (const textureResource of this._textureResources.values()) {
            this._destroyGpuResource(
                textureResource.texture,
                textureResource.memoryToken,
            );
        }

        this._meshResources.clear();
        this._textureResources.clear();
        this._materialBindGroups.clear();
    }
}
