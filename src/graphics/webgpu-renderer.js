// WebGPURenderer is a class that encapsulates the functionality of rendering graphics using the WebGPU API.
// It initializes GPU resources, including a vertex buffer, and draws a mesh to the canvas.

import { AstralLogger } from "../diagnostics/logger.js";
import { AssetHandle } from "../core/assets/asset-handle.js";
import { Mesh } from "./mesh.js";
import { Material } from "./material.js";

const shaderUrl = new URL("./shaders/triangle.wgsl", import.meta.url);
const GPU_TIMING_SLOT_COUNT = 3;
const GPU_TIMESTAMP_PAIR_BYTES = 16;

export class WebGPURenderer {
    constructor(canvas, memoryTracker = null, profiler = null) {
        if (
            memoryTracker !== null &&
            (typeof memoryTracker.TrackResource !== "function" ||
                typeof memoryTracker.ReleaseResource !== "function")
        ) {
            throw new TypeError(
                "WebGPURenderer memory tracker must track and release resources.",
            );
        }

        if (
            profiler !== null &&
            (typeof profiler.RecordGpuFrameTime !== "function" ||
                typeof profiler.IsEnabled !== "boolean")
        ) {
            throw new TypeError(
                "WebGPURenderer profiler must record GPU frame timings.",
            );
        }

        this._canvas = canvas;
        this._memoryTracker = memoryTracker;
        this._profiler = profiler;
        this._context = null;
        this._device = null;
        this._format = null;
        this._pipeline = null;
        this._meshResources = new Map();
        this._textureResources = new Map();
        this._materialBindGroups = new Map();
        this._drawItems = [];
        this._transformBindGroupLayout = null;
        this._materialBindGroupLayout = null;
        this._textureSampler = null;
        this._transformBuffer = null;
        this._transformBufferMemoryToken = null;
        this._transformBindGroup = null;
        this._matrixBlockSize = 16 * 3 * Float32Array.BYTES_PER_ELEMENT;
        this._uniformStride = 0;
        this._drawCapacity = 0;
        this._matrixData = new Float32Array(0);
        this._depthTexture = null;
        this._depthTextureMemoryToken = null;
        this._depthView = null;
        this._depthWidth = 0;
        this._depthHeight = 0;
        this._depthFormat = "depth24plus";
        this._deviceLostInfo = null;
        this._gpuTimingSupported = false;
        this._gpuTimestampQuerySet = null;
        this._gpuTimingSlots = [];
        this._gpuTimingGeneration = 0;
    }

    get GpuTimingSupported() {
        return this._gpuTimingSupported;
    }

    // Initialize the WebGPU renderer by requesting a GPU adapter and device, and configuring the canvas context.
    async Initialize() {
        await this._InitializeDevice();
        this._ConfigureCanvasContext();

        const shaderCode = await this._LoadShader();

        this._pipeline = await this._CreatePipeline(shaderCode);
        this._textureSampler = this._device.createSampler({
            addressModeU: "repeat",
            addressModeV: "repeat",
            magFilter: "linear",
            minFilter: "linear",
        });
        this._InitializeTransformResources();
    }

    async _InitializeDevice() {
        if (!navigator.gpu) {
            throw new Error("WebGPU is not available in this browser.");
        }

        const adapter = await navigator.gpu.requestAdapter();

        if (!adapter) {
            throw new Error("The browser could not access a GPU adapter.");
        }

        const requiredFeatures = adapter.features.has("timestamp-query")
            ? ["timestamp-query"]
            : [];
        this._device = await adapter.requestDevice(
            requiredFeatures.length > 0 ? { requiredFeatures } : undefined,
        );
        this._deviceLostInfo = null;
        this._InitializeGpuTiming();

        const device = this._device;

        device.lost.then((lostInfo) => {
            if (lostInfo.reason === "destroyed") {
                return;
            }

            this._deviceLostInfo = lostInfo;
            this._DestroyGpuTimingResources();
            AstralLogger.Error("WebGPU device lost.", {
                reason: lostInfo.reason,
                message: lostInfo.message,
            });
        });

        device.addEventListener("uncapturederror", (event) => {
            AstralLogger.Error("Uncaptured WebGPU error.", {
                name: event.error.constructor.name,
                message: event.error.message,
            });
        });
    }

