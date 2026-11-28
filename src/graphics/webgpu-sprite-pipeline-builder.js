export async function CreateWebGpuSpritePipeline({
    device,
    format,
    depthFormat,
    shaderUrl,
    signal,
}) {
    const response = await fetch(shaderUrl, { signal });
    if (!response.ok) {
        throw new Error(`Could not load sprite shader. HTTP ${response.status}.`);
    }
    const shaderModule = device.createShaderModule({
        code: await response.text(),
    });
    const frameBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: "uniform", minBindingSize: 128 },
            },
        ],
    });
    const spriteBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: {
                    type: "uniform",
                    hasDynamicOffset: true,
                    minBindingSize: 96,
                },
            },
        ],
    });
    const textureBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                texture: { sampleType: "float", viewDimension: "2d" },
            },
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: { type: "filtering" },
            },
        ],
    });
    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [
            frameBindGroupLayout,
            spriteBindGroupLayout,
            textureBindGroupLayout,
        ],
    });
    const pipeline = await device.createRenderPipelineAsync({
        layout: pipelineLayout,
        vertex: {
            module: shaderModule,
            entryPoint: "VertexMain",
            buffers: [
                {
                    arrayStride: 16,
                    attributes: [
                        { format: "float32x2", offset: 0, shaderLocation: 0 },
                        { format: "float32x2", offset: 8, shaderLocation: 1 },
                    ],
                },
            ],
        },
        fragment: {
            module: shaderModule,
            entryPoint: "FragmentMain",
            targets: [
                {
                    format,
                    blend: {
                        color: {
                            srcFactor: "src-alpha",
                            dstFactor: "one-minus-src-alpha",
                            operation: "add",
                        },
                        alpha: {
                            srcFactor: "one",
                            dstFactor: "one-minus-src-alpha",
                            operation: "add",
                        },
                    },
                },
            ],
        },
        primitive: {
            topology: "triangle-list",
            cullMode: "none",
        },
        depthStencil: {
            format: depthFormat,
            depthWriteEnabled: false,
            depthCompare: "less-equal",
        },
    });
    return {
        pipeline,
        frameBindGroupLayout,
        spriteBindGroupLayout,
        textureBindGroupLayout,
    };
}
