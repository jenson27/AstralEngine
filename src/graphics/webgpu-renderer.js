// WebGPURenderer is a class that encapsulates the functionality of rendering graphics using the WebGPU API.
// It initializes GPU resources, including a vertex buffer, and draws a mesh to the canvas.

import { Mesh } from "./mesh.js";

export class WebGPURenderer {
    constructor(canvas) {
        this._canvas = canvas;
        this._context = null;
        this._device = null;
        this._format = null;
        this._pipeline = null;
        this._vertexBuffer = null;
        this._vertexCount = 0;
        this._transformBuffer = null;
        this._transformBindGroup = null;
        this._matrixData = new Float32Array(16 * 3);
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

        this._pipeline = this._device.createRenderPipeline({
            layout: "auto",
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

        this._transformBuffer = this._device.createBuffer({
            size: this._matrixData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this._transformBindGroup = this._device.createBindGroup({
            layout: this._pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this._transformBuffer },
                },
            ],
        });

        const identityMatrix = new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        ]);

        this.SetMatrices(identityMatrix, identityMatrix, identityMatrix);
    }

    SetMesh(mesh) {
        if (!(mesh instanceof Mesh)) {
            throw new TypeError("Renderer requires a Mesh.");
        }

        if (!this._device) {
            throw new Error("Renderer is not initialized.");
        }

        const positions = mesh.GetPositions();
        const vertexBuffer = this._device.createBuffer({
            size: positions.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        this._device.queue.writeBuffer(vertexBuffer, 0, positions);

        this._vertexBuffer?.destroy();
        this._vertexBuffer = vertexBuffer;
        this._vertexCount = mesh.VertexCount;
    }

    // Updates the model, view, and projection matrices in the uniform buffer.
    SetMatrices(modelMatrix, viewMatrix, projectionMatrix) {
        if (
            !(modelMatrix instanceof Float32Array) ||
            modelMatrix.length !== 16 ||
            !(viewMatrix instanceof Float32Array) ||
            viewMatrix.length !== 16 ||
            !(projectionMatrix instanceof Float32Array) ||
            projectionMatrix.length !== 16
        ) {
            throw new TypeError(
                "Model, view, and projection matrices must each contain 16 values.",
            );
        }

        if (!this._transformBuffer) {
            throw new Error("Renderer is not initialized.");
        }

        this._matrixData.set(modelMatrix, 0);
        this._matrixData.set(viewMatrix, 16);
        this._matrixData.set(projectionMatrix, 32);

        this._device.queue.writeBuffer(
            this._transformBuffer,
            0,
            this._matrixData,
        );
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

    // Binds the vertex buffer, draws the mesh, and submits the commands to the GPU queue.
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
        renderPass.setBindGroup(0, this._transformBindGroup);
        renderPass.setVertexBuffer(0, this._vertexBuffer);
        renderPass.draw(this._vertexCount);
        renderPass.end();

        this._device.queue.submit([commandEncoder.finish()]);
    }

    Shutdown() {
        this._context?.unconfigure();
        this._vertexBuffer?.destroy();
        this._transformBuffer?.destroy();
        this._depthTexture?.destroy();
        this._device?.destroy();

        this._context = null;
        this._device = null;
        this._format = null;
        this._pipeline = null;
        this._vertexBuffer = null;
        this._vertexCount = 0;
        this._transformBuffer = null;
        this._transformBindGroup = null;
        this._depthTexture = null;
        this._depthView = null;
        this._depthWidth = 0;
        this._depthHeight = 0;
    }
}
