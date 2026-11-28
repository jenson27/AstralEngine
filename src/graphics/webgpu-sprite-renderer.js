import { CreateWebGpuSpritePipeline } from "./webgpu-sprite-pipeline-builder.js";

const spriteShaderUrl = new URL("./shaders/sprite.wgsl", import.meta.url);
const QUAD_VERTICES = new Float32Array([
    0, 0, 0, 1,
    1, 0, 1, 1,
    1, 1, 1, 0,
    0, 0, 0, 1,
    1, 1, 1, 0,
    0, 1, 0, 0,
]);

export class WebGpuSpriteRenderer {
    constructor({
        device,
        format,
        depthFormat,
        resourceCache,
        memoryTracker = null,
        trackGpuResource,
        destroyGpuResource,
    }) {
        this._device = device;
        this._format = format;
        this._depthFormat = depthFormat;
        this._resourceCache = resourceCache;
        this._memoryTracker = memoryTracker;
        this._trackGpuResource = trackGpuResource;
        this._destroyGpuResource = destroyGpuResource;
        this._pipeline = null;
        this._frameBuffer = null;
        this._frameMemoryToken = null;
        this._frameBindGroup = null;
        this._spriteBuffer = null;
        this._spriteMemoryToken = null;
        this._spriteDataMemoryToken = null;
        this._spriteBindGroup = null;
        this._spriteBindGroupLayout = null;
        this._spriteCapacity = 0;
        this._spriteStride = 0;
        this._spriteData = new Float32Array(0);
        this._vertexBuffer = null;
        this._vertexMemoryToken = null;
        this._sampler = null;
        this._textureBindGroups = new Map();
        this._drawItems = [];
        this._activeImages = new Set();
    }

    get ActiveImages() {
        return new Set(this._activeImages);
    }

    async Initialize({ signal } = {}) {
        const resources = await CreateWebGpuSpritePipeline({
            device: this._device,
            format: this._format,
            depthFormat: this._depthFormat,
            shaderUrl: spriteShaderUrl,
            signal,
        });
        if (signal?.aborted) {
            throw signal.reason ?? new Error("Sprite initialization was aborted.");
        }
        this._pipeline = resources.pipeline;
        this._frameBuffer = this._device.createBuffer({
            size: 128,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this._frameMemoryToken = this._trackGpuResource(
            "Sprite frame uniform buffer",
            "GPUBuffer",
            128,
        );
        this._frameBindGroup = this._device.createBindGroup({
            layout: resources.frameBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this._frameBuffer, size: 128 },
                },
            ],
        });
        this._sampler = this._device.createSampler({
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
            magFilter: "nearest",
            minFilter: "nearest",
            mipmapFilter: "nearest",
            lodMaxClamp: 0,
        });
        const uniformAlignment =
            this._device.limits.minUniformBufferOffsetAlignment;
        this._spriteStride =
            Math.ceil(96 / uniformAlignment) * uniformAlignment;
        this._spriteBindGroupLayout = resources.spriteBindGroupLayout;
        this._EnsureSpriteCapacity(1);
        this._vertexBuffer = this._device.createBuffer({
            size: QUAD_VERTICES.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this._device.queue.writeBuffer(this._vertexBuffer, 0, QUAD_VERTICES);
        this._vertexMemoryToken = this._trackGpuResource(
            "Sprite quad vertex buffer",
            "GPUBuffer",
            QUAD_VERTICES.byteLength,
        );
    }

    SetRenderItems(renderItems, viewMatrix, projectionMatrix) {
        if (!Array.isArray(renderItems)) {
            throw new TypeError("Sprite render items must be an array.");
        }
        this._activeImages = new Set();
        this._drawItems.length = 0;
        this._EnsureSpriteCapacity(renderItems.length);
        const floatsPerSprite =
            this._spriteStride / Float32Array.BYTES_PER_ELEMENT;
        const frameData = new Float32Array(32);
        frameData.set(viewMatrix, 0);
        frameData.set(projectionMatrix, 16);
        this._device.queue.writeBuffer(this._frameBuffer, 0, frameData);

        for (let index = 0; index < renderItems.length; index += 1) {
            const item = renderItems[index];
            if (
                !item?.texture?.bitmap ||
                item.uvRect?.length !== 4
            ) {
                throw new TypeError("Sprite render item has invalid texture or UV data.");
            }
            const values = [
                ...item.position,
                item.width,
                ...item.right,
                item.height,
                ...item.up,
                item.pivot[0],
                ...item.uvRect,
                ...item.tint,
                item.pivot[1],
                0,
                0,
                0,
            ];
            if (values.length !== 24 || !values.every(Number.isFinite)) {
                throw new TypeError(
                    "Sprite render item contains invalid numeric data.",
                );
            }
            const offset = index * this._spriteStride;
            this._spriteData.set(
                values,
                index * floatsPerSprite,
            );
            this._activeImages.add(item.texture);
            this._drawItems.push({
                transformOffset: offset,
                textureBindGroup: this._GetTextureBindGroup(item.texture),
            });
        }

        if (renderItems.length > 0) {
            this._device.queue.writeBuffer(
                this._spriteBuffer,
                0,
                this._spriteData.subarray(
                    0,
                    floatsPerSprite * renderItems.length,
                ),
            );
        }
    }

    _EnsureSpriteCapacity(requiredCount) {
        if (requiredCount <= this._spriteCapacity && this._spriteBindGroup) {
            return;
        }
        if (!this._spriteBindGroupLayout) {
            throw new Error("Sprite uniform layout is not initialized.");
        }
        let capacity = Math.max(1, this._spriteCapacity);
        while (capacity < requiredCount) {
            capacity *= 2;
        }
        this._destroyGpuResource(this._spriteBuffer, this._spriteMemoryToken);
        this._memoryTracker?.ReleaseResource(this._spriteDataMemoryToken);
        this._spriteDataMemoryToken = null;
        this._spriteCapacity = capacity;
        this._spriteData = new Float32Array(
            (this._spriteStride / Float32Array.BYTES_PER_ELEMENT) * capacity,
        );
        this._spriteDataMemoryToken = this._memoryTracker?.TrackResource({
            label: "Sprite staging buffer",
            resourceType: "Float32Array",
            category: "cpu-resource",
            bytes: this._spriteData.byteLength,
            owner: "WebGpuSpriteRenderer",
            estimated: false,
        }) ?? null;
        this._spriteBuffer = this._device.createBuffer({
            size: this._spriteStride * capacity,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this._spriteMemoryToken = this._trackGpuResource(
            "Sprite uniform buffer",
            "GPUBuffer",
            this._spriteStride * capacity,
        );
        this._spriteBindGroup = this._device.createBindGroup({
            layout: this._spriteBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this._spriteBuffer,
                        offset: 0,
                        size: 96,
                    },
                },
            ],
        });
    }

