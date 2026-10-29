// WebGPURenderer is a class that encapsulates the functionality of rendering graphics using the WebGPU API.
// It provides methods to initialize the renderer, configure the canvas context, and render frames by clearing the canvas with a specified color.

export class WebGPURenderer {
    constructor(canvas) {
        this._canvas = canvas;
        this._context = null;
        this._device = null;
        this._format = null;
        this._pipeline = null;
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

        this._pipeline = this._device.createRenderPipeline({
            layout: "auto",
            vertex: {
                module: shaderModule,
                entryPoint: "VertexMain",
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
    }

    // Creates a command encoder to record GPU commands,
    // begins a render pass, draws a triangle, and submits the commands to the GPU queue.
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
        renderPass.draw(3);
        renderPass.end();

        this._device.queue.submit([commandEncoder.finish()]);
    }

    Shutdown() {
        this._context?.unconfigure();
        this._device?.destroy();

        this._context = null;
        this._device = null;
        this._format = null;
        this._pipeline = null;
    }
}
