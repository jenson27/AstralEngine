// WebGPURenderer is a class that encapsulates the functionality of rendering graphics using the WebGPU API.
// It initializes GPU resources, including a vertex buffer, and draws a mesh to the canvas.

import { AstralLogger } from "../diagnostics/logger.js";
import { Material } from "./material.js";
import { GpuTimingTracker } from "./gpu-timing-tracker.js";
import { WebGpuResourceCache } from "./webgpu-resource-cache.js";
import { CreateWebGpuPipeline } from "./webgpu-pipeline-builder.js";
import { SetNormalMatrix4 } from "../math/matrix4.js";

const shaderUrl = new URL("./shaders/triangle.wgsl", import.meta.url);
const mipmapShaderUrl = new URL("./shaders/mipmap.wgsl", import.meta.url);

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
        this._gpuTimingTracker = new GpuTimingTracker(
            profiler,
            memoryTracker,
        );
        this._context = null;
        this._device = null;
        this._format = null;
        this._pipeline = null;
        this._gpuResourceCache = null;
        this._drawItems = [];
        this._transformBindGroupLayout = null;
        this._materialBindGroupLayout = null;
        this._textureSampler = null;
        this._linearTextureSampler = null;
        this._transformBuffer = null;
        this._transformBufferMemoryToken = null;
        this._transformBindGroup = null;
        this._matrixBlockSize = 76 * Float32Array.BYTES_PER_ELEMENT;
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
    }

    get GpuTimingSupported() {
        return this._gpuTimingTracker.IsSupported;
    }

    // Initialize the WebGPU renderer by requesting a GPU adapter and device, and configuring the canvas context.
    async Initialize() {
        await this._InitializeDevice();
        this._ConfigureCanvasContext();

        const [shaderCode, mipmapShaderCode] = await Promise.all([
            this._LoadShader(shaderUrl, "triangle"),
            this._LoadShader(mipmapShaderUrl, "mipmap"),
        ]);

        const pipelineResources = await CreateWebGpuPipeline({
            device: this._device,
            format: this._format,
            depthFormat: this._depthFormat,
            matrixBlockSize: this._matrixBlockSize,
            shaderCode,
            mipmapShaderCode,
        });
        this._pipeline = pipelineResources.pipeline;
        this._transformBindGroupLayout =
            pipelineResources.transformBindGroupLayout;
        this._materialBindGroupLayout =
            pipelineResources.materialBindGroupLayout;
        this._textureSampler = this._device.createSampler({
            addressModeU: "repeat",
            addressModeV: "repeat",
            magFilter: "linear",
            minFilter: "linear",
            mipmapFilter: "linear",
        });
        this._linearTextureSampler = this._device.createSampler({
            addressModeU: "repeat",
            addressModeV: "repeat",
            magFilter: "linear",
            minFilter: "linear",
            mipmapFilter: "nearest",
            lodMaxClamp: 0,
        });
        this._gpuResourceCache = new WebGpuResourceCache({
            device: this._device,
            materialBindGroupLayout: this._materialBindGroupLayout,
            textureSampler: this._textureSampler,
            linearTextureSampler: this._linearTextureSampler,
            mipmapPipeline: pipelineResources.mipmapPipeline,
            linearMipmapPipeline: pipelineResources.linearMipmapPipeline,
            trackGpuResource: (label, resourceType, bytes) =>
                this._TrackGpuResource(label, resourceType, bytes),
            destroyGpuResource: (resource, memoryToken) =>
                this._DestroyTrackedResource(resource, memoryToken),
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
        this._gpuTimingTracker.Initialize(this._device);

        const device = this._device;

        device.lost.then((lostInfo) => {
            if (lostInfo.reason === "destroyed") {
                return;
            }

            this._deviceLostInfo = lostInfo;
            this._gpuTimingTracker.Destroy();
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

    async _LoadShader(url, shaderName) {
        const shaderResponse = await fetch(url);

        if (!shaderResponse.ok) {
            throw new Error(
                `Could not load ${shaderName} shader. HTTP ${shaderResponse.status}.`,
            );
        }

        return shaderResponse.text();
    }

    _InitializeTransformResources() {
        const alignment =
            this._device.limits.minUniformBufferOffsetAlignment;
        this._uniformStride =
            Math.ceil(this._matrixBlockSize / alignment) * alignment;
        this._EnsureTransformCapacity(1);
    }

    SetRenderItems(
        renderItems,
        viewMatrix,
        projectionMatrix,
        lighting = {},
    ) {
        if (!Array.isArray(renderItems)) {
            throw new TypeError("Render items must be an array.");
        }

        if (
            !this._device ||
            !this._transformBuffer ||
            !this._gpuResourceCache
        ) {
            throw new Error("Renderer is not initialized.");
        }

        this._RequireMatrix(viewMatrix, "View matrix");
        this._RequireMatrix(projectionMatrix, "Projection matrix");
        const lightDirection = this._ReadVector3(
            lighting.direction ?? [0.4, 0.8, 0.45],
            "Light direction",
        );
        const lightColor = this._ReadVector3(
            lighting.color ?? [1, 1, 1],
            "Light color",
        );
        const cameraPosition = this._ReadVector3(
            lighting.cameraPosition ?? [0, 0, 0],
            "Camera position",
        );
        const lightIntensity = lighting.intensity ?? 3;
        if (!Number.isFinite(lightIntensity) || lightIntensity < 0) {
            throw new RangeError("Light intensity must be non-negative.");
        }
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

            const mesh = renderItem.mesh;
            activeMeshes.add(mesh);
            const meshResource =
                this._gpuResourceCache.GetMeshResource(mesh);
            const transformOffset = index * this._uniformStride;

            for (const submesh of meshResource.submeshes) {
                const material =
                    renderItem.materialsBySlot?.[submesh.materialSlot];

                if (!material) {
                    throw new TypeError(
                        `Render item has no material for slot "${submesh.materialSlot}".`,
                    );
                }

                if (!(material instanceof Material)) {
                    throw new TypeError(
                        `Material for slot "${submesh.materialSlot}" must be a Material.`,
                    );
                }

                activeMaterials.add(material);
                this._drawItems.push({
                    vertexBuffer: meshResource.vertexBuffer,
                    indexBuffer: meshResource.indexBuffer,
                    indexFormat: meshResource.indexFormat,
                    firstVertex: submesh.firstVertex,
                    vertexCount: submesh.vertexCount,
                    firstIndex: submesh.firstIndex,
                    indexCount: submesh.indexCount,
                    transformOffset,
                    materialBindGroup:
                        this._gpuResourceCache.GetMaterialBindGroup(material),
                });
            }

            const matrixOffset = index * floatsPerDraw;
            this._matrixData.set(renderItem.modelMatrix, matrixOffset);
            this._matrixData.set(viewMatrix, matrixOffset + 16);
            this._matrixData.set(projectionMatrix, matrixOffset + 32);
            this._matrixData.set(
                SetNormalMatrix4(new Float32Array(16), renderItem.modelMatrix),
                matrixOffset + 48,
            );
            this._matrixData.set(
                [...lightDirection, 0],
                matrixOffset + 64,
            );
            this._matrixData.set(
                [...lightColor, lightIntensity],
                matrixOffset + 68,
            );
            this._matrixData.set(
                [...cameraPosition, 1],
                matrixOffset + 72,
            );
        }

        if (renderItems.length > 0) {
            const usedFloatCount = floatsPerDraw * renderItems.length;
            this._device.queue.writeBuffer(
                this._transformBuffer,
                0,
                this._matrixData.subarray(0, usedFloatCount),
            );
        }

        this._gpuResourceCache.Prune(activeMeshes, activeMaterials);
    }

    _RequireMatrix(matrix, name) {
        if (!(matrix instanceof Float32Array) || matrix.length !== 16) {
            throw new TypeError(`${name} must contain 16 values.`);
        }
    }

    _ReadVector3(value, name) {
        if (
            !Array.isArray(value) && !(value instanceof Float32Array) ||
            value.length !== 3 || !value.every(Number.isFinite)
        ) {
            throw new TypeError(`${name} must contain three finite values.`);
        }
        return value;
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

    _DestroyTrackedResource(resource, memoryToken) {
        resource?.destroy();
        this._memoryTracker?.ReleaseResource(memoryToken);
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
        const timingFrame = this._gpuTimingTracker.BeginFrame();
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
            timestampWrites: timingFrame?.TimestampWrites,
        });

        renderPass.setPipeline(this._pipeline);

        for (const drawItem of this._drawItems) {
            renderPass.setBindGroup(0, this._transformBindGroup, [
                drawItem.transformOffset,
            ]);
            renderPass.setBindGroup(1, drawItem.materialBindGroup);
            renderPass.setVertexBuffer(0, drawItem.vertexBuffer);
            if (drawItem.indexBuffer) {
                renderPass.setIndexBuffer(
                    drawItem.indexBuffer,
                    drawItem.indexFormat,
                );
                renderPass.drawIndexed(
                    drawItem.indexCount,
                    1,
                    drawItem.firstIndex,
                );
            } else {
                renderPass.draw(
                    drawItem.vertexCount,
                    1,
                    drawItem.firstVertex,
                );
            }
        }

        renderPass.end();

        timingFrame?.Resolve(commandEncoder);

        try {
            this._device.queue.submit([commandEncoder.finish()]);
        } catch (error) {
            timingFrame?.Cancel();

            throw error;
        }

        timingFrame?.Read(frameNumber);
    }

    Shutdown() {
        this._context?.unconfigure();
        this._gpuTimingTracker.Destroy();
        this._gpuResourceCache?.Dispose();
        this._gpuResourceCache = null;
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
        this._linearTextureSampler = null;
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
