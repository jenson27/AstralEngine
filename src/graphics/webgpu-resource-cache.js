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
        linearMipmapPipeline = mipmapPipeline,
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
        this._linearMipmapPipeline = linearMipmapPipeline;
        this._trackGpuResource = trackGpuResource;
        this._destroyGpuResource = destroyGpuResource;
        this._meshResources = new Map();
        this._textureResources = new Map();
        this._materialBindGroups = new Map();
        this._samplers = new Map();
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
        const normals = mesh.GetNormals();
        const texCoord1 = mesh.GetTexCoord1();
        const colors = mesh.GetColors();
        const indices = mesh.GetIndices();
        const vertexData = new Float32Array(mesh.VertexCount * 14);

        for (let index = 0; index < mesh.VertexCount; index += 1) {
            vertexData.set(
                positions.subarray(index * 3, index * 3 + 3),
                index * 14,
            );
            vertexData.set(normals.subarray(index * 3, index * 3 + 3), index * 14 + 3);
            vertexData.set(
                uvs.subarray(index * 2, index * 2 + 2),
                index * 14 + 6,
            );
            vertexData.set(texCoord1.subarray(index * 2, index * 2 + 2), index * 14 + 8);
            vertexData.set(colors.subarray(index * 4, index * 4 + 4), index * 14 + 10);
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

    GetTextureResource(imageAsset, colorSpace = "srgb") {
        if (imageAsset === null) {
            return this._GetDefaultTextureResource();
        }

        if (!["srgb", "linear"].includes(colorSpace)) {
            throw new TypeError("Texture color space must be srgb or linear.");
        }
        const resourcesByColorSpace = this._textureResources.get(imageAsset);
        let textureResource = resourcesByColorSpace?.get(colorSpace);

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
            format: colorSpace === "srgb" ? "rgba8unorm-srgb" : "rgba8unorm",
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
            this._GenerateMipmaps(
                texture,
                mipLevelCount,
                colorSpace === "srgb"
                    ? this._mipmapPipeline
                    : this._linearMipmapPipeline,
            );
        } catch (error) {
            texture.destroy();
            throw error;
        }

        textureResource = {
            texture,
            view: texture.createView(),
            memoryToken: this._trackGpuResource(
                `Material ${colorSpace} texture`,
                "GPUTexture",
                GetMipChainByteLength(imageAsset.width, imageAsset.height),
            ),
        };
        const nextResourcesByColorSpace = resourcesByColorSpace ?? new Map();
        nextResourcesByColorSpace.set(colorSpace, textureResource);
        this._textureResources.set(imageAsset, nextResourcesByColorSpace);

        return textureResource;
    }

    _GenerateMipmaps(texture, mipLevelCount, mipmapPipeline) {
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
                layout: mipmapPipeline.getBindGroupLayout(0),
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
            renderPass.setPipeline(mipmapPipeline);
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

        const baseColorTextureResource = this.GetTextureResource(
            material.BaseColorTexture,
            "srgb",
        );
        const metallicRoughnessTextureResource = this.GetTextureResource(
            material.MetallicRoughnessTexture,
            "linear",
        );
        const factorBuffer = this._device.createBuffer({
            size: 48,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        let factorMemoryToken = null;

        try {
            this._device.queue.writeBuffer(
                factorBuffer,
                0,
                new Float32Array([
                    ...material.BaseColorFactor,
                    material.MetallicFactor,
                    material.RoughnessFactor,
                    material.AlphaCutoff,
                    material.AlphaMode === "MASK" ? 1 : 0,
                    material.BaseColorTexCoord,
                    material.MetallicRoughnessTexCoord,
                    material.IsUnlit ? 1 : 0,
                    0,
                ]),
            );
            factorMemoryToken = this._trackGpuResource(
                "Material PBR factors",
                "GPUBuffer",
                48,
            );
            const bindGroup = this._device.createBindGroup({
                layout: this._materialBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: baseColorTextureResource.view,
                    },
                    {
                        binding: 1,
                        resource: this._GetSampler(material.BaseColorSampler),
                    },
                    {
                        binding: 2,
                        resource: { buffer: factorBuffer },
                    },
                    {
                        binding: 3,
                        resource: metallicRoughnessTextureResource.view,
                    },
                    {
                        binding: 4,
                        resource: this._GetSampler(material.MetallicRoughnessSampler),
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

    _GetSampler(settings) {
        const key = JSON.stringify(settings);
        let sampler = this._samplers.get(key);
        if (!sampler) {
            sampler = this._device.createSampler({
                addressModeU: settings.addressModeU,
                addressModeV: settings.addressModeV,
                magFilter: settings.magFilter,
                minFilter: settings.minFilter,
                mipmapFilter: settings.mipmapFilter,
                lodMaxClamp: settings.mipmaps ? 32 : 0,
            });
            this._samplers.set(key, sampler);
        }
        return sampler;
    }

    Prune(activeMeshes, activeMaterials, activeSpriteImages = new Set()) {
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

        const activeTextureFormats = new Map();
        const AddActiveTexture = (imageAsset, colorSpace) => {
            if (imageAsset === null) {
                return;
            }
            let colorSpaces = activeTextureFormats.get(imageAsset);
            if (!colorSpaces) {
                colorSpaces = new Set();
                activeTextureFormats.set(imageAsset, colorSpaces);
            }
            colorSpaces.add(colorSpace);
        };

        for (const material of activeMaterials) {
            AddActiveTexture(material.BaseColorTexture, "srgb");
            AddActiveTexture(material.MetallicRoughnessTexture, "linear");
        }
        for (const imageAsset of activeSpriteImages) {
            AddActiveTexture(imageAsset, "srgb");
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

        for (const [imageAsset, resourcesByColorSpace] of this._textureResources) {
            const activeColorSpaces = activeTextureFormats.get(imageAsset) ?? new Set();
            for (const [colorSpace, textureResource] of resourcesByColorSpace) {
                if (!activeColorSpaces.has(colorSpace)) {
                    this._destroyGpuResource(
                        textureResource.texture,
                        textureResource.memoryToken,
                    );
                    resourcesByColorSpace.delete(colorSpace);
                }
            }
            if (resourcesByColorSpace.size === 0) {
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

        for (const resourcesByColorSpace of this._textureResources.values()) {
            for (const textureResource of resourcesByColorSpace.values()) {
                this._destroyGpuResource(
                    textureResource.texture,
                    textureResource.memoryToken,
                );
            }
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
        this._samplers.clear();
        this._defaultTextureResource = null;
    }
}
