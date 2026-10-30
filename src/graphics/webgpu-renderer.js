// WebGPURenderer is a class that encapsulates the functionality of rendering graphics using the WebGPU API.
// It initializes GPU resources, including a vertex buffer, and draws a triangle to the canvas.

export class WebGPURenderer {
    constructor(canvas) {
        this._canvas = canvas;
        this._context = null;
        this._device = null;
        this._format = null;
        this._pipeline = null;
        this._vertexBuffer = null;
        this._transformBuffer = null;
        this._transformBindGroup = null;
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

        const vertexData = new Float32Array([
            0.0, 0.6,
            -0.6, -0.5,
            0.6, -0.5,
        ]);

        this._vertexBuffer = this._device.createBuffer({
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        this._device.queue.writeBuffer(this._vertexBuffer, 0, vertexData);

        this._pipeline = this._device.createRenderPipeline({
            layout: "auto",
            vertex: {
                module: shaderModule,
                entryPoint: "VertexMain",
                buffers: [
                    {
                        arrayStride: 8,
                        attributes: [
                            {
                                format: "float32x2",
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
        });

        this._transformBuffer = this._device.createBuffer({
            size: 16 * Float32Array.BYTES_PER_ELEMENT,
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

        this.SetModelMatrix(
            new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1,
            ]),
        );
    }

    // Updates the model matrix in the uniform buffer.
    SetModelMatrix(modelMatrix) {
        if (!(modelMatrix instanceof Float32Array) || modelMatrix.length !== 16) {
            throw new TypeError(
                "Model matrix must be a 16-element Float32Array.",
            );
        }

        if (!this._transformBuffer) {
            throw new Error("Renderer is not initialized.");
        }

        this._device.queue.writeBuffer(this._transformBuffer, 0, modelMatrix);
    }

    // Binds the vertex buffer, draws the triangle, and submits the commands to the GPU queue.
    Render() {
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
        });

        renderPass.setPipeline(this._pipeline);
        renderPass.setBindGroup(0, this._transformBindGroup);
        renderPass.setVertexBuffer(0, this._vertexBuffer);
        renderPass.draw(3);
        renderPass.end();

        this._device.queue.submit([commandEncoder.finish()]);
    }

    Shutdown() {
        this._context?.unconfigure();
        this._vertexBuffer?.destroy();
        this._transformBuffer?.destroy();
        this._device?.destroy();

        this._context = null;
        this._device = null;
        this._format = null;
        this._pipeline = null;
        this._vertexBuffer = null;
        this._transformBuffer = null;
        this._transformBindGroup = null;
    }
}