    _GetTextureBindGroup(imageAsset) {
        let bindGroup = this._textureBindGroups.get(imageAsset);
        if (bindGroup) {
            return bindGroup;
        }
        const textureResource = this._resourceCache.GetTextureResource(
            imageAsset,
            "srgb",
        );
        bindGroup = this._device.createBindGroup({
            layout: this._pipeline.getBindGroupLayout(2),
            entries: [
                { binding: 0, resource: textureResource.view },
                { binding: 1, resource: this._sampler },
            ],
        });
        this._textureBindGroups.set(imageAsset, bindGroup);
        return bindGroup;
    }

    Prune(activeImages) {
        for (const imageAsset of this._textureBindGroups.keys()) {
            if (!activeImages.has(imageAsset)) {
                this._textureBindGroups.delete(imageAsset);
            }
        }
    }

    ClearRenderItems() {
        this._drawItems.length = 0;
        this._activeImages.clear();
    }

    Draw(renderPass) {
        if (this._drawItems.length === 0) {
            return;
        }
        renderPass.setPipeline(this._pipeline);
        renderPass.setBindGroup(0, this._frameBindGroup);
        renderPass.setVertexBuffer(0, this._vertexBuffer);
        for (const drawItem of this._drawItems) {
            renderPass.setBindGroup(
                1,
                this._spriteBindGroup,
                [drawItem.transformOffset],
            );
            renderPass.setBindGroup(2, drawItem.textureBindGroup);
            renderPass.draw(6);
        }
    }

    Dispose() {
        this._destroyGpuResource(this._frameBuffer, this._frameMemoryToken);
        this._destroyGpuResource(this._spriteBuffer, this._spriteMemoryToken);
        this._destroyGpuResource(this._vertexBuffer, this._vertexMemoryToken);
        this._memoryTracker?.ReleaseResource(this._spriteDataMemoryToken);
        this._spriteDataMemoryToken = null;
        this._spriteData = new Float32Array(0);
        this._textureBindGroups.clear();
        this._drawItems.length = 0;
        this._activeImages.clear();
        this._frameBuffer = null;
        this._spriteBuffer = null;
        this._vertexBuffer = null;
    }
}
