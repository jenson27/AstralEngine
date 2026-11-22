import { Material } from "./material.js";
import { Mesh } from "./mesh.js";

function GetMipLevelCount(width, height) {
    return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

function GetMipChainByteLength(width, height) {
    let byteLength = 0;
    while (true) {
        byteLength += width * height * 4;
        if (width === 1 && height === 1) {
            return byteLength;
        }
        width = Math.max(1, Math.floor(width / 2));
        height = Math.max(1, Math.floor(height / 2));
    }
}

export class WebGpuResourceCache {
    constructor({
        device,
        materialBindGroupLayout,
        textureSampler,
        linearTextureSampler = textureSampler,
        mipmapPipeline,
        trackGpuResource,
        destroyGpuResource,
    }) {
        if (!device) {
            throw new TypeError("WebGpuResourceCache requires a device.");
        }
        if (!mipmapPipeline || typeof mipmapPipeline.getBindGroupLayout !== "function") {
            throw new TypeError("WebGpuResourceCache requires a mipmap pipeline.");
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
        this._linearTextureSampler = linearTextureSampler;
        this._mipmapPipeline = mipmapPipeline;
        this._trackGpuResource = trackGpuResource;
        this._destroyGpuResource = destroyGpuResource;
        this._meshResources = new Map();
        this._textureResources = new Map();
        this._materialBindGroups = new Map();
        this._defaultTextureResource = null;
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
        const indices = mesh.GetIndices();
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

        let vertexBuffer = null;
        let vertexMemoryToken = null;
        let indexBuffer = null;
        let indexMemoryToken = null;
        try {
            vertexBuffer = this._device.createBuffer({
                size: vertexData.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            this._device.queue.writeBuffer(vertexBuffer, 0, vertexData);
            vertexMemoryToken = this._trackGpuResource(
                "Mesh vertex buffer",
                "GPUBuffer",
                vertexData.byteLength,
            );

            if (indices) {
                indexBuffer = this._device.createBuffer({
                    size: indices.byteLength,
                    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
                });
                this._device.queue.writeBuffer(indexBuffer, 0, indices);
                indexMemoryToken = this._trackGpuResource(
                    "Mesh index buffer",
                    "GPUBuffer",
                    indices.byteLength,
                );
            }
        } catch (error) {
            this._destroyGpuResource(indexBuffer, indexMemoryToken);
            this._destroyGpuResource(vertexBuffer, vertexMemoryToken);
            throw error;
        }

        return {
            vertexBuffer,
            memoryToken: vertexMemoryToken,
            indexBuffer,
            indexMemoryToken,
            indexFormat: indices instanceof Uint16Array ? "uint16" : "uint32",
            vertexCount: mesh.VertexCount,
            indexCount: indices?.length ?? 0,
            submeshes: mesh.Submeshes,
        };
    }

    GetTextureResource(imageAsset) {
        if (imageAsset === null) {
            return this._GetDefaultTextureResource();
        }

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

        const mipLevelCount = GetMipLevelCount(imageAsset.width, imageAsset.height);
        const texture = this._device.createTexture({
            size: [imageAsset.width, imageAsset.height, 1],
            mipLevelCount,
            format: "rgba8unorm-srgb",
            usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });

        try {
            this._device.queue.copyExternalImageToTexture(
                { source: imageAsset.bitmap },
                { texture, mipLevel: 0 },
                [imageAsset.width, imageAsset.height, 1],
            );
            this._GenerateMipmaps(texture, mipLevelCount);
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
                GetMipChainByteLength(imageAsset.width, imageAsset.height),
            ),
        };
        this._textureResources.set(imageAsset, textureResource);

        return textureResource;
    }

    _GenerateMipmaps(texture, mipLevelCount) {
        if (mipLevelCount <= 1) {
            return;
        }

        const commandEncoder = this._device.createCommandEncoder();
        for (let level = 1; level < mipLevelCount; level += 1) {
            const sourceView = texture.createView({
                baseMipLevel: level - 1,
                mipLevelCount: 1,
            });
            const destinationView = texture.createView({
                baseMipLevel: level,
                mipLevelCount: 1,
            });
            const bindGroup = this._device.createBindGroup({
                layout: this._mipmapPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: sourceView },
                    { binding: 1, resource: this._textureSampler },
                ],
            });
            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: destinationView,
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: "clear",
                    storeOp: "store",
                }],
            });
            renderPass.setPipeline(this._mipmapPipeline);
            renderPass.setBindGroup(0, bindGroup);
            renderPass.draw(3);
            renderPass.end();
        }

        this._device.queue.submit([commandEncoder.finish()]);
    }

    _GetDefaultTextureResource() {
        if (this._defaultTextureResource) {
            return this._defaultTextureResource;
        }

        const texture = this._device.createTexture({
            size: [1, 1, 1],
            format: "rgba8unorm-srgb",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        try {
            this._device.queue.writeTexture(
                { texture },
                new Uint8Array([255, 255, 255, 255]),
                { bytesPerRow: 4, rowsPerImage: 1 },
                [1, 1, 1],
            );
        } catch (error) {
            texture.destroy();
            throw error;
        }

        this._defaultTextureResource = {
            texture,
            view: texture.createView(),
            memoryToken: this._trackGpuResource(
                "Default white material texture",
                "GPUTexture",
                4,
            ),
        };
        return this._defaultTextureResource;
    }

    GetMaterialBindGroup(material) {
        if (!(material instanceof Material)) {
            throw new TypeError("Render item requires a Material.");
        }

        let materialResource = this._materialBindGroups.get(material);

        if (materialResource) {
            return materialResource.bindGroup;
        }

        const textureResource = this.GetTextureResource(
            material.BaseColorTexture,
        );
        const factorBuffer = this._device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        let factorMemoryToken = null;

        try {
            this._device.queue.writeBuffer(
                factorBuffer,
                0,
                new Float32Array(material.BaseColorFactor),
            );
            factorMemoryToken = this._trackGpuResource(
                "Material base-color factor",
                "GPUBuffer",
                16,
            );
            const bindGroup = this._device.createBindGroup({
                layout: this._materialBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: textureResource.view,
                    },
                    {
                        binding: 1,
                        resource: material.BaseColorMinFilter === "linear"
                            ? this._linearTextureSampler
                            : this._textureSampler,
                    },
                    {
                        binding: 2,
                        resource: { buffer: factorBuffer },
                    },
                ],
            });
            materialResource = {
                bindGroup,
                factorBuffer,
                factorMemoryToken,
            };
            this._materialBindGroups.set(material, materialResource);
            return bindGroup;
        } catch (error) {
            this._destroyGpuResource(factorBuffer, factorMemoryToken);
            throw error;
        }
    }

    Prune(activeMeshes, activeMaterials) {
        for (const [mesh, meshResource] of this._meshResources) {
            if (!activeMeshes.has(mesh)) {
                this._destroyGpuResource(
                    meshResource.vertexBuffer,
                    meshResource.memoryToken,
                );
                this._destroyGpuResource(
                    meshResource.indexBuffer,
                    meshResource.indexMemoryToken,
                );
                this._meshResources.delete(mesh);
            }
        }

        const activeTextures = new Set();

        for (const material of activeMaterials) {
            if (material.BaseColorTexture !== null) {
                activeTextures.add(material.BaseColorTexture);
            }
        }

        for (const [material, materialResource] of this._materialBindGroups) {
            if (!activeMaterials.has(material)) {
                this._destroyGpuResource(
                    materialResource.factorBuffer,
                    materialResource.factorMemoryToken,
                );
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
            this._destroyGpuResource(
                meshResource.indexBuffer,
                meshResource.indexMemoryToken,
            );
        }

        for (const textureResource of this._textureResources.values()) {
            this._destroyGpuResource(
                textureResource.texture,
                textureResource.memoryToken,
            );
        }

        for (const materialResource of this._materialBindGroups.values()) {
            this._destroyGpuResource(
                materialResource.factorBuffer,
                materialResource.factorMemoryToken,
            );
        }
        this._destroyGpuResource(
            this._defaultTextureResource?.texture,
            this._defaultTextureResource?.memoryToken,
        );

        this._meshResources.clear();
        this._textureResources.clear();
        this._materialBindGroups.clear();
        this._defaultTextureResource = null;
    }
}
