// WebGPURenderer is a class that encapsulates the functionality of rendering graphics using the WebGPU API.
// It initializes GPU resources, including a vertex buffer, and draws a mesh to the canvas.

import { AstralLogger } from "../diagnostics/logger.js";
import { Mesh } from "./mesh.js";

export class WebGPURenderer {
    constructor(canvas) {
        this._canvas = canvas;
        this._context = null;
        this._device = null;
        this._format = null;
        this._pipeline = null;
        this._meshResources = new Map();
        this._drawItems = [];
        this._transformBindGroupLayout = null;
        this._transformBuffer = null;
        this._transformBindGroup = null;
        this._matrixBlockSize = 16 * 3 * Float32Array.BYTES_PER_ELEMENT;
        this._uniformStride = 0;
        this._drawCapacity = 0;
        this._matrixData = new Float32Array(0);
        this._depthTexture = null;
        this._depthView = null;
        this._depthWidth = 0;
        this._depthHeight = 0;
        this._depthFormat = "depth24plus";
    }

    // Initialize the WebGPU renderer by requesting a GPU adapter and device, and configuring the canvas context.
    async Initialize() {
        if (!navigator.gpu) {
            throw new Error("WebGPU is not available in this browser.");
        }

        const adapter = await navigator.gpu.requestAdapter();

        if (!adapter) {
            throw new Error("The browser could not access a GPU adapter.");
        }

        this._device = await adapter.requestDevice();

        const device = this._device;

        device.lost.then((lostInfo) => {
            if (lostInfo.reason === "destroyed") {
                return;
            }

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

        const shaderResponse = await fetch(
            "/src/graphics/shaders/triangle.wgsl",
        );

        if (!shaderResponse.ok) {
            throw new Error(
                `Could not load triangle shader. HTTP ${shaderResponse.status}.`,
            );
        }

        const shaderCode = await shaderResponse.text();
        const shaderModule = this._device.createShaderModule({
            code: shaderCode,
        });

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

        const pipelineLayout = this._device.createPipelineLayout({
            bindGroupLayouts: [this._transformBindGroupLayout],
        });

        this._pipeline = this._device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: "VertexMain",
                buffers: [
                    {
                        arrayStride: 12,
                        attributes: [
                            {
                                format: "float32x3",
                                offset: 0,
                                shaderLocation: 0,
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

        const floatsPerDraw =
            this._uniformStride / Float32Array.BYTES_PER_ELEMENT;

        for (let index = 0; index < renderItems.length; index += 1) {
            const renderItem = renderItems[index];

            if (!renderItem || typeof renderItem !== "object") {
                throw new TypeError("Each render item must be an object.");
            }

            this._RequireMatrix(renderItem.modelMatrix, "Model matrix");
            this._drawItems.push(this._GetMeshResource(renderItem.mesh));

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
    }

    _RequireMatrix(matrix, name) {
        if (!(matrix instanceof Float32Array) || matrix.length !== 16) {
            throw new TypeError(`${name} must contain 16 values.`);
        }
    }

    _GetMeshResource(mesh) {
        if (!(mesh instanceof Mesh)) {
            throw new TypeError("Render item requires a Mesh.");
        }

        let meshResource = this._meshResources.get(mesh);

        if (meshResource) {
            return meshResource;
        }

        const positions = mesh.GetPositions();
        const vertexBuffer = this._device.createBuffer({
            size: positions.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        this._device.queue.writeBuffer(vertexBuffer, 0, positions);

        meshResource = {
            vertexBuffer,
            vertexCount: mesh.VertexCount,
        };
        this._meshResources.set(mesh, meshResource);
        return meshResource;
    }

    _EnsureTransformCapacity(requiredDrawCount) {
        if (requiredDrawCount <= this._drawCapacity) {
            return;
        }

        let drawCapacity = Math.max(1, this._drawCapacity);
        while (drawCapacity < requiredDrawCount) {
            drawCapacity *= 2;
        }

        this._transformBuffer?.destroy();
        this._drawCapacity = drawCapacity;
        this._matrixData = new Float32Array(
            (this._uniformStride / Float32Array.BYTES_PER_ELEMENT) *
                drawCapacity,
        );

        this._transformBuffer = this._device.createBuffer({
            size: this._uniformStride * drawCapacity,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

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

        this._depthTexture?.destroy();

        this._depthTexture = this._device.createTexture({
            size: [width, height, 1],
            format: this._depthFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this._depthView = this._depthTexture.createView();
        this._depthWidth = width;
        this._depthHeight = height;
    }

    // Binds each mesh and its matrix data, then submits the frame to the GPU queue.
    Render() {
        this.EnsureDepthTexture();

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
        });

        renderPass.setPipeline(this._pipeline);

        for (let index = 0; index < this._drawItems.length; index += 1) {
            const drawItem = this._drawItems[index];

            renderPass.setBindGroup(0, this._transformBindGroup, [
                index * this._uniformStride,
            ]);
            renderPass.setVertexBuffer(0, drawItem.vertexBuffer);
            renderPass.draw(drawItem.vertexCount);
        }

        renderPass.end();

        this._device.queue.submit([commandEncoder.finish()]);
    }

    Shutdown() {
        this._context?.unconfigure();

        for (const meshResource of this._meshResources.values()) {
            meshResource.vertexBuffer.destroy();
        }

        this._meshResources.clear();
        this._drawItems.length = 0;
        this._transformBuffer?.destroy();
        this._depthTexture?.destroy();
        this._device?.destroy();

        this._context = null;
        this._device = null;
        this._format = null;
        this._pipeline = null;
        this._transformBindGroupLayout = null;
        this._transformBuffer = null;
        this._transformBindGroup = null;
        this._uniformStride = 0;
        this._drawCapacity = 0;
        this._matrixData = new Float32Array(0);
        this._depthTexture = null;
        this._depthView = null;
        this._depthWidth = 0;
        this._depthHeight = 0;
    }
}