    _InitializeGpuTiming() {
        if (
            !this._profiler ||
            !this._device.features.has("timestamp-query")
        ) {
            return;
        }

        try {
            this._gpuTimestampQuerySet = this._device.createQuerySet({
                type: "timestamp",
                count: GPU_TIMING_SLOT_COUNT * 2,
            });

            for (let index = 0; index < GPU_TIMING_SLOT_COUNT; index += 1) {
                this._CreateGpuTimingSlot(index * 2);
            }

            this._gpuTimingSupported = true;
        } catch (error) {
            this._DestroyGpuTimingResources();
            AstralLogger.Warn(
                "GPU timestamp queries could not be initialized.",
                error,
            );
        }
    }

    _CreateGpuTimingSlot(queryIndex) {
        const slot = {
            queryIndex,
            busy: false,
            resolveBuffer: null,
            readBuffer: null,
            resolveMemoryToken: null,
            readMemoryToken: null,
        };
        this._gpuTimingSlots.push(slot);
        slot.resolveBuffer = this._device.createBuffer({
            size: GPU_TIMESTAMP_PAIR_BYTES,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        slot.readBuffer = this._device.createBuffer({
            size: GPU_TIMESTAMP_PAIR_BYTES,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        slot.resolveMemoryToken = this._TrackGpuResource(
            "GPU timing resolve buffer",
            "GPUBuffer",
            GPU_TIMESTAMP_PAIR_BYTES,
        );
        slot.readMemoryToken = this._TrackGpuResource(
            "GPU timing readback buffer",
            "GPUBuffer",
            GPU_TIMESTAMP_PAIR_BYTES,
        );
    }

    _AcquireGpuTimingSlot() {
        if (
            !this._gpuTimingSupported ||
            !this._profiler?.IsEnabled ||
            this._profiler.CurrentFrameNumber === null
        ) {
            return null;
        }

        const slot = this._gpuTimingSlots.find((candidate) => !candidate.busy);

        if (!slot) {
            return null;
        }

        slot.busy = true;
        return slot;
    }

    _ReadGpuTiming(slot, frameNumber) {
        const generation = this._gpuTimingGeneration;

        void slot.readBuffer
            .mapAsync(GPUMapMode.READ)
            .then(() => {
                const timestamps = new BigUint64Array(
                    slot.readBuffer.getMappedRange(),
                );
                const startTimestamp = timestamps[0];
                const endTimestamp = timestamps[1];
                slot.readBuffer.unmap();

                if (
                    generation === this._gpuTimingGeneration &&
                    endTimestamp >= startTimestamp
                ) {
                    this._profiler.RecordGpuFrameTime(
                        frameNumber,
                        Number(endTimestamp - startTimestamp) / 1_000_000,
                    );
                }
            })
            .catch(() => {})
            .finally(() => {
                slot.busy = false;
            });
    }

    _DestroyGpuTimingResources() {
        this._gpuTimingGeneration += 1;
        this._gpuTimingSupported = false;
        this._gpuTimestampQuerySet?.destroy();
        this._gpuTimestampQuerySet = null;

        for (const slot of this._gpuTimingSlots) {
            slot.resolveBuffer?.destroy();
            slot.readBuffer?.destroy();
            this._memoryTracker?.ReleaseResource(slot.resolveMemoryToken);
            this._memoryTracker?.ReleaseResource(slot.readMemoryToken);
        }

        this._gpuTimingSlots.length = 0;
    }

    _ConfigureCanvasContext() {
        this._context = this._canvas.getContext("webgpu");

        if (!this._context) {
            throw new Error("Could not create a WebGPU canvas context.");
        }

        this._format = navigator.gpu.getPreferredCanvasFormat();

        this._context.configure({
            device: this._device,
            format: this._format,
            alphaMode: "opaque",
        });

        this.EnsureDepthTexture();
    }

    async _LoadShader() {
        const shaderResponse = await fetch(shaderUrl);

        if (!shaderResponse.ok) {
            throw new Error(
                `Could not load triangle shader. HTTP ${shaderResponse.status}.`,
            );
        }

        return shaderResponse.text();
    }

    async _CreatePipeline(shaderCode) {
        const shaderModule = this._device.createShaderModule({
            code: shaderCode,
        });

        this._CreateBindGroupLayouts();

        const pipelineLayout = this._device.createPipelineLayout({
            bindGroupLayouts: [
                this._transformBindGroupLayout,
                this._materialBindGroupLayout,
            ],
        });

        return this._CreateRenderPipeline(shaderModule, pipelineLayout);
    }

    _CreateBindGroupLayouts() {
        this._transformBindGroupLayout =
            this._device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.VERTEX,
                        buffer: {
                            type: "uniform",
                            hasDynamicOffset: true,
                            minBindingSize: this._matrixBlockSize,
                        },
                    },
                ],
            });

        this._materialBindGroupLayout =
            this._device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.FRAGMENT,
                        texture: {
                            sampleType: "float",
                            viewDimension: "2d",
                        },
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.FRAGMENT,
                        sampler: {
                            type: "filtering",
                        },
                    },
                ],
            });
    }

    _CreateRenderPipeline(shaderModule, pipelineLayout) {
        return this._device.createRenderPipelineAsync({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: "VertexMain",
                buffers: [
                    {
                        arrayStride: 20,
                        attributes: [
                            {
                                format: "float32x3",
                                offset: 0,
                                shaderLocation: 0,
                            },
                            {
                                format: "float32x2",
                                offset: 12,
                                shaderLocation: 1,
                            },
                        ],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: "FragmentMain",
                targets: [{ format: this._format }],
            },
            primitive: {
                topology: "triangle-list",
            },
            depthStencil: {
                format: this._depthFormat,
                depthWriteEnabled: true,
                depthCompare: "less",
            },
        });
    }

    _InitializeTransformResources() {
        const alignment =
            this._device.limits.minUniformBufferOffsetAlignment;
        this._uniformStride =
            Math.ceil(this._matrixBlockSize / alignment) * alignment;
        this._EnsureTransformCapacity(1);
    }

    SetRenderItems(renderItems, viewMatrix, projectionMatrix) {
        if (!Array.isArray(renderItems)) {
            throw new TypeError("Render items must be an array.");
        }

        if (!this._device || !this._transformBuffer) {
            throw new Error("Renderer is not initialized.");
        }

        this._RequireMatrix(viewMatrix, "View matrix");
        this._RequireMatrix(projectionMatrix, "Projection matrix");
        this._EnsureTransformCapacity(renderItems.length);
        this._drawItems.length = 0;
        const activeMeshes = new Set();
        const activeMaterials = new Set();

        const floatsPerDraw =
            this._uniformStride / Float32Array.BYTES_PER_ELEMENT;

        for (let index = 0; index < renderItems.length; index += 1) {
            const renderItem = renderItems[index];

            if (!renderItem || typeof renderItem !== "object") {
                throw new TypeError("Each render item must be an object.");
            }

            this._RequireMatrix(renderItem.modelMatrix, "Model matrix");

            if (!(renderItem.meshHandle instanceof AssetHandle)) {
                throw new TypeError(
                    "Render item requires a mesh asset handle.",
                );
            }

            const mesh = renderItem.meshHandle.Current;
            activeMeshes.add(mesh);
            const meshResource = this._GetMeshResource(mesh);
            const transformOffset = index * this._uniformStride;

            for (const submesh of meshResource.submeshes) {
                const materialHandle =
                    renderItem.materialHandlesBySlot?.[
                        submesh.materialSlot
                    ];

                if (!(materialHandle instanceof AssetHandle)) {
                    throw new TypeError(
                        `Render item has no material handle for slot "${submesh.materialSlot}".`,
                    );
                }

                const material = materialHandle.Current;

                if (!(material instanceof Material)) {
                    throw new TypeError(
                        `Material handle for slot "${submesh.materialSlot}" must contain a Material.`,
                    );
                }

                activeMaterials.add(material);
                this._drawItems.push({
                    vertexBuffer: meshResource.vertexBuffer,
                    firstVertex: submesh.firstVertex,
                    vertexCount: submesh.vertexCount,
                    transformOffset,
                    materialBindGroup:
                        this._GetMaterialBindGroup(material),
                });
            }

            const matrixOffset = index * floatsPerDraw;
            this._matrixData.set(renderItem.modelMatrix, matrixOffset);
            this._matrixData.set(viewMatrix, matrixOffset + 16);
            this._matrixData.set(projectionMatrix, matrixOffset + 32);
        }

        if (renderItems.length > 0) {
            const usedFloatCount = floatsPerDraw * renderItems.length;
            this._device.queue.writeBuffer(
                this._transformBuffer,
                0,
                this._matrixData.subarray(0, usedFloatCount),
            );
        }

        this._PruneMeshResources(activeMeshes);
        this._PruneMaterialResources(activeMaterials);
    }

    _RequireMatrix(matrix, name) {
        if (!(matrix instanceof Float32Array) || matrix.length !== 16) {
            throw new TypeError(`${name} must contain 16 values.`);
        }
    }

    _TrackGpuResource(label, resourceType, bytes) {
        if (!this._memoryTracker) {
            return null;
        }

        return this._memoryTracker.TrackResource({
            label,
            resourceType,
            category: "gpu-resource",
            bytes,
            owner:
                this._memoryTracker.CurrentOwner ?? "WebGPURenderer",
            estimated: true,
        });
    }

    _GetMeshResource(mesh) {
        if (!(mesh instanceof Mesh)) {
            throw new TypeError("Render item requires a Mesh.");
        }

        const meshResource = this._meshResources.get(mesh);

        if (meshResource) {
            return meshResource;
        }

        const newMeshResource = this._CreateMeshResource(mesh);
        this._meshResources.set(mesh, newMeshResource);
        return newMeshResource;
    }

    _CreateMeshResource(mesh) {
        const vertexData = this._CreateInterleavedVertexData(mesh);

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
            memoryToken: this._TrackGpuResource(
                "Mesh vertex buffer",
                "GPUBuffer",
                vertexData.byteLength,
            ),
            vertexCount: mesh.VertexCount,
            submeshes: mesh.Submeshes,
        };
    }

    _CreateInterleavedVertexData(mesh) {
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

        return vertexData;
    }

    _GetTextureResource(imageAsset) {
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
            memoryToken: this._TrackGpuResource(
                "Material base-color texture",
                "GPUTexture",
                imageAsset.width * imageAsset.height * 4,
            ),
        };
        this._textureResources.set(imageAsset, textureResource);

        return textureResource;
    }

    _GetMaterialBindGroup(material) {
        let bindGroup = this._materialBindGroups.get(material);

        if (bindGroup) {
            return bindGroup;
        }

        const textureResource = this._GetTextureResource(
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

    _DestroyTrackedResource(resource, memoryToken) {
        resource?.destroy();
        this._memoryTracker?.ReleaseResource(memoryToken);
    }

    _DestroyMeshResource(meshResource) {
        this._DestroyTrackedResource(
            meshResource.vertexBuffer,
            meshResource.memoryToken,
        );
    }

    _DestroyTextureResource(textureResource) {
        this._DestroyTrackedResource(
            textureResource.texture,
            textureResource.memoryToken,
        );
    }

    _PruneMeshResources(activeMeshes) {
        for (const [mesh, meshResource] of this._meshResources) {
            if (!activeMeshes.has(mesh)) {
                this._DestroyMeshResource(meshResource);
                this._meshResources.delete(mesh);
            }
        }
    }

    _PruneMaterialResources(activeMaterials) {
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
                this._DestroyTextureResource(textureResource);
                this._textureResources.delete(imageAsset);
            }
        }
    }

    _EnsureTransformCapacity(requiredDrawCount) {
        if (requiredDrawCount <= this._drawCapacity) {
            return;
        }

        let drawCapacity = Math.max(1, this._drawCapacity);
        while (drawCapacity < requiredDrawCount) {
            drawCapacity *= 2;
        }

        this._DestroyTrackedResource(
            this._transformBuffer,
            this._transformBufferMemoryToken,
        );
        this._drawCapacity = drawCapacity;
        this._matrixData = new Float32Array(
            (this._uniformStride / Float32Array.BYTES_PER_ELEMENT) *
                drawCapacity,
        );

        this._transformBuffer = this._device.createBuffer({
            size: this._uniformStride * drawCapacity,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this._transformBufferMemoryToken = this._TrackGpuResource(
            "Transform uniform buffer",
            "GPUBuffer",
            this._uniformStride * drawCapacity,
        );

        this._transformBindGroup = this._device.createBindGroup({
            layout: this._transformBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this._transformBuffer,
                        offset: 0,
                        size: this._matrixBlockSize,
                    },
                },
            ],
        });
    }

    EnsureDepthTexture() {
        const width = this._canvas.width;
        const height = this._canvas.height;

        if (
            this._depthTexture &&
            this._depthWidth === width &&
            this._depthHeight === height
        ) {
            return;
        }

        this._DestroyTrackedResource(
            this._depthTexture,
            this._depthTextureMemoryToken,
        );

        this._depthTexture = this._device.createTexture({
            size: [width, height, 1],
            format: this._depthFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this._depthTextureMemoryToken = this._TrackGpuResource(
            "Depth attachment",
            "GPUTexture",
            width * height * 4,
        );

        this._depthView = this._depthTexture.createView();
        this._depthWidth = width;
        this._depthHeight = height;
    }

    // Binds each mesh and its matrix data, then submits the frame to the GPU queue.
    Render() {
        if (this._deviceLostInfo) {
            throw new Error(
                `Cannot render because the WebGPU device was lost: ${this._deviceLostInfo.message}`,
            );
        }

        this.EnsureDepthTexture();

        const frameNumber = this._profiler?.CurrentFrameNumber;
        const timingSlot = this._AcquireGpuTimingSlot();
        const commandEncoder = this._device.createCommandEncoder();
        const canvasTexture = this._context.getCurrentTexture();

        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: canvasTexture.createView(),
                    clearValue: { r: 0.04, g: 0.06, b: 0.1, a: 1 },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
            depthStencilAttachment: {
                view: this._depthView,
                depthClearValue: 1,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
            timestampWrites: timingSlot
                ? {
                      querySet: this._gpuTimestampQuerySet,
                      beginningOfPassWriteIndex: timingSlot.queryIndex,
                      endOfPassWriteIndex: timingSlot.queryIndex + 1,
                  }
                : undefined,
        });

        renderPass.setPipeline(this._pipeline);

        for (const drawItem of this._drawItems) {
            renderPass.setBindGroup(0, this._transformBindGroup, [
                drawItem.transformOffset,
            ]);
            renderPass.setBindGroup(1, drawItem.materialBindGroup);
            renderPass.setVertexBuffer(0, drawItem.vertexBuffer);
            renderPass.draw(
                drawItem.vertexCount,
                1,
                drawItem.firstVertex,
            );
        }

        renderPass.end();

        if (timingSlot) {
            commandEncoder.resolveQuerySet(
                this._gpuTimestampQuerySet,
                timingSlot.queryIndex,
                2,
                timingSlot.resolveBuffer,
                0,
            );
            commandEncoder.copyBufferToBuffer(
                timingSlot.resolveBuffer,
                0,
                timingSlot.readBuffer,
                0,
                GPU_TIMESTAMP_PAIR_BYTES,
            );
        }

        try {
            this._device.queue.submit([commandEncoder.finish()]);
        } catch (error) {
            if (timingSlot) {
                timingSlot.busy = false;
            }

            throw error;
        }

        if (timingSlot) {
            this._ReadGpuTiming(timingSlot, frameNumber);
        }
    }

    Shutdown() {
        this._context?.unconfigure();
        this._DestroyGpuTimingResources();

        for (const meshResource of this._meshResources.values()) {
            this._DestroyMeshResource(meshResource);
        }

        for (const textureResource of this._textureResources.values()) {
            this._DestroyTextureResource(textureResource);
        }

        this._meshResources.clear();
        this._textureResources.clear();
        this._materialBindGroups.clear();
        this._drawItems.length = 0;
        this._DestroyTrackedResource(
            this._transformBuffer,
            this._transformBufferMemoryToken,
        );
        this._DestroyTrackedResource(
            this._depthTexture,
            this._depthTextureMemoryToken,
        );
        this._device?.destroy();

        this._context = null;
        this._device = null;
        this._format = null;
        this._pipeline = null;
        this._transformBindGroupLayout = null;
        this._materialBindGroupLayout = null;
        this._textureSampler = null;
        this._transformBuffer = null;
        this._transformBufferMemoryToken = null;
        this._transformBindGroup = null;
        this._uniformStride = 0;
        this._drawCapacity = 0;
        this._matrixData = new Float32Array(0);
        this._depthTexture = null;
        this._depthTextureMemoryToken = null;
        this._depthView = null;
        this._depthWidth = 0;
        this._depthHeight = 0;
        this._deviceLostInfo = null;
    }
}
